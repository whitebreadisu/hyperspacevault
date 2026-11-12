import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cardImageProps } from "../../utils/cardImages";
import type { CardImageProps } from "../../utils/cardImages";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import { scopeShortName } from "../../utils/variantScope";
import type { PriceMode } from "../../utils/variantScope";
import { MIcon } from "../icons";
import { PriceSeg } from "../vault/CompletionHeader";
import { prefersReducedMotion } from "../vault/useCollapse";
import { railPrice } from "./cardDetailModel";
import type { RegionGeom } from "./cardDetailModel";
import { PrintingPlate } from "./PrintingPlate";

// The collapsing art region (App Spec §25.2). Every box keeps a fixed layout: the region is sticky
// with a constant 100 px layout box; its expanded surface, art and plate
// overflow below it, and collapsing moves them with transform + opacity only
// (the surface slides up by --d-delta, the art translates + scales to the
// 80 px thumbnail from its top-left corner, the expanded plate block fades
// and lifts, the collapsed row fades in). The expanded caption reads "finish - SET ###" at the left and the selected
// printing's price (per Market / Low) at the right; the collapsed row is
// three columns -- thumbnail | finish label over the plate | Market / Low
// over the price -- with no set / number. Tap the collapsed art (or pull from the top)
// to expand; scrolling back to the top never does. Leaders flip with
// desktop's two-phase rotateY (cp-image-flip--out / --in, 0.36 s total);
// reduced motion swaps at once.

const finishLabel = (v: InventoryVariant) => scopeShortName(v.finish ?? v.variant_type);

function regionImage(
  variant: InventoryVariant,
  back: boolean,
  mode: "app" | "fixed320"
): CardImageProps | null {
  const images = back ? variant.back_images : variant.front_images;
  if (mode === "fixed320") return images?.w320 ? { src: images.w320 } : null;
  return cardImageProps(images, back ? variant.back_image_url : variant.front_image_url, "large");
}

interface Props {
  card: InventoryCard;
  variant: InventoryVariant;
  geom: RegionGeom;
  showBack: boolean;
  setShowBack: (b: boolean) => void;
  collapsed: boolean;
  onExpand: () => void;
  /** Every printing of the card with the quantity to show (the stepper's
   * optimistic quantities included): the plate counts across them. */
  shownVariants: InventoryVariant[];
  isAuthenticated: boolean;
  priceKind: PriceMode;
  onPriceKind: (k: PriceMode) => void;
  /** The plate opens Owned by finish (signed in only). */
  onOpenFinish?: () => void;
  /** A stash link's card: the plate is the in-stash count alone. */
  stashCount?: boolean;
  /** Public card page (design note §4.0 row 10): drawn instead of the
   * printing plate, in both the expanded block and the collapsed row. */
  plateSlot?: ReactNode;
  /** "fixed320": the 320 px same-origin rendition only, no srcset and no
   * fallback to the official CDN (design note §5a). */
  imageMode?: "app" | "fixed320";
  /** Phone 1e: the stash block under the plate (expanded) and the
   * list pinned under the collapsed row; geom carries their heights. */
  stashBlock?: ReactNode;
  stashPinned?: ReactNode;
}

export function CardRegion({
  card,
  variant,
  geom,
  showBack,
  setShowBack,
  collapsed,
  onExpand,
  shownVariants,
  isAuthenticated,
  priceKind,
  onPriceKind,
  onOpenFinish,
  stashCount = false,
  plateSlot,
  imageMode = "app",
  stashBlock,
  stashPinned,
}: Props) {
  const [phase, setPhase] = useState<"out" | "in" | null>(null);
  const { hasBack } = geom;
  const back = showBack && hasBack;
  const img = regionImage(variant, back, imageMode);
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
    "--reg-min": geom.regMin + "px",
  } as CSSProperties;
  const plate = (
    <PrintingPlate
      name={card.name}
      type={card.type}
      variants={shownVariants}
      scope={variant.finish ?? variant.variant_type}
      isAuthenticated={isAuthenticated}
      onClick={onOpenFinish}
      stashCount={stashCount}
    />
  );
  // The page's slot replaces the expanded plate; its collapsed row keeps
  // only the finish label and the price (no inventory affordance, row 11).
  const plateNode = plateSlot ?? plate;
  const miniPlate = plateSlot ? null : plate;
  const num = `${variant.source_set_code} ${variant.card_number}`;
  const fin = finishLabel(variant);
  const noPrice = price === "—";

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
            <span className="m-dreg__id">
              <span className="m-dreg__fin">{fin}</span>
              <span className="m-dreg__sep" aria-hidden="true">
                {" - "}
              </span>
              <span className="m-dreg__num">{num}</span>
            </span>
            <span
              className={"m-dreg__cprice" + (noPrice ? " m-dreg__cprice--none" : "")}
              aria-label={`${fin} price ${price}`}
            >
              {price}
            </span>
          </div>
          {plateNode}
          {stashBlock}
        </div>
        <div className="m-dreg3__mini" aria-hidden={collapsed ? undefined : true}>
          <span className="m-dreg__inv">
            <span className="m-dreg__minilab">{fin}</span>
            {miniPlate}
          </span>
          <span className="m-dreg__price">
            <PriceSeg mode={priceKind} onChange={onPriceKind} />
            <span
              className={"m-dreg__pval" + (noPrice ? " m-dreg__pval--none" : "")}
              aria-label={`${fin} price ${price}`}
            >
              {price}
            </span>
          </span>
        </div>
        {stashPinned}
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
