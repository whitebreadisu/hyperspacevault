"""BL-137 D4: orchestrates D1 (parse+resolve) + D2 (fetch) + D3 (diff) + D4
(cost+cart) behind one entrypoint, check_deck -- the single function
POST /api/deck-check calls. Ephemeral by design (Definition_DeckCheck
§1/§4): nothing here writes to the database; the caller's inventory is the
only thing read."""

from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.repositories import deck_check as deck_check_repo
from app.schemas.deck_check_schema import (
    CardSummary,
    DeckCardEntry,
    DeckCheckResponse,
    DeckSlotSummary,
    DeckSummary,
    MissingCard,
    PricingInfo,
    ScopeResult,
    ScopesResponse,
    UnrecognizedCard,
)
from app.services import deck_cost, deck_diff, deck_fetch
from app.services.deck_diff import MissingEntry
from app.services.deck_parse import ParsedDeck, parse_deck_json
from app.services.deck_resolution import (
    SLOT_BASE,
    SLOT_LEADER,
    SLOT_MAIN,
    SLOT_SECOND_LEADER,
    SLOT_SIDEBOARD,
    ResolvedCardRef,
    build_slotted_refs,
    resolve_slotted_refs,
)

DEFAULT_MODE = "standard"
PASTED_SOURCE = "pasted"
PRICING_SOURCE = "tcgplayer"

_MAIN_POOL_SLOTS = (SLOT_LEADER, SLOT_BASE, SLOT_SECOND_LEADER, SLOT_MAIN)


def check_deck(
    db: Session,
    *,
    url: str | None,
    deck_json: dict | None,
    mode: str = DEFAULT_MODE,
) -> DeckCheckResponse:
    """Raises deck_fetch.UnsupportedUrlError, deck_fetch.FetchFailedError,
    or deck_parse.InvalidDeckJsonError -- the router maps each to its typed
    error response. An empty inventory is never an error here; it just
    means every card comes back missing."""
    if url is not None:
        raw, source = deck_fetch.fetch_deck_json(url)
    else:
        raw, source = deck_json, PASTED_SOURCE

    parsed = parse_deck_json(raw)

    slotted = build_slotted_refs(parsed)
    resolved, unrecognized = resolve_slotted_refs(db, slotted)

    main_needs, side_needs = _aggregate_needs(resolved)
    all_base_card_ids = sorted(set(main_needs) | set(side_needs))

    owned = deck_check_repo.get_owned_quantities(db, all_base_card_ids)
    card_refs = deck_check_repo.get_base_card_refs(db, all_base_card_ids)
    variant_prices = deck_check_repo.get_variant_type_prices(db, all_base_card_ids)

    main_diff, side_diff, _together_diff_unused = deck_diff.diff_scopes(
        main_needs, side_needs, owned
    )
    # BL-142: full-card-list build for the ALL CARDS toggle + deck-value
    # extension. `owned` baselines mirror diff_scopes exactly -- raw owned
    # for main, remaining_after_main(...) for side -- so a card's "have" in
    # the full list always agrees with the missing-only diff's.
    main_all_entries = deck_diff.full_entries(main_needs, owned)
    side_all_entries = deck_diff.full_entries(
        side_needs, deck_diff.remaining_after_main(main_needs, owned)
    )

    def _card_summary(base_card_id: int) -> CardSummary | None:
        ref = card_refs.get(base_card_id)
        if ref is None:
            return None
        return CardSummary(
            base_card_id=ref.id,
            set_code=ref.set_code,
            base_card_number=ref.base_card_number,
            name=ref.name,
            subtitle=ref.subtitle,
            type=ref.type,
            front_image_url=ref.front_image_url,
        )

    def _price_for(base_card_id: int) -> deck_cost.CardPrice:
        return deck_cost.price_missing_card(variant_prices.get(base_card_id, []), mode)

    def _scope_result(
        missing_entries: list[MissingEntry],
        all_entries: list[MissingEntry],
        buildable: bool,
    ) -> tuple[ScopeResult, date | None]:
        missing_cards: list[MissingCard] = []
        cart_lines: list[deck_cost.CartLine] = []
        missing_total = 0.0
        unpriced_count = 0
        latest_as_of: date | None = None
        for entry in missing_entries:
            summary = _card_summary(entry.base_card_id)
            price = _price_for(entry.base_card_id)
            missing_qty = entry.need - entry.have
            subtotal: float | None
            if price.unit_price is None:
                unpriced_count += 1
                subtotal = None
            else:
                subtotal = round(price.unit_price * missing_qty, 2)
                missing_total += subtotal
                if price.as_of is not None and (
                    latest_as_of is None or price.as_of > latest_as_of
                ):
                    latest_as_of = price.as_of
            if summary is not None:
                missing_cards.append(
                    MissingCard(
                        card=summary,
                        need=entry.need,
                        have=entry.have,
                        unit_price=price.unit_price,
                        price_basis=price.price_basis,
                        subtotal=subtotal,
                    )
                )
                # TCGplayer product names include the subtitle as
                # "Name - Subtitle" (verified against tcgcsv product data,
                # e.g. "Han Solo - Hibernation Sick") -- a bare "Han Solo"
                # matches nothing in Mass Entry (owner repro, 2026-07-21).
                cart_lines.append(
                    deck_cost.CartLine(
                        qty=missing_qty,
                        name=(
                            f"{summary.name} - {summary.subtitle}"
                            if summary.subtitle
                            else summary.name
                        ),
                        set_code=summary.set_code,
                    )
                )

        # BL-142: the full card list (ALL CARDS toggle) + deck value (scope-
        # tile market value). Priced at unit_price * NEED (the value of
        # owning every copy the deck calls for), unlike missing_total's
        # unit_price * missing_qty -- an already-owned card still
        # contributes its full value to deck_value, which is the whole
        # point of a "what's this deck worth" number.
        all_cards: list[DeckCardEntry] = []
        deck_value = 0.0
        unpriced_value_count = 0
        for entry in all_entries:
            summary = _card_summary(entry.base_card_id)
            if summary is None:
                continue
            price = _price_for(entry.base_card_id)
            line_value: float | None
            if price.unit_price is None:
                unpriced_value_count += 1
                line_value = None
            else:
                line_value = round(price.unit_price * entry.need, 2)
                deck_value += line_value
                if price.as_of is not None and (
                    latest_as_of is None or price.as_of > latest_as_of
                ):
                    latest_as_of = price.as_of
            all_cards.append(
                DeckCardEntry(
                    card=summary,
                    need=entry.need,
                    have=entry.have,
                    unit_price=price.unit_price,
                    price_basis=price.price_basis,
                    line_value=line_value,
                )
            )

        return (
            ScopeResult(
                buildable=buildable,
                missing=missing_cards,
                missing_total=round(missing_total, 2),
                unpriced_count=unpriced_count,
                cart_url=deck_cost.build_cart_url(cart_lines),
                all_cards=all_cards,
                deck_value=round(deck_value, 2),
                unpriced_value_count=unpriced_value_count,
            ),
            latest_as_of,
        )

    main_scope, main_as_of = _scope_result(
        main_diff.missing, main_all_entries, main_diff.buildable
    )
    side_scope, side_as_of = _scope_result(
        side_diff.missing, side_all_entries, side_diff.buildable
    )
    together_scope, together_as_of = _scope_result(
        main_diff.missing + side_diff.missing,
        main_all_entries + side_all_entries,
        main_diff.buildable and side_diff.buildable,
    )

    overall_as_of = max(
        (d for d in (main_as_of, side_as_of, together_as_of) if d is not None),
        default=None,
    )

    return DeckCheckResponse(
        deck=_build_deck_summary(parsed, resolved, card_refs, source),
        unrecognized=[UnrecognizedCard(id=u.id, count=u.count) for u in unrecognized],
        scopes=ScopesResponse(
            main=main_scope, side=side_scope, together=together_scope
        ),
        pricing=PricingInfo(mode=mode, source=PRICING_SOURCE, as_of=overall_as_of),
    )


