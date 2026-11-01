"""Deck-check cost math + TCGplayer Mass Entry cart URL generation (App
Spec §5.11, §12). Pure -- no DB.

Cost math reuses app.services.pricing.compute_display_price for the two
base modes, then layers one deck-check-specific rule on top: in
`standard` mode, a card whose Standard printing itself has no price but
another printing does falls back to the lowest `market` among priced
variants, flagged `price_basis="fallback"`. This fallback is intentionally
NOT part of compute_display_price -- the catalog display_price means "the
Standard printing's price, full stop" (a card with an unpriced Standard
variant shows no display_price in the catalog); deck-check answers a
different question ("what will this cost me to buy"), where falling back
to whatever printing IS priced is the more useful answer.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from urllib.parse import quote, quote_plus

from app.services.pricing import VariantTypePrice, compute_display_price

PRICE_BASIS_STANDARD = "standard"
PRICE_BASIS_CHEAPEST = "cheapest"
PRICE_BASIS_FALLBACK = "fallback"

MODE_STANDARD = "standard"
MODE_CHEAPEST = "cheapest"

MASS_ENTRY_BASE_URL = "https://www.tcgplayer.com/massentry"
# Mass Entry matches ?productline= case-insensitively against the product
# line's internal `name` — NOT the URL slug (TCGplayer vendor behaviour): the
# MassEntry page bundle does
# `productLines.find(p => p.name.toUpperCase() === param.toUpperCase())`, and
# GET mpapi.tcgplayer.com/v2/massentry/productlines returns
# {"productLineId": 79, "name": "Star Wars Unlimited",
#  "displayName": "Star Wars: Unlimited"}. The slug ("star-wars-unlimited")
# matches nothing, leaving the product line unselected so every pasted line
# is "passed over".
MASS_ENTRY_PRODUCT_LINE = "Star Wars Unlimited"


@dataclass(frozen=True)
class CardPrice:
    unit_price: float | None
    price_basis: str | None
    as_of: date | None


def price_missing_card(variant_prices: list[VariantTypePrice], mode: str) -> CardPrice:
    """mode="cheapest": min(low) across every priced variant (unchanged
    from compute_display_price, price_basis always "cheapest" when found).
    mode="standard" (default for any unrecognized value, same tolerant
    posture as compute_display_price): the Standard printing's market
    price when priced (price_basis "standard"); else the lowest `market`
    among any priced variant (price_basis "fallback"); else unpriced."""
    if mode == MODE_CHEAPEST:
        display = compute_display_price(variant_prices, MODE_CHEAPEST)
        if display is None:
            return CardPrice(None, None, None)
        return CardPrice(display.value, PRICE_BASIS_CHEAPEST, display.as_of)

    display = compute_display_price(variant_prices, MODE_STANDARD)
    if display is not None:
        return CardPrice(display.value, PRICE_BASIS_STANDARD, display.as_of)

    fallback_candidates = [
        (vtp.price.market, vtp.price.as_of)
        for vtp in variant_prices
        if vtp.price is not None and vtp.price.market is not None
    ]
    if not fallback_candidates:
        return CardPrice(None, None, None)
    value, as_of = min(fallback_candidates, key=lambda c: c[0])
    return CardPrice(value, PRICE_BASIS_FALLBACK, as_of)


@dataclass(frozen=True)
class CartLine:
    qty: int
    name: str
    set_code: str


def build_cart_url(lines: list[CartLine]) -> str | None:
    """Mass Entry cart URL:
    `tcgplayer.com/massentry?productline=<MASS_ENTRY_PRODUCT_LINE>&c=...`
    with `c=<qty>+<name>+[<SetCode>]||<qty>+<name>+[<SetCode>]||...` --
    card number is deliberately omitted (Mass Entry treats a missing number
    as "any printing of this card in this set", matching the UI's stated
    name-based/printing-fidelity caveat, App Spec §5.11). None for an empty
    list -- no cart to build when nothing is missing.

    Encoding (TCGplayer vendor behaviour): each line is
    `application/x-www-form-urlencoded` (`quote_plus`, `+` for spaces)
    individually, then joined by a LITERAL `||` that must NOT itself be
    percent-encoded, since Mass Entry's client-side parser splits lines on
    that literal delimiter. Percent-encoding the whole `c=` value (`||` ->
    `%7C%7C`) collapses the cart into one unparseable blob and every card
    is "passed over"."""
    if not lines:
        return None
    segments = "||".join(
        quote_plus(f"{line.qty} {line.name} [{line.set_code}]") for line in lines
    )
    c_param = f"{segments}||"
    return (
        f"{MASS_ENTRY_BASE_URL}"
        f"?productline={quote(MASS_ENTRY_PRODUCT_LINE)}"
        f"&c={c_param}"
    )
