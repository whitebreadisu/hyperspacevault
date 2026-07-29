"""BL-76 Phase 3 (ADR-0012, derivation amendment): pure, side-effect-free
path/URL derivation shared by the ingestion mirror (Phase 2) and the API/
serving layer (Phase 3).

Moved here from `app.ingestion.image_mirror` (which re-exports `derive_stem`
and `object_paths` for backward compatibility -- the backfill script and its
tests still import them from there) so that `app.services.cards` (imported
on every API request) doesn't have to pull in `google-cloud-storage`/`httpx`/
`Pillow` just to compute a same-origin path string. This module has zero
third-party imports and zero I/O -- safe to import from the request path.

The amendment to ADR-0012's "additive path columns" line, decided
2026-07-11: no new DB columns, no migration. Every rendition path is
*derived* at read time from the already-stored `front_image_url`/
`back_image_url` CDN URLs via `object_paths` below -- the mirror's path
scheme is deterministic and stateless by design (see its original
docstring), so storing the derived paths a second time would just be
redundant, driftable state. This is also why Phase 3 needs zero catalog
seed regeneration: no catalog *data* changes, only how the API composes
URLs from data that was already there.
"""

from __future__ import annotations

from urllib.parse import urlparse

CACHE_CONTROL = "public, max-age=31536000, immutable"
RENDITION_WIDTHS = (640, 320)
WEBP_QUALITY = 80
ORIGINAL_CONTENT_TYPE = "image/png"
RENDITION_CONTENT_TYPE = "image/webp"

# The official SWU CDN -- ingestion's source of truth, and Phase 3's
# same-origin serving handler's fallback target for any object the backfill
# hasn't mirrored yet (dev is ~25% through as of 2026-07-11).
CDN_ORIGIN = "https://cdn.starwarsunlimited.com"

# Same-origin path prefix the Firebase Hosting rewrite / Cloud Run image
# handler serves objects under (app/routers/images.py): "/images/" + the
# object's bucket path (which already starts with "cards/").
SERVE_PREFIX = "/images/"


def derive_stem(url: str) -> str:
    """The CDN filename, extension and querystring stripped -- the shared
    basename every one of this image's stored objects is built from."""
    path = urlparse(url).path
    filename = path.rsplit("/", 1)[-1]
    return filename.rsplit(".", 1)[0] if "." in filename else filename


def object_paths(url: str) -> dict[str, str]:
    """The 3 deterministic object paths for a source CDN URL, keyed by
    rendition ("original", "640", "320"). Pure path derivation -- no bucket
    access, callable by both the mirror (upload targets) and the API/serving
    layer (same-origin URL composition) from a stored `front_image_url`/
    `back_image_url` alone."""
    stem = derive_stem(url)
    return {
        "original": f"cards/{stem}.png",
        "640": f"cards/{stem}_640.webp",
        "320": f"cards/{stem}_320.webp",
    }


def same_origin_renditions(url: str) -> dict[str, str]:
    """The 3 same-origin serving URLs (GET /images/cards/<file>) for a
    stored CDN URL, keyed "original"/"w640"/"w320" -- the shape
    `CardVariantCatalogResponse.front_images`/`back_images` (BL-76 Phase 3)
    return to the frontend for srcset construction. Additive alongside the
    untouched `front_image_url`/`back_image_url` provenance fields."""
    paths = object_paths(url)
    return {
        "original": f"{SERVE_PREFIX}{paths['original']}",
        "w640": f"{SERVE_PREFIX}{paths['640']}",
        "w320": f"{SERVE_PREFIX}{paths['320']}",
    }


def fallback_cdn_url(stem: str) -> str:
    """BEST-EFFORT reconstructed official-CDN URL for a stem whose object
    isn't in the bucket yet (partial backfill) or ever (DR fallback) --
    always the full-size PNG, since renditions are mirror-only artifacts
    that don't exist on the CDN. Used by the images router's cache-miss 307
    redirect (app/routers/images.py).

    Best-effort, not authoritative: `derive_stem` discards the source URL's
    path entirely (see its docstring's `<anything>/<stem>.png` scheme), and
    CloudFront/S3 does NOT normalize away an empty path segment -- the
    double-slash `.com//<stem>.png` and single-slash `.com/<stem>.png`
    forms are distinct object keys, each 403ing for the other's images
    (verified live 2026-07-11). The stem cannot encode which form is
    correct, so this picks the dominant one: a dev-DB census of all 8,354
    stored image URLs found double-slash origin outnumbers single-slash
    ~29:1 (8,077 vs 277). The ~277 single-slash-origin URLs (concentrated
    in SOR standard cards) 403 through this redirect until mirrored.

    The AUTHORITATIVE safety net is client-side: the frontend has the
    exact stored URL (front_image_url/back_image_url), and every card
    <img> carries a one-shot onError fallback that swaps to it when the
    served source fails (frontend/src/utils/cardImages.ts,
    makeCardImageErrorHandler) -- so a 307 -> 403 chain here degrades to
    one wasted round trip, never a broken image. Fixing the form
    server-side would require the stored URL (a DB lookup) on the image
    hot path, which is deliberately avoided."""
    return f"{CDN_ORIGIN}//{stem}.png"
