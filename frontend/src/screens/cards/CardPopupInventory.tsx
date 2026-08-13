import { useCallback, useState } from "react";
import type { VariantDetail } from "../../api/baseCards";
import { incrementCard, decrementCard, EmailNotVerifiedError } from "../../api/inventory";
import type { LimitsMatrix } from "../../utils/limits";
import type { CapMode, TypeCategory } from "../../api/settingsLimits";
import {
  effectiveLimit,
  enforcementCap,
  limitBucketOf,
  QUANTITY_CEILING,
} from "../../utils/limits";
import { variantLabel } from "./cardPopupShared";

/** BL-155 decomposition: inventory controls, pulled out of CardPopup.tsx
 * verbatim -- the selected printing's owned-quantity stepper (InventoryPlate,
 * with its limits/cap_mode math), the signed-out "Sign in" nudge that stands
 * in for it, and the increment/decrement mutation logic (useInventoryMutation)
 * that drives both. */

const VERIFY_EMAIL_MESSAGE = "Verify your email to manage inventory -- see the banner above.";

/** Inventory-plate label format (design handoff §5: "OWNED — <printing>
 * <cardnum>") -- deliberately shorter than variantLabel above (no set code;
 * the printings picker and the right pane's set name already carry that). */
function ownedLabel(v: VariantDetail): string {
  return `${v.finish ?? v.variant_type} #${v.card_number}`;
}

interface InventoryPlateProps {
  variant: VariantDetail;
  typeCategory: TypeCategory;
  limits: LimitsMatrix | null;
  capMode: CapMode;
  pending: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  /** BL-205 (§19.1): true for a shared-vault viewer -- renders the same
   * readout (qty, limit fraction, progress bar, over-limit tag) but with the
   * -/+ stepper buttons REMOVED rather than merely disabled, matching the
   * spec's "quantity editing removed" wording. Distinct from the
   * signed-out nudge above: a read-only viewer sees the OWNER's real
   * quantity, not a "sign in" prompt. Defaults false so every existing
   * caller renders the interactive stepper unchanged. */
  readOnly?: boolean;
}

/** The selected printing's owned-quantity stepper (design handoff §5's
 * "Inventory plate"). BL-111 F5 LIMITS MAPPING (product-owner decision,
 * overrides the design mock's hardcoded 3/1): reuses the exact enforcement
 * math CardInventoryPopup shipped (utils/limits.ts) rather than the mock's
 * fixed playset-size constants --
 *   - y = the printing's effectiveLimit; null ("No limit") hides the "/y"
 *     suffix and the progress bar entirely, and + is enabled up to the 999
 *     technical ceiling (enforcementCap already resolves null -> the
 *     ceiling, so the hard-mode branch below reduces to the same check).
 *   - hard cap_mode: + disables at the effective cap (ported verbatim).
 *   - soft cap_mode: + stays enabled past the limit -- only the ceiling
 *     stops it -- and the readout carries a distinct amber "Over limit" tag
 *     (ported verbatim from CardInventoryPopup's cip-row--over-limit/
 *     cip-row__qty--over-limit) once quantity exceeds the raw effective
 *     limit. This is separate from atOrOverLimit below, which is a purely
 *     visual "you've reached the configured limit" cue (design handoff's
 *     "progress bar ... red at the limit") that applies in EITHER cap_mode
 *     once quantity >= the limit -- hard mode can only ever reach exactly
 *     that value (+ disables there), soft mode can sail past it. */
