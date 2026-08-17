"""BL-232 SEC-1 unit coverage: loggable_path redacts the /api/shared/{token}
credential segment before a request line is logged, and leaves every other
path untouched. Integration proof (the redaction actually reaching the log
record through the middleware) lives in test_shares_api.py, which needs the
DB container; these run anywhere.
"""

from app.middleware import loggable_path


def test_shared_paths_redact_the_token_segment():
    assert loggable_path("/api/shared/abc123") == "/api/shared/[token]"
    assert (
        loggable_path("/api/shared/abc123/quantities")
        == "/api/shared/[token]/quantities"
    )
    assert loggable_path("/api/shared/abc123/limits") == "/api/shared/[token]/limits"


def test_garbage_probe_paths_are_redacted_too():
    # a probing request never gets its guess logged verbatim either
    assert loggable_path("/api/shared/../../etc") == "/api/shared/[token]/../etc"
    assert loggable_path("/api/shared/") == "/api/shared/[token]"


def test_non_shared_paths_are_untouched():
    for path in [
        "/api/shares",
        "/api/shares/5/rotate",
        "/api/shared",
        "/api/sharedx/abc",
        "/api/inventory/5/adjust",
        "/health",
        "/images/cards/card_x.webp",
    ]:
        assert loggable_path(path) == path
