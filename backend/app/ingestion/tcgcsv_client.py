"""Shared tcgcsv.com HTTP client (App Spec §16.1) -- used by the mapping
builder (run_tcgplayer_mapping.py), the daily sync job
(app.jobs.price_sync), and the history backfill job
(app.jobs.price_backfill).

Every request through this module carries the identifying User-Agent
below, and every caller that issues more than one request must throttle
between them via `throttle()`, which sleeps MIN_REQUEST_INTERVAL_SECONDS
(0.25 s). All fetches are sequential (no concurrency) by construction: this
module has no async/thread-pool machinery at all.

Star Wars: Unlimited's tcgcsv categoryId is 79 (App Spec §16.1).
"""

from __future__ import annotations

import time

import httpx

BASE_URL = "https://tcgcsv.com"
CATEGORY_ID = 79
USER_AGENT = "SWUInventoryManager/1.0"
MIN_REQUEST_INTERVAL_SECONDS = 0.25  # matches the delay in tcgcsv.com/faq sample code
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

    def __enter__(self) -> TcgcsvClient:
        return self

    def __exit__(self, *exc_info) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    def last_updated(self) -> str:
        """GET /last-updated.txt -- an ISO-8601-ish timestamp string, e.g.
        "2026-07-15T20:05:27+0000"."""
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


# Root-set tcgcsv groupId map: every catalog `sets.code` with
# is_base_set=true has an exact name match to one tcgcsv group (no fuzzy
# resolution). Weekly Play groups are in WEEKLY_PLAY_GROUP_IDS below; the
# other promo/convention/tier codes (C24, J25, ...) have no confirmed 1:1
# tcgcsv-groupId mapping and are not priced.
ROOT_SET_GROUP_IDS: dict[str, int] = {
    "SOR": 23405,
    "SHD": 23488,
    "TWI": 23597,
    "JTL": 23956,
    "LOF": 24279,
    "SEC": 24387,
    "LAW": 24572,
    "ASH": 24660,
    "HMW": 24812,
    "IBH": 24386,
    "TS26": 24622,
    "IC27": 24888,  # "Icons 2027 Edition", publishedOn 2026-11-20
}

# Weekly Play tcgcsv groupId map (App Spec §16.3b), checked against the category-79
# groups endpoint. Keyed by the WP set-code convention (root-set code + "P", e.g.
# "SORP") used elsewhere in the codebase (app.services.set_order's
# CURATED_EXPORT_SET_ORDER, app.ingestion.swuapi_classify's
# `source_set_code.endswith("P")` channel rule). CAVEAT: card_variants.source_set_code carries the "P" code only from JTL onward
# -- the first three sets' WP printings are ROOT-coded (SOR/SHD/TWI) on our side, which
# is why run_tcgplayer_mapping's WP pass sources variants from BOTH the "P" code and its
# root companion. IBH and TS26 have no Weekly Play program (starter-deck-only releases;
# absent from the groups listing), so there are deliberately no IBHP/TS26P keys here.
WEEKLY_PLAY_GROUP_IDS: dict[str, int] = {
    "SORP": 23451,
    "SHDP": 23555,
    "TWIP": 23820,
    "JTLP": 24171,
    "SECP": 24515,
    "LOFP": 24535,
    "LAWP": 24659,
    "ASHP": 24765,
    "HMWP": 24897,
}

# The single fetch-scope source of truth shared by the mapping builder
# (app.ingestion.run_tcgplayer_mapping.run()), the daily price sync job
# (app.jobs.price_sync.run_sync()), and the history backfill job
# (app.jobs.price_backfill.py): deliberately not independently-maintained
# lists, which could fork so that a job fetches groups the mapping does not
# cover, or misses groups it does. The backfill's archive walk
# extracts these groups' price files per day, so newly mapped WP-group
# variants gain history on a `--start`-forced re-walk (per-(variant, date)
# inserts are ON CONFLICT DO NOTHING -- already-walked days only add rows
# for the newly mapped).
ALL_PRICED_GROUP_IDS: dict[str, int] = {**ROOT_SET_GROUP_IDS, **WEEKLY_PLAY_GROUP_IDS}
