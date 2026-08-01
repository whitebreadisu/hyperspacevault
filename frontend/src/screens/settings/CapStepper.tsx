/** BL-182: a settings-local numeric keep-limit stepper -- the visual
 * language of the card popup's owned-quantity plate (CardPopupInventory.tsx
 * InventoryPlate / CardPopup.css .cp-plate__step, __qty) re-implemented here
 * rather than imported, since the popup's plate is quantity-vs-limit display
 * while this is a bare "− value +" editor for the limit itself. Click-per-
 * step only (no hold-to-repeat, no text entry) -- an iteration round may add
 * either later, but the locked BL-182 spec is buttons only. */

interface CapStepperProps {
  /** Display label, already in the page's all-caps convention (e.g.
   * "LEADERS & BASES"). */
  label: string;
  /** Title-case name used inside the buttons' aria-labels (e.g.
   * "Leaders & Bases"), since screen readers shouldn't announce the visual
   * all-caps styling as a spelled-out acronym. */
  ariaName: string;
  /** Small floor hint under the label (e.g. "min 1"). */
  floorHint: string;
  value: number;
  floor: number;
  ceiling: number;
  /** True when the parent's selection is "No limits" (stepper shown but
   * inert) or a save is in flight. */
  disabled: boolean;
  onDecrement: () => void;
  onIncrement: () => void;
}

export function CapStepper({
  label,
  ariaName,
  floorHint,
  value,
  floor,
  ceiling,
  disabled,
  onDecrement,
  onIncrement,
}: CapStepperProps) {
  const decDisabled = disabled || value <= floor;
  const incDisabled = disabled || value >= ceiling;

  return (
    <div className={`sl-capstepper${disabled ? " sl-capstepper--disabled" : ""}`}>
      <span className="sl-capstepper__label">
        <span className="sl-capstepper__title">{label}</span>
        <span className="sl-capstepper__hint">{floorHint}</span>
      </span>
      <span className="sl-capstepper__control">
        <button
          type="button"
          className="sl-capstepper__step sl-capstepper__step--dec"
          aria-label={`Decrease ${ariaName} cap`}
          disabled={decDisabled}
          onClick={onDecrement}
        >
          −
        </button>
        <span className="sl-capstepper__value">{value}</span>
        <button
          type="button"
          className="sl-capstepper__step sl-capstepper__step--inc"
          aria-label={`Increase ${ariaName} cap`}
          disabled={incDisabled}
          onClick={onIncrement}
        >
          +
        </button>
      </span>
    </div>
  );
}
