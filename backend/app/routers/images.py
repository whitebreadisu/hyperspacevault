"""BL-76 Phase 3 (ADR-0012): same-origin card-image serving.

GET /images/cards/{filename} streams one object out of the per-env GCS
bucket (Phase 1's card_images_bucket, Phase 2's mirror target) with a
long-lived immutable Cache-Control header, so the Firebase Hosting CDN edge
(the BL-101/ADR-0005 pattern -- see app/http_cache.py) caches every hit
after the first Cloud Run round-trip.

Public-cache eligibility (http_cache.py's invariant: a route may carry a
public cache header only if its response bytes are independent of the
Authorization header): this route takes no auth dependency and touches no
tenant-scoped data at all -- its only input is the `filename` path segment,
and its output is either the literal bytes of an immutable GCS object (a
changed source image is a new filename/path by ADR-0012 convention, never an
overwrite) or a redirect computed by pure string derivation from that same
filename. The response can never vary by caller identity, so it satisfies
the invariant *by construction*, the same way the base-cards list route
does (app/routers/base_cards.py) -- just via its own explicit
Cache-Control rather than the shared http_cache.catalog_cache dependency,
since immutable objects warrant a far longer TTL than catalog data.

Miss fallback (partial-backfill + DR design): the dev bucket is mid-backfill
(observed ~28% mirrored, unevenly by set, as of 2026-07-11 -- see the PR),
and even a fully-backfilled bucket is a mirror, not the source of truth. A
miss reconstructs the official CDN URL from the stem (pure, via
image_paths.fallback_cdn_url) and 307-redirects there with `Cache-Control:
no-store` -- nothing caches the fallback, so a request for the same
filename heals to a 200 the moment the backfill (or a future re-run)
mirrors it, with zero client-visible change (same URL, same img tag) once
it does.

The reconstruction is BEST-EFFORT, correct only for the dominant (~97%)
double-slash-origin URL form -- ~277 single-slash-origin stored URLs
(concentrated in SOR standard cards) 403 through this redirect until
mirrored, because the stem alone cannot encode which slash form the CDN
expects (see fallback_cdn_url's docstring for the census and live
verification). The AUTHORITATIVE safety net is the frontend's one-shot
<img> onError swap to the exact stored front_image_url/back_image_url
(frontend/src/utils/cardImages.ts, makeCardImageErrorHandler); this route
deliberately does NOT look the stored URL up itself, since that would put
a DB query on the image hot path.

Path safety: `filename` must decompose into a stem matching STEM_RE (letters/
digits/underscore/hyphen only -- real stems, per image_mirror's docstring,
are `card_<...>_<hex>`) plus one of the three known suffixes. No dots are
permitted in the stem, which rules out `..` (traversal) outright, and
FastAPI's default `str` path convertor already rejects a literal `/` in
`{filename}` (an encoded `%2F` doesn't survive Starlette's route matching
either), so `filename` can never smuggle a second path segment. Anything
that doesn't parse is a 404, not a 400 -- a probing/malformed filename gets
the same response as a filename that's simply not one of our objects.
"""

from __future__ import annotations

import os
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse, StreamingResponse
from google.cloud import storage

from app.services.image_paths import (
    CACHE_CONTROL,
    ORIGINAL_CONTENT_TYPE,
    RENDITION_CONTENT_TYPE,
    fallback_cdn_url,
)

router = APIRouter(prefix="/images", tags=["images"])

STEM_RE = re.compile(r"^[A-Za-z0-9_-]+$")

# suffix -> (rendition content type). Checked longest-suffix-first isn't
# needed since "_640.webp"/"_320.webp" and ".png" are mutually exclusive
# endings.
_RENDITION_SUFFIXES = {
    "_640.webp": RENDITION_CONTENT_TYPE,
    "_320.webp": RENDITION_CONTENT_TYPE,
}
_ORIGINAL_SUFFIX = ".png"

NO_STORE = "no-store"

_bucket: storage.Bucket | None = None


def get_images_bucket() -> storage.Bucket:
    """ADC-authenticated GCS bucket handle, cached at module scope so a busy
    server doesn't build a fresh storage.Client (and its credential
    resolution) on every request. FastAPI dependency -- tests override this
    via app.dependency_overrides rather than touching real GCS."""
    global _bucket
    if _bucket is None:
        bucket_name = os.environ["CARD_IMAGES_BUCKET"]
        _bucket = storage.Client().bucket(bucket_name)
    return _bucket


def _parse_filename(filename: str) -> tuple[str, str] | None:
    """`filename` -> (stem, content_type), or None if it doesn't match one
    of the three object shapes image_paths.object_paths produces. The stem
    extracted here is what a miss falls back to (image_paths.fallback_cdn_url)."""
    for suffix, content_type in _RENDITION_SUFFIXES.items():
        if filename.endswith(suffix):
            stem = filename[: -len(suffix)]
            return (stem, content_type) if STEM_RE.match(stem) else None
    if filename.endswith(_ORIGINAL_SUFFIX):
        stem = filename[: -len(_ORIGINAL_SUFFIX)]
        return (stem, ORIGINAL_CONTENT_TYPE) if STEM_RE.match(stem) else None
    return None


@router.get("/cards/{filename}")
def get_card_image(filename: str, bucket: storage.Bucket = Depends(get_images_bucket)):
    parsed = _parse_filename(filename)
    if parsed is None:
        raise HTTPException(status_code=404, detail="Not a recognized image path")
    stem, content_type = parsed

    blob = bucket.get_blob(f"cards/{filename}")
    if blob is not None:
        return StreamingResponse(
            blob.open("rb"),
            media_type=blob.content_type or content_type,
            headers={"Cache-Control": CACHE_CONTROL},
        )

    # Not mirrored (yet, or ever) -- redirect to the official CDN so the
    # image still displays, uncached, so it heals as the backfill proceeds.
    return RedirectResponse(
        url=fallback_cdn_url(stem),
        status_code=307,
        headers={"Cache-Control": NO_STORE},
    )
