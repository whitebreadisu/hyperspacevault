"""BL-54 S2 (Definition_ImportExport_2026-07-22.md §7.3): the
POST /api/inventory/import report schema, shared verbatim between the
dry_run and commit stages (only `committed` and the actual DB state
differ).

Every field below that's meaningless for a given row's status (e.g.
`resulting_quantity` on an unresolved row, `candidates` on a resolved row)
stays `None` and is dropped from the wire response by the router's
`response_model_exclude_none=True` -- matching §7.3's example payloads,
where an ambiguous row simply omits the resolved-only keys rather than
nulling them out.
"""

from typing import Literal

from pydantic import BaseModel

RowStatus = Literal["resolved", "unresolved", "ambiguous"]
ReasonCode = Literal[
    "unknown_uuid_and_triple",
    "unknown_triple",
    "ambiguous_triple",
    "incomplete_identity",
    "malformed_row",
    # BL-185: SWUDB import adapter reason codes (app/services/
    # swudb_import.py) -- "ambiguous" outcomes reuse "ambiguous_triple"
    # itself (locked decision 4: no new UX). "unmapped_swudb_set" was
    # renamed "unmapped_set" under BL-186 (below) -- now format-agnostic
    # since a second source format exists.
    "unmapped_set",
    "unknown_set_and_number",
    # BL-186: sw-unlimited-db import adapter reason codes (app/services/
    # swunlimiteddb_import.py). "unmapped_set"/"unknown_set_and_number"
    # above are shared verbatim with SWUDB (same meaning: the file's set
    # code isn't in our table / the (set, number) pair isn't a known base
    # card). "unmapped_column" is new: a quantity column this adapter
    # deliberately never resolves (Event Exclusive in v1, the 9 dead
    # tournament columns, Organized Play Foil, Price wall/Event pack/Day
    # two reward). "unknown_variant_for_column" is new: the base card was
    # found but none of its variants belong to the column's family.
    # Multi-match within a family reuses "ambiguous_triple" (existing
    # bucket, no new UX -- same locked decision 4 as SWUDB).
    "unmapped_column",
    "unknown_variant_for_column",
]
TrimReason = Literal["keep_limit", "ceiling"]
ImportMode = Literal["merge_add", "replace", "replace_all"]
CapHandling = Literal["add_above", "trim"]
ImportStage = Literal["dry_run", "commit"]


class ImportRowCard(BaseModel):
    """§7.3's `card` object. For a resolved row this is the canonical
    catalog identity (DB-sourced, even if the file's own uuid/triple
    disagreed via fallback/mismatch); for unresolved/ambiguous rows it's
    only whatever raw identity fragments the file actually carried -- never
    invented."""

    swuapi_uuid: str | None = None
    set_code: str | None = None
    card_number: str | None = None
    variant_type: str | None = None
    name: str | None = None
    subtitle: str | None = None


class ImportRowReport(BaseModel):
    row_number: int
    status: RowStatus
    reason: ReasonCode | None = None
    matched_by_fallback: bool | None = None
    uuid_triple_mismatch: bool | None = None
    # BL-200: widened from list[str] (bare swuapi UUIDs) to full card
    # records -- the ambiguous-row report used to leak swuapi UUIDs
    # verbatim to the screen; each candidate now carries everything
    # ImportRowCard already carries for a resolved row (set/number/variant/
    # name/subtitle), built from the same VariantMatch data every
    # candidate-construction site already has in hand (BL-200 census,
    # "Candidate display" section -- zero new DB queries).
    candidates: list[ImportRowCard] | None = None
    card: ImportRowCard
    file_quantity: int | None = None
    current_quantity: int | None = None
    resulting_quantity: int | None = None
    copies_not_added: int | None = None
    trim_reason: TrimReason | None = None


class ImportTotals(BaseModel):
    rows: int
    resolved: int
    matched_by_fallback: int
    unresolved: int
    ambiguous: int
    trimmed: int
    ceiling_clamped: int
    duplicate_rows_merged: int
    unrecognized_columns: list[str]
    removed_by_replace_all: int


class RemovedRow(BaseModel):
    """§7.3 `replace_all`: one currently-owned row the file doesn't mention
    -- itemized in both stages so the destructive half of the preview is as
    visible as the additive half."""

    card: ImportRowCard
    quantity: int


class ImportReport(BaseModel):
    stage: ImportStage
    mode: ImportMode
    cap_handling: CapHandling
    committed: bool
    totals: ImportTotals
    rows: list[ImportRowReport]
    removed: list[RemovedRow] = []
