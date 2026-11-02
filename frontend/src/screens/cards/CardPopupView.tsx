import type { ReactNode, RefObject } from "react";
import type { BaseCardDetail, VariantDetail } from "../../api/baseCards";
import { AspectIcon } from "../../components/AspectIcon";
import { StatBadge } from "../../components/StatBadge";
import { SectionSeparator } from "../../components/SectionSeparator";
import { RarityBadge } from "../../components/RarityBadge";
import { EpicActionText } from "../../components/EpicActionText";
import { repairText } from "../../utils/mojibake";
import { CardPopupRail, type PriceRailMode } from "./CardPopupRail";
import type { CardFlip } from "./useCardFlip";
import "./CardPopup.css";

/** The card popup's view: header, separator, and the three-column body
 * (printings rail, image column, card info). It takes the card as props and
 * fetches nothing, so two containers render it:
 *   - CardPopup.tsx, the app's modal (fetch, inventory, keyboard, analytics);
 *   - the public card page (src/public), prerendered at build time from the
 *     public catalog and hydrated from the same data (design note §0, §6).
 * The slots carry what only one container has (the close/nav cluster, the
 * inventory plate, the expanded history). The page-only props default to the
 * popup's own output, so the app renders exactly as before. */

/** Base-set codes with shipped starfield art (public/images/starfields/) --
 * the same fixed roster the app-header's ASH starfield assumes. Any other
 * source_set_code (Weekly Play, Judge, Convention, etc. container sets) has
 * no art. */
const STARFIELD_SET_CODES = new Set([
  "SOR",
  "SHD",
  "TWI",
  "JTL",
  "LOF",
  "SEC",
  "LAW",
  "ASH",
  "HMW",
  "IBH",
]);

/** Logo roster (public/images/set_*.png) = starfield roster + TS26, which has
 * a logo but no starfield -- the two asset classes are not the same set list.
 * AddCardsSetBar's SetMark renders from this roster ungated. */
const LOGO_SET_CODES = new Set([...STARFIELD_SET_CODES, "TS26"]);

function setLogoSrc(code: string): string | null {
  return LOGO_SET_CODES.has(code) ? `/images/set_${code}.png` : null;
}

function starfieldSrc(code: string): string | null {
  return STARFIELD_SET_CODES.has(code) ? `/images/starfields/starfield_${code}.jpg` : null;
}

/** Canonical aspect display order (shared with FilterPanel's ASPECT_LIST)
 * plus the header-glow color for each: card-text section headers tint to the
 * card's primary aspect. Command's color doubles as the app's
 * --aspect-command token value, kept as a literal here since this map covers
 * all 6 aspects, not just Command. */
const ASPECT_ORDER = ["Vigilance", "Command", "Aggression", "Cunning", "Heroism", "Villainy"];
const ASPECT_GLOW: Record<string, string> = {
  Vigilance: "#3ea0d6",
  Command: "#178a3a",
  Aggression: "#c02b30",
  Cunning: "#e2a33c",
  Heroism: "#d8d3c3",
  Villainy: "#7c3aed",
};

export function orderAspects(aspects: string[]): string[] {
  return [...aspects].sort((a, b) => {
    const ai = ASPECT_ORDER.indexOf(a);
    const bi = ASPECT_ORDER.indexOf(b);
    return (ai === -1 ? ASPECT_ORDER.length : ai) - (bi === -1 ? ASPECT_ORDER.length : bi);
  });
}

export interface CardPopupViewProps {
  baseCardId: number;
  detail: BaseCardDetail;
  variants: VariantDetail[];
  selectedVariant: VariantDetail;
  setNameByCode: Record<string, string>;
  isAuthenticated: boolean;
  priceMode: PriceRailMode;
  onPriceModeChange: (mode: PriceRailMode) => void;
  onSelectVariant: (variantId: number) => void;
  onExpandHistory: () => void;
  flip: CardFlip;
  /** Passed to useCardFlip too: the image column it measures. */
  imageWrapRef: RefObject<HTMLDivElement | null>;
  /** Top-right of the header: the app's prev/next + close cluster. */
  headerControls?: ReactNode;
  /** Between the separator and the body: the app's mutation error. */
  notice?: ReactNode;
  /** Under the image: the app's inventory plate, the page's sign-up plate. */
  inventorySlot: ReactNode;
  /** Under the body: the app's expanded price history. */
  afterBody?: ReactNode;
  /** Page-only (design note §4.0). Defaults reproduce the popup.
   * The card name's element: the popup's `h2`; on the public page, whose
   * phone tree holds the one `<h1>` element, "aria-h1" -- a `div` with
   * role="heading" aria-level 1, the same look (row 3). */
  headingLevel?: "h1" | "h2" | "aria-h1";
  /** Replaces "Base set" in the info set row and the rail group (row 4). */
  baseSetLabel?: string;
  /** Replaces "#5" in the info set row, e.g. "SOR 005" (row 5). */
  numberLabel?: string;
  /** Adds the "Aspects: ..." facts row (row 6). */
  showAspectsRow?: boolean;
  /** Under the image, above the plate: the page's notice line (row 9). */
  imageNote?: ReactNode;
  /** Shown in the image slot when the printing has no image to show (the
   * public page's same-size art placeholder, design note §5a). The app
   * passes none and renders nothing there, as before. */
  imagePlaceholder?: ReactNode;
}

