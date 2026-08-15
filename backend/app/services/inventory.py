from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.ingestion.swuapi_classify import classify_variant, limit_bucket
from app.repositories import inventory as inventory_repo
from app.schemas.inventory_schema import (
    AdjustResponse,
    DecrementResponse,
    IncrementResponse,
    VariantQuantityResponse,
)
from app.services import inventory_io
from app.services.limits import (
    CAP_MODE_SOFT,
    TYPE_CATEGORY_SINGLETON,
    effective_cap_mode,
    effective_limit,
    type_category,
)
from app.services.set_order import export_sort_key

# BL-54 S1 (§7.1): filename stem -- date-stamped, format-suffixed
# (hyperspacevault-inventory_<YYYY-MM-DD>.json|csv).
EXPORT_FILENAME_STEM = "hyperspacevault-inventory"

# BL-24: the absolute technical ceiling on any single variant's quantity,
# enforced unconditionally before any tenant limit resolution -- no
# override, however permissive (including an explicit "no limit"), can
# raise a variant past this.
QUANTITY_CEILING = 999

# BL-24: completion ("playset_complete") is decoupled from the per-variant
# keep-limit -- for standard cards it always means "3 total copies across
# every variant of this base card" (get_base_card_total), independent of
# whatever the effective per-variant limit is configured to. Kept as its
# own constant (rather than reusing the old shared PLAYSET_SIZE name, which
# used to double as both the keep-limit and the completion threshold) so
# the two concepts can't silently re-couple in a future edit.
COMPLETION_PLAYSET_SIZE = 3

# BL-102: get_all_inventory/_to_response (the heavy GET /api/inventory list)
# retired -- runtime-dead since BL-56; get_quantities is its designed
# replacement (BL-101).


def get_quantities(db: Session) -> list[VariantQuantityResponse]:
    """BL-101: the caller's sparse per-variant quantities -- merged
    client-side onto the publicly cached catalog list."""
    return [
        VariantQuantityResponse(variant_id=variant_id, quantity=quantity)
        for variant_id, quantity in inventory_repo.get_quantities(db)
    ]


def increment_card(db: Session, variant_id: int) -> IncrementResponse | None:
    variant = inventory_repo.get_variant_with_inventory(db, variant_id)
    if variant is None:
        return None

    current_qty = variant.inventory.quantity if variant.inventory else 0

    # BL-24 step 1: the technical ceiling always wins, checked before any
    # limit resolution -- even a bucket explicitly configured "no limit"
    # cannot push a variant past 999.
    if current_qty >= QUANTITY_CEILING:
        return IncrementResponse(
            variant_id=variant_id,
            quantity=current_qty,
            blocked=True,
            reason="ceiling",
        )

    category = type_category(variant.base_card.type)
    bucket = limit_bucket(variant.variant_type, variant.source_set_code)
    max_quantity = effective_limit(db, category, bucket)

    # BL-24/BL-35 step 2-4: per-variant, no cross-variant summing -- the
    # variant's OWN quantity is compared to its effective limit (tenant
    # override if one exists, else the code default). None means the tenant
    # has configured this bucket as unlimited, so at_or_over_limit can never
    # be true for it -- there's no boundary to cross.
    #
    # cap_mode governs what happens when at_or_over_limit IS true: "hard"
    # (default, unchanged pre-BL-35 behavior) blocks with reason
    # "trade_sell"; "soft" instead lets the increment through below and the
    # response carries over_limit=True. effective_cap_mode is only queried
    # when it can actually change the outcome, keeping the common
    # (below-limit) path to a single extra query total.
    at_or_over_limit = max_quantity is not None and current_qty >= max_quantity
    if at_or_over_limit and effective_cap_mode(db) != CAP_MODE_SOFT:
        return IncrementResponse(
            variant_id=variant_id,
            quantity=current_qty,
            blocked=True,
            reason="trade_sell",
        )

    if category == TYPE_CATEGORY_SINGLETON:
        inv = inventory_repo.upsert_increment(db, variant_id)
        return IncrementResponse(
            variant_id=variant_id,
            quantity=inv.quantity,
            # BL-24: completion semantics for singletons are unchanged from
            # pre-BL-24 -- "first copy acquired", independent of the
            # effective limit. A raised singleton override (e.g. 2) lets
            # the variant hold a 2nd copy without playset_complete
            # re-firing on that later increment.
            playset_complete=(current_qty == 0),
            # BL-35: reaching here with at_or_over_limit true only happens
            # in soft mode (hard mode already returned above), so this is
            # exactly the "committed past the limit" case the response
            # flags for the client.
            over_limit=at_or_over_limit,
        )

    current_total = inventory_repo.get_base_card_total(db, variant.base_card_id)
    inv = inventory_repo.upsert_increment(db, variant_id)
    new_total = current_total + 1
    return IncrementResponse(
        variant_id=variant_id,
        quantity=inv.quantity,
        playset_complete=(new_total == COMPLETION_PLAYSET_SIZE),
        over_limit=at_or_over_limit,
    )


