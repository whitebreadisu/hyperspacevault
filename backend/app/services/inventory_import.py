"""BL-54 S2: resolution engine (§4), merge/cap math (§5), and the
dry_run/commit orchestration behind POST /api/inventory/import (§7.2/§7.3).

Definition_ImportExport_2026-07-22.md is authoritative; every section
reference below points there.

Both stages share ONE code path -- `compute_import` -- so "commit re-runs
the identical computation" (§7.2) is true by construction rather than by
convention: the router calls this exact function for both dry_run and
commit, and only the commit branch additionally applies the returned
WritePlan and calls db.commit() once.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field, replace
from functools import partial

from sqlalchemy.orm import Session

from app.ingestion.swuapi_classify import limit_bucket
from app.repositories import inventory_import as inventory_import_repo
from app.repositories.inventory_import import VariantMatch
from app.schemas.inventory_import_schema import (
    ImportReport,
    ImportRowCard,
    ImportRowReport,
    ImportTotals,
    RemovedRow,
)
from app.services.inventory import QUANTITY_CEILING
from app.services.inventory_io import ParsedRow, ParseNotes
from app.services.limits import effective_limit, type_category


@dataclass
class WritePlan:
    """§7.2 commit stage: exactly what to write, computed once by
    compute_import and applied verbatim by apply_write_plan -- P6/§7.2
    "commit writes only resolved rows" plus replace_all's removals (which
    are themselves just resolved-to-zero writes on rows the file didn't
    mention)."""

    updates: dict[int, int] = field(default_factory=dict)


@dataclass
class _Resolution:
    """§4's per-row outcome, before any merge/cap math (which needs each
    resolved variant's current quantity, fetched in bulk once every
    resolved variant_id in the file is known -- see compute_import)."""

    row: ParsedRow
    status: str  # "resolved" | "unresolved" | "ambiguous"
    reason: str | None
    matched_by_fallback: bool
    uuid_triple_mismatch: bool
    # BL-200: full VariantMatch tuples now, not bare swuapi_id strings --
    # converted to ImportRowCard only when the report row is built below
    # (_resolved_card), so an ambiguous row's candidates render as real
    # cards ("SET number · variant type · name") instead of UUIDs.
    candidates: list[VariantMatch]
    variant: VariantMatch | None


def _triple_of(row: ParsedRow) -> tuple[str, str, str] | None:
    """§4 step 3: a "complete" triple requires all three fields -- a
    partially-filled triple is never treated as resolvable, only as
    `incomplete_identity`."""
    if row.set_code and row.card_number and row.variant_type:
        return (row.set_code, row.card_number, row.variant_type)
    return None


# PLR0911: one early return per §4 outcome, in the order the spec lists them.
def _resolve_row(  # noqa: PLR0911
    row: ParsedRow,
    uuid_map: dict[str, VariantMatch],
    triple_map: dict[tuple[str, str, str], list[VariantMatch]],
) -> _Resolution:
    """§4, applied in the order the spec states it. `row.malformed_quantity`
    short-circuits everything else -- per inventory_io's S2 handoff
    docstring, a malformed quantity is `malformed_row` before any identity
    resolution is even attempted."""
    if row.malformed_quantity:
        return _Resolution(row, "unresolved", "malformed_row", False, False, [], None)

    # BL-185: a SWUDB row's identity was resolved (or determined un-
    # resolvable/ambiguous) entirely by swudb_import.parse_swudb_csv at
    # parse time -- its raw identity (Set/CardNumber/IsFoil/Stamp) doesn't
    # fit the uuid/triple schemes this function otherwise handles, so the
    # adapter does its own §6 resolution against the DB up front and
    # stashes the verdict on the row rather than a triple this function
    # could re-derive. `preresolved_reason` is None on every row parse_
    # json/parse_csv ever produce, so this branch is a no-op for them.
    if row.preresolved_reason is not None:
        if row.preresolved_candidates:
            return _Resolution(
                row,
                "ambiguous",
                row.preresolved_reason,
                False,
                False,
                row.preresolved_candidates,
                None,
            )
        return _Resolution(
            row, "unresolved", row.preresolved_reason, False, False, [], None
        )

    triple = _triple_of(row)

    # Step 1: uuid present and known -> resolved by uuid, unconditionally
    # (even if a complete triple on the same row disagrees -- that's a
    # warning flag, not a resolution failure, §4 step 1).
    if row.swuapi_uuid and row.swuapi_uuid in uuid_map:
        match = uuid_map[row.swuapi_uuid]
        variant = match[0]
        mismatch = (
            triple is not None
            and triple
            != (
                variant.source_set_code,
                variant.card_number,
                variant.variant_type,
            )
        ) or row.preresolved_mismatch  # BL-185: SWUDB's own IsFoil/Stamp
        # confirmatory check (soft warning, never a resolution failure --
        # §6 step 3/§7). preresolved_mismatch is always False on a
        # canonical-format row (no triple to compare against here anyway).
        return _Resolution(row, "resolved", None, False, mismatch, [], match)

    # Step 2: uuid absent OR present-but-unknown -> fall back to the triple.
    # `matched_by_fallback` is only ever true when a uuid WAS present (P3) --
    # a row with no uuid at all resolving by triple is just normal identity,
    # not a "fallback".
    uuid_was_present = bool(row.swuapi_uuid)

    if triple is not None:
        matches = triple_map.get(triple, [])
        if len(matches) == 1:
            return _Resolution(
                row, "resolved", None, uuid_was_present, False, [], matches[0]
            )
        if len(matches) > 1:
            candidates = sorted(matches, key=lambda m: m[0].swuapi_id)
            return _Resolution(
                row, "ambiguous", "ambiguous_triple", False, False, candidates, None
            )
        reason = "unknown_uuid_and_triple" if uuid_was_present else "unknown_triple"
        return _Resolution(row, "unresolved", reason, False, False, [], None)

    # Step 3: no usable identity at all (uuid unknown/absent AND an
    # incomplete triple).
    return _Resolution(row, "unresolved", "incomplete_identity", False, False, [], None)


def _compute_target(
    mode: str, cap_handling: str, current: int, file_quantity: int, limit: int | None
) -> tuple[int, str | None, int]:
    """§5's merge & cap math. Returns
    (resulting_quantity, trim_reason, copies_not_added); trim_reason is
    None when this row wasn't clamped at all."""
    raw_target = current + file_quantity if mode == "merge_add" else file_quantity

    if cap_handling == "trim" and limit is not None:
        if mode == "merge_add":
            # §5: merge_add + trim never reduces pre-existing stock.
            pre_ceiling = max(current, min(raw_target, limit))
        else:
            # replace/replace_all: reduction is inherent to "file wins".
            pre_ceiling = min(raw_target, limit)
    else:
        # add_above: keep-limits never clamp (P7). Ceiling still applies
        # below regardless of cap_handling (P8).
        pre_ceiling = raw_target

    final_target = min(pre_ceiling, QUANTITY_CEILING)

    if final_target < pre_ceiling:
        trim_reason = "ceiling"
    elif pre_ceiling < raw_target:
        trim_reason = "keep_limit"
    else:
        trim_reason = None

    copies_not_added = raw_target - final_target if trim_reason else 0
    return final_target, trim_reason, copies_not_added


