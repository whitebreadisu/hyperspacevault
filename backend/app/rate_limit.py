"""BL-126 anti-abuse cheap tier: a simple in-memory per-IP-per-hour
submission cap. This is deliberately the cheapest possible tier -- state
lives in one Cloud Run *instance's* process memory, so it resets on every
cold start/restart/scale event and is blind to traffic landing on a
different instance. Good enough to blunt a lone bot hammering one
instance; not a defense against a distributed or persistent attacker.

BL-53 (revised scope, 2026-07-24) extends this same per-instance pattern
with a tenant-keyed variant (`check_tenant_rate_limit` below) for
POST /api/inventory/import (30/hr/tenant) and POST /api/deck-check
(60/hr/tenant) -- same documented caveat applies: an attacker fanned
across multiple Cloud Run instances, or a cold start mid-window, resets
or splits the count. Real distributed rate limiting (a shared store --
Redis/Memorystore, or an edge control like Cloud Armor) remains a bigger
infra lift than this cheap tier and is out of scope here.

BL-266 (2026-10-14) bounds the memory of both stores. Before it, a key's
timestamps were pruned only when that same key came back, so every
one-off client (one IP hitting GET /api/shared/<anything> once) left an
entry behind for the life of the instance. Now:
  - a sweep, at most once per SWEEP_INTERVAL_SECONDS and run on the
    request path, deletes every key whose newest attempt has aged out of
    its window (nothing left to count, so dropping it changes no answer);
  - each store holds at most MAX_KEYS keys. A new key arriving at a full
    store evicts the least recently used key -- O(1), so a flood of fresh
    keys costs no more CPU per request than normal traffic.
    Eviction is fail-OPEN: the evicted client simply starts a fresh
    budget. Refusing new keys instead would let a flood of fresh keys
    lock out every legitimate first-time caller.
  - IP keys collapse an IPv6 address to its /64 (`client_ip_key`), the
    block one subscriber or one cloud VM gets; keyed per full address,
    one host could rotate through 2^64 addresses for a fresh budget each.

Module-level state (not a class instantiated per-request) so the counter
is genuinely shared across requests within one process, matching how a
real per-instance limiter has to work.
"""

import ipaddress
import time
from bisect import bisect_left
from collections import OrderedDict

MAX_SUBMISSIONS_PER_WINDOW = 5
WINDOW_SECONDS = 60 * 60  # one hour

# BL-266: a full store of one-hit keys measured ~19 MB (~370 bytes a key
# with the OrderedDict), so both stores together stay under ~40 MB of the
# 512 MiB Cloud Run container -- bounded even mid-flood.
MAX_KEYS = 50_000
SWEEP_INTERVAL_SECONDS = 60.0
_IPV6_64_MASK = ((1 << 64) - 1) << 64


class _SlidingWindowStore:
    """Per-key sliding-window attempt log with bounded memory (BL-266).

    `_keys` maps key -> (window_seconds, ascending attempt timestamps), in
    LRU order: every hit moves its key to the end, so the first key is the
    least recently used. An OrderedDict, not a dict: popping a plain
    dict's first key repeatedly is O(deleted slots) per pop until the next
    resize, which a flood turns quadratic; popitem(last=False) is O(1).
    """

    def __init__(self, max_keys: int, sweep_interval: float) -> None:
        self.max_keys = max_keys
        self.sweep_interval = sweep_interval
        self._keys: OrderedDict[str, tuple[float, list[float]]] = OrderedDict()
        self._last_sweep: float | None = None

    def __len__(self) -> int:
        return len(self._keys)

    def __contains__(self, key: str) -> bool:
        return key in self._keys

    def hit(
        self, key: str, max_calls: int, window_seconds: float, now: float
    ) -> float | None:
        """Record an attempt for `key` unless it is over budget. Returns
        None when allowed, else the seconds until its oldest in-window
        attempt expires."""
        if self._last_sweep is None or now - self._last_sweep >= self.sweep_interval:
            self.sweep(now)

        entry = self._keys.pop(key, None)
        if entry is None:
            # No sweep here: on a full store that would be O(keys) work per
            # request for exactly the flood the cap exists for. The LRU
            # head is the key idle longest, which for one shared window is
            # also the first to expire.
            while len(self._keys) >= self.max_keys:
                self._keys.popitem(last=False)
            attempts: list[float] = []
        else:
            attempts = entry[1]
            del attempts[: bisect_left(attempts, now - window_seconds)]
        self._keys[key] = (window_seconds, attempts)

        if len(attempts) >= max_calls:
            return window_seconds - (now - attempts[0])
        attempts.append(now)
        return None

    def sweep(self, now: float) -> None:
        """Drop every key whose newest attempt is outside its window."""
        self._last_sweep = now
        expired = [
            key
            for key, (window, attempts) in self._keys.items()
            if not attempts or attempts[-1] < now - window
        ]
        for key in expired:
            del self._keys[key]

    def clear(self) -> None:
        self._keys.clear()
        self._last_sweep = None