def export_inventory(db: Session, format: str) -> tuple[str, str, str]:
    """BL-54 S1 (§7.1): the caller's full inventory (every row with
    quantity >= 1) as either canonical JSON or derived CSV
    (app/services/inventory_io.py, §3). Returns (content, filename,
    media_type) for the router to stream as a download.

    `format` is validated by the router's Literal["json", "csv"] query
    param before this runs; only the two branches below are reachable."""
    rows = sorted(
        inventory_repo.get_export_rows(db),
        key=lambda r: export_sort_key(r.source_set_code, r.card_number, r.variant_type),
    )
    io_rows = []
    for r in rows:
        # §3.1: _derived is re-derived from the same curated classifier the
        # rest of the app uses (swuapi_classify), never stored -- see that
        # module's docstring on why finish/channel/stamped aren't persisted
        # columns.
        classification = classify_variant(r.variant_type, r.source_set_code)
        io_rows.append(
            inventory_io.InventoryRow(
                swuapi_uuid=r.swuapi_id,
                set_code=r.source_set_code,
                card_number=r.card_number,
                variant_type=r.variant_type,
                quantity=r.quantity,
                name=r.name,
                subtitle=r.subtitle,
                derived=inventory_io.DerivedInfo(
                    finish=classification.finish,
                    channel=classification.channel,
                    stamped=classification.stamped,
                ),
            )
        )

    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if format == "csv":
        return (
            inventory_io.serialize_csv(io_rows),
            f"{EXPORT_FILENAME_STEM}_{date_str}.csv",
            "text/csv",
        )
    return (
        inventory_io.serialize_json(io_rows),
        f"{EXPORT_FILENAME_STEM}_{date_str}.json",
        "application/json",
    )


def decrement_card(db: Session, variant_id: int) -> DecrementResponse | None:
    variant = inventory_repo.get_variant_with_inventory(db, variant_id)
    if variant is None:
        return None

    inv = inventory_repo.upsert_decrement(db, variant_id)
    return DecrementResponse(variant_id=variant_id, quantity=inv.quantity)


def _resolve_adjust(
    current_qty: int, delta: int, max_quantity: int | None, cap_mode: str
) -> tuple[int, int, bool, str | None, bool]:
    """BL-219: the pure decision core behind adjust_card -- given the
    variant's pre-adjust quantity, the requested signed delta, its
    effective limit (None = unlimited), and the tenant's cap_mode, returns
    (new_quantity, applied, blocked, reason, over_limit). Generalizes
    increment_card/decrement_card's existing per-call semantics from a
    fixed +-1 to an arbitrary signed magnitude, resolving the limit/cap_mode
    exactly ONCE per call (both callers below already fetched them once):

      - negative delta: always applies down to the floor (0), never blocks
        (same as decrement_card). over_limit is still reported (gated on
        cap_mode == soft, matching over_limit's existing "only possible in
        soft mode" invariant -- see IncrementResponse.over_limit) so a
        decrement off a stranded/lowered-limit quantity reports the
        resulting state the same way an increment would.
      - positive delta: the 999 ceiling always wins first (BL-24 step 1,
        unconditional in both cap modes -- QUANTITY_CEILING module
        constant). Then, in hard mode with a real (non-None) limit, a
        variant already at/over that limit is fully blocked (0 applied,
        reason "trade_sell") exactly like increment_card's existing block.
        Otherwise the delta is clamped to whichever cap actually binds (the
        effective limit in hard mode, the 999 ceiling in soft/no-limit
        mode) -- which can mean a PARTIAL apply (more was requested than
        there was room for) rather than a full block. `reason` is populated
        whenever the requested delta was truncated by either cause,
        independent of whether that leaves `blocked` True -- `blocked`
        itself stays reserved for the "nothing applied" case, unchanged
        from its existing meaning.
    """
    if delta < 0:
        new_qty = max(current_qty + delta, 0)
        applied = new_qty - current_qty
        over_limit = (
            cap_mode == CAP_MODE_SOFT
            and max_quantity is not None
            and new_qty > max_quantity
        )
        return new_qty, applied, False, None, over_limit

    # delta > 0 from here -- the 999 ceiling always wins first, in either
    # cap_mode (BL-24 step 1, ported verbatim from increment_card).
    if current_qty >= QUANTITY_CEILING:
        return current_qty, 0, True, "ceiling", False

    hard_capped = cap_mode != CAP_MODE_SOFT and max_quantity is not None
    if hard_capped and current_qty >= max_quantity:
        return current_qty, 0, True, "trade_sell", False

    cap, cap_reason = (
        (max_quantity, "trade_sell") if hard_capped else (QUANTITY_CEILING, "ceiling")
    )
    raw_target = current_qty + delta
    new_qty = min(raw_target, cap)
    applied = new_qty - current_qty
    reason = cap_reason if new_qty < raw_target else None
    over_limit = (
        cap_mode == CAP_MODE_SOFT
        and max_quantity is not None
        and new_qty > max_quantity
    )
    return new_qty, applied, False, reason, over_limit


