"""BL-137: POST /api/deck-check request/response shapes
(Definition_DeckCheck_2026-07-16.md §6)."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel


class DeckCheckRequest(BaseModel):
    """Exactly one of url / deck_json is expected -- enforced in the router
    (not a pydantic validator) so the XOR violation can produce the same
    typed `invalid_deck_json` error shape as every other structural
    problem, rather than a generic pydantic 422."""

    url: str | None = None
    deck_json: dict | None = None


class CardSummary(BaseModel):
    """Light catalog reference -- enough to render a card row/leader/base
    without pulling the full variant long tail (deck-check ownership is
    finish-agnostic, so a specific variant is never the point here)."""

    base_card_id: int
    set_code: str
    base_card_number: str
    name: str
    subtitle: str | None
    type: str
    front_image_url: str | None


class DeckSlotSummary(CardSummary):
    count: int


class DeckSummary(BaseModel):
    name: str | None
    author: str | None
    source: str  # "swubase" | "sw-unlimited-db" | "pasted"
    leader: DeckSlotSummary | None
    second_leader: DeckSlotSummary | None
    base: DeckSlotSummary | None
    main_count: int
    side_count: int


class UnrecognizedCard(BaseModel):
    id: str
    count: int


class MissingCard(BaseModel):
    card: CardSummary
    need: int
    have: int
    unit_price: float | None
    price_basis: str | None
    subtotal: float | None


class DeckCardEntry(BaseModel):
    """BL-142: one row of a scope's COMPLETE card list -- unlike
    MissingCard, present for every card in the scope (including fully-owned
    ones), which is what the ALL CARDS toggle and the scope-tile market
    value both need. `line_value` is unit_price * need (the value of owning
    every copy the deck calls for), not the missing quantity -- None when
    the card is unpriced (excluded from ScopeResult.deck_value, counted in
    unpriced_value_count instead, same posture as missing/unpriced_count)."""

    card: CardSummary
    need: int
    have: int
    unit_price: float | None
    price_basis: str | None
    line_value: float | None


class ScopeResult(BaseModel):
    buildable: bool
    missing: list[MissingCard]
    missing_total: float
    unpriced_count: int
    cart_url: str | None
    # BL-142: full-list + deck-value extension (Definition_DeckCheck §6 did
    # not anticipate these; additive fields, no removals -- see PR
    # description). all_cards mirrors `missing` but includes owned rows;
    # deck_value is the scope's complete-decklist market value (same
    # mode/price-basis rules as missing_total, priced via unit_price * need
    # rather than the missing quantity); unpriced_value_count is the count
    # of all_cards entries with no price at all (independent of
    # unpriced_count, which only counts *missing* unpriced cards).
    all_cards: list[DeckCardEntry]
    deck_value: float
    unpriced_value_count: int


class ScopesResponse(BaseModel):
    main: ScopeResult
    side: ScopeResult
    together: ScopeResult


class PricingInfo(BaseModel):
    mode: str
    source: str
    as_of: date | None


class DeckCheckResponse(BaseModel):
    deck: DeckSummary
    unrecognized: list[UnrecognizedCard]
    scopes: ScopesResponse
    pricing: PricingInfo
