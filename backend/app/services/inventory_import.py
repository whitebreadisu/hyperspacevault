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

from dataclasses import dataclass, field, replace

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
    candidates: list[str]
    variant: VariantMatch | None


def _triple_of(row: ParsedRow) -> tuple[str, str, str] | None:
    """§4 step 3: a "complete" triple requires all three fields -- a
    partially-filled triple is never treated as resolvable, only as
    `incomplete_identity`."""
    if row.set_code and row.card_number and row.variant_type:
        return (row.set_code, row.card_number, row.variant_type)
    return None


def _resolve_row(
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

    triple = _triple_of(row)

    # Step 1: uuid present and known -> resolved by uuid, unconditionally
    # (even if a complete triple on the same row disagrees -- that's a
    # warning flag, not a resolution failure, §4 step 1).
    if row.swuapi_uuid and row.swuapi_uuid in uuid_map:
        match = uuid_map[row.swuapi_uuid]
        variant = match[0]
        mismatch = triple is not None and triple != (
            variant.source_set_code,
            variant.card_number,
            variant.variant_type,
        )
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
            candidates = sorted(m[0].swuapi_id for m in matches)
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
    `plan_updates[variant.id] = resulting` last-write-wins in
    compute_import -- report and actual write would disagree, violating
    §7.3's "the preview shows exact outcomes". (inventory_io's
    _merge_duplicates docstring explicitly leaves this post-resolution fold
    to S2 -- its representation-level scope line stands.)

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
    """For unresolved/ambiguous rows: only whatever raw identity fragments
    the file actually carried, never a guessed/invented identity."""
    return ImportRowCard(
        swuapi_uuid=row.swuapi_uuid,
        set_code=row.set_code,
        card_number=row.card_number,
        variant_type=row.variant_type,
    )


def compute_import(
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
    resolutions, cross_scheme_merged = _fold_post_resolution_duplicates(resolutions)

    resolved_variant_ids = list(
        {res.variant[0].id for res in resolutions if res.variant is not None}
    )
    current_quantities = inventory_import_repo.get_current_quantities(
        db, resolved_variant_ids
    )

    # §5: the effective keep-limit only depends on (type_category,
    # limit_bucket) -- at most 2 x len(ALL_LIMIT_BUCKETS) distinct cells --
    # so cache per-cell rather than re-querying tenant_card_limits once per
    # file row.
    limit_cache: dict[tuple[str, str], int | None] = {}

    def _limit_for(base_card_type: str, variant_type: str, set_code: str) -> int | None:
        category = type_category(base_card_type)
        bucket = limit_bucket(variant_type, set_code)
        key = (category, bucket)
        if key not in limit_cache:
            limit_cache[key] = effective_limit(db, category, bucket)
        return limit_cache[key]

    row_reports: list[ImportRowReport] = []
    plan_updates: dict[int, int] = {}
    resolved_variant_id_set: set[int] = set()

    resolved_count = 0
    matched_by_fallback_count = 0
    unresolved_count = 0
    ambiguous_count = 0
    trimmed_count = 0
    ceiling_clamped_count = 0

    for res in resolutions:
        row = res.row
        if res.status == "resolved":
            assert res.variant is not None
            variant, _name, _subtitle, base_card_type = res.variant
            assert row.quantity is not None  # malformed rows never resolve
            current = current_quantities.get(variant.id, 0)
            limit = _limit_for(
                base_card_type, variant.variant_type, variant.source_set_code
            )
            resulting, trim_reason, copies_not_added = _compute_target(
                mode, cap_handling, current, row.quantity, limit
            )
            plan_updates[variant.id] = resulting
            resolved_variant_id_set.add(variant.id)

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
            resolved_count += 1
            if res.matched_by_fallback:
                matched_by_fallback_count += 1
            if trim_reason == "keep_limit":
                trimmed_count += 1
            elif trim_reason == "ceiling":
                ceiling_clamped_count += 1

        elif res.status == "ambiguous":
            row_reports.append(
                ImportRowReport(
                    row_number=row.row_number,
                    status="ambiguous",
                    reason=res.reason,
                    candidates=res.candidates,
                    card=ImportRowCard(
                        set_code=row.set_code,
                        card_number=row.card_number,
                        variant_type=row.variant_type,
                    ),
                    file_quantity=row.quantity,
                )
            )
            ambiguous_count += 1

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
            unresolved_count += 1

    removed_rows: list[RemovedRow] = []
    if mode == "replace_all":
        owned = inventory_import_repo.get_owned_rows_excluding(
            db, resolved_variant_id_set
        )
        for (
            variant_id,
            quantity,
            swuapi_id,
            set_code,
            card_number,
            variant_type,
            name,
            subtitle,
        ) in owned:
            removed_rows.append(
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
            # §5: replace_all wipes rows absent from the file -- itemized
            # above AND applied (as a resolved-to-zero write) below, in the
            # same WritePlan as every other resolved row.
            plan_updates[variant_id] = 0

    # `rows` counts the rows the report actually shows (resolved +
    # unresolved + ambiguous) -- rows folded away by either duplicate pass
    # (inventory_io's §3.4 raw-identity pass, or the post-resolution
    # cross-scheme pass above) are counted in duplicate_rows_merged
    # instead, exactly like the within-scheme case already was.
    totals = ImportTotals(
        rows=len(rows) - cross_scheme_merged,
        resolved=resolved_count,
        matched_by_fallback=matched_by_fallback_count,
        unresolved=unresolved_count,
        ambiguous=ambiguous_count,
        trimmed=trimmed_count,
        ceiling_clamped=ceiling_clamped_count,
        duplicate_rows_merged=notes.duplicate_rows_merged + cross_scheme_merged,
        unrecognized_columns=notes.unrecognized_columns,
        removed_by_replace_all=len(removed_rows),
    )

    report = ImportReport(
        stage=stage,
        mode=mode,
        cap_handling=cap_handling,
        committed=False,
        totals=totals,
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