def adjust_card(db: Session, variant_id: int, delta: int) -> AdjustResponse | None:
    """BL-219 (issue #127): the stepper's debounced-batch endpoint -- applies
    one signed `delta` (the frontend's net of however many clicks landed
    inside its 400ms debounce window) in place of `delta` separate
    increment/decrement round trips. Resolves the effective limit/cap_mode
    ONCE (mirrors increment_card's single extra query on the common path),
    then delegates the clamping decision to _resolve_adjust above.
    `playset_complete` is computed exactly as increment_card/decrement_card
    already do -- singleton: "first copy acquired" (current_qty was 0);
    standard: the base-card total (summed BEFORE this write, then offset by
    `applied`) crossing to exactly COMPLETION_PLAYSET_SIZE."""
    variant = inventory_repo.get_variant_with_inventory(db, variant_id)
    if variant is None:
        return None

    current_qty = variant.inventory.quantity if variant.inventory else 0
    category = type_category(variant.base_card.type)
    bucket = limit_bucket(variant.variant_type, variant.source_set_code)
    max_quantity = effective_limit(db, category, bucket)
    cap_mode = effective_cap_mode(db)

    new_qty, applied, blocked, reason, over_limit = _resolve_adjust(
        current_qty, delta, max_quantity, cap_mode
    )

    # applied == 0 means nothing changes -- a blocked positive delta
    # (mirrors increment_card's own early return with no DB write at all),
    # or a negative delta that was already at the floor (a harmless no-op
    # decrement_card itself still writes unconditionally, but skipping it
    # here produces the identical stored quantity with one fewer statement).
    # Nothing can have crossed COMPLETION_PLAYSET_SIZE with no quantity
    # change, so playset_complete is unconditionally False here too --
    # same as increment_card's blocked responses never setting it.
    if applied == 0:
        return AdjustResponse(
            variant_id=variant_id,
            quantity=current_qty,
            applied=0,
            requested=delta,
            blocked=blocked,
            reason=reason,
            over_limit=over_limit,
            playset_complete=False,
        )

    if category == TYPE_CATEGORY_SINGLETON:
        # applied > 0 guaranteed here (the applied == 0 case already
        # returned above), so this is exactly increment_card's "first copy
        # acquired" check, generalized to whatever `applied` turned out to
        # be for this call.
        playset_complete = current_qty == 0
        inv = inventory_repo.upsert_adjust(db, variant_id, applied)
    else:
        # BL-24 (ported): current_total is read BEFORE the write below, same
        # ordering increment_card already relies on, so it reflects this
        # variant's PRE-adjust contribution to the base card's total.
        current_total = inventory_repo.get_base_card_total(db, variant.base_card_id)
        inv = inventory_repo.upsert_adjust(db, variant_id, applied)
        new_total = current_total + applied
        playset_complete = new_total == COMPLETION_PLAYSET_SIZE

    return AdjustResponse(
        variant_id=variant_id,
        quantity=inv.quantity,
        applied=applied,
        requested=delta,
        blocked=blocked,
        reason=reason,
        over_limit=over_limit,
        playset_complete=playset_complete,
    )
