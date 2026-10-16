"""BL-53 (revised scope, A4-13/A4-04): unit tests for the per-tenant
sliding-window limiter (app/rate_limit.py's check_tenant_rate_limit). Pure
unit tests against the module's in-memory state -- no DB, no TestClient --
mirroring test_logging.py's no-DATABASE_URL-needed pattern. Integration
coverage (the 429 + Retry-After behavior wired into the actual routers) is
in test_inventory_import_api.py::TestRateLimit and
test_deck_check_api.py::TestRateLimit.
"""

import pytest

from app import rate_limit
from app.rate_limit import (
    _reset_for_tests,
    _SlidingWindowStore,
    check_tenant_rate_limit,
    client_ip_key,
    is_rate_limited,
)


def setup_function():
    _reset_for_tests()


def test_calls_under_the_limit_are_allowed_and_return_none():
    for i in range(5):
        assert (
            check_tenant_rate_limit(
                "scope_a", "tenant_1", max_calls=5, window_seconds=3600, now=float(i)
            )
            is None
        )


def test_the_call_that_exceeds_the_limit_returns_a_positive_retry_after():
    for i in range(5):
        check_tenant_rate_limit(
            "scope_a", "tenant_1", max_calls=5, window_seconds=3600, now=float(i)
        )
    retry_after = check_tenant_rate_limit(
        "scope_a", "tenant_1", max_calls=5, window_seconds=3600, now=5.0
    )
    assert isinstance(retry_after, int)
    assert retry_after > 0


def test_retry_after_counts_down_toward_the_oldest_attempt_expiring():
    # Five calls at t=0..4, all within a 3600s window.
    for i in range(5):
        check_tenant_rate_limit(
            "scope_a", "tenant_1", max_calls=5, window_seconds=3600, now=float(i)
        )
    early = check_tenant_rate_limit(
        "scope_a", "tenant_1", max_calls=5, window_seconds=3600, now=10.0
    )
    later = check_tenant_rate_limit(
        "scope_a", "tenant_1", max_calls=5, window_seconds=3600, now=100.0
    )
    # Both still limited (oldest attempt at t=0 hasn't expired out of the
    # 3600s window yet), but the wait shrinks as real time advances.
    assert early is not None and later is not None
    assert later < early


def test_window_expiry_frees_a_slot():
    for i in range(5):
        check_tenant_rate_limit(
            "scope_a", "tenant_1", max_calls=5, window_seconds=100, now=float(i)
        )
    # Oldest attempt (t=0) is now outside the 100s window -- one slot frees.
    assert (
        check_tenant_rate_limit(
            "scope_a", "tenant_1", max_calls=5, window_seconds=100, now=101.0
        )
        is None
    )


def test_scopes_are_independent_even_for_the_same_tenant():
    """Exhausting inventory_import's budget must never count against
    deck_check's for the same tenant -- each router passes its own scope
    string precisely so the two stay independent."""
    for i in range(5):
        check_tenant_rate_limit(
            "inventory_import", "tenant_9", max_calls=5, window_seconds=3600, now=0.0
        )
    assert (
        check_tenant_rate_limit(
            "inventory_import", "tenant_9", max_calls=5, window_seconds=3600, now=0.0
        )
        is not None
    )
    assert (
        check_tenant_rate_limit(
            "deck_check", "tenant_9", max_calls=5, window_seconds=3600, now=0.0
        )
        is None
    )


def test_tenants_are_independent_within_the_same_scope():
    for i in range(5):
        check_tenant_rate_limit(
            "deck_check", "tenant_a", max_calls=5, window_seconds=3600, now=0.0
        )
    assert (
        check_tenant_rate_limit(
            "deck_check", "tenant_a", max_calls=5, window_seconds=3600, now=0.0
        )
        is not None
    )
    assert (
        check_tenant_rate_limit(
            "deck_check", "tenant_b", max_calls=5, window_seconds=3600, now=0.0
        )
        is None
    )


def test_reset_for_tests_clears_the_tenant_store_too():
    """_reset_for_tests is the same helper the feedback limiter's autouse
    conftest fixture calls before every test -- it must clear BOTH stores,
    or a tenant-keyed test run earlier in the process could leak state
    into a later one."""
    for i in range(5):
        check_tenant_rate_limit(
            "deck_check", "tenant_z", max_calls=5, window_seconds=3600, now=0.0
        )
    assert (
        check_tenant_rate_limit(
            "deck_check", "tenant_z", max_calls=5, window_seconds=3600, now=0.0
        )
        is not None
    )
    _reset_for_tests()
    assert (
        check_tenant_rate_limit(
            "deck_check", "tenant_z", max_calls=5, window_seconds=3600, now=0.0
        )
        is None
    )


# --- BL-266: bounded memory (sweep + key cap) and IPv6 /64 keys ----------
# The pre-BL-266 stores pruned a key only when that same key came back, so
# one-off keys (one IP, one GET /api/shared/<anything>) accumulated for the
# life of the instance. These pin the sweep, the cap and its eviction order,
# and the /64 collapse that stops one IPv6 host rotating addresses.


def test_sweep_drops_one_off_keys_once_their_window_has_passed():
    store = _SlidingWindowStore(max_keys=1000, sweep_interval=60)
    for i in range(100):
        store.hit(f"ip-{i}", max_calls=5, window_seconds=100, now=0.0)
    assert len(store) == 100
    # The next call after the window (and the sweep interval) has passed
    # sweeps every expired key; only the caller's own key remains.
    store.hit("ip-new", max_calls=5, window_seconds=100, now=200.0)
    assert len(store) == 1
    assert "ip-new" in store


