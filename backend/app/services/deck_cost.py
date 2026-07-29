"""BL-137 D4: cost math + TCGplayer Mass Entry cart URL generation
(Definition_DeckCheck_2026-07-16.md §5). Pure -- no DB.

Cost math reuses app.services.pricing.compute_display_price (BL-136 P4)
for the two base modes, then layers one deck-check-specific rule on top:
in `standard` mode, a card whose Standard printing itself has no price but
another printing does falls back to the lowest `market` among priced
variants, flagged `price_basis="fallback"`. This fallback is intentionally
NOT part of compute_display_price -- BL-136's catalog display_price means
"the Standard printing's price, full stop" (a card with an unpriced
Standard variant correctly shows no display_price on the catalog grid);
deck-check cares about a different question ("what will this cost me to
buy"), where falling back to whatever printing IS priced is the more
useful answer.
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
# line's internal `name` — NOT the URL slug. Verified against TCGplayer's own
# sources 2026-07-21: the MassEntry page bundle does
# `productLines.find(p => p.name.toUpperCase() === param.toUpperCase())`, and
# GET mpapi.tcgplayer.com/v2/massentry/productlines returns
# {"productLineId": 79, "name": "Star Wars Unlimited",
#  "displayName": "Star Wars: Unlimited"}. The earlier slug value
# ("star-wars-unlimited") matched nothing, leaving the product line unselected
# so every pasted line was "passed over" (owner repro, 2026-07-21).
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
    """Definition_DeckCheck §5 exact format:
    `tcgplayer.com/massentry?productline=star-wars-unlimited&c=qty name…`,
    confirmed live (Spike_TCGplayer_Landscape_2026-07-16.md §3):
    `c=<qty>+<name>+[<SetCode>]||<qty>+<name>+[<SetCode>]||...` -- card
    number is deliberately omitted (Mass Entry treats a missing number as
    "any printing of this card in this set", matching the UI's stated
    name-based/printing-fidelity caveat). None for an empty list -- no cart
    to build when nothing is missing.

    Owner dev-review round 2 (2026-07-21, BL-137/BL-142 family): browser-
    verified this was producing a Mass Entry page where every card got
    "passed over" (none resolved against Star Wars: Unlimited). Root cause
    -- the previous implementation ran the *entire* `c=` value through
    `quote(c_param, safe="")`, which percent-encodes every reserved
    character including the `||` line separator (-> `%7C%7C`) and spaces
    (-> `%20`). Both of the spike's two independently-verified working
    real-world examples (a Magic deck and a Yu-Gi-Oh deck with an explicit
    `productline=`) instead use a LITERAL, unencoded `||` between lines and
    `+` for spaces within a line -- i.e. each line is `application/x-www-
    form-urlencoded` (`quote_plus`) individually, then joined by a raw
    `||` that must NOT itself be percent-encoded, since Mass Entry's
    client-side parser splits lines on that literal delimiter. Escaping the
    separator away collapses the whole cart into one unparseable blob,
    which is what made every card -- not just the game context -- fail to
    resolve. `productline=` was already present in both the old and new
    output; it was the `c=` shape that was broken."""
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
