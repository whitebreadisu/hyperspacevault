"""BL-137 D2: unit tests for app/services/deck_fetch.py -- URL allowlist
parsing (DB-free, no network) and the httpx fetch path (network mocked via
monkeypatch, mirroring test_feedback_api.py's github_notify mocking
style)."""

import httpx
import pytest

from app.services import deck_fetch
from app.services.deck_fetch import (
    FetchFailedError,
    UnsupportedUrlError,
    fetch_deck_json,
    resolve_provider_api_url,
)


class TestResolveProviderApiUrl:
    def test_swubase_deck_json_api_url(self):
        url, source = resolve_provider_api_url(
            "https://swubase.com/api/deck/e36c459f-b77b-42ad-90c8-8d64932abd1e/json"
        )
        assert (
            url
            == "https://swubase.com/api/deck/e36c459f-b77b-42ad-90c8-8d64932abd1e/json"
        )
        assert source == "swubase"

    def test_swubase_page_url_extracts_uuid(self):
        """A pasted deck PAGE url (not the raw API url) still resolves --
        the uuid is extracted from wherever it appears in the URL, and the
        fetch always targets our own hardcoded API path template."""
        url, source = resolve_provider_api_url(
            "https://swubase.com/decks/e36c459f-b77b-42ad-90c8-8d64932abd1e"
        )
        assert (
            url
            == "https://swubase.com/api/deck/e36c459f-b77b-42ad-90c8-8d64932abd1e/json"
        )
        assert source == "swubase"

    def test_sw_unlimited_db_query_param_id(self):
        url, source = resolve_provider_api_url(
            "https://sw-unlimited-db.com/umbraco/api/deckapi/get?id=77465"
        )
        assert url == "https://sw-unlimited-db.com/umbraco/api/deckapi/get?id=77465"
        assert source == "sw-unlimited-db"

    def test_sw_unlimited_db_page_url_trailing_numeric_segment(self):
        url, source = resolve_provider_api_url(
            "https://sw-unlimited-db.com/decks/77465"
        )
        assert url == "https://sw-unlimited-db.com/umbraco/api/deckapi/get?id=77465"
        assert source == "sw-unlimited-db"

    def test_www_subdomain_accepted(self):
        url, source = resolve_provider_api_url(
            "https://www.swubase.com/decks/e36c459f-b77b-42ad-90c8-8d64932abd1e"
        )
        assert source == "swubase"

    def test_non_allowlisted_host_rejected(self):
        with pytest.raises(UnsupportedUrlError):
            resolve_provider_api_url("https://swudb.com/decks/top-deck")

    def test_evil_host_rejected(self):
        """SSRF hygiene: a host that isn't on the allowlist is rejected
        even if it superficially resembles an allowlisted host."""
        with pytest.raises(UnsupportedUrlError):
            resolve_provider_api_url("https://swubase.com.evil.example/api/deck/x/json")

    def test_allowlisted_host_no_recognizable_id_rejected(self):
        with pytest.raises(UnsupportedUrlError):
            resolve_provider_api_url("https://swubase.com/about")

    def test_non_http_scheme_rejected(self):
        with pytest.raises(UnsupportedUrlError):
            resolve_provider_api_url("file:///etc/passwd")

    def test_garbage_url_rejected(self):
        with pytest.raises(UnsupportedUrlError):
            resolve_provider_api_url("not a url at all")


class _FakeStreamResponse:
    def __init__(self, status_code: int, body: bytes):
        self.status_code = status_code
        self._body = body

    def iter_bytes(self):
        # Yield in small chunks to exercise the accumulation loop.
        for i in range(0, len(self._body), 8):
            yield self._body[i : i + 8]


class _FakeStreamContextManager:
    def __init__(self, response: _FakeStreamResponse):
        self._response = response

    def __enter__(self):
        return self._response

    def __exit__(self, *exc):
        return False


