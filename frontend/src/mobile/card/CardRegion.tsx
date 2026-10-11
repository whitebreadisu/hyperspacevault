import { useState } from "react";
import type { CSSProperties } from "react";
import { cardImageProps } from "../../utils/cardImages";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import { scopeShortName } from "../../utils/variantScope";
import type { PriceMode } from "../../utils/variantScope";
import { MIcon } from "../icons";
import { PriceSeg } from "../vault/CompletionHeader";
import { prefersReducedMotion } from "../vault/useCollapse";
import { railPrice } from "./cardDetailModel";
import type { RegionGeom } from "./cardDetailModel";
import { PrintingPlate } from "./PrintingPlate";

// BL-248 S2-02: the collapsing art region (rev4 MCardDetail.jsx Region,
// m-rev3.css:136-225). Every box keeps a fixed layout: the region is sticky
// with a constant 100 px layout box; its expanded surface, art and plate
// overflow below it, and collapsing moves them with transform + opacity only
// (the surface slides up by --d-delta, the art translates + scales to the
// 80 px thumbnail from its top-left corner, the expanded plate block fades
// and lifts, the collapsed row -- plate + the selected printing's price +
// Market / Low -- fades in). Tap the collapsed art (or pull from the top)
// to expand; scrolling back to the top never does. Leaders flip with
// desktop's two-phase rotateY (cp-image-flip--out / --in, 0.36 s total);
// reduced motion swaps at once.

const finishLabel = (v: InventoryVariant) => scopeShortName(v.finish ?? v.variant_type);

interface Props {
  card: InventoryCard;
  variant: InventoryVariant;
  geom: RegionGeom;
  showBack: boolean;
  setShowBack: (b: boolean) => void;
  collapsed: boolean;
  onExpand: () => void;
  qty: number;
  isAuthenticated: boolean;
  priceKind: PriceMode;
  onPriceKind: (k: PriceMode) => void;
}

export function CardRegion({
  card,
  variant,
  geom,
  showBack,
  setShowBack,
  collapsed,
  onExpand,
  qty,
  isAuthenticated,
  priceKind,
  onPriceKind,
}: Props) {
  const [phase, setPhase] = useState<"out" | "in" | null>(null);
  const { hasBack } = geom;
  const back = showBack && hasBack;
  const img = back
    ? cardImageProps(variant.back_images, variant.back_image_url, "large")
    : cardImageProps(variant.front_images, variant.front_image_url, "large");
  const price = railPrice(variant, priceKind);
  const doFlip = () => {
    if (!hasBack || phase) return;
    if (prefersReducedMotion()) {
      setShowBack(!showBack);
      return;
    }
    setPhase("out");
  };
  const onAnimEnd = () => {
    if (phase === "out") {
      setShowBack(!showBack);
      setPhase("in");
    } else setPhase(null);
  };
  const style = {
    "--art-w": geom.artW + "px",
    "--art-h": geom.artH + "px",
    "--art-s": geom.cH / geom.artH,
    "--own-top": geom.ownTop + "px",
    "--mini-l": 16 + geom.cW + 14 + "px",
    "--flip-top": geom.flipTop + "px",
  } as CSSProperties;
  const plate = <PrintingPlate type={card.type} qty={qty} isAuthenticated={isAuthenticated} />;
  const num = `${variant.source_set_code} ${variant.card_number}`;

  return (
    <div
      className={"m-dreg m-dreg3" + (collapsed ? " m-dreg3--collapsed" : "")}
      style={style}
      data-land={geom.land ? "1" : undefined}
    >
      <div className="m-dreg3__bg" aria-hidden="true">
        <span className="m-pullbar" />
      </div>
      <div className="m-dreg3__artpos">
        <div className="m-artslide">
          <div className="m-dreg3__art">
            <button
              type="button"
              className={"m-art__btn m-dreg__btn" + (phase ? " cp-image-flip--" + phase : "")}
              onAnimationEnd={onAnimEnd}
              onClick={collapsed ? onExpand : doFlip}
              disabled={!collapsed && !hasBack}
              aria-label={
                collapsed
                  ? "Show the card at full size"
                  : hasBack
                    ? back
                      ? "Show front"
                      : "Show back"
                    : card.name
              }
            >
              {img ? (
                <img
                  className="m-art__img m-dreg__img"
                  src={img.src}
                  srcSet={img.srcSet}
                  onError={img.onError}
                  alt={card.name + (back ? " (back)" : "")}
                  draggable={false}
                />
              ) : (
                <span className="m-img-ph">No image</span>
              )}
            </button>
          </div>
        </div>
      </div>
      <div className="m-dreg3__fade">
        <div className="m-dreg3__own" aria-hidden={collapsed ? true : undefined}>
          <div className="m-dreg__cap">
            <span className="m-dreg__fin">{finishLabel(variant)}</span>
            <span className="m-dreg__num">{num}</span>
          </div>
          {plate}
        </div>
        <div className="m-dreg3__mini" aria-hidden={collapsed ? undefined : true}>
          {plate}
          <span className="m-dreg__price">
            <span
              className={"m-dreg__pval" + (price === "—" ? " m-dreg__pval--none" : "")}
              aria-label={`${finishLabel(variant)} price ${price}`}
            >
              {price}
            </span>
            <PriceSeg mode={priceKind} onChange={onPriceKind} />
          </span>
        </div>
        {hasBack ? (
          <div className="m-dreg__flip m-dreg3__flip" aria-hidden={collapsed ? true : undefined}>
            <button
              type="button"
              className="cp-flip m-flipbtn"
              onClick={doFlip}
              tabIndex={collapsed ? -1 : 0}
              disabled={phase !== null}
            >
              <MIcon name="flip" size={16} /> {back ? "Show front" : "Show back"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
