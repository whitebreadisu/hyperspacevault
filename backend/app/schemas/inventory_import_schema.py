"""The POST /api/inventory/import report schema (App Spec §17.2), shared
verbatim between the dry_run and commit stages (only `committed` and the
actual DB state differ).

Every field below that's meaningless for a given row's status (e.g.
`resulting_quantity` on an unresolved row, `candidates` on a resolved row)
stays `None` and is dropped from the wire response by the router's
`response_model_exclude_none=True` -- so an ambiguous row simply omits
the resolved-only keys rather than nulling them out.
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
    # Foreign-format adapter reason codes (App Spec §17.5), shared by the
    # SWUDB adapter (app/services/swudb_import.py) and the sw-unlimited-db
    # adapter (app/services/swunlimiteddb_import.py) with the same meaning:
    # the file's set code isn't in our table / the (set, number) pair isn't
    # a known base card. "ambiguous" outcomes reuse "ambiguous_triple"
    # itself, so the existing ambiguous-row UX covers them.
    "unmapped_set",
    "unknown_set_and_number",
    # sw-unlimited-db only: "unmapped_column" is a quantity column the
    # adapter deliberately never resolves (UNMAPPED_COLUMNS in
    # app/services/swunlimiteddb_import.py); "unknown_variant_for_column"
    # means the base card was found but none of its variants belong to the
    # column's family. Multi-match within a family reuses
    # "ambiguous_triple" (the same existing bucket).
    "unmapped_column",
    "unknown_variant_for_column",
]
TrimReason = Literal["keep_limit", "ceiling"]
ImportMode = Literal["merge_add", "replace", "replace_all"]
CapHandling = Literal["add_above", "trim"]
ImportStage = Literal["dry_run", "commit"]


class ImportRowCard(BaseModel):
    """The report's `card` object. For a resolved row this is the canonical
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
    # Full card records, not bare swuapi UUIDs, so the ambiguous-row report
    # can show each candidate readably: each carries everything
    # ImportRowCard carries for a resolved row (set/number/variant/
    # name/subtitle), built from the VariantMatch data every
    # candidate-construction site already has in hand (no extra DB query).
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
    """`replace_all`: one currently-owned row the file doesn't mention
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
