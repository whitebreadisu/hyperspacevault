from typing import Literal

from pydantic import BaseModel

# BL-102: CardWithInventoryResponse (CardResponse + quantity, the heavy
# GET /api/inventory row shape) retired with its endpoint -- superseded by
# VariantQuantityResponse below (BL-101).


class VariantQuantityResponse(BaseModel):
    """One sparse per-tenant inventory row (BL-101) -- the quantity half
    of the catalog/quantity split. GET /api/inventory/quantities returns
    these for the caller's tenant only; the client treats every variant_id
    absent from the list as quantity 0."""

    variant_id: int
    quantity: int


class IncrementResponse(BaseModel):
    variant_id: int
    quantity: int
    playset_complete: bool = False
    blocked: bool = False
    # BL-24: "trade_sell" -- the variant is at its effective per-tenant
    # keep-limit (code default or override); "ceiling" -- the variant is at
    # QUANTITY_CEILING (999), the absolute technical maximum that no
    # override can raise. See app/services/inventory.py's increment_card.
    reason: Literal["trade_sell", "ceiling"] | None = None
    # BL-35: true when this increment committed a variant's quantity past
    # its effective keep-limit -- only possible in "soft" cap_mode (in
    # "hard" mode the increment is blocked instead, reason "trade_sell").
    # Never true for a "no limit" bucket (there's no boundary to be over),
    # and never true alongside reason="ceiling" (the ceiling always blocks,
    # in both modes).
    over_limit: bool = False


class DecrementResponse(BaseModel):
    variant_id: int
    quantity: int
