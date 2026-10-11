import type { CSSProperties, Ref } from "react";
import type { BaseCardDetail } from "../../api/baseCards";
import type { CapMode } from "../../api/settingsLimits";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import type { LimitsMatrix } from "../../utils/limits";
import { scopeShortName } from "../../utils/variantScope";
import type { PriceMode } from "../../utils/variantScope";
import { CardInfo } from "./CardInfo";
import { CardRegion } from "./CardRegion";
import type { RegionGeom } from "./cardDetailModel";
import { PriceChart } from "./PriceChart";
import { Printings } from "./Printings";
import type { Stepper } from "./useStepper";

// BL-248 S2-08: one card's page -- the collapsing region and the body
// (printings rail, price history, card text) -- split out of CardDetail so
// the body-slide swipe can draw the neighbour beside the current card (rev4
// MCardDetail.jsx CardPage). The header is NOT part of the page: it stays
// fixed while pages slide under it (R5 switch swipe=body). A `ghost` page is
// the neighbour during a swipe or a chevron move: at the top, on its entry
// printing, in the current page's collapse state, inert, no fetches.

const finishLabel = (v: InventoryVariant) => scopeShortName(v.finish ?? v.variant_type);

/** A stepper that only reads (the neighbour page during a slide). */
export const READ_ONLY_STEPPER: Stepper = {
  qtyOf: (v) => v.quantity,
  increment: () => {},
  decrement: () => {},
  pending: false,
  error: null,
};

export interface CardPageProps {
  card: InventoryCard;
  variant: InventoryVariant;
  geom: RegionGeom;
  showBack: boolean;
  setShowBack: (b: boolean) => void;
  collapsed: boolean;
  onExpand?: () => void;
  pulling?: boolean;
  pullStyle?: CSSProperties;
  scrollRef?: Ref<HTMLDivElement>;
  ghost?: "next" | "prev";
  stepper: Stepper;
  isAuthenticated: boolean;
  priceKind: PriceMode;
  onPriceKind: (k: PriceMode) => void;
  setNameByCode: Record<string, string>;
  limits: LimitsMatrix | null;
  capMode: CapMode;
  onRequestSignIn: () => void;
  detail: BaseCardDetail | null;
  onSelect: (variantId: number) => void;
  onOpenFinish?: () => void;
  onOpenAspects?: (aspects: string[]) => void;
  onChartEngage?: () => void;
  /** BL-252 S6-05: a shared vault's card (×N, no stepper). */
  readOnly?: boolean;
}

export function CardPage(p: CardPageProps) {
  const { card, variant, geom, ghost } = p;
  const style = {
    "--d-full": geom.full + "px",
    "--d-delta": geom.delta + "px",
    ...(ghost ? null : p.pullStyle),
  } as CSSProperties;
  return (
    <div
      className={
        "m-page" +
        (p.collapsed ? " m-page--collapsed" : "") +
        (!ghost && p.pulling ? " m-pulling" : "") +
        (ghost ? " m-page--ghost m-page--" + ghost : "")
      }
      style={style}
      aria-hidden={ghost ? true : undefined}
      inert={!!ghost}
      data-card={card.base_card_id}
    >
      <div
        className="m-scroll m-detail__scroll m-detail__scroll--r3"
        ref={ghost ? undefined : p.scrollRef}
      >
        <CardRegion
          card={card}
          variant={variant}
          geom={geom}
          showBack={p.showBack}
          setShowBack={p.setShowBack}
          collapsed={p.collapsed}
          onExpand={p.onExpand ?? (() => {})}
          qty={p.stepper.qtyOf(variant)}
          isAuthenticated={p.isAuthenticated}
          priceKind={p.priceKind}
          onPriceKind={p.onPriceKind}
          onOpenFinish={ghost ? undefined : p.onOpenFinish}
        />
        <div className="m-detail__body">
          <Printings
            card={card}
            setNameByCode={p.setNameByCode}
            selectedId={variant.variant_id}
            onSelect={p.onSelect}
            priceKind={p.priceKind}
            onPriceKind={p.onPriceKind}
            isAuthenticated={p.isAuthenticated}
            stepper={p.stepper}
            limits={p.limits}
            capMode={p.capMode}
            onRequestSignIn={p.onRequestSignIn}
            ghost={!!ghost}
            readOnly={p.readOnly}
          />
          <section className="m-sec m-history" aria-labelledby={ghost ? undefined : "sec-history"}>
            <div className="m-sec__head">
              <h2 className="m-sec__title" id={ghost ? undefined : "sec-history"}>
                Price history
              </h2>
              <span className="m-sec__aside">
                {finishLabel(variant)} · {variant.source_set_code} {variant.card_number}
              </span>
            </div>
            <PriceChart
              baseCardId={card.base_card_id}
              variant={variant}
              live={!ghost}
              onEngage={p.onChartEngage}
            />
          </section>
          <CardInfo
            card={card}
            detail={p.detail}
            setName={p.setNameByCode[card.set_code] ?? card.set_code}
            onOpenAspects={ghost ? undefined : p.onOpenAspects}
            ghost={!!ghost}
          />
        </div>
      </div>
    </div>
  );
}
