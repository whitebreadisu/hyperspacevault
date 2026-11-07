"""BL-235: /api/relay/* PostHog reverse proxy.

No DB/auth dependency -- the relay is deliberately unauthenticated (anonymous
visitors emit events), so these tests run without DATABASE_URL, monkeypatching
the module-level httpx client the way TestSecurityHeaders leans on /health.
"""

import logging

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


def _relay_records(caplog):
    return [r for r in caplog.records if r.name == relay.logger.name]


CAPTURE_PATHS = ["e", "e/", "i/v0/e/", "batch/", "engage/", "capture/", "s/", "s"]
NON_CAPTURE_PATHS = [
    ("flags/?v=2", "flags"),
    ("decide/?v=3", "flags"),
    ("array/phc_token/config", "config"),
    ("array/phc_token/config.js", "config"),
    ("something/else", "other"),
]


class TestFailurePosture:
    """Analytics must never break the app or page us (BL-333): ingestion-path
    upstream trouble is never a 5xx and logs one WARNING. Capture endpoints
    answer an accepted 200; flags/config answer 204 so posthog-js sees a
    failed load."""

    @pytest.mark.parametrize(
        "error",
        [
            httpx.ConnectError("boom"),
            httpx.ReadTimeout("slow"),
            httpx.ProtocolError("bad"),
        ],
    )
    def test_upstream_errors_answer_accepted_and_warn(self, monkeypatch, caplog, error):
        # Ported: asserted the raw path ("/e") in the log; now the category.
        monkeypatch.setattr(relay, "_client", RecordingClient(error=error))
        with caplog.at_level(logging.WARNING, logger=relay.logger.name):
            response = client.post("/api/relay/e?distinct_id=secret-id", content=b"{}")
        assert response.status_code == 200
        assert response.json() == {"status": 1}
        records = _relay_records(caplog)
        assert len(records) == 1
        assert records[0].levelno == logging.WARNING
        message = records[0].getMessage()
        assert type(error).__name__ in message
        assert "endpoint=capture" in message
        assert "secret-id" not in message

    @pytest.mark.parametrize("status", [500, 503])
    def test_upstream_5xx_answers_accepted_and_warns(self, monkeypatch, caplog, status):
        # Ported: was 503 only, with a raw-path assertion; 500 is the boundary.
        monkeypatch.setattr(
            relay, "_client", RecordingClient(response=httpx.Response(status))
        )
        with caplog.at_level(logging.WARNING, logger=relay.logger.name):
            response = client.post("/api/relay/i/v0/e/?token=secret", content=b"{}")
        assert response.status_code == 200
        assert response.json() == {"status": 1}
        records = _relay_records(caplog)
        assert len(records) == 1
        assert records[0].levelno == logging.WARNING
        message = records[0].getMessage()
        assert str(status) in message
        assert "endpoint=capture" in message
        assert "/i/v0/e/" not in message
        assert "secret" not in message

    @pytest.mark.parametrize("path", CAPTURE_PATHS)
    def test_capture_path_variants_answer_accepted(self, monkeypatch, caplog, path):
        monkeypatch.setattr(
            relay, "_client", RecordingClient(response=httpx.Response(502))
        )
        with caplog.at_level(logging.WARNING, logger=relay.logger.name):
            response = client.post(f"/api/relay/{path}?ip=0", content=b"{}")
        assert response.status_code == 200
        assert response.json() == {"status": 1}
        assert len(_relay_records(caplog)) == 1

    def test_replay_category_logged(self, monkeypatch, caplog):
        monkeypatch.setattr(
            relay, "_client", RecordingClient(error=httpx.ReadTimeout("slow"))
        )
        with caplog.at_level(logging.WARNING, logger=relay.logger.name):
            client.post("/api/relay/s/?ver=1", content=b"{}")
        assert "endpoint=replay" in _relay_records(caplog)[0].getMessage()

    @pytest.mark.parametrize(("path", "category"), NON_CAPTURE_PATHS)
    @pytest.mark.parametrize(
        "failure",
        [httpx.Response(500), httpx.Response(503), httpx.ReadTimeout("slow")],
        ids=["500", "503", "timeout"],
    )
    def test_flags_and_config_failures_are_not_faked_as_accepted(
        self, monkeypatch, caplog, path, category, failure
    ):
        # New: before, every non-static path got 200 {"status": 1}, which
        # posthog-js reads as a successful flags/config load.
        if isinstance(failure, httpx.Response):
            fake = RecordingClient(response=failure)
        else:
            fake = RecordingClient(error=failure)
        monkeypatch.setattr(relay, "_client", fake)
        with caplog.at_level(logging.WARNING, logger=relay.logger.name):
            response = client.post(f"/api/relay/{path}", content=b"{}")
        assert response.status_code == 204
        assert response.content == b""
        records = _relay_records(caplog)
        assert len(records) == 1
        assert records[0].levelno == logging.WARNING
        assert f"endpoint={category}" in records[0].getMessage()

    def test_caller_controlled_path_never_logged(self, monkeypatch, caplog):
        monkeypatch.setattr(
            relay, "_client", RecordingClient(response=httpx.Response(503))
        )
        with caplog.at_level(logging.WARNING, logger=relay.logger.name):
            client.post(
                "/api/relay/e/sk-live-SECRETSEGMENT?token=QUERYSECRET",
                content=b"BODYSECRET",
                headers={"X-Api-Key": "HEADERSECRET"},
            )
            client.post("/api/relay/sk-live-SECRETSEGMENT/x", content=b"{}")
        records = _relay_records(caplog)
        assert len(records) == 2
        text = " ".join(r.getMessage() for r in records)
        for needle in ("SECRET", "sk-live"):
            assert needle not in text
        assert "endpoint=capture" in records[0].getMessage()
        assert "endpoint=other" in records[1].getMessage()

    def test_upstream_4xx_passes_through(self, monkeypatch, caplog):
        monkeypatch.setattr(
            relay,
            "_client",
            RecordingClient(response=httpx.Response(400, content=b"bad")),
        )
        with caplog.at_level(logging.WARNING, logger=relay.logger.name):
            response = client.post("/api/relay/e")
        assert response.status_code == 400
        assert response.content == b"bad"
        assert not [r for r in caplog.records if r.name == relay.logger.name]

    def test_upstream_200_passes_through(self, monkeypatch):
        monkeypatch.setattr(
            relay,
            "_client",
            RecordingClient(response=httpx.Response(200, content=b"upstream-body")),
        )
        response = client.post("/api/relay/e")
        assert response.status_code == 200
        assert response.content == b"upstream-body"

    def test_static_asset_failure_is_not_masked(self, monkeypatch):
        monkeypatch.setattr(
            relay, "_client", RecordingClient(error=httpx.ReadTimeout("slow"))
        )
        assert client.get("/api/relay/static/recorder.js").status_code == 502

    def test_static_asset_upstream_5xx_passes_through(self, monkeypatch):
        monkeypatch.setattr(
            relay, "_client", RecordingClient(response=httpx.Response(503))
        )
        assert client.get("/api/relay/static/recorder.js").status_code == 503


class TestMethodSurface:
    def test_disallowed_methods_rejected(self, upstream):
        assert client.delete("/api/relay/e").status_code == 405
        assert client.put("/api/relay/e").status_code == 405
        assert upstream.calls == []
