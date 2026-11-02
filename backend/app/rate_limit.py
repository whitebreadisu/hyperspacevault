"""Anti-abuse cheap tier: in-memory, per-instance sliding-window rate
limits. The contract (what this tier promises, what it does not, and its
memory bound) is written in specification_documents/SWU_Platform_Spec.md
section 5.1, the bullet "Limiter cheap-tier contract and memory bound";
this module is its implementation. In short:

  - `is_rate_limited`: POST /api/feedback, 5/hr per client IP.
  - `check_tenant_rate_limit`: POST /api/inventory/import (30/hr/tenant),
    POST /api/deck-check (60/hr/tenant) and the GET /api/shared/{token}
    reads (300/hr per client IP).
  - enforcement is per process, from the state this process still holds.
    State lives in one Cloud Run *instance's* memory, so it resets on every
    cold start/restart/scale event; each extra instance is an independent
    budget, and a key evicted at MAX_KEYS starts afresh (fail-open, below).
    Within those limits a client at its limit gets the 429. Good enough to
    blunt a lone client hammering one instance; not a defense against a
    distributed or persistent attacker. Real distributed rate limiting (a
    shared store -- Redis/Memorystore, or an edge control like Cloud
    Armor) is not attempted here.
  - attempt times are whole seconds rounded up, a conservative overcount:
    a client is never admitted past its limit, and one under it can be
    held back up to one second past the exact window (the Retry-After
    header rounds up to whole seconds, so it is under two seconds over).
  - the time is read inside the store's lock (`hit()` calls
    time.monotonic() itself), so concurrent requests are stamped in the
    order they are processed. A stamp is never recorded below the key's
    newest one (clamped up: conservative), so each key's log stays sorted
    even for injected test times; with the clock read under the lock the
    clamp never fires in production. Precondition: ceil(time) fits the log's
    unsigned 32-bit entries (0 to 2**32-1 s; monotonic seconds take ~136
    years to pass that).

Memory is bounded by key count and by bytes per key:
  - a sweep, at most once per SWEEP_INTERVAL_SECONDS and run on the
    request path, deletes every key whose newest attempt has aged out of
    its window (nothing left to count, so dropping it changes no answer).
    Without it every one-off client (one IP hitting
    GET /api/shared/<anything> once) would leave an entry behind for the
    life of the instance;
  - each store holds at most MAX_KEYS keys. A new key arriving at a full
    store evicts the least recently used key -- O(1), so a flood of fresh
    keys costs no more CPU per request than normal traffic.
    Eviction is fail-OPEN: the evicted client simply starts a fresh
    budget. Refusing new keys instead would let a flood of fresh keys
    lock out every legitimate first-time caller;
  - a key never holds more than max_calls attempts (a refused call is not
    recorded), each 4 bytes (`_KeyLog`);
  - IP keys collapse an IPv6 address to its /64 (`client_ip_key`), the
    block one subscriber or one cloud VM gets; keyed per full address,
    one host could rotate through 2^64 addresses for a fresh budget each.
    `client_ip_key` turns every unparseable host into the one key
    "invalid" (and a missing one into "unknown"), so a forged header cannot
    mint long or numerous keys. Every key is therefore an IP key or
    "<scope>:<server-resolved tenant id>", and the longest is a normalized
    IPv6 /64 plus the "shared_read:" prefix.

Worst case, as Python-allocated bytes measured with tracemalloc on Python
3.12 (process RSS is higher), pinned by test_rate_limit.py: both stores
full of MAX_KEYS longest keys, every key at its limit (300 shared reads in
the keyed store, 5 in the feedback store), peak at 99.4 MB while the
OrderedDict tables resize under churn (keyed store 75.8 MB, ~1.5 KB a key:
1,200 bytes of attempts plus array slack, key string, array header and
dict slot; feedback store 13.8 MB; 95.6 MB together at rest). The stated
bound is 115 MB, about 21% of the 512 MiB Cloud Run container
(terraform/modules/app sets no memory limit, so the default applies).
The keyed store's figure scales with the largest max_calls any caller
passes; raising a limit above 300 means re-measuring.

Module-level state (not a class instantiated per-request) so the counter
is genuinely shared across requests within one process, matching how a
real per-instance limiter has to work.
"""

import ipaddress
import math
import threading
import time
from array import array
from bisect import bisect_left
from collections import OrderedDict
from typing import cast

MAX_SUBMISSIONS_PER_WINDOW = 5
WINDOW_SECONDS = 60 * 60  # one hour

MAX_KEYS = 50_000
SWEEP_INTERVAL_SECONDS = 60.0
_IPV6_64_MASK = ((1 << 64) - 1) << 64

# The memory bound and the 2**32-1 s ceiling assume 4-byte 'I' entries (a C
# unsigned int: 4 bytes on CPython for Linux x86-64 and Windows).
if array("I").itemsize != 4:
    raise RuntimeError("rate_limit needs a 4-byte array('I') item")
INVALID_HOST_KEY = "invalid"


class _KeyLog(array[int]):
    """One key's in-window attempt times as whole seconds (unsigned 32-bit,
    ascending), plus the key's window length. An array subclass rather
    than an object holding an array: one header per key instead of two."""

    __slots__ = ("window",)
    window: float

    def __new__(cls, window: float) -> "_KeyLog":
        log = cast("_KeyLog", super().__new__(cls, "I"))
        log.window = window
        return log