def test_sweep_keeps_keys_that_still_have_attempts_in_their_window():
    store = _SlidingWindowStore(max_keys=1000, sweep_interval=60)
    store.hit("old", max_calls=5, window_seconds=100, now=0.0)
    store.hit("recent", max_calls=5, window_seconds=100, now=90.0)
    store.hit("caller", max_calls=5, window_seconds=100, now=150.0)
    assert "old" not in store
    assert "recent" in store


def test_sweep_runs_at_most_once_per_interval():
    store = _SlidingWindowStore(max_keys=1000, sweep_interval=60)
    store.hit("a", max_calls=5, window_seconds=10, now=0.0)  # first call sweeps
    store.hit("b", max_calls=5, window_seconds=10, now=30.0)
    # "a" expired at t=10, but no sweep is due until t=60.
    assert "a" in store
    store.hit("c", max_calls=5, window_seconds=10, now=61.0)
    assert "a" not in store and "b" not in store


def test_a_store_never_holds_more_than_max_keys():
    store = _SlidingWindowStore(max_keys=50, sweep_interval=3600)
    for i in range(500):  # a flood of fresh keys, all still in-window
        store.hit(f"ip-{i}", max_calls=5, window_seconds=3600, now=float(i))
    assert len(store) == 50


def test_a_full_store_evicts_the_least_recently_used_key():
    store = _SlidingWindowStore(max_keys=3, sweep_interval=3600)
    for key in ("a", "b", "c"):
        store.hit(key, max_calls=5, window_seconds=3600, now=1.0)
    store.hit("a", max_calls=5, window_seconds=3600, now=2.0)  # "b" is now LRU
    store.hit("d", max_calls=5, window_seconds=3600, now=3.0)
    assert "b" not in store
    assert all(k in store for k in ("a", "c", "d"))


def test_a_full_store_does_not_sweep_on_every_new_key(monkeypatch):
    """A full store must stay O(1) per hit: sweeping on every new key would
    turn a flood of fresh keys into O(keys) CPU per request."""
    store = _SlidingWindowStore(max_keys=10, sweep_interval=3600)
    sweeps = []
    real_sweep = store.sweep
    monkeypatch.setattr(
        store, "sweep", lambda now: (sweeps.append(now), real_sweep(now))
    )
    for i in range(1000):
        store.hit(f"ip-{i}", max_calls=5, window_seconds=3600, now=float(i) / 10)
    assert len(store) == 10
    assert len(sweeps) == 1  # only the first call's periodic sweep


def test_eviction_fails_open_with_a_fresh_budget():
    """An evicted key starts over rather than staying blocked -- a flood of
    fresh keys must never lock out the clients it pushes out."""
    store = _SlidingWindowStore(max_keys=2, sweep_interval=3600)
    for _ in range(3):
        store.hit("busy", max_calls=3, window_seconds=3600, now=0.0)
    assert store.hit("busy", max_calls=3, window_seconds=3600, now=0.0) is not None
    store.hit("x", max_calls=3, window_seconds=3600, now=1.0)
    store.hit("y", max_calls=3, window_seconds=3600, now=1.0)  # evicts "busy"
    assert store.hit("busy", max_calls=3, window_seconds=3600, now=2.0) is None


def test_module_stores_are_capped(monkeypatch):
    monkeypatch.setattr(rate_limit._tenant_calls, "max_keys", 20)
    monkeypatch.setattr(rate_limit._submissions, "max_keys", 20)
    for i in range(200):
        check_tenant_rate_limit(
            "shared_read",
            f"10.0.{i // 256}.{i % 256}",
            max_calls=300,
            window_seconds=3600,
            now=float(i),
        )
        is_rate_limited(f"10.1.{i // 256}.{i % 256}", now=float(i))
    assert len(rate_limit._tenant_calls) == 20
    assert len(rate_limit._submissions) == 20


def test_feedback_limit_still_trips_at_max_submissions():
    for i in range(rate_limit.MAX_SUBMISSIONS_PER_WINDOW):
        assert is_rate_limited("203.0.113.9", now=float(i)) is False
    assert is_rate_limited("203.0.113.9", now=10.0) is True
    # ...and frees once the oldest attempt leaves the window.
    assert is_rate_limited("203.0.113.9", now=rate_limit.WINDOW_SECONDS + 0.5) is False


@pytest.mark.parametrize(
    ("host", "key"),
    [
        ("203.0.113.7", "203.0.113.7"),
        ("2001:db8:1:2:aaaa::1", "2001:db8:1:2::/64"),
        ("2001:db8:1:2:ffff:ffff:ffff:ffff", "2001:db8:1:2::/64"),
        ("::ffff:198.51.100.4", "198.51.100.4"),
        ("testclient", "testclient"),
        ("", "unknown"),
        (None, "unknown"),
    ],
)
def test_client_ip_key(host, key):
    assert client_ip_key(host) == key


def test_one_ipv6_host_rotating_addresses_shares_one_budget():
    hosts = [f"2001:db8:5:6::{i:x}" for i in range(1, 7)]
    results = [
        check_tenant_rate_limit(
            "shared_read", client_ip_key(h), max_calls=5, window_seconds=3600, now=0.0
        )
        for h in hosts
    ]
    assert results[:5] == [None] * 5
    assert results[5] is not None
    # A different /64 is a different client.
    assert (
        check_tenant_rate_limit(
            "shared_read",
            client_ip_key("2001:db8:5:7::1"),
            max_calls=5,
            window_seconds=3600,
            now=0.0,
        )
        is None
    )