export function CardPopupView({
  baseCardId,
  detail,
  variants,
  selectedVariant,
  setNameByCode,
  isAuthenticated,
  priceMode,
  onPriceModeChange,
  onSelectVariant,
  onExpandHistory,
  flip,
  imageWrapRef,
  headerControls,
  notice,
  inventorySlot,
  afterBody,
  headingLevel = "h2",
  baseSetLabel,
  numberLabel,
  showAspectsRow = false,
  imageNote,
  imagePlaceholder,
}: CardPopupViewProps) {
  const { displayedImages, canFlip, showBack, flipPhase, flipHeight } = flip;
  const headerArt = starfieldSrc(detail.set_code);
  const isBaseSelected = selectedVariant.source_set_code === detail.set_code;
  const setLogo = setLogoSrc(selectedVariant.source_set_code) ?? setLogoSrc(detail.set_code);
  const setDisplayName = isBaseSelected
    ? (baseSetLabel ?? "Base set")
    : (setNameByCode[selectedVariant.source_set_code] ?? selectedVariant.source_set_code);

  const aspects = orderAspects(detail.aspects);
  const glow = aspects.length ? (ASPECT_GLOW[aspects[0]] ?? "#2563eb") : "#2563eb";
  const hasBackText = !!(detail.double_sided && detail.back_text);
  const titleProps =
    headingLevel === "aria-h1" ? { role: "heading", "aria-level": 1 as const } : undefined;
  const Title = headingLevel === "aria-h1" ? "div" : headingLevel;
  const frontText = repairText(detail.front_text);
  const backText = repairText(detail.back_text);

  return (
    <>
      <div className="cp-header">
        {headerArt && (
          <div
            className="cp-header__art"
            style={{
              backgroundImage: `linear-gradient(90deg, rgba(9, 11, 20, 0.62), rgba(9, 11, 20, 0.28)), url(${headerArt})`,
            }}
            aria-hidden="true"
          />
        )}
        <div className="cp-header__row">
          <Title className="cp-title" id="cp-title" {...titleProps}>
            {detail.name}
          </Title>
          {detail.subtitle && <div className="cp-subtitle">{detail.subtitle}</div>}
          {setLogo && (
            <img className="cp-header__setlogo" src={setLogo} alt={`${detail.set_code} logo`} />
          )}
        </div>
        {/* Prev/next nav flanks the close button in one
          absolutely-positioned cluster -- see CardPopupNav.tsx's
          CardPopupNavButtons doc comment. */}
        {headerControls}
      </div>

      <SectionSeparator className="cp-separator" />

      {notice}

      <div className="cp-body">
        <CardPopupRail
          baseCardId={baseCardId}
          variants={variants}
          baseSetCode={detail.set_code}
          setNameByCode={setNameByCode}
          selectedVariant={selectedVariant}
          isAuthenticated={isAuthenticated}
          priceMode={priceMode}
          onPriceModeChange={onPriceModeChange}
          onSelectVariant={onSelectVariant}
          onExpandHistory={onExpandHistory}
          baseSetLabel={baseSetLabel}
        />

        <div className="cp-center">
          {displayedImages && (
            <div className="cp-image-wrap" ref={imageWrapRef}>
              {/* A flat <img> literally rotated to rest at
                rotateY(180deg) would render mirrored (there's no
                real "back face" -- it's the same plane seen from
                behind), so the transform never rests or animates
                past 90deg. Two-phase flip: `cp-image-flip--out`
                rotates the CURRENT side from 0deg to 90deg; its
                animationend (useCardFlip's onFlipAnimationEnd) swaps
                `showBack` -- so `src` above only changes once the
                image is edge-on and invisible -- then switches to
                `cp-image-flip--in`, which rotates 90deg back to 0deg
                to reveal the NEW side. The viewer watches the old
                face fold away and only ever sees the new face as it
                unfolds, never a mid-flight swap.

                Leader backs are landscape while fronts are
                portrait, so without a morph this element's height
                would snap instantly the moment `src` swaps
                mid-flip. `flipHeight` (useCardFlip, from the
                measured width and the target side's aspect) drives
                an inline height that CSS transitions smoothly across
                the full 0.36s flip; when either input isn't known
                yet (aspect not measured, or a non-flippable/
                non-leader card that never needs this) there's no
                inline style at all and the element just falls back
                to its natural CSS height.

                Known limitation: with `overflow: hidden` on this
                element (needed so a mid-morph height doesn't clip
                through to reveal image content past the rotated
                edge), the rotateY perspective bulge can clip a few
                px at the very top/bottom mid-flip. Minor and only
                visible mid-animation. */}
              <div
                className={`cp-image-flip${flipPhase ? ` cp-image-flip--${flipPhase}` : ""}`}
                onAnimationEnd={flip.onFlipAnimationEnd}
                style={flipHeight != null ? { height: flipHeight } : undefined}
              >
                <img
                  className="cp-image"
                  src={displayedImages.src}
                  srcSet={displayedImages.srcSet}
                  onError={displayedImages.onError}
                  onLoad={flip.onImageLoad}
                  alt={`${detail.name}${detail.subtitle ? ` – ${detail.subtitle}` : ""}`}
                />
              </div>
            </div>
          )}
          {!displayedImages && imagePlaceholder}
          {canFlip && (
            <button
              type="button"
              className="cp-flip"
              disabled={flipPhase !== null}
              onClick={flip.onFlipClick}
            >
              {showBack ? "Show front" : "Show back"}
            </button>
          )}
          {imageNote}
          {inventorySlot}
        </div>

        <div className="cp-info">
          {/* The rarity SYMBOL is a larger icon anchored LEFT of the
              two-line set/rarity stack; the colored label stays
              inline beside the card number. */}
          {/* The type + aspect icons sit INSIDE the set row,
              right-aligned -- type text LEFT of the aspect icons. */}
          <div className="cp-info__set-row">
            <RarityBadge rarity={detail.rarity} iconOnly size={34} />
            <div className="cp-info__set-text">
              <div className="cp-info__set-name">{setDisplayName}</div>
              <div className="cp-info__meta">
                <RarityBadge rarity={detail.rarity} labelOnly />
                <span className="cp-info__cardnum">
                  {isBaseSelected && numberLabel ? numberLabel : `#${selectedVariant.card_number}`}
                </span>
              </div>
            </div>
            <div className="cp-info__typeaspects">
              <span className="cp-info__typeline">
                {detail.type}
                {detail.type2 ? ` · ${detail.type2}` : ""}
              </span>
              {/* Sized to match the stat badges (Cost/Power/HP render
                  at 46 below), not the 34px rarity icon. */}
              {aspects.map((a) => (
                <AspectIcon key={a} aspect={a} size={46} tooltip />
              ))}
            </div>
          </div>

          <div className="cp-text">
            <div className="cp-text__inner">
              {hasBackText && (
                <div className="cp-text__header" style={{ color: glow }}>
                  {detail.type}
                </div>
              )}
              {frontText && <p className="cp-text__body">{frontText}</p>}
              <EpicActionText text={detail.epic_action} />
              {hasBackText && (
                <div className="cp-text__back">
                  <div className="cp-text__header" style={{ color: glow }}>
                    {detail.type2 ?? "Back"}
                  </div>
                  <p className="cp-text__body">{backText}</p>
                </div>
              )}
            </div>
          </div>

          {/* A null stat renders neither its badge nor its label (an
            orphaned "COST" caption with nothing above it would read
            as broken); if the card has none of the three stats the
            whole strip disappears. Zero is a real value and still
            renders. */}
          {(detail.cost != null || detail.power != null || detail.hp != null) && (
            <div className="cp-stats">
              <div className="cp-stats__inner">
                {detail.cost != null && (
                  <div className="cp-stats__item">
                    <StatBadge type="cost" value={detail.cost} size={46} />
                    <span className="cp-stats__label">COST</span>
                  </div>
                )}
                {detail.power != null && (
                  <div className="cp-stats__item">
                    <StatBadge type="power" value={detail.power} size={46} />
                    <span className="cp-stats__label">POWER</span>
                  </div>
                )}
                {detail.hp != null && (
                  <div className="cp-stats__item">
                    <StatBadge type="hp" value={detail.hp} size={46} />
                    <span className="cp-stats__label">HP</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="cp-facts">
            {showAspectsRow && aspects.length > 0 && (
              <div className="cp-facts__row">
                <span className="cp-facts__label">ASPECTS</span>
                <span>{aspects.join(", ")}</span>
              </div>
            )}
            {detail.keywords.length > 0 && (
              <div className="cp-facts__row">
                <span className="cp-facts__label">KEYWORDS</span>
                <span>{detail.keywords.join(", ")}</span>
              </div>
            )}
            {detail.traits.length > 0 && (
              <div className="cp-facts__row">
                <span className="cp-facts__label">TRAITS</span>
                <span>{detail.traits.join(", ")}</span>
              </div>
            )}
            {detail.arena != null && detail.arena !== "" && (
              <div className="cp-facts__row">
                <span className="cp-facts__label">ARENA</span>
                <span>{detail.arena}</span>
              </div>
            )}
          </div>

          <div className="cp-artist">Artist — {detail.artist ?? "—"}</div>
        </div>
      </div>

      {afterBody}
    </>
  );
}
