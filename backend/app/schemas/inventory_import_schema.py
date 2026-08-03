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
    # itself (locked decision 4: no new UX), these two are the only new
    # values.
    "unmapped_swudb_set",
    "unknown_set_and_number",
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
    candidates: list[str] | None = None
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
