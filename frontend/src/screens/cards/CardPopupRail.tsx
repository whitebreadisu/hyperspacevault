import { useMemo } from "react";
import { ValueSwitch } from "./VariantScopeControls";
import type { VariantDetail } from "../../api/baseCards";
import { variantPriceValue } from "../../utils/completion";
import { variantLabel, orderVariants } from "./cardPopupShared";
import { CardPopupCompactHistory } from "./CardPopupPriceHistory";

/** Printings rail, the popup's left column: the printing picker (grouped by
 * set, base set first), the Market/Low price-mode toggle beside its heading,
 * the always-on compact price-history embed, and the rail-footer attribution
 * line. See CardPopupPriceHistory.tsx for the history embed itself and
 * cardPopupShared.ts for variantLabel (shared with CardPopupInventory.tsx's
 * aria-labels) and orderVariants (the one ordering rule the shell's up/down
 * keyboard cycle also uses, not a second hand-kept copy). */

interface PrintingGroup {
  setCode: string;
  /** "Base set" for the card's own set_code; the full long set name (e.g.
   * "2024 Convention Exclusive") for every other source set. A base card's
   * own set_code IS its base set by construction -- no separate is_base_set
   * lookup is needed. */
  label: string;
  items: VariantDetail[];
}

function groupBySet(
  ordered: VariantDetail[],
  baseSetCode: string,
  setNameByCode: Record<string, string>
): PrintingGroup[] {
  const groups: PrintingGroup[] = [];
  for (const v of ordered) {
    let g = groups[groups.length - 1];
    if (!g || g.setCode !== v.source_set_code) {
      const isBase = v.source_set_code === baseSetCode;
      g = {
        setCode: v.source_set_code,
        label: isBase ? "Base set" : (setNameByCode[v.source_set_code] ?? v.source_set_code),
        items: [],
      };
      groups.push(g);
    }
    g.items.push(v);
  }
  return groups;
}

/** Prices live ON the rail rows, with a per-printing Market/Low price-KIND
 * switch in the rail header. There is no separate grouped price block and no
 * deck-cost "Cheapest" aggregate here. See railPriceText/PriceRailMode below
 * and the rail markup in the JSX. */
export type PriceRailMode = "market" | "low";

/** Rail row's right-aligned price text for the active Market/Low mode.
 * `v.price === undefined` (CatalogVariant's additive-optional field, absent
 * on a stale cached catalog response that predates per-variant prices) is
 * handled by the caller as a loading-skeleton state, never reaching this
 * function -- see the rail JSX below. */
function railPriceText(v: VariantDetail, mode: PriceRailMode): string {
  const val = variantPriceValue(v, mode);
  return val == null ? "—" : `$${val.toFixed(2)}`;
}

interface CardPopupRailProps {
  baseCardId: number;
  variants: VariantDetail[];
  /** The base card's own set_code (detail.set_code) -- guaranteed non-null
   * by the caller, which only mounts this rail once `detail` has resolved. */
  baseSetCode: string;
  setNameByCode: Record<string, string>;
  selectedVariant: VariantDetail;
  isAuthenticated: boolean;
  priceMode: PriceRailMode;
  onPriceModeChange: (mode: PriceRailMode) => void;
  onSelectVariant: (variantId: number) => void;
  onExpandHistory: () => void;
}