class _SlidingWindowStore:
    """Per-key sliding-window attempt log with bounded memory.

    `_keys` maps key -> `_KeyLog`, in LRU order: every hit moves its key to
    the end, so the first key is the least recently used. An OrderedDict,
    not a dict: popping a plain dict's first key repeatedly is O(deleted
    slots) per pop until the next resize, which a flood turns quadratic;
    popitem(last=False) is O(1).

    Time is time.monotonic() seconds, read inside the lock; tests may
    inject `now`. An attempt at time t is recorded as ceil(t), 4 bytes,
    so ceil(t) must lie in 0..2**32-1 (monotonic seconds take ~136 years
    to pass that), and never below the key's newest stamp: a lower one is
    clamped up to it, which keeps the log sorted for bisect and only ever
    counts an attempt longer. Rounding up is the conservative direction: an attempt counts for up to
    one second longer than its exact window, never shorter, so a client is
    never admitted past its limit and one under it is held back by at most
    that one second (the wait hit() returns is at most one second over the
    exact wait).

    One lock per store, held for all of hit(), including the time read
    and a due sweep: sync handlers and dependencies run in FastAPI's
    threadpool, and without it two threads could both admit a key's last
    slot, lose an attempt while the key is popped and re-inserted, or
    record their stamps out of order.
    """

    def __init__(self, max_keys: int, sweep_interval: float) -> None:
        self.max_keys = max_keys
        self.sweep_interval = sweep_interval
        self._keys: OrderedDict[str, _KeyLog] = OrderedDict()
        self._last_sweep: float | None = None
        self._lock = threading.Lock()

    def __len__(self) -> int:
        return len(self._keys)

    def __contains__(self, key: str) -> bool:
        return key in self._keys

    def hit(
        self,
        key: str,
        max_calls: int,
        window_seconds: float,
        now: float | None = None,
    ) -> float | None:
        """Record an attempt for `key` unless it is over budget. Returns
        None when allowed, else the seconds until its oldest in-window
        attempt expires. `now` is for tests; production callers omit it."""
        with self._lock:
            if now is None:
                now = time.monotonic()
            if (
                self._last_sweep is None
                or now - self._last_sweep >= self.sweep_interval
            ):
                self._sweep(now)

            log = self._keys.pop(key, None)
            if log is None:
                # No sweep here: on a full store that would be O(keys) work
                # per request for exactly the flood the cap exists for. The
                # LRU head is the key idle longest, which for one shared
                # window is also the first to expire.
                while len(self._keys) >= self.max_keys:
                    self._keys.popitem(last=False)
                log = _KeyLog(window_seconds)
            else:
                log.window = window_seconds
                del log[: bisect_left(log, now - window_seconds)]
            self._keys[key] = log

            if len(log) >= max_calls:
                return window_seconds - (now - log[0])
            stamp = math.ceil(now)
            log.append(max(stamp, log[-1]) if log else stamp)
            return None

    def _sweep(self, now: float) -> None:
        """Drop every key whose newest attempt is outside its window. Called
        from hit() with the lock held, for the whole pass: on a full store
        that is a ~9-15 ms pause for every caller once a minute."""
        self._last_sweep = now
        expired = [
            key
            for key, log in self._keys.items()
            if not log or log[-1] < now - log.window
        ]
        for key in expired:
            del self._keys[key]

    def clear(self) -> None:
        with self._lock:
            self._keys.clear()
            self._last_sweep = None


_submissions = _SlidingWindowStore(MAX_KEYS, SWEEP_INTERVAL_SECONDS)

# A separate store (and separate function) from the feedback limiter
# above, each with its own MAX_KEYS cap: a flood of fresh keys on the
# feedback limiter cannot evict this store's keys, and vice versa. Within
# this store the keys are NOT isolated: the anonymous per-IP shared-read
# keys (app/database.py's get_shared_db) and the per-tenant import and
# deck-check keys share the one LRU cap, so a flood of fresh IPs on
# /api/shared/ can evict tenant keys (fail-open: an evicted tenant starts
# a fresh budget).
_tenant_calls = _SlidingWindowStore(MAX_KEYS, SWEEP_INTERVAL_SECONDS)


def client_ip_key(host: str | None) -> str:
    """The rate-limit key for a client address. IPv4 is used as
    is; an IPv4-mapped IPv6 address becomes its IPv4 form; any other IPv6
    address becomes its /64 network. A missing peer becomes "unknown" and
    anything unparseable (TestClient's "testclient", a forged
    X-Forwarded-For entry) becomes the one fixed key "invalid": passing it
    through would let a caller mint unlimited keys as long as a request
    header, which breaks the memory bound, and a single bucket gives all
    such callers one shared budget."""
    if not host:
        return "unknown"
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return INVALID_HOST_KEY
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
    return (
        _submissions.hit(client_key, MAX_SUBMISSIONS_PER_WINDOW, WINDOW_SECONDS, now)
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
    """Per-tenant sliding-window limiter. `scope`
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
    retry_after = _tenant_calls.hit(
        f"{scope}:{tenant_id}", max_calls, window_seconds, now
    )
    if retry_after is None:
        return None
    return max(1, int(retry_after) + 1)


def _reset_for_tests() -> None:
    """Test-only: clears every recorded attempt (both the feedback
    per-IP store and the per-tenant store) so rate-limit tests
    don't leak state into (or inherit it from) other tests sharing this
    process."""
    _submissions.clear()
    _tenant_calls.clear()
