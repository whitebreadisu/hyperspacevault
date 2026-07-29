import type { Card } from "./cards";
import { authedFetch } from "./authedFetch";
import { ApiError } from "./errors";

export interface CardWithQty extends Card {
  quantity: number;
}

export interface IncrementResult {
  variant_id: number;
  quantity: number;
  playset_complete: boolean;
  blocked: boolean;
  reason: string | null;
  // BL-35: true when this increment committed past the variant's effective
  // keep-limit (only possible in "soft" cap_mode -- "hard" mode blocks the
  // increment instead). Informational -- see CardPopup's handleIncrement
  // (BL-111 F5) for why it isn't stored as state.
  over_limit?: boolean;
}

export interface DecrementResult {
  variant_id: number;
  quantity: number;
}

/** BL-16: thrown when the backend's inventory-mutation gate (require_verified_
 * email) rejects a request with 403 {"detail": "email_not_verified"} -- the
 * caller is authenticated but hasn't confirmed their email yet. Callers that
 * mutate inventory (CardPopup, AddCardsModal) catch this
 * specifically to point the user at the site-wide verify-email banner,
 * rather than showing a generic failure message. BL-154: extends the shared
 * ApiError base (api/errors.ts) -- status is always 403 (the only status
 * this error is ever constructed for; see throwIfMutationFailed below). */
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
  // BL-154: migrated from a bare `throw new Error` -- same message text, now
  // a typed ApiError carrying res.status for callers that want to branch on it.
  throw new ApiError(`${action} failed for variant ${variantId}: ${res.status}`, res.status);
}

// BL-102: getInventory() retired with GET /api/inventory (runtime-dead
// since BL-56; getQuantities below is its designed replacement). The
// CardWithQty type stays -- Add Cards test fixtures are deliberately typed
// against it (utils/addCardsResolver.ts's contract note).

/** One sparse per-tenant inventory row (BL-101) -- the quantity half of the
 * catalog/quantity split. Any variant_id absent from the list is quantity 0. */
export interface VariantQuantity {
  variant_id: number;
  quantity: number;
}

/** BL-101: the caller's sparse per-variant quantities, merged onto the
 * (publicly cached) catalog list in CardsPage. Auth-required -- only call
 * when signed in; anonymous users simply have no quantities to fetch. */
export async function getQuantities(): Promise<VariantQuantity[]> {
  const res = await authedFetch("/api/inventory/quantities");
  // BL-154: migrated from a bare `throw new Error`.
  if (!res.ok) throw new ApiError(`Failed to fetch quantities: ${res.status}`, res.status);
  return res.json();
}

export async function incrementCard(variantId: number): Promise<IncrementResult> {
  const res = await authedFetch(`/api/inventory/${variantId}/increment`, { method: "POST" });
  await throwIfMutationFailed(res, "Increment", variantId);
  return res.json();
}

export async function decrementCard(variantId: number): Promise<DecrementResult> {
  const res = await authedFetch(`/api/inventory/${variantId}/decrement`, { method: "POST" });
  await throwIfMutationFailed(res, "Decrement", variantId);
  return res.json();
}