function InventoryPlate({
  variant,
  typeCategory,
  limits,
  capMode,
  pending,
  onIncrement,
  onDecrement,
  readOnly = false,
}: InventoryPlateProps) {
  const bucket = limitBucketOf(variant.finish, variant.channel);
  const rawLimit = effectiveLimit(limits, typeCategory, bucket);
  const cap = enforcementCap(limits, typeCategory, bucket);
  const qty = variant.quantity;

  const incDisabled = pending || (capMode === "soft" ? qty >= QUANTITY_CEILING : qty >= cap);
  const decDisabled = pending || qty <= 0;

  const atOrOverLimit = rawLimit !== null && qty >= rawLimit;
  const softOverLimit = capMode === "soft" && rawLimit !== null && qty > rawLimit;
  const pctWidth =
    rawLimit !== null && rawLimit > 0
      ? `${Math.min(100, Math.round((qty / rawLimit) * 100))}%`
      : "0%";

  const label = ownedLabel(variant);

  return (
    <div className="cp-plate">
      <div className="cp-plate__inner">
        {/* BL-205: readOnly renders the qty by itself -- no -/+ buttons at
            all (removed, not disabled -- §19.1's "card-detail quantity
            editing" mutation affordance). */}
        {readOnly ? (
          <div className="cp-plate__stepper">
            <span className="cp-plate__qty">{qty}</span>
          </div>
        ) : (
          <div className="cp-plate__stepper">
            <button
              type="button"
              className="cp-plate__step cp-plate__step--dec"
              aria-label={`Decrement ${variantLabel(variant)}`}
              disabled={decDisabled}
              onClick={onDecrement}
            >
              −
            </button>
            <span className="cp-plate__qty">{qty}</span>
            <button
              type="button"
              className="cp-plate__step cp-plate__step--inc"
              aria-label={`Increment ${variantLabel(variant)}`}
              disabled={incDisabled}
              onClick={onIncrement}
            >
              +
            </button>
          </div>
        )}
        <div className="cp-plate__readout">
          <div className="cp-plate__readout-row">
            <span className="cp-plate__owned-label">OWNED — {label}</span>
            <span
              className={`cp-plate__count${atOrOverLimit ? " cp-plate__count--at-limit" : ""}${
                softOverLimit ? " cp-plate__count--over-limit" : ""
              }`}
            >
              {rawLimit !== null ? `${qty} / ${rawLimit}` : qty}
            </span>
          </div>
          {rawLimit !== null && (
            <div className="cp-plate__bar">
              <div
                className={`cp-plate__bar-fill${atOrOverLimit ? " cp-plate__bar-fill--at-limit" : ""}`}
                style={{ width: pctWidth }}
              />
            </div>
          )}
          {softOverLimit && (
            <span className="cp-plate__over-limit-tag" title="Over your keep-limit">
              Over limit
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** BL-155 decomposition: handleIncrement/handleDecrement pulled out of
 * CardPopup.tsx verbatim, as a hook -- `setVariants`/`setChanged` are the
 * shell's own useState setters (stable across renders), passed down rather
 * than owned here, since the shell's data-loading effect and the rest of the
 * popup still need `variants`/`changed` directly. `pending`/`mutationError`
 * ARE owned here -- nothing outside this hook reads/writes them except via
 * its return value. */
export function useInventoryMutation(
  selectedVariant: VariantDetail | null | undefined,
  setVariants: React.Dispatch<React.SetStateAction<VariantDetail[]>>,
  setChanged: React.Dispatch<React.SetStateAction<boolean>>
) {
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const handleIncrement = useCallback(async () => {
    if (!selectedVariant) return;
    const variantId = selectedVariant.variant_id;
    setPending(true);
    setMutationError(null);
    try {
      const result = await incrementCard(variantId);
      if (!result.blocked) {
        // BL-35 (ported): result.over_limit is informational only -- not
        // stored as state. The over-limit indicator is derived fresh on
        // every render from the resolved quantity vs. the effective limit
        // (see InventoryPlate), so it stays correct even if the tenant's
        // limits/cap_mode change later in the same session.
        setVariants((prev) =>
          prev.map((v) => (v.variant_id === variantId ? { ...v, quantity: result.quantity } : v))
        );
        setChanged(true);
      }
    } catch (err) {
      setMutationError(
        err instanceof EmailNotVerifiedError ? VERIFY_EMAIL_MESSAGE : "Something went wrong."
      );
    } finally {
      setPending(false);
    }
  }, [selectedVariant, setVariants, setChanged]);

  const handleDecrement = useCallback(async () => {
    if (!selectedVariant) return;
    const variantId = selectedVariant.variant_id;
    setPending(true);
    setMutationError(null);
    try {
      const result = await decrementCard(variantId);
      setVariants((prev) =>
        prev.map((v) => (v.variant_id === variantId ? { ...v, quantity: result.quantity } : v))
      );
      setChanged(true);
    } catch (err) {
      setMutationError(
        err instanceof EmailNotVerifiedError ? VERIFY_EMAIL_MESSAGE : "Something went wrong."
      );
    } finally {
      setPending(false);
    }
  }, [selectedVariant, setVariants, setChanged]);

  return { pending, mutationError, handleIncrement, handleDecrement };
}

/** Switches between the signed-in stepper and the signed-out nudge -- the
 * unified popup opens for anonymous users too (BL-56 §5.5's inert-teaser
 * pattern), the plate itself being the nudge rather than a separate bounce. */
export function CardPopupInventoryControls({
  isAuthenticated,
  readOnly = false,
  variant,
  typeCategory,
  limits,
  capMode,
  pending,
  onIncrement,
  onDecrement,
  onRequestSignIn,
}: {
  isAuthenticated: boolean;
  /** BL-205: forwarded to InventoryPlate -- see its own doc comment. Only
   * meaningful when `isAuthenticated` is true (a shared-vault viewer always
   * has `isAuthenticated=true` here, see CardsPage's `hasData` -- readOnly
   * is what then keeps the stepper from being interactive). Defaults false
   * so every existing caller renders unchanged. */
  readOnly?: boolean;
  variant: VariantDetail;
  typeCategory: TypeCategory;
  limits: LimitsMatrix | null;
  capMode: CapMode;
  pending: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  /** BL-56 §5.5's inert-teaser pattern: opens the shell's AuthModal. The
   * signed-out inventory plate's "Sign in" button routes through this. */
  onRequestSignIn?: () => void;
}) {
  if (!isAuthenticated) {
    return (
      <div className="cp-plate">
        <div className="cp-plate__inner cp-plate__inner--signed-out">
          <span className="cp-plate__signed-out-msg">Sign in to manage inventory</span>
          {onRequestSignIn && (
            <button type="button" className="cp-plate__signin" onClick={onRequestSignIn}>
              Sign in
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <InventoryPlate
      variant={variant}
      typeCategory={typeCategory}
      limits={limits}
      capMode={capMode}
      pending={pending}
      onIncrement={onIncrement}
      onDecrement={onDecrement}
      readOnly={readOnly}
    />
  );
}
