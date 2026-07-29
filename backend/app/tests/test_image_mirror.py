"""BL-76 Phase 2 (ADR-0012) tests for app/ingestion/image_mirror.py.

No network, no real GCS -- path derivation is pure, rendition generation
runs against a small in-test fixture image, and mirror_image is exercised
against fake Bucket/Blob doubles plus an httpx.MockTransport so the whole
mirror flow (existence-check skip, download, 3-object upload) is verified
without ever touching the real CDN or bucket.
"""

import io

import httpx
import pytest
from PIL import Image

from app.ingestion.image_mirror import (
    derive_stem,
    make_rendition,
    mirror_image,
    object_paths,
)

# --- path derivation -------------------------------------------------------


@pytest.mark.parametrize(
    "url,expected_stem",
    [
        (
            "https://cdn.starwarsunlimited.com//card_08010001_EN_The_Armorer_Leader_7f473bab82.png",
            "card_08010001_EN_The_Armorer_Leader_7f473bab82",
        ),
        # single slash variant (not every CDN URL is double-slash)
        (
            "https://cdn.starwarsunlimited.com/card_08010010_EN_Bo_Katan_6f767daa86.png",
            "card_08010010_EN_Bo_Katan_6f767daa86",
        ),
        # defensive: a querystring is not part of the filename
        (
            "https://cdn.starwarsunlimited.com/card_0801_abc123.png?v=2",
            "card_0801_abc123",
        ),
        # defensive: no extension at all
        (
            "https://cdn.starwarsunlimited.com/card_no_extension",
            "card_no_extension",
        ),
    ],
)
def test_derive_stem(url, expected_stem):
    assert derive_stem(url) == expected_stem


def test_object_paths_scheme():
    url = "https://cdn.starwarsunlimited.com//card_0801_abc123.png"
    paths = object_paths(url)
    assert paths == {
        "original": "cards/card_0801_abc123.png",
        "640": "cards/card_0801_abc123_640.webp",
        "320": "cards/card_0801_abc123_320.webp",
    }


def test_object_paths_deterministic_across_calls():
    """Phase 3 needs to recompute these from a stored URL with zero extra
    state -- calling twice must be byte-identical."""
    url = "https://cdn.starwarsunlimited.com//card_repeat_test.png"
    assert object_paths(url) == object_paths(url)


# --- rendition generation ---------------------------------------------------


def _fixture_png_bytes(width: int, height: int) -> bytes:
    im = Image.new("RGB", (width, height), color=(120, 60, 200))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def test_make_rendition_resizes_and_preserves_aspect_ratio():
    original = _fixture_png_bytes(1000, 1400)  # 5:7 card-ish aspect ratio
    rendition = make_rendition(original, 640)

    with Image.open(io.BytesIO(rendition)) as im:
        assert im.format == "WEBP"
        assert im.width == 640
        assert im.height == round(1400 * (640 / 1000))


def test_make_rendition_320_is_smaller_than_640():
    original = _fixture_png_bytes(1000, 1400)
    r640 = make_rendition(original, 640)
    r320 = make_rendition(original, 320)
    assert len(r320) < len(r640)


def test_make_rendition_does_not_upscale_a_smaller_source():
    original = _fixture_png_bytes(200, 280)
    rendition = make_rendition(original, 640)
    with Image.open(io.BytesIO(rendition)) as im:
        assert im.width == 200  # native size, not upscaled to 640
        assert im.height == 280


# --- mirror_image (fake bucket + mocked HTTP transport) --------------------


class FakeBlob:
    def __init__(self, store: dict[str, bytes], path: str):
        self._store = store
        self._path = path
        self.cache_control = None
        self.content_type = None

    def exists(self) -> bool:
        return self._path in self._store

    def upload_from_string(self, data: bytes, content_type: str) -> None:
        self.content_type = content_type
        self._store[self._path] = data


class FakeBucket:
    def __init__(self, preexisting: set[str] | None = None):
        self._store: dict[str, bytes] = {p: b"existing" for p in (preexisting or set())}

    def blob(self, path: str) -> FakeBlob:
        return FakeBlob(self._store, path)


def _mock_transport(png_bytes: bytes) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=png_bytes)

    return httpx.MockTransport(handler)


def test_mirror_image_uploads_all_three_objects_when_none_exist():
    url = "https://cdn.starwarsunlimited.com//card_new_0001.png"
    bucket = FakeBucket()
    png_bytes = _fixture_png_bytes(1000, 1400)

    with httpx.Client(transport=_mock_transport(png_bytes)) as client:
        result = mirror_image(url, bucket, client)

    assert sorted(result.uploaded) == [
        "cards/card_new_0001.png",
        "cards/card_new_0001_320.webp",
        "cards/card_new_0001_640.webp",
    ]
    assert result.skipped == []
    assert set(bucket._store.keys()) == set(result.uploaded)


def test_mirror_image_skips_download_when_all_objects_already_present():
    url = "https://cdn.starwarsunlimited.com//card_present_0001.png"
    bucket = FakeBucket(
        preexisting={
            "cards/card_present_0001.png",
            "cards/card_present_0001_640.webp",
            "cards/card_present_0001_320.webp",
        }
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("should not hit the CDN when all objects exist")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = mirror_image(url, bucket, client)

    assert result.uploaded == []
    assert sorted(result.skipped) == [
        "cards/card_present_0001.png",
        "cards/card_present_0001_320.webp",
        "cards/card_present_0001_640.webp",
    ]


def test_mirror_image_uploads_only_missing_objects():
    """Partial-progress resume case: original already mirrored, renditions
    are not -- exactly the state a run interrupted mid-object would leave."""
    url = "https://cdn.starwarsunlimited.com//card_partial_0001.png"
    bucket = FakeBucket(preexisting={"cards/card_partial_0001.png"})
    png_bytes = _fixture_png_bytes(1000, 1400)

    with httpx.Client(transport=_mock_transport(png_bytes)) as client:
        result = mirror_image(url, bucket, client)

    assert sorted(result.uploaded) == [
        "cards/card_partial_0001_320.webp",
        "cards/card_partial_0001_640.webp",
    ]
    assert result.skipped == ["cards/card_partial_0001.png"]


def test_mirror_image_raises_on_http_error():
    url = "https://cdn.starwarsunlimited.com//card_missing_0001.png"
    bucket = FakeBucket()

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(httpx.HTTPStatusError):
            mirror_image(url, bucket, client)
