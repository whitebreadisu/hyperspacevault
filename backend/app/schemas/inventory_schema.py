from typing import Literal

from pydantic import BaseModel, Field, field_validator

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


# BL-219 (issue #127): request/response for POST /api/inventory/{id}/adjust
# -- the debounced stepper's batched-delta endpoint. The frontend accumulates
# rapid +/- clicks into a single signed delta and flushes ONE call instead of
# one round trip per click (see CardPopupInventory.tsx's useInventoryMutation);
# the increment/decrement routes/contracts above are untouched.
class AdjustDeltaRequest(BaseModel):
    """`delta` must be nonzero (a zero-delta flush is skipped client-side
    entirely -- see useInventoryMutation) and within the same [-999, 999]
    range as QUANTITY_CEILING, the absolute technical ceiling any single
    call could ever need to cross in one hop."""

    delta: int = Field(ge=-999, le=999)

    @field_validator("delta")
    @classmethod
    def _nonzero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("delta must not be 0")
        return value


class AdjustResponse(BaseModel):
    variant_id: int
    quantity: int
    # The delta actually committed -- may be less than `requested` (same
    # sign, smaller magnitude) when a positive delta was clamped by the
    # effective limit (hard mode) or the 999 ceiling; always equal to
    # `requested` for a negative delta unless the floor (0) was reached.
    applied: int
    requested: int
    blocked: bool = False
    # See IncrementResponse.reason above for the two values' meaning.
    # Populated whenever the requested delta was truncated by the effective
    # limit or the ceiling, whether or not that leaves `blocked` True (a
    # partial apply truncates without blocking; blocked is reserved for the
    # zero-applied case, same meaning it has on increment).
    reason: Literal["trade_sell", "ceiling"] | None = None
    over_limit: bool = False
    playset_complete: bool = False
