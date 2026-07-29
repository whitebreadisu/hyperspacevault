"""BL-76 Phase 3 (ADR-0012) tests for GET /images/cards/{filename}
(app/routers/images.py). No real GCS -- get_images_bucket is overridden
with a fake bucket double, matching this repo's pattern in
test_image_mirror.py.

Note: importing app.main (transitively, via conftest.py) requires
DATABASE_URL to be set even though these tests never touch the DB --
app/database.py reads it at module import time. Run alongside the rest of
the suite (DATABASE_URL is already required repo-wide -- see conftest.py).
"""

import io

from fastapi.testclient import TestClient

from app.main import app
from app.routers.images import get_images_bucket
from app.services.image_paths import CACHE_CONTROL


class FakeBlob:
    def __init__(self, content: bytes, content_type: str | None = None):
        self._content = content
        self.content_type = content_type

    def open(self, mode: str):
        assert mode == "rb"
        return io.BytesIO(self._content)


class FakeBucket:
    def __init__(self, objects: dict[str, FakeBlob] | None = None):
        self._objects = objects or {}

    def get_blob(self, path: str) -> FakeBlob | None:
        return self._objects.get(path)


def _client_with_bucket(bucket: FakeBucket) -> TestClient:
    app.dependency_overrides[get_images_bucket] = lambda: bucket
    return TestClient(app)


def teardown_function(_fn):
    app.dependency_overrides.pop(get_images_bucket, None)


class TestImageHit:
    def test_streams_bytes_with_content_type_and_immutable_cache(self):
        bucket = FakeBucket(
            {
                "cards/card_test_0001_640.webp": FakeBlob(
                    b"webp-bytes", content_type="image/webp"
                )
            }
        )
        client = _client_with_bucket(bucket)

        response = client.get("/images/cards/card_test_0001_640.webp")

        assert response.status_code == 200
        assert response.content == b"webp-bytes"
        assert response.headers["content-type"] == "image/webp"
        assert response.headers["cache-control"] == CACHE_CONTROL

    def test_original_png_hit(self):
        bucket = FakeBucket(
            {
                "cards/card_test_0001.png": FakeBlob(
                    b"png-bytes", content_type="image/png"
                )
            }
        )
        client = _client_with_bucket(bucket)

        response = client.get("/images/cards/card_test_0001.png")

        assert response.status_code == 200
        assert response.content == b"png-bytes"
        assert response.headers["content-type"] == "image/png"
        assert response.headers["cache-control"] == CACHE_CONTROL

    def test_falls_back_to_extension_content_type_when_blob_lacks_one(self):
        """A blob whose content_type wasn't populated by GCS metadata still
        gets a sane Content-Type from the filename's known extension."""
        bucket = FakeBucket(
            {"cards/card_test_0001_320.webp": FakeBlob(b"data", content_type=None)}
        )
        client = _client_with_bucket(bucket)

        response = client.get("/images/cards/card_test_0001_320.webp")

        assert response.status_code == 200
        assert response.headers["content-type"] == "image/webp"


class TestImageMissFallback:
    """Double slash in every expected Location below is deliberate, not a
    typo -- see image_paths.fallback_cdn_url's docstring: verified against
    the live CDN 2026-07-11 that this is the form ~97% of stored URLs
    actually need (a single-slash reconstruction 403s for them)."""

    def test_rendition_miss_redirects_to_full_size_cdn_png_no_store(self):
        bucket = FakeBucket()  # empty -- nothing mirrored
        client = _client_with_bucket(bucket)

        response = client.get(
            "/images/cards/card_test_0001_640.webp", follow_redirects=False
        )

        assert response.status_code == 307
        assert response.headers["location"] == (
            "https://cdn.starwarsunlimited.com//card_test_0001.png"
        )
        assert response.headers["cache-control"] == "no-store"

    def test_320_rendition_miss_strips_suffix_the_same_way(self):
        bucket = FakeBucket()
        client = _client_with_bucket(bucket)

        response = client.get(
            "/images/cards/card_test_0001_320.webp", follow_redirects=False
        )

        assert response.headers["location"] == (
            "https://cdn.starwarsunlimited.com//card_test_0001.png"
        )

    def test_original_miss_redirects_to_the_same_stem(self):
        bucket = FakeBucket()
        client = _client_with_bucket(bucket)

        response = client.get(
            "/images/cards/card_test_0001.png", follow_redirects=False
        )

        assert response.status_code == 307
        assert response.headers["location"] == (
            "https://cdn.starwarsunlimited.com//card_test_0001.png"
        )
        assert response.headers["cache-control"] == "no-store"


class TestImagePathSafety:
    def test_unrecognized_extension_is_404(self):
        bucket = FakeBucket()
        client = _client_with_bucket(bucket)

        response = client.get("/images/cards/card_test_0001.gif")

        assert response.status_code == 404

    def test_dotted_stem_is_rejected(self):
        """A stem containing '..' (or any dot) never matches STEM_RE, which
        is what rules out traversal -- this is the direct unit-level check
        of that rule, independent of how the router is mounted."""
        bucket = FakeBucket()
        client = _client_with_bucket(bucket)

        response = client.get("/images/cards/..png")

        assert response.status_code == 404

    def test_extra_path_segment_does_not_route(self):
        """No route matches a filename with an embedded '/' -- Starlette's
        default string convertor for {filename} excludes '/', so an
        attempted second segment 404s at the router level, before
        _parse_filename ever runs."""
        bucket = FakeBucket()
        client = _client_with_bucket(bucket)

        response = client.get("/images/cards/foo/bar.png")

        assert response.status_code == 404

    def test_encoded_slash_does_not_escape_the_cards_namespace(self):
        bucket = FakeBucket()
        client = _client_with_bucket(bucket)

        response = client.get(
            "/images/cards/..%2F..%2Fetc%2Fpasswd.png", follow_redirects=False
        )

        assert response.status_code == 404
