"""BL-76 Phase 2 (ADR-0012): mirror a card image from the official SWU CDN
into our own GCS bucket, generating the two thumbnail renditions alongside
the original.

Path scheme (deterministic, derived from the source CDN filename only --
Phase 3's serving layer and any re-mirror both need to compute these paths
from a stored `front_image_url`/`back_image_url` with zero extra state):

    source:  https://cdn.starwarsunlimited.com/<anything>/<stem>.png
    stored:
        cards/<stem>.png        -- original, unmodified bytes
        cards/<stem>_640.webp   -- 640px-wide rendition (long edge for
                                    double-sided/landscape art -- width is
                                    the resize target; height follows the
                                    source aspect ratio)
        cards/<stem>_320.webp   -- 320px-wide rendition, same rule

`<stem>` is the CDN filename with its extension stripped (e.g.
`card_08010001_EN_The_Armorer_Leader_7f473bab82` from
`.../card_08010001_EN_The_Armorer_Leader_7f473bab82.png`). Every observed
CDN URL as of 2026-07-11 is a bare `.png` with no querystring (verified
against all 8,342 distinct front + 417 distinct back URLs in the dev DB);
`derive_stem` still strips a querystring defensively if one ever appears,
since it is not part of the filename.

Renditions are generated with Pillow, converted to WebP at quality 80,
preserving aspect ratio (resize by width, matching the source spec's
"640px-wide and 320px-wide" framing). All three objects get
`Cache-Control: public, max-age=31536000, immutable`, matching the bucket
being immutable-by-convention (ADR-0012): a changed source image is a new
filename/path, never an overwrite.

Idempotent: `mirror_image` checks bucket existence per-object before
downloading/uploading anything, so re-running (or the ~21 rows that share a
front_image_url) costs nothing beyond the existence check.

BL-76 Phase 3: `derive_stem`/`object_paths` moved to
`app.services.image_paths` (a zero-dependency module the request-serving API
can import without dragging in google-cloud-storage/httpx/Pillow) and are
re-exported here unchanged so this module's own callers (the backfill
script, this module's tests) keep working without modification.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass

import httpx
from google.cloud import storage
from PIL import Image

from app.services.image_paths import (
    CACHE_CONTROL,
    ORIGINAL_CONTENT_TYPE,
    RENDITION_CONTENT_TYPE,
    RENDITION_WIDTHS,
    WEBP_QUALITY,
    derive_stem,
    object_paths,
)

logger = logging.getLogger(__name__)

__all__ = [
    "CACHE_CONTROL",
    "RENDITION_WIDTHS",
    "WEBP_QUALITY",
    "ORIGINAL_CONTENT_TYPE",
    "RENDITION_CONTENT_TYPE",
    "derive_stem",
    "object_paths",
    "make_rendition",
    "MirrorResult",
    "mirror_image",
    "get_bucket",
]


def make_rendition(original_bytes: bytes, width: int) -> bytes:
    """Resize `original_bytes` (a PNG) to `width` wide, preserving aspect
    ratio, and return WebP-encoded bytes at WEBP_QUALITY. Never upscales --
    a source image narrower than `width` is encoded to WebP at its native
    size, since upscaling would add bytes with no real resolution gain."""
    with Image.open(io.BytesIO(original_bytes)) as im:
        im = im.convert("RGBA") if im.mode not in ("RGB", "RGBA") else im
        target_width = min(width, im.width)
        target_height = round(im.height * (target_width / im.width))
        resized = im.resize((target_width, target_height), Image.LANCZOS)
        buf = io.BytesIO()
        resized.save(buf, format="WEBP", quality=WEBP_QUALITY)
        return buf.getvalue()


@dataclass
class MirrorResult:
    url: str
    uploaded: list[str]  # object paths newly uploaded this call
    skipped: list[str]  # object paths that already existed


def mirror_image(
    url: str,
    bucket: storage.Bucket,
    http_client: httpx.Client,
) -> MirrorResult:
    """Mirror one source CDN image into `bucket`: original PNG + 640/320
    WebP renditions. Downloads the source at most once, only if at least one
    of the 3 objects is missing. Raises on download/upload failure --
    callers (the backfill script) are responsible for catching per-URL and
    routing into the conservation report; this function does not swallow
    errors."""
    paths = object_paths(url)
    existing = {key: bucket.blob(path).exists() for key, path in paths.items()}
    if all(existing.values()):
        return MirrorResult(url=url, uploaded=[], skipped=list(paths.values()))

    response = http_client.get(url)
    response.raise_for_status()
    original_bytes = response.content

    uploaded: list[str] = []
    skipped: list[str] = []

    if existing["original"]:
        skipped.append(paths["original"])
    else:
        _upload(bucket, paths["original"], original_bytes, ORIGINAL_CONTENT_TYPE)
        uploaded.append(paths["original"])

    for width in RENDITION_WIDTHS:
        key = str(width)
        if existing[key]:
            skipped.append(paths[key])
            continue
        rendition_bytes = make_rendition(original_bytes, width)
        _upload(bucket, paths[key], rendition_bytes, RENDITION_CONTENT_TYPE)
        uploaded.append(paths[key])

    return MirrorResult(url=url, uploaded=uploaded, skipped=skipped)


def _upload(bucket: storage.Bucket, path: str, data: bytes, content_type: str) -> None:
    blob = bucket.blob(path)
    blob.cache_control = CACHE_CONTROL
    blob.upload_from_string(data, content_type=content_type)


def get_bucket(bucket_name: str) -> storage.Bucket:
    """ADC-authenticated GCS client -- picks up gcloud application-default
    credentials automatically (no explicit key file), matching how this
    machine's ADC is already scoped for the per-env buckets (BL-76 Phase 1)."""
    client = storage.Client()
    return client.bucket(bucket_name)