_submissions = _SlidingWindowStore(MAX_KEYS, SWEEP_INTERVAL_SECONDS)

# BL-53: a separate store (and separate function) from the feedback limiter
# above -- deliberately not a generalized rewrite of is_rate_limited itself,
# to keep this change scoped to the new call sites and leave the
# already-shipped/tested feedback path untouched.
_tenant_calls = _SlidingWindowStore(MAX_KEYS, SWEEP_INTERVAL_SECONDS)


def client_ip_key(host: str | None) -> str:
    """The rate-limit key for a client address (BL-266). IPv4 is used as
    is; an IPv4-mapped IPv6 address becomes its IPv4 form; any other IPv6
    address becomes its /64 network. Anything unparseable (TestClient's
    "testclient", a missing peer) passes through unchanged."""
    if not host:
        return "unknown"
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return host
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.ipv4_mapped is not None:
            return str(addr.ipv4_mapped)
        # Masking the integer is ~100x cheaper than building an IPv6Network.
        return f"{ipaddress.IPv6Address(int(addr) & _IPV6_64_MASK)}/64"
    return str(addr)


def is_rate_limited(client_key: str, now: float | None = None) -> bool:
    """True if client_key has already made MAX_SUBMISSIONS_PER_WINDOW
    attempts within the trailing WINDOW_SECONDS. Also records this call as
    a new attempt when it is NOT rate-limited -- callers should call this
    exactly once per submission attempt, so a request rejected earlier for
    an unrelated reason (e.g. a 422 payload) never consumes a slot."""
    current = now if now is not None else time.monotonic()
    return (
        _submissions.hit(
            client_key, MAX_SUBMISSIONS_PER_WINDOW, WINDOW_SECONDS, current
        )
        is not None
    )


def check_tenant_rate_limit(
    scope: str,
    tenant_id: int | str,
    *,
    max_calls: int,
    window_seconds: int,
    now: float | None = None,
) -> int | None:
    """Per-tenant sliding-window limiter (BL-53 A4-13/A4-04). `scope`
    namespaces the call site (e.g. "inventory_import", "deck_check") so
    exhausting one endpoint's budget never counts against another's, even
    for the same tenant. `tenant_id` must always be server-resolved (from
    request.state.tenant_id, set by get_db via the verified Firebase
    identity + RLS -- never client-supplied) exactly like every other
    tenant-scoped check in this codebase. (The share-read limiter passes a
    `client_ip_key` here instead -- same store, IP-keyed.)

    Returns None when the call is allowed (and records it as an attempt,
    same one-call-per-request contract as is_rate_limited). Returns the
    whole number of seconds the caller should wait (for a Retry-After
    header) when the tenant is over budget -- computed from the oldest
    attempt still inside the window, not a flat window_seconds, so the
    caller gets a tightening countdown rather than always being told to
    wait the full hour.
    """
    current = now if now is not None else time.monotonic()
    retry_after = _tenant_calls.hit(
        f"{scope}:{tenant_id}", max_calls, window_seconds, current
    )
    if retry_after is None:
        return None
    return max(1, int(retry_after) + 1)


def _reset_for_tests() -> None:
    """Test-only: clears every recorded attempt (both the feedback
    per-IP store and the BL-53 per-tenant store) so rate-limit tests
    don't leak state into (or inherit it from) other tests sharing this
    process."""
    _submissions.clear()
    _tenant_calls.clear()
