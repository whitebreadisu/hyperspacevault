import { useCallback, useEffect, useRef, useState } from "react";
import type { VariantDetail } from "../../api/baseCards";
import { adjustCard, EmailNotVerifiedError } from "../../api/inventory";
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
 * that drives both.
 *
 * BL-219 (issue #127): useInventoryMutation reworked from "one round trip
 * per click, buttons disabled while it's in flight" to accumulate-and-
 * debounce -- see its own doc comment below for the full design. The
 * increment/decrement API contracts themselves are untouched; this hook now
 * drives the new POST .../adjust endpoint exclusively. */

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

  // BL-219: no longer gated on `pending` -- the debounced stepper never
  // blocks the buttons while a flush is in flight (accumulating clicks is
  // the whole point). `qty` here is already the DISPLAYED quantity
  // (serverQuantity + the accumulated-but-not-yet-flushed delta,
  // useInventoryMutation's optimistic update), so the same boundary
  // semantics that used to gate against the server-confirmed quantity now
  // gate against that live, locally-accumulated value instead.
  const incDisabled = capMode === "soft" ? qty >= QUANTITY_CEILING : qty >= cap;
  const decDisabled = qty <= 0;

  const atOrOverLimit = rawLimit !== null && qty >= rawLimit;
  const softOverLimit = capMode === "soft" && rawLimit !== null && qty > rawLimit;
  const pctWidth =
    rawLimit !== null && rawLimit > 0
      ? `${Math.min(100, Math.round((qty / rawLimit) * 100))}%`
      : "0%";

  const label = ownedLabel(variant);

  return (
    // BL-219: `pending` is now purely informational (a flush is somewhere
    // in flight for this popup) -- the buttons themselves are never gated
    // on it (see incDisabled/decDisabled above); this class is an
    // unstyled-today hook for a future subtle "saving" affordance, kept
    // deliberately inert rather than reaching for CSS this task didn't
    // ask for.
    <div className={`cp-plate${pending ? " cp-plate--pending" : ""}`}>
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

/** BL-219 (issue #127): per-variant debounce/accumulation bookkeeping --
 * lives in a ref (not state) since updating it must never itself trigger a
 * render; the DISPLAYED quantity is what's rendered, driven by ordinary
 * setVariants calls at the points below that actually change it.
 *   - serverQty: the last quantity this hook knows the SERVER actually
 *     holds -- seeded from the variant's own quantity the first time a
 *     click touches it (at that instant nothing is pending yet, so the
 *     variant's current quantity IS server truth), then kept in sync by
 *     every flush response. Never reset once seeded -- see bump() below.
 *   - unflushed: the net signed delta accumulated since the last flush was
 *     carved out (by a debounce firing OR a forced flush) -- what the next
 *     network call, if any, will send.
 *   - timer: the pending 400ms debounce handle, or null if no flush is
 *     currently scheduled (either none was ever needed, or one just fired/
 *     was forced and hasn't been rescheduled by a newer click yet). */
interface AdjustBookkeeping {
  serverQty: number;
  unflushed: number;
  timer: ReturnType<typeof setTimeout> | null;
}

// BL-219: debounce window -- one network call per burst of clicks landing
// within 400ms of each other, not one call per click.
const ADJUST_DEBOUNCE_MS = 400;

/** BL-155 decomposition (BL-219 rework, issue #127): handleIncrement/
 * handleDecrement pulled out of CardPopup.tsx verbatim as a hook originally;
 * now accumulate-and-debounce instead of one increment/decrement round trip
 * per click. `setVariants`/`setChanged` are the shell's own useState
 * setters (stable across renders), passed down rather than owned here,
 * since the shell's data-loading effect and the rest of the popup still
 * need `variants`/`changed` directly. `pending`/`mutationError` ARE owned
 * here -- nothing outside this hook reads/writes them except via its
 * return value.
 *
 * Design (BL-219 locked spec): a click mutates a local, per-variant signed
 * delta immediately (both +/- accumulate into the SAME delta, so
 * interleaving nets out) and updates the DISPLAYED quantity optimistically
 * (serverQty + unflushed) -- no network call yet. 400ms after the last
 * click on that variant, exactly one POST .../adjust call fires with the
 * net delta (skipped entirely if it netted to 0); while that call is in
 * flight, further clicks keep accumulating into a NEW delta and reschedule
 * their own 400ms flush rather than blocking on the one already in flight
 * (see InventoryPlate's incDisabled/decDisabled -- never gated on
 * `pending`). The reconciliation on a response replaces serverQty with the
 * response's authoritative quantity and re-derives the display from
 * whatever accumulated in the meantime (bump() during that flight already
 * moved it into `unflushed` again); an error instead leaves serverQty
 * untouched and re-derives from that same untouched value -- "dropping"
 * only the failed flush's own delta while preserving anything accumulated
 * after it. bookkeepingRef is keyed by variant_id (not just "the current
 * selection") since a forced flush on variant-switch can still be in
 * flight for a variant that is no longer selected -- its eventual response
 * must still land on the right row in `variants`. */
export function useInventoryMutation(
  selectedVariant: VariantDetail | null | undefined,
  setVariants: React.Dispatch<React.SetStateAction<VariantDetail[]>>,
  setChanged: React.Dispatch<React.SetStateAction<boolean>>
) {
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const bookkeepingRef = useRef<Map<number, AdjustBookkeeping>>(new Map());
  // How many flushes are currently in flight, across every variant this
  // popup instance has touched -- `pending` is true whenever this is > 0.
  const inFlightCountRef = useRef(0);

  const setDisplayedQuantity = useCallback(
    (variantId: number, quantity: number) => {
      setVariants((prev) => prev.map((v) => (v.variant_id === variantId ? { ...v, quantity } : v)));
    },
    [setVariants]
  );

  // The actual network call for whatever's currently in `unflushed` -- only
  // ever invoked by flushNow below (either the debounce timer firing, or a
  // forced immediate flush), never called directly by a click.
  const flush = useCallback(
    async (variantId: number) => {
      const entry = bookkeepingRef.current.get(variantId);
      if (!entry || entry.unflushed === 0) return;
      const delta = entry.unflushed;
      // Reset immediately, BEFORE the await -- clicks that land while this
      // call is in flight accumulate into a fresh delta rather than being
      // folded into the one already on the wire.
      entry.unflushed = 0;

      inFlightCountRef.current += 1;
      setPending(true);
      setMutationError(null);
      try {
        const result = await adjustCard(variantId, delta);
        // BL-35 (ported): result.over_limit/blocked are informational only
        // for the *response itself* -- the over-limit indicator is derived
        // fresh on every render from the resolved quantity vs. the
        // effective limit (see InventoryPlate), so it stays correct even if
        // the tenant's limits/cap_mode change later in the same session.
        // `applied` is deliberately NOT used here -- `quantity` is the
        // authoritative post-adjust value regardless of how much of the
        // request was actually applied (partial, zero/blocked, or full).
        entry.serverQty = result.quantity;
        setDisplayedQuantity(variantId, entry.serverQty + entry.unflushed);
      } catch (err) {
        // Drop the flushed delta -- serverQty is untouched (last known
        // server truth), so the display snaps back to it plus whatever's
        // accumulated since this failed flush was carved out.
        setDisplayedQuantity(variantId, entry.serverQty + entry.unflushed);
        setMutationError(
          err instanceof EmailNotVerifiedError ? VERIFY_EMAIL_MESSAGE : "Something went wrong."
        );
      } finally {
        inFlightCountRef.current -= 1;
        if (inFlightCountRef.current === 0) setPending(false);
      }
    },
    [setDisplayedQuantity]
  );

  // Cancels any pending debounce timer for `variantId` and flushes RIGHT
  // NOW instead -- the "MUST flush immediately" paths (unmount, variant
  // switch, before another mutation) all funnel through this.
  const flushNow = useCallback(
    (variantId: number) => {
      const entry = bookkeepingRef.current.get(variantId);
      if (!entry) return;
      if (entry.timer !== null) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      void flush(variantId);
    },
    [flush]
  );

  // A click: accumulate the +-1 into the variant's pending delta, update
  // the display optimistically, and (re)start its 400ms debounce window.
  // setChanged(true) fires HERE (synchronously, at click time) rather than
  // waiting on the flush's response -- CardPopup.tsx's close() reads
  // `changed` synchronously the instant Close is clicked, which can easily
  // land before an in-flight or still-debouncing flush has resolved (the
  // popup's OWN unmount is one of the "MUST flush immediately" triggers, so
  // a flush is often only just STARTING as the popup goes away); if
  // `changed` waited on that response, a close that races the flush would
  // silently skip the parent's refreshQuantities. Optimistic and harmless
  // either way (a no-op refresh costs a cheap idempotent GET, same trade-off
  // decrement_card's response already made by never distinguishing "really
  // changed" from "no-op at the floor" pre-BL-219).
  const bump = useCallback(
    (variantId: number, delta: 1 | -1, currentDisplayed: number) => {
      let entry = bookkeepingRef.current.get(variantId);
      if (!entry) {
        // First-ever touch of this variant in this hook instance: nothing
        // is pending yet, so its current displayed quantity IS server
        // truth -- see AdjustBookkeeping's doc comment above.
        entry = { serverQty: currentDisplayed, unflushed: 0, timer: null };
        bookkeepingRef.current.set(variantId, entry);
      }
      entry.unflushed += delta;
      setDisplayedQuantity(variantId, entry.serverQty + entry.unflushed);
      setChanged(true);

      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        entry!.timer = null;
        void flush(variantId);
      }, ADJUST_DEBOUNCE_MS);
    },
    [setDisplayedQuantity, setChanged, flush]
  );

  const handleIncrement = useCallback(() => {
    if (!selectedVariant) return;
    bump(selectedVariant.variant_id, 1, selectedVariant.quantity);
  }, [selectedVariant, bump]);

  const handleDecrement = useCallback(() => {
    if (!selectedVariant) return;
    bump(selectedVariant.variant_id, -1, selectedVariant.quantity);
  }, [selectedVariant, bump]);

  // BL-219: flush-on-variant-switch and flush-on-unmount, both from ONE
  // effect keyed on the selected variant_id -- its cleanup fires exactly
  // when that id is about to change (a rail click, prev/next card nav, or
  // any other path that moves the selection) AND on unmount (popup close),
  // which is exactly the "MUST flush immediately" trigger set the locked
  // spec calls out. "Before any other inventory mutation from the same
  // popup" is covered for free: this popup only ever mutates the currently
  // SELECTED variant, so any other mutation necessarily follows a
  // selection change this same cleanup already intercepts.
  const selectedVariantId = selectedVariant?.variant_id;
  useEffect(() => {
    return () => {
      if (selectedVariantId != null) flushNow(selectedVariantId);
    };
  }, [selectedVariantId, flushNow]);

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
