"""Owner dev-review 2026-07-23: the deterministic row order for the two
downloadable files (inventory export §7.1, catalog reference §6). Files
should read the way the Vault does on screen -- not raw alphabetical
set_code, which interleaved Weekly Play and promo containers among the
base sets and sorted card numbers lexicographically ("10" before "2").

Group order:
1. Base sets in release order -- the same curated order the Vault uses
   (frontend/src/utils/catalog.ts CURATED_SET_ORDER), TS26 included as the
   last base set.
2. Weekly Play sets, in their base sets' order.
3. The long-tail containers: Judge, Promo, Convention Exclusive, Gift Box,
   Gamegenic, movie promo.
4. Any set code not in the curated list (a future set before this list is
   extended -- the content runbook's catalog-refresh step covers keeping it
   current) sorts after everything curated, alphabetically.

Within a set: card_number ascending numerically (all-digit strings today;
a non-numeric card_number would sort after the numeric ones, then
lexicographically), then variant_type as the final tiebreaker.
"""

CURATED_EXPORT_SET_ORDER = [
    # Base sets, release order (Vault's on-screen order).
    "SOR",
    "SHD",
    "TWI",
    "JTL",
    "LOF",
    "SEC",
    "LAW",
    "ASH",
    "IBH",
    "TS26",
    # Weekly Play, in base-set order.
    "SORP",
    "SHDP",
    "TWIP",
    "JTLP",
    "LOFP",
    "SECP",
    "LAWP",
    "ASHP",
    # Long-tail containers.
    "J24",
    "J25",
    "P25",
    "P26",
    "C24",
    "C25",
    "C26",
    "G25",
    "GG",
    "MV26",
]

_SET_RANK = {code: i for i, code in enumerate(CURATED_EXPORT_SET_ORDER)}


def export_sort_key(
    set_code: str | None, card_number: str | None, variant_type: str | None
) -> tuple:
    """Sort key for one file row. Usable directly as
    `sorted(rows, key=lambda r: export_sort_key(...))` by both the export
    and the catalog reference services."""
    code = set_code or ""
    number = card_number or ""
    rank = _SET_RANK.get(code, len(CURATED_EXPORT_SET_ORDER))
    numeric = (0, int(number)) if number.isdigit() else (1, 0)
    return (rank, code, numeric, number, variant_type or "")
