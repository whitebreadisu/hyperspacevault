from fastapi.testclient import TestClient

from app.main import _api_docs_enabled, app


def test_docs_enabled_by_default(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    assert _api_docs_enabled() is True


def test_docs_enabled_outside_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "development")
    assert _api_docs_enabled() is True


def test_docs_disabled_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    assert _api_docs_enabled() is False


class TestSecurityHeaders:
    """BL-157/A4-14: app/middleware.py's security_headers middleware, on a
    route with no DB/auth dependency (GET /health) so this needs no
    DATABASE_URL -- the header set is response-wide, not route-specific,
    so one representative public route stands in for every route
    (including a 404, exercised separately below, and /images/**, which
    isn't wired in the FastAPI app under test -- it's served by a separate
    bucket-relay route not part of this router set)."""

    def test_health_response_carries_all_four_headers(self):
        client = TestClient(app)
        response = client.get("/health")
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["X-Frame-Options"] == "DENY"
        assert response.headers["Referrer-Policy"] == "no-referrer"
        assert (
            response.headers["Strict-Transport-Security"]
            == "max-age=31536000; includeSubDomains"
        )

    def test_headers_present_even_on_a_404(self):
        """The middleware wraps every response call_next returns, not just
        the happy path -- a route that doesn't exist must still carry the
        hardening headers."""
        client = TestClient(app)
        response = client.get("/api/this-route-does-not-exist")
        assert response.status_code == 404
        assert response.headers["X-Content-Type-Options"] == "nosniff"
