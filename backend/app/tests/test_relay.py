"""BL-235: /api/relay/* PostHog reverse proxy.

No DB/auth dependency -- the relay is deliberately unauthenticated (anonymous
visitors emit events), so these tests run without DATABASE_URL, monkeypatching
the module-level httpx client the way TestSecurityHeaders leans on /health.
"""

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import relay


class RecordingClient:
    """Stands in for relay._client; records the forwarded request and returns
    a canned upstream response (or raises, for the failure-posture tests)."""

    def __init__(self, response=None, error=None):
        self.response = response or httpx.Response(200, content=b"ok")
        self.error = error
        self.calls = []

    async def request(self, method, url, content=b"", headers=None):
        self.calls.append(
            {"method": method, "url": url, "content": content, "headers": headers or {}}
        )
        if self.error is not None:
            raise self.error
        return self.response


@pytest.fixture
def upstream(monkeypatch):
    recorder = RecordingClient()
    monkeypatch.setattr(relay, "_client", recorder)
    return recorder


client = TestClient(app)


class TestRouting:
    def test_event_ingestion_goes_to_ingest_host(self, upstream):
        response = client.post("/api/relay/e?ip=0&v=1", content=b"payload")
        assert response.status_code == 200
        call = upstream.calls[0]
        assert call["method"] == "POST"
        assert call["url"] == "https://us.i.posthog.com/e?ip=0&v=1"
        assert call["content"] == b"payload"

    def test_static_assets_go_to_assets_host(self, upstream):
        response = client.get("/api/relay/static/recorder.js")
        assert response.status_code == 200
        assert (
            upstream.calls[0]["url"]
            == "https://us-assets.i.posthog.com/static/recorder.js"
        )

    def test_nested_paths_and_query_survive(self, upstream):
        client.post("/api/relay/decide/?v=3")
        assert upstream.calls[0]["url"] == "https://us.i.posthog.com/decide/?v=3"


class TestRequestHeaderHygiene:
    def test_forwards_content_type_and_user_agent_only(self, upstream):
        client.post(
            "/api/relay/e",
            content=b"{}",
            headers={
                "Content-Type": "application/json",
                "User-Agent": "test-browser/1.0",
                "Authorization": "Bearer should-not-cross",
                "Cookie": "session=should-not-cross",
                "X-Custom": "should-not-cross",
            },
        )
        sent = upstream.calls[0]["headers"]
        assert sent["content-type"] == "application/json"
        assert sent["user-agent"] == "test-browser/1.0"
        lowered = {k.lower() for k in sent}
        assert "authorization" not in lowered
        assert "cookie" not in lowered
        assert "x-custom" not in lowered

    def test_client_ip_forwarded_for_geoip(self, upstream):
        client.post("/api/relay/e", content=b"{}")
        # TestClient's synthetic peer is "testclient"; the assertion is that
        # the relay stamps x-forwarded-for from request.client at all.
        assert upstream.calls[0]["headers"]["x-forwarded-for"] == "testclient"


class TestResponsePassthrough:
    def test_upstream_status_body_and_content_type_come_back(self, monkeypatch):
        recorder = RecordingClient(
            response=httpx.Response(
                207,
                content=b'{"status": 1}',
                headers={
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache",
                    "Set-Cookie": "ph=should-not-cross",
                    "X-Upstream-Internal": "should-not-cross",
                },
            )
        )
        monkeypatch.setattr(relay, "_client", recorder)
        response = client.post("/api/relay/e")
        assert response.status_code == 207
        assert response.content == b'{"status": 1}'
        assert response.headers["content-type"] == "application/json"
        assert response.headers["cache-control"] == "no-cache"
        assert "set-cookie" not in response.headers
        assert "x-upstream-internal" not in response.headers


class TestFailurePosture:
    """Analytics must never break the app: upstream trouble is a quiet 502,
    never an exception into the app's error surface."""

    @pytest.mark.parametrize(
        "error",
        [
            httpx.ConnectError("boom"),
            httpx.ReadTimeout("slow"),
            httpx.ProtocolError("bad"),
        ],
    )
    def test_upstream_errors_become_502(self, monkeypatch, error):
        monkeypatch.setattr(relay, "_client", RecordingClient(error=error))
        response = client.post("/api/relay/e", content=b"{}")
        assert response.status_code == 502

    def test_upstream_5xx_passes_through_without_raising(self, monkeypatch):
        monkeypatch.setattr(
            relay, "_client", RecordingClient(response=httpx.Response(503))
        )
        assert client.post("/api/relay/e").status_code == 503


class TestMethodSurface:
    def test_disallowed_methods_rejected(self, upstream):
        assert client.delete("/api/relay/e").status_code == 405
        assert client.put("/api/relay/e").status_code == 405
        assert upstream.calls == []