export function CardPopupRail({
  baseCardId,
  variants,
  baseSetCode,
  setNameByCode,
  selectedVariant,
  isAuthenticated,
  priceMode,
  onPriceModeChange,
  onSelectVariant,
  onExpandHistory,
}: CardPopupRailProps) {
  const orderedVariants = useMemo(
    () => orderVariants(variants, baseSetCode),
    [variants, baseSetCode]
  );
  const printingGroups = useMemo(
    () => groupBySet(orderedVariants, baseSetCode, setNameByCode),
    [orderedVariants, baseSetCode, setNameByCode]
  );
  // Rail-footer attribution's "· N unpriced": shown whenever any printing
  // lacks a price.
  const unpricedCount = useMemo(() => variants.filter((v) => v.price == null).length, [variants]);

  return (
    <div className="cp-rail">
      <div className="cp-rail__heading-row">
        {/* Heading uses the "Variant(s)" taxonomy the popup uses elsewhere;
          the filter / Add Cards "Finish" labels are deliberately different
          because they select the finish axis specifically. Plural since the
          rail lists several printings per card in the overwhelming common
          case. */}
        <div className="cp-rail__heading">Variants · {orderedVariants.length}</div>
        {/* Per-printing price KIND toggle (Market/Low) for the rail rows'
          prices. */}
        {/* Same ValueSwitch control as the table header and completion panel:
            one Market/Low idiom app-wide. */}
        <div className="cp-rail__pricemode">
          <ValueSwitch
            checked={priceMode === "low"}
            label={priceMode === "low" ? "LOW" : "MARKET"}
            ariaLabel={
              priceMode === "low"
                ? "Showing low price — switch to market"
                : "Showing market price — switch to low"
            }
            title={
              priceMode === "low"
                ? "Low price — cheapest listing. Click for market price."
                : "Market price — TCGplayer market average. Click for low price."
            }
            onToggle={() => onPriceModeChange(priceMode === "low" ? "market" : "low")}
          />
        </div>
      </div>
      {printingGroups.map((g) => (
        <div className="cp-rail__group" key={g.setCode}>
          <div className="cp-rail__group-label">{g.label}</div>
          <div className="cp-rail__items">
            {g.items.map((v) => {
              const active = v.variant_id === selectedVariant.variant_id;
              const owned = v.quantity > 0;
              return (
                <button
                  type="button"
                  key={v.variant_id}
                  className={`cp-rail__item${active ? " cp-rail__item--active" : ""}`}
                  aria-pressed={active}
                  title={variantLabel(v)}
                  // Lookup hook for the up/down keyboard cycle's
                  // scrollIntoView: the shell finds this row by id after a
                  // keyboard cycle to bring it into view (click never needs
                  // this, the user already sees the row they clicked).
                  data-variant-id={v.variant_id}
                  onClick={() => onSelectVariant(v.variant_id)}
                >
                  <span className="cp-rail__item-finish">{v.finish ?? v.variant_type}</span>
                  <span className="cp-rail__item-num">#{v.card_number}</span>
                  {isAuthenticated && (
                    <span
                      className={`cp-rail__item-qty${owned ? " cp-rail__item-qty--owned" : ""}`}
                    >
                      ×{v.quantity}
                    </span>
                  )}
                  {/* The printing's price (per the rail header's Market/Low
                    toggle) is right-aligned on its own row. `v.price ===
                    undefined` (additive-optional field, absent on a stale
                    cached catalog response) shows the loading skeleton bar;
                    `null` (fetched, genuinely no price) shows the em-dash via
                    railPriceText. */}
                  <span className="cp-rail__item-price">
                    {v.price === undefined ? (
                      <span
                        className="cp-rail__item-price-skeleton"
                        aria-hidden="true"
                        data-testid="rail-price-skeleton"
                      />
                    ) : (
                      <span data-testid="rail-price-text">{railPriceText(v, priceMode)}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {/* The COMPACT history panel is permanently embedded under the printing
        rows, re-rendering on selection since it's keyed off selectedVariant
        directly. */}
      <CardPopupCompactHistory
        baseCardId={baseCardId}
        variant={selectedVariant}
        onExpand={onExpandHistory}
      />
      <div className="cp-rail__footer">
        <div className="cp-rail__attribution">
          Prices via TCGplayer
          {unpricedCount > 0 ? ` · ${unpricedCount} unpriced` : ""}
        </div>
      </div>
    </div>
  );
}
