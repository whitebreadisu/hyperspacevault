"""BL-76 Phase 3 (ADR-0012) tests for app/services/image_paths.py -- the
pure derivation module split out of app.ingestion.image_mirror so the
request-serving API can compute same-origin URLs without importing
google-cloud-storage/httpx/Pillow. derive_stem/object_paths themselves are
unchanged (still covered by test_image_mirror.py's parametrized cases,
which still pass against the re-exported names); this file covers the two
functions Phase 3 adds on top.
"""

from app.services.image_paths import (
    CDN_ORIGIN,
    derive_stem,
    fallback_cdn_url,
    object_paths,
    same_origin_renditions,
)


def test_derive_stem_and_object_paths_are_re_exported_and_still_correct():
    url = "https://cdn.starwarsunlimited.com//card_0801_abc123.png"
    assert derive_stem(url) == "card_0801_abc123"
    assert object_paths(url) == {
        "original": "cards/card_0801_abc123.png",
        "640": "cards/card_0801_abc123_640.webp",
        "320": "cards/card_0801_abc123_320.webp",
    }


def test_same_origin_renditions_shape():
    url = "https://cdn.starwarsunlimited.com//card_0801_abc123.png"
    assert same_origin_renditions(url) == {
        "original": "/images/cards/card_0801_abc123.png",
        "w640": "/images/cards/card_0801_abc123_640.webp",
        "w320": "/images/cards/card_0801_abc123_320.webp",
    }


def test_same_origin_renditions_deterministic_across_calls():
    url = "https://cdn.starwarsunlimited.com/card_repeat.png"
    assert same_origin_renditions(url) == same_origin_renditions(url)


def test_fallback_cdn_url_reconstructs_full_size_png_with_the_double_slash_form():
    """Double slash is deliberate -- verified 2026-07-11 against the live
    CDN that a single-slash reconstruction 403s for the ~97% of stored
    URLs that are double-slash-origin (see fallback_cdn_url's docstring
    for the full census). This pins the double-slash form as the
    intentional behavior, not a regression."""
    assert (
        fallback_cdn_url("card_0801_abc123")
        == f"{CDN_ORIGIN}//card_0801_abc123.png"
        == "https://cdn.starwarsunlimited.com//card_0801_abc123.png"
    )
