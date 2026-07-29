"""BL-99 -- API response compression (GZipMiddleware).

Covers: a large catalog response gets Content-Encoding: gzip when the
client advertises Accept-Encoding: gzip, and decompresses to
byte-identical JSON as the uncompressed response (transport-only, no
correctness regression); the same request without gzip support advertised
is served uncompressed; a response below minimum_size=500 bytes is never
compressed even when gzip is requested (proves the size gate itself, and
pins the middleware-ordering fix in app/main.py -- GZip must sit *inside*
the P6 log_requests middleware, or BaseHTTPMiddleware's call_next
streaming defeats minimum_size for every response, small or large); and
log_requests (app/middleware.py) still emits its per-request log line for
a compressed response.

FastAPI's TestClient (httpx under the hood) transparently decompresses a
gzip response body -- .content/.json() always return decoded bytes
regardless of whether the wire response was compressed. That means
compression is only observable via response.headers["content-encoding"],
never via response.content/.json() -- these tests assert on the header.
The "not compressed" side needs an explicit Accept-Encoding: identity
header, since TestClient's default httpx client always advertises
gzip/deflate/br/zstd -- "just don't send the header" isn't a way to get an
uncompressed response out of this client.

Run inside the backend container:
    docker compose exec backend pytest app/tests/test_compression.py -v
"""

import logging
import os

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL -- run inside the backend container",
)


@pytest.fixture
def anon_client():
    """A TestClient with no dependency overrides -- these are all public,
    tenant-less catalog reads (get_catalog_db), so no auth is needed to
    exercise compression. Mirrors test_cache_headers.py's anon_client."""
    from app.main import app

    return TestClient(app)


class TestLargeCatalogResponseCompression:
    """GET /api/base-cards?set_code=SOR is comfortably above the 500-byte
    minimum_size threshold in every environment this suite runs in: a
    BaseCardCatalogResponse row (BL-146 slimmed this to 17 fields, including
    the nested variant list) puts a single row's JSON well above 500 bytes,
    and the smallest catalog this suite ever runs against
    (conftest.seed_minimal_catalog, on a fresh CI database) still seeds 6
    SOR base cards.

    PORTED for BL-102 from GET /api/cards (retired): compression is
    middleware-level and route-agnostic, so the property transfers to the
    large catalog endpoint users actually fetch."""

    def test_compressed_when_gzip_accepted(self, anon_client):
        response = anon_client.get(
            "/api/base-cards?set_code=SOR", headers={"Accept-Encoding": "gzip"}
        )
        assert response.status_code == 200
        assert response.headers["content-encoding"] == "gzip"

    def test_not_compressed_without_gzip_accept_encoding(self, anon_client):
        response = anon_client.get(
            "/api/base-cards?set_code=SOR", headers={"Accept-Encoding": "identity"}
        )
        assert response.status_code == 200
        assert "content-encoding" not in response.headers

    def test_compression_is_lossless(self, anon_client):
        """gzip is transport-only: the compressed and uncompressed
        responses must decode to byte-identical JSON."""
        compressed = anon_client.get(
            "/api/base-cards?set_code=SOR", headers={"Accept-Encoding": "gzip"}
        )
        uncompressed = anon_client.get(
            "/api/base-cards?set_code=SOR", headers={"Accept-Encoding": "identity"}
        )
        assert compressed.headers["content-encoding"] == "gzip"
        assert "content-encoding" not in uncompressed.headers

        compressed_json = compressed.json()
        assert len(compressed_json) > 0
        assert compressed_json == uncompressed.json()


class TestSmallResponseNeverCompressed:
    """Below minimum_size=500 bytes, GZipMiddleware must not compress even
    when the client advertises gzip support. This is the assertion that
    would have failed under the pre-fix middleware ordering (GZip outside
    log_requests) -- BaseHTTPMiddleware's call_next streaming made every
    response, including these tiny ones, take GZip's unconditional
    streaming-compression branch. See app/main.py's ordering comment."""

    def test_404_not_compressed(self, anon_client):
        response = anon_client.get(
            "/api/sets/NOPE", headers={"Accept-Encoding": "gzip"}
        )
        assert response.status_code == 404
        assert "content-encoding" not in response.headers

    def test_health_check_not_compressed(self, anon_client):
        response = anon_client.get("/health", headers={"Accept-Encoding": "gzip"})
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
        assert "content-encoding" not in response.headers


class TestRequestLoggingUnaffectedByCompression:
    """P6's log_requests middleware (app/middleware.py) reads
    response.status_code, not the response body, so it must keep emitting
    its one-line-per-request log regardless of whether GZip compressed the
    body that ends up going out on the wire."""

    def test_log_line_emitted_for_compressed_response(self, anon_client, caplog):
        with caplog.at_level(logging.INFO, logger="app.request"):
            response = anon_client.get(
                "/api/base-cards?set_code=SOR", headers={"Accept-Encoding": "gzip"}
            )

        assert response.status_code == 200
        assert response.headers["content-encoding"] == "gzip"

        records = [r for r in caplog.records if r.name == "app.request"]
        assert len(records) == 1
        assert records[0].httpRequest["status"] == 200
        assert records[0].httpRequest["requestUrl"] == "/api/base-cards"
