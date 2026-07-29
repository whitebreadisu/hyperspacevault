"""BL-53 (revised scope, A4-13/A4-04): unit tests for the per-tenant
sliding-window limiter (app/rate_limit.py's check_tenant_rate_limit). Pure
unit tests against the module's in-memory state -- no DB, no TestClient --
mirroring test_logging.py's no-DATABASE_URL-needed pattern. Integration
coverage (the 429 + Retry-After behavior wired into the actual routers) is
in test_inventory_import_api.py::TestRateLimit and
test_deck_check_api.py::TestRateLimit.
"""

from app.rate_limit import _reset_for_tests, check_tenant_rate_limit


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