def _fold_post_resolution_duplicates(
    resolutions: list[_Resolution],
) -> tuple[list[_Resolution], int]:
    """inventory_io._merge_duplicates (§3.4) folds duplicates at the
    representation level only -- same raw uuid, or same raw triple. A file
    can still carry one card twice under DIFFERENT identity schemes (once
    by uuid, once by triple); that duplicate only becomes visible after
    resolution, when both rows land on the same variant_id. Without this
    pass, both rows would appear in the report while
    `updates[variant.id] = resulting` last-write-wins in _plan_rows --
    report and actual write would disagree, violating §7.3's "the preview
    shows exact outcomes". (inventory_io's _merge_duplicates leaves this
    post-resolution fold to this module by design.)

    Policy matches §3.4's duplicate handling: file quantities sum into the
    FIRST row (its row_number and resolution attributes win), later rows
    drop out of the report entirely, and each dropped row counts into
    `duplicate_rows_merged`. Runs before any merge/cap math, in all modes.
    Only resolved rows fold -- unresolved/ambiguous rows never carry a
    variant_id to fold on.
    """
    folded: list[_Resolution] = []
    first_index_by_variant: dict[int, int] = {}
    dropped = 0
    for res in resolutions:
        if res.status == "resolved" and res.variant is not None:
            variant_id = res.variant[0].id
            if variant_id in first_index_by_variant:
                idx = first_index_by_variant[variant_id]
                first = folded[idx]
                # Malformed rows never resolve, so both quantities exist.
                assert first.row.quantity is not None
                assert res.row.quantity is not None
                folded[idx] = replace(
                    first,
                    row=replace(
                        first.row, quantity=first.row.quantity + res.row.quantity
                    ),
                )
                dropped += 1
                continue
            first_index_by_variant[variant_id] = len(folded)
        folded.append(res)
    return folded, dropped


def _resolved_card(match: VariantMatch) -> ImportRowCard:
    variant, name, subtitle, _base_card_type = match
    return ImportRowCard(
        swuapi_uuid=variant.swuapi_id,
        set_code=variant.source_set_code,
        card_number=variant.card_number,
        variant_type=variant.variant_type,
        name=name,
        subtitle=subtitle,
    )