class _FakeClient:
    def __init__(self, status_code=200, body=b"{}", raise_exc=None):
        self._status_code = status_code
        self._body = body
        self._raise_exc = raise_exc
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def stream(self, method, url):
        self.calls.append((method, url))
        if self._raise_exc is not None:
            raise self._raise_exc
        return _FakeStreamContextManager(
            _FakeStreamResponse(self._status_code, self._body)
        )


class TestFetchDeckJson:
    def test_successful_fetch_returns_parsed_json_and_source(self, monkeypatch):
        body = b'{"leader": {"id": "JTL_017", "count": 1}}'
        fake = _FakeClient(status_code=200, body=body)
        monkeypatch.setattr(deck_fetch.httpx, "Client", lambda **kwargs: fake)
        raw, source = fetch_deck_json(
            "https://swubase.com/api/deck/e36c459f-b77b-42ad-90c8-8d64932abd1e/json"
        )
        assert raw == {"leader": {"id": "JTL_017", "count": 1}}
        assert source == "swubase"
        assert fake.calls[0][0] == "GET"

    def test_non_200_status_raises_fetch_failed(self, monkeypatch):
        fake = _FakeClient(status_code=404, body=b"not found")
        monkeypatch.setattr(deck_fetch.httpx, "Client", lambda **kwargs: fake)
        with pytest.raises(FetchFailedError):
            fetch_deck_json(
                "https://swubase.com/api/deck/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/json"
            )

    def test_oversized_response_raises_fetch_failed(self, monkeypatch):
        big_body = b"x" * (deck_fetch.MAX_RESPONSE_BYTES + 1)
        fake = _FakeClient(status_code=200, body=big_body)
        monkeypatch.setattr(deck_fetch.httpx, "Client", lambda **kwargs: fake)
        with pytest.raises(FetchFailedError, match="exceeded"):
            fetch_deck_json(
                "https://swubase.com/api/deck/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/json"
            )

    def test_timeout_raises_fetch_failed(self, monkeypatch):
        fake = _FakeClient(raise_exc=httpx.TimeoutException("timed out"))
        monkeypatch.setattr(deck_fetch.httpx, "Client", lambda **kwargs: fake)
        with pytest.raises(FetchFailedError, match="timed out"):
            fetch_deck_json(
                "https://swubase.com/api/deck/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/json"
            )

    def test_network_error_raises_fetch_failed(self, monkeypatch):
        fake = _FakeClient(raise_exc=httpx.ConnectError("boom"))
        monkeypatch.setattr(deck_fetch.httpx, "Client", lambda **kwargs: fake)
        with pytest.raises(FetchFailedError, match="network error"):
            fetch_deck_json(
                "https://swubase.com/api/deck/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/json"
            )

    def test_malformed_json_response_raises_fetch_failed(self, monkeypatch):
        fake = _FakeClient(status_code=200, body=b"<html>not json</html>")
        monkeypatch.setattr(deck_fetch.httpx, "Client", lambda **kwargs: fake)
        with pytest.raises(FetchFailedError, match="non-JSON"):
            fetch_deck_json(
                "https://swubase.com/api/deck/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/json"
            )

    def test_unsupported_url_never_touches_the_network(self, monkeypatch):
        """A non-allowlisted host must raise before httpx.Client is even
        constructed -- confirmed by making the constructor itself blow up
        if called."""

        def _boom(**kwargs):
            raise AssertionError("httpx.Client must not be constructed for a bad host")

        monkeypatch.setattr(deck_fetch.httpx, "Client", _boom)
        with pytest.raises(UnsupportedUrlError):
            fetch_deck_json("https://evil.example/steal-data")

    def test_client_constructed_with_no_follow_redirects(self, monkeypatch):
        captured_kwargs = {}

        def _factory(**kwargs):
            captured_kwargs.update(kwargs)
            return _FakeClient(status_code=200, body=b"{}")

        monkeypatch.setattr(deck_fetch.httpx, "Client", _factory)
        fetch_deck_json(
            "https://swubase.com/api/deck/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/json"
        )
        assert captured_kwargs.get("follow_redirects") is False
        assert captured_kwargs.get("timeout") == deck_fetch.FETCH_TIMEOUT_SECONDS
