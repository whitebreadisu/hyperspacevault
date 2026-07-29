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

Module-level state (not a class instantiated per-request) so the counter
is genuinely shared across requests within one process, matching how a
real per-instance limiter has to work.
"""

import time
from collections import defaultdict

MAX_SUBMISSIONS_PER_WINDOW = 5
WINDOW_SECONDS = 60 * 60  # one hour

_submissions: dict[str, list[float]] = defaultdict(list)

# BL-53: a separate store (and separate function) from the feedback limiter
# above -- deliberately not a generalized rewrite of is_rate_limited itself,
# to keep this change scoped to the new call sites and leave the
# already-shipped/tested feedback path untouched.
_tenant_calls: dict[str, list[float]] = defaultdict(list)


def is_rate_limited(client_key: str, now: float | None = None) -> bool:
    """True if client_key has already made MAX_SUBMISSIONS_PER_WINDOW
    attempts within the trailing WINDOW_SECONDS. Also records this call as
    a new attempt when it is NOT rate-limited -- callers should call this
    exactly once per submission attempt, so a request rejected earlier for
    an unrelated reason (e.g. a 422 payload) never consumes a slot."""
    current = now if now is not None else time.monotonic()
    attempts = _submissions[client_key]
    cutoff = current - WINDOW_SECONDS
    while attempts and attempts[0] < cutoff:
        attempts.pop(0)
    if len(attempts) >= MAX_SUBMISSIONS_PER_WINDOW:
        return True
    attempts.append(current)
    return False


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
    tenant-scoped check in this codebase.

    Returns None when the call is allowed (and records it as an attempt,
    same one-call-per-request contract as is_rate_limited). Returns the
    whole number of seconds the caller should wait (for a Retry-After
    header) when the tenant is over budget -- computed from the oldest
    attempt still inside the window, not a flat window_seconds, so the
    caller gets a tightening countdown rather than always being told to
    wait the full hour.
    """
    key = f"{scope}:{tenant_id}"
    current = now if now is not None else time.monotonic()
    attempts = _tenant_calls[key]
    cutoff = current - window_seconds
    while attempts and attempts[0] < cutoff:
        attempts.pop(0)
    if len(attempts) >= max_calls:
        retry_after = window_seconds - (current - attempts[0])
        return max(1, int(retry_after) + 1)
    attempts.append(current)
    return None


def _reset_for_tests() -> None:
    """Test-only: clears every recorded attempt (both the feedback
    per-IP store and the BL-53 per-tenant store) so rate-limit tests
    don't leak state into (or inherit it from) other tests sharing this
    process."""
    _submissions.clear()
    _tenant_calls.clear()