def _raw_card(row: ParsedRow) -> ImportRowCard:
    """For unresolved rows: only whatever raw identity fragments the file
    actually carried, never a guessed/invented identity. Ambiguous rows
    build their own card from the triple alone (see _plan_rows)."""
    return ImportRowCard(
        swuapi_uuid=row.swuapi_uuid,
        set_code=row.set_code,
        card_number=row.card_number,
        variant_type=row.variant_type,
    )


def _resolve_rows(db: Session, rows: list[ParsedRow]) -> tuple[list[_Resolution], int]:
    """§4 for every row: one bulk uuid lookup and one bulk triple lookup,
    per-row resolution against them, then the cross-scheme duplicate fold.
    Returns the folded resolutions and the number of rows the fold
    removed."""
    uuids: set[str] = set()
    triples: set[tuple[str, str, str]] = set()
    for row in rows:
        if row.malformed_quantity:
            continue
        if row.swuapi_uuid:
            uuids.add(row.swuapi_uuid)
        triple = _triple_of(row)
        if triple is not None:
            triples.add(triple)

    uuid_map = inventory_import_repo.get_variants_by_uuids(db, list(uuids))
    triple_map = inventory_import_repo.get_variants_by_triples(db, list(triples))

    resolutions = [_resolve_row(row, uuid_map, triple_map) for row in rows]
    return _fold_post_resolution_duplicates(resolutions)


LimitCache = dict[tuple[str, str], int | None]
LimitLookup = Callable[[str, str, str], int | None]


def _cached_limit(
    db: Session,
    cache: LimitCache,
    base_card_type: str,
    variant_type: str,
    set_code: str,
) -> int | None:
    """§5: the effective keep-limit for one variant. The limit depends only
    on (type_category, limit_bucket) -- at most 2 x len(ALL_LIMIT_BUCKETS)
    distinct cells -- so `cache` holds one lookup per cell and
    tenant_card_limits is queried once per cell rather than once per file
    row. The caller owns `cache` and scopes it to one import."""
    key = (type_category(base_card_type), limit_bucket(variant_type, set_code))
    if key not in cache:
        cache[key] = effective_limit(db, *key)
    return cache[key]


def _plan_rows(
    resolutions: list[_Resolution],
    current_quantities: dict[int, int],
    limit_for: LimitLookup,
    mode: str,
    cap_handling: str,
) -> tuple[list[ImportRowReport], dict[int, int]]:
    """§5 merge/cap per row and the §7.3 report row for it. Returns the
    report rows (in resolution order) and the target quantity for every
    resolved variant_id. DB-free: `current_quantities` is already fetched
    (an absent variant_id means current 0) and `limit_for(base_card_type,
    variant_type, set_code)` supplies each resolved row's keep-limit."""
    row_reports: list[ImportRowReport] = []
    updates: dict[int, int] = {}

    for res in resolutions:
        row = res.row
        if res.status == "resolved":
            assert res.variant is not None
            variant, _name, _subtitle, base_card_type = res.variant
            assert row.quantity is not None  # malformed rows never resolve
            current = current_quantities.get(variant.id, 0)
            limit = limit_for(
                base_card_type, variant.variant_type, variant.source_set_code
            )
            resulting, trim_reason, copies_not_added = _compute_target(
                mode, cap_handling, current, row.quantity, limit
            )
            updates[variant.id] = resulting
            row_reports.append(
                ImportRowReport(
                    row_number=row.row_number,
                    status="resolved",
                    matched_by_fallback=res.matched_by_fallback,
                    uuid_triple_mismatch=res.uuid_triple_mismatch,
                    card=_resolved_card(res.variant),
                    file_quantity=row.quantity,
                    current_quantity=current,
                    resulting_quantity=resulting,
                    copies_not_added=copies_not_added,
                    trim_reason=trim_reason,
                )
            )
        elif res.status == "ambiguous":
            row_reports.append(
                ImportRowReport(
                    row_number=row.row_number,
                    status="ambiguous",
                    reason=res.reason,
                    # Each candidate renders as a full card, built the same
                    # way as a resolved row's `card`, from VariantMatch data
                    # the bulk lookups already fetched (no extra query).
                    candidates=[_resolved_card(m) for m in res.candidates],
                    card=ImportRowCard(
                        set_code=row.set_code,
                        card_number=row.card_number,
                        variant_type=row.variant_type,
                    ),
                    file_quantity=row.quantity,
                )
            )
        else:  # unresolved
            row_reports.append(
                ImportRowReport(
                    row_number=row.row_number,
                    status="unresolved",
                    reason=res.reason,
                    card=_raw_card(row),
                    file_quantity=row.quantity,
                )
            )

    return row_reports, updates


