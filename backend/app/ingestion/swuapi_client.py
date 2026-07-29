"""Live swuapi.com fetch -- the real/ongoing-run data source.

Not exercised in CI (SWU_Catalog_Redesign_Spec.md §8.3: "no live
api.swuapi.com calls in CI"). The dev/test/CI input is the captured export
fixture loaded directly as a dict; this module exists only for the real
catalog-rebuild run.

`/export/all` alone is not enough: its card records are missing
`variant_of_uuid` entirely (confirmed live 2026-06-21 -- only `/cards`
carries it). So this mirrors how the captured fixture
(swuapi_export_2026-06-21.json) was actually built per its own header
comment: paginate `/cards` offset-based for full per-card data including
`variant_of_uuid`, and use `/export/all` only for `sets`/`meta`. Cursor-based
pagination (`next_cursor`) is documented to silently truncate past ~3,857
records (mapping spec §4) -- offset-based, driven by `pagination.total`, is
the only reliable way to walk the full corpus. The API caps page size at
500 regardless of the requested `limit`.
"""

import httpx

EXPORT_ALL_URL = "https://api.swuapi.com/export/all"
CARDS_URL = "https://api.swuapi.com/cards"
PAGE_SIZE = 500


def fetch_export(timeout: float = 60.0) -> dict:
    with httpx.Client(timeout=timeout) as client:
        export_all = client.get(EXPORT_ALL_URL)
        export_all.raise_for_status()
        export_all_data = export_all.json()

        cards: list[dict] = []
        offset = 0
        total = None
        while total is None or offset < total:
            response = client.get(
                CARDS_URL, params={"limit": PAGE_SIZE, "offset": offset}
            )
            response.raise_for_status()
            page = response.json()
            cards.extend(page["cards"])
            total = page["pagination"]["total"]
            offset += len(page["cards"])
            if not page["cards"]:
                break  # defensive: avoid an infinite loop on an empty page

    return {
        "meta": export_all_data.get("meta"),
        "sets": export_all_data["sets"],
        "cards": cards,
    }
