import type { Card } from "./cards";
import { authedFetch } from "./authedFetch";
import { ApiError } from "./errors";

export interface CardWithQty extends Card {
  quantity: number;
}

/** Thrown when the backend's inventory-mutation gate (require_verified_
 * email) rejects a request with 403 {"detail": "email_not_verified"} -- the
 * caller is authenticated but hasn't confirmed their email yet. Callers that
 * mutate inventory (CardPopupInventory.tsx's useInventoryMutation,
 * AddCardsModal, the phone's useStepper and tool commit) catch this
 * specifically to show the verify-email message rather than a generic
 * failure. Extends the shared ApiError base (api/errors.ts) -- status is
 * always 403 (the only status this error is ever constructed for; see
 * throwIfMutationFailed below). */
export class EmailNotVerifiedError extends ApiError {
  constructor() {
    super("Verify your email to manage inventory.", 403);
    this.name = "EmailNotVerifiedError";
  }
}

async function throwIfMutationFailed(
  res: Response,
  action: string,
  variantId: number
): Promise<void> {
  if (res.ok) return;
  if (res.status === 403) {
    let detail: unknown;
    try {
      detail = (await res.json())?.detail;
    } catch {
      detail = undefined;
    }
    if (detail === "email_not_verified") throw new EmailNotVerifiedError();
  }
  throw new ApiError(`${action} failed for variant ${variantId}: ${res.status}`, res.status);
}

// CardWithQty above has no endpoint of its own (quantities come from
// getQuantities below); Add Cards test fixtures are deliberately typed
// against it (utils/addCardsResolver.ts's contract note).

/** One sparse per-tenant inventory row -- the quantity half of the
 * catalog/quantity split. Any variant_id absent from the list is quantity 0. */
export interface VariantQuantity {
  variant_id: number;
  quantity: number;
}

/** The caller's sparse per-variant quantities, merged onto the (publicly
 * cached) catalog list in vault/useVaultData.ts. Auth-required -- only call
 * when signed in; anonymous users simply have no quantities to fetch. */
export async function getQuantities(): Promise<VariantQuantity[]> {
  const res = await authedFetch("/api/inventory/quantities");
  if (!res.ok) throw new ApiError(`Failed to fetch quantities: ${res.status}`, res.status);
  return res.json();
}

// The debounced-batch endpoint -- one call per accumulated burst of stepper
// clicks rather than one round trip per click (see CardPopupInventory.tsx's
// useInventoryMutation).
export interface AdjustResult {
  variant_id: number;
  quantity: number;
  // The delta actually committed -- may be smaller in magnitude than
  // `requested` (same sign) when clamped by the effective limit (hard mode)
  // or the 999 ceiling.
  applied: number;
  requested: number;
  blocked: boolean;
  reason: string | null;
  over_limit: boolean;
  playset_complete: boolean;
}

export async function adjustCard(variantId: number, delta: number): Promise<AdjustResult> {
  const res = await authedFetch(`/api/inventory/${variantId}/adjust`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ delta }),
  });
  await throwIfMutationFailed(res, "Adjust", variantId);
  return res.json();
}