def _replace_all_removals(
    owned_rows: Iterable[tuple],
) -> tuple[list[RemovedRow], dict[int, int]]:
    """§5 `replace_all`: every owned row the file did not resolve is
    itemized as a removal and written as a resolved-to-zero update in the
    same WritePlan as every other resolved row. `owned_rows` are
    get_owned_rows_excluding's rows: (variant_id, quantity, swuapi_id,
    set_code, card_number, variant_type, name, subtitle). DB-free."""
    removed: list[RemovedRow] = []
    updates: dict[int, int] = {}
    for (
        variant_id,
        quantity,
        swuapi_id,
        set_code,
        card_number,
        variant_type,
        name,
        subtitle,
    ) in owned_rows:
        removed.append(
            RemovedRow(
                card=ImportRowCard(
                    swuapi_uuid=swuapi_id,
                    set_code=set_code,
                    card_number=card_number,
                    variant_type=variant_type,
                    name=name,
                    subtitle=subtitle,
                ),
                quantity=quantity,
            )
        )
        updates[variant_id] = 0
    return removed, updates


def _totals(
    shown_rows: int,
    row_reports: list[ImportRowReport],
    removed: list[RemovedRow],
    notes: ParseNotes,
    cross_scheme_merged: int,
) -> ImportTotals:
    """§7.3 totals, counted from the report rows. `shown_rows` counts the
    rows the report actually shows (resolved + unresolved + ambiguous);
    rows folded away by either duplicate pass (inventory_io's §3.4
    raw-identity pass, or the post-resolution cross-scheme pass) count in
    duplicate_rows_merged instead."""
    resolved = [r for r in row_reports if r.status == "resolved"]
    trim_reasons = [r.trim_reason for r in resolved]
    return ImportTotals(
        rows=shown_rows,
        resolved=len(resolved),
        matched_by_fallback=sum(1 for r in resolved if r.matched_by_fallback),
        unresolved=sum(1 for r in row_reports if r.status == "unresolved"),
        ambiguous=sum(1 for r in row_reports if r.status == "ambiguous"),
        trimmed=trim_reasons.count("keep_limit"),
        ceiling_clamped=trim_reasons.count("ceiling"),
        duplicate_rows_merged=notes.duplicate_rows_merged + cross_scheme_merged,
        unrecognized_columns=notes.unrecognized_columns,
        removed_by_replace_all=len(removed),
    )


# PLR0913: the router passes mode, cap_handling and stage as three separate
# keyword options, one per form field.
def compute_import(  # noqa: PLR0913
    db: Session,
    rows: list[ParsedRow],
    notes: ParseNotes,
    *,
    mode: str,
    cap_handling: str,
    stage: str,
) -> tuple[ImportReport, WritePlan]:
    """§4 resolution + §5 merge/cap math + §7.3 report, for either stage --
    read-only (issues no writes; the caller applies the returned WritePlan
    for the commit stage only). See module docstring for why this single
    function backs both stages."""
    resolutions, cross_scheme_merged = _resolve_rows(db, rows)

    resolved_variant_ids = list(
        {res.variant[0].id for res in resolutions if res.variant is not None}
    )
    current_quantities = inventory_import_repo.get_current_quantities(
        db, resolved_variant_ids
    )
    limit_cache: LimitCache = {}
    row_reports, plan_updates = _plan_rows(
        resolutions,
        current_quantities,
        partial(_cached_limit, db, limit_cache),
        mode,
        cap_handling,
    )

    removed_rows: list[RemovedRow] = []
    if mode == "replace_all":
        owned = inventory_import_repo.get_owned_rows_excluding(db, set(plan_updates))
        removed_rows, removal_updates = _replace_all_removals(owned)
        plan_updates.update(removal_updates)

    report = ImportReport(
        stage=stage,
        mode=mode,
        cap_handling=cap_handling,
        committed=False,
        totals=_totals(
            len(rows) - cross_scheme_merged,
            row_reports,
            removed_rows,
            notes,
            cross_scheme_merged,
        ),
        rows=row_reports,
        removed=removed_rows,
    )
    return report, WritePlan(updates=plan_updates)


def apply_write_plan(db: Session, plan: WritePlan) -> None:
    """§7.2 commit stage: writes the plan's target quantities. Does NOT
    commit -- the router commits exactly once after this returns, so a
    mid-way failure (raised from here or from the router before that
    commit) leaves every row untouched (get_db's session is closed without
    committing, discarding the whole uncommitted transaction)."""
    inventory_import_repo.apply_quantities(db, plan.updates)