def _aggregate_needs(
    resolved: list[ResolvedCardRef],
) -> tuple[dict[int, int], dict[int, int]]:
    """Definition_DeckCheck §4: main scope = main deck + leader + base
    (+ second leader); side scope = sideboard only. Counts are summed per
    base_card_id in case the same card appears more than once in a pool."""
    main_needs: dict[int, int] = {}
    side_needs: dict[int, int] = {}
    for r in resolved:
        if r.slot in _MAIN_POOL_SLOTS:
            main_needs[r.base_card_id] = main_needs.get(r.base_card_id, 0) + r.count
        elif r.slot == SLOT_SIDEBOARD:
            side_needs[r.base_card_id] = side_needs.get(r.base_card_id, 0) + r.count
    return main_needs, side_needs


def _build_deck_summary(
    parsed: ParsedDeck,
    resolved: list[ResolvedCardRef],
    card_refs: dict[int, "deck_check_repo.BaseCardRef"],
    source: str,
) -> DeckSummary:
    by_slot: dict[str, ResolvedCardRef] = {}
    for r in resolved:
        if r.slot in (SLOT_LEADER, SLOT_BASE, SLOT_SECOND_LEADER):
            by_slot[r.slot] = r

    def _slot_summary(slot: str) -> DeckSlotSummary | None:
        r = by_slot.get(slot)
        if r is None:
            return None
        ref = card_refs.get(r.base_card_id)
        if ref is None:
            return None
        return DeckSlotSummary(
            base_card_id=ref.id,
            set_code=ref.set_code,
            base_card_number=ref.base_card_number,
            name=ref.name,
            subtitle=ref.subtitle,
            type=ref.type,
            front_image_url=ref.front_image_url,
            count=r.count,
        )

    return DeckSummary(
        name=parsed.name,
        author=parsed.author,
        source=source,
        leader=_slot_summary(SLOT_LEADER),
        second_leader=_slot_summary(SLOT_SECOND_LEADER),
        base=_slot_summary(SLOT_BASE),
        # main_count/side_count are the conventional "50-card main deck"
        # figures -- the deck[]/sideboard[] pools only, NOT including
        # leader/base (those are always exactly 1 each and reported
        # separately). Computed from the raw parsed counts, independent of
        # resolution success, so an unrecognized card still counts toward
        # "how many cards are in this deck".
        main_count=sum(r.count for r in parsed.main),
        side_count=sum(r.count for r in parsed.sideboard),
    )
