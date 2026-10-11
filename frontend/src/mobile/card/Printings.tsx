import { useMemo } from "react";
import type { CapMode } from "../../api/settingsLimits";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import { typeCategoryOf } from "../../utils/limits";
import type { LimitsMatrix } from "../../utils/limits";
import { scopeShortName } from "../../utils/variantScope";
import type { PriceMode } from "../../utils/variantScope";
import { PriceSeg } from "../vault/CompletionHeader";
import { groupPrintings, orderPrintings, railPrice, stepperState } from "./cardDetailModel";
import type { Stepper } from "./useStepper";

// BL-248 S2-04 / S2-05 / S2-06: the printings rail -- desktop
// CardPopupRail.tsx's order (base set first, other sources alphabetically,
// card number ascending), group labels ("Base set" / the set's name) and
// "Variants · N" heading with the Market / Low toggle; rev4 MCardDetail.jsx
// Printings' row (finish + set/number button, price, quantity) at phone
// size. Finish names are the Vault's short names. A tap selects the
// printing (art, plate and price follow). The selected row carries the
// −/+ stepper (desktop CardPopupInventory semantics, 44 px targets); the
// other rows show desktop's ×N (green when owned). Signed out: no ×N, the
// stepper is aria-disabled and routes to sign-in (desktop's teaser).

const finishLabel = (v: InventoryVariant) => scopeShortName(v.finish ?? v.variant_type);

interface Props {
  card: InventoryCard;
  setNameByCode: Record<string, string>;
  selectedId: number;
  onSelect: (variantId: number) => void;
  priceKind: PriceMode;
  onPriceKind: (k: PriceMode) => void;
  isAuthenticated: boolean;
  stepper: Stepper;
  limits: LimitsMatrix | null;
  capMode: CapMode;
  onRequestSignIn: () => void;
}

export function Printings({
  card,
  setNameByCode,
  selectedId,
  onSelect,
  priceKind,
  onPriceKind,
  isAuthenticated,
  stepper,
  limits,
  capMode,
  onRequestSignIn,
}: Props) {
  const groups = useMemo(
    () =>
      groupPrintings(orderPrintings(card.variants, card.set_code), card.set_code, setNameByCode),
    [card.variants, card.set_code, setNameByCode]
  );
  const category = typeCategoryOf(card.type);
  return (
    <section className="m-sec m-printings" aria-labelledby="sec-printings">
      <div className="m-sec__head">
        <h2 className="m-sec__title" id="sec-printings">
          Variants <span className="m-sec__count">{card.variants.length}</span>
        </h2>
        <PriceSeg mode={priceKind} onChange={onPriceKind} />
      </div>
      {stepper.error ? (
        <p className="cp-status cp-status--error cp-mutation-error m-print__error" role="alert">
          {stepper.error}
        </p>
      ) : null}
      {groups.map((g) => (
        <div key={g.setCode} className="m-printgroup">
          {groups.length > 1 ? (
            <div className="cp-rail__group-label m-printgroup__label">{g.label}</div>
          ) : null}
          {g.items.map((v) => {
            const active = v.variant_id === selectedId;
            const qty = stepper.qtyOf(v);
            const price = railPrice(v, priceKind);
            const st = stepperState(v, qty, category, limits, capMode);
            const num = `${v.source_set_code} ${v.card_number}`;
            return (
              <div
                key={v.variant_id}
                className={"cp-rail__item m-print" + (active ? " cp-rail__item--active" : "")}
                data-variant={v.variant_id}
              >
                <button
                  type="button"
                  className="m-print__main"
                  onClick={() => onSelect(v.variant_id)}
                  aria-pressed={active}
                  aria-label={`${finishLabel(v)}, ${num}`}
                >
                  <span className="m-print__finish">{finishLabel(v)}</span>
                  <span className="m-print__num">{num}</span>
                  {active && isAuthenticated && st.softOverLimit ? (
                    <span className="cp-plate__over-limit-tag m-print__over">Over limit</span>
                  ) : null}
                </button>
                <span className={"m-print__price" + (price === "—" ? " m-print__price--none" : "")}>
                  {price}
                </span>
                {active ? (
                  <Step
                    variant={v}
                    qty={qty}
                    isAuthenticated={isAuthenticated}
                    incDisabled={st.incDisabled}
                    decDisabled={st.decDisabled}
                    atLimit={st.atOrOverLimit}
                    overLimit={st.softOverLimit}
                    pending={stepper.pending}
                    onInc={() => stepper.increment(v)}
                    onDec={() => stepper.decrement(v)}
                    onRequestSignIn={onRequestSignIn}
                  />
                ) : (
                  <span className="m-print__qtyslot">
                    {isAuthenticated ? (
                      <span
                        className={
                          "cp-rail__item-qty m-print__qty" +
                          (qty > 0 ? " cp-rail__item-qty--owned" : "")
                        }
                      >
                        ×{qty}
                      </span>
                    ) : null}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}

function Step({
  variant,
  qty,
  isAuthenticated,
  incDisabled,
  decDisabled,
  atLimit,
  overLimit,
  pending,
  onInc,
  onDec,
  onRequestSignIn,
}: {
  variant: InventoryVariant;
  qty: number;
  isAuthenticated: boolean;
  incDisabled: boolean;
  decDisabled: boolean;
  atLimit: boolean;
  overLimit: boolean;
  pending: boolean;
  onInc: () => void;
  onDec: () => void;
  onRequestSignIn: () => void;
}) {
  const label = `${variant.finish ?? variant.variant_type} – #${variant.card_number} – ${variant.source_set_code}`;
  if (!isAuthenticated) {
    // Desktop's signed-out teaser: the control stays clickable (aria-disabled,
    // not disabled) and opens sign-in.
    return (
      <span className="m-stepper m-stepper--anon">
        <button
          type="button"
          className="m-step"
          aria-disabled="true"
          aria-label={`Sign in to manage inventory: decrement ${label}`}
          onClick={onRequestSignIn}
        >
          −
        </button>
        <span className="m-step__qty">—</span>
        <button
          type="button"
          className="m-step"
          aria-disabled="true"
          aria-label={`Sign in to manage inventory: increment ${label}`}
          onClick={onRequestSignIn}
        >
          +
        </button>
      </span>
    );
  }
  return (
    <span className={"m-stepper" + (pending ? " m-stepper--pending" : "")}>
      <button
        type="button"
        className="m-step"
        disabled={decDisabled}
        onClick={onDec}
        aria-label={`Decrement ${label}`}
      >
        −
      </button>
      <span
        className={
          "m-step__qty" +
          (qty > 0 ? " m-step__qty--on" : "") +
          (atLimit ? " cp-plate__count--at-limit" : "") +
          (overLimit ? " cp-plate__count--over-limit" : "")
        }
        aria-live="polite"
      >
        {qty}
      </span>
      <button
        type="button"
        className="m-step"
        disabled={incDisabled}
        onClick={onInc}
        aria-label={`Increment ${label}`}
      >
        +
      </button>
    </span>
  );
}
