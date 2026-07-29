"""BL-136: shared tcgcsv.com HTTP client -- used by the mapping builder
(run_tcgplayer_mapping.py, P1), the daily sync job (app.jobs.price_sync,
P2), and the history backfill job (app.jobs.price_backfill, P3).

tcgcsv.com's own fair-use guidance (Spike_TCGCSV_Pricing_2026-07-16.md §2,
REPORTED from /faq: recommends `time.sleep(0.25)` and "a clearly
identifiable User-Agent") is a hard constraint per the BL-136 brief, not a
suggestion -- every request through this module carries the User-Agent
below and every caller that issues more than one request must throttle
between them via `throttle()`. All fetches are sequential (no concurrency)
by construction: this module has no async/thread-pool machinery at all.

Star Wars: Unlimited's tcgcsv categoryId is 79 (spike §1.2, live-verified).
"""

from __future__ import annotations

import time

import httpx

BASE_URL = "https://tcgcsv.com"
CATEGORY_ID = 79
USER_AGENT = "SWUInventoryManager/1.0"
MIN_REQUEST_INTERVAL_SECONDS = 0.1  # >=100ms between requests, per the brief
DEFAULT_TIMEOUT_SECONDS = 30.0


def throttle(seconds: float = MIN_REQUEST_INTERVAL_SECONDS) -> None:
    """Sleeps `seconds` -- called between sequential tcgcsv requests. A
    thin wrapper (not inlined at call sites) so tests can monkeypatch it to
    a no-op instead of actually sleeping."""
    time.sleep(seconds)


class TcgcsvClient:
    """Sequential, throttled, UA-identified HTTP client for tcgcsv.com's
    public JSON endpoints. Each method issues exactly one GET; callers
    doing multiple calls in a loop are responsible for calling `throttle()`
    between them (kept explicit at the call site rather than hidden here,
    so a caller fetching one thing isn't forced to pay a throttle delay it
    doesn't need)."""

    def __init__(self, timeout: float = DEFAULT_TIMEOUT_SECONDS):
        self._client = httpx.Client(
            base_url=BASE_URL,
            headers={"User-Agent": USER_AGENT},
            timeout=timeout,
        )

    def __enter__(self) -> "TcgcsvClient":
        return self

    def __exit__(self, *exc_info) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    def last_updated(self) -> str:
        """GET /last-updated.txt -- an ISO-8601-ish timestamp string, e.g.
        "2026-07-15T20:05:27+0000" (spike §2, live-verified)."""
        response = self._client.get("/last-updated.txt")
        response.raise_for_status()
        return response.text.strip()

    def groups(self, category_id: int = CATEGORY_ID) -> list[dict]:
        """GET /tcgplayer/{categoryId}/groups -- all tcgcsv groups (boxed
        releases + promo channels) for the category."""
        response = self._client.get(f"/tcgplayer/{category_id}/groups")
        response.raise_for_status()
        return response.json()["results"]

    def products(self, group_id: int, category_id: int = CATEGORY_ID) -> list[dict]:
        """GET /tcgplayer/{categoryId}/{groupId}/products -- raw product
        rows (name, productId, extendedData, ...) for one group."""
        response = self._client.get(f"/tcgplayer/{category_id}/{group_id}/products")
        response.raise_for_status()
        return response.json()["results"]

    def prices(self, group_id: int, category_id: int = CATEGORY_ID) -> list[dict]:
        """GET /tcgplayer/{categoryId}/{groupId}/prices -- one row per
        (productId, subTypeName): {productId, lowPrice, midPrice, highPrice,
        marketPrice, directLowPrice, subTypeName}."""
        response = self._client.get(f"/tcgplayer/{category_id}/{group_id}/prices")
        response.raise_for_status()
        return response.json()["results"]


# Root-set tcgcsv groupId map (spike §1.3, live-verified 2026-07-16 group
# list). Every catalog `sets.code` with is_base_set=true has an exact
# name match to one tcgcsv group -- confirmed directly against the dev DB
# during this build (10 codes, 10 matches, no fuzzy resolution needed).
# The 19 remaining promo/convention/tier codes (SORP, C24, J25, ...) have no
# confirmed 1:1 tcgcsv-groupId mapping (spike §1.3/§4.1) and are
# deliberately out of scope here -- building that mapping is separate
# follow-on work.
ROOT_SET_GROUP_IDS: dict[str, int] = {
    "SOR": 23405,
    "SHD": 23488,
    "TWI": 23597,
    "JTL": 23956,
    "LOF": 24279,
    "SEC": 24387,
    "LAW": 24572,
    "ASH": 24660,
    "IBH": 24386,
    "TS26": 24622,
}

# Weekly Play tcgcsv groupId map (BL-174, live-verified 2026-07-27 against
# the category-79 groups endpoint --
# specification_documents/analysis/Pricing_Coverage_NonCore_Finishes_2026-07-27.md).
# Keyed by the WP set-code convention (root-set code + "P", e.g. "SORP")
# already used elsewhere in the codebase: card_variants.source_set_code for
# a Weekly Play printing IS this code verbatim (straight off swuapi -- see
# SWU_Standard_Variant_Mapping_Spec.md's SORP walkthrough), and
# app.services.set_order.CURATED_EXPORT_SET_ORDER /
# app.ingestion.swuapi_classify's `source_set_code.endswith("P")` channel
# rule both already assume it. IBH and TS26 never had a Weekly Play
# program (starter-deck-only releases) -- confirmed absent from the live
# groups listing -- so there are deliberately no IBHP/TS26P keys here.
WEEKLY_PLAY_GROUP_IDS: dict[str, int] = {
    "SORP": 23451,
    "SHDP": 23555,
    "TWIP": 23820,
    "JTLP": 24171,
    "SECP": 24515,
    "LOFP": 24535,
    "LAWP": 24659,
    "ASHP": 24765,
}

# BL-174: the single fetch-scope source of truth shared by both the
# mapping builder (app.ingestion.run_tcgplayer_mapping.run()) and the
# daily price sync job (app.jobs.price_sync.run_sync()) -- deliberately
# not two independently-maintained lists (the coverage analysis above
# flagged exactly that fork risk). app.jobs.price_backfill.py is NOT
# widened to this map -- a historical Weekly Play backfill is a separate,
# out-of-scope follow-on; it keeps using ROOT_SET_GROUP_IDS.
ALL_PRICED_GROUP_IDS: dict[str, int] = {**ROOT_SET_GROUP_IDS, **WEEKLY_PLAY_GROUP_IDS}
