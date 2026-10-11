import { AspectIcon } from "../../components/AspectIcon";
import { RarityBadge } from "../../components/RarityBadge";
import { StatBadge } from "../../components/StatBadge";
import { parseCardDisplay } from "../../utils/catalog";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import { cardValuePrice, formatCardValue } from "../../utils/variantScope";
import type { PriceMode } from "../../utils/variantScope";
import { cellImage, pickRepresentative, scopedVariant } from "./cardImage";
import { Playset } from "./Playset";
import type { RowSize } from "./useVaultView";

// BL-247 S1-19: one Vault row (rev4 MVault.jsx:98-176). Four tiers: `none` is
// one line (set/#, name, subtitle, price, playset); sm / md / lg add the
// thumbnail (desktop cellImage orientation rules), rarity, aspects; md the
// type; lg two-line names and the stat badges. Scoped (run B2): the set/# is
// the scoped printing's own number (amber), the price is that printing's
// own price or an em dash (cardValuePrice -- never Standard's), the thumbnail
// is its art, the pips read its count and the price + playset cluster carries
// desktop's faint amber column wash. The whole row is one tap target.

export function CardRow({
  card,
  size,
  scope,
  priceKind,
  isAuthenticated,
  onOpen,
}: {
  card: InventoryCard;
  size: RowSize;
  scope: string | null;
  priceKind: PriceMode;
  isAuthenticated: boolean;
  onOpen: (card: InventoryCard, variant: InventoryVariant | null) => void;
}) {
  const sv = scopedVariant(card, scope);
  const shown = sv ?? pickRepresentative(card.variants);
  const price = formatCardValue(cardValuePrice(card.variants, scope, priceKind));
  const { displayName, subtitle } = parseCardDisplay(card);
  const num = sv
    ? `${sv.source_set_code} ${sv.card_number}`
    : `${card.set_code} ${card.base_card_number}`;
  const numEl = <span className={"m-row__num" + (sv ? " m-row__num--scoped" : "")}>{num}</span>;
  const own = (
    <span className={"m-row__own" + (scope ? " m-row__own--scoped" : "")}>
      <span className={"m-row__price" + (price === "—" ? " m-row__price--none" : "")}>{price}</span>
      <span className="m-row__ownline">
        <Playset card={card} scope={scope} isAuthenticated={isAuthenticated} />
      </span>
    </span>
  );
  const label = `${num} ${displayName}${subtitle ? ", " + subtitle : ""}`;
  const open = () => onOpen(card, sv ?? null);

  if (size === "none") {
    return (
      <button
        type="button"
        className="m-row m-row--t-none m-row--line"
        data-card={card.base_card_id}
        data-set={card.set_code}
        onClick={open}
        aria-label={label}
      >
        <span className="m-row__main">
          {numEl}
          <span className="m-row__name">{displayName}</span>
          {subtitle ? <span className="m-row__sub">{subtitle}</span> : null}
        </span>
        {own}
      </button>
    );
  }

  const img = cellImage(card, shown, "thumb", size === "lg" ? "96px" : "48px");
  const aspectSize = size === "lg" ? 24 : size === "md" ? 20 : 18;
  const hasStats = card.cost != null || card.power != null || card.hp != null;
  return (
    <button
      type="button"
      className={"m-row m-row--t-" + size}
      data-card={card.base_card_id}
      data-set={card.set_code}
      onClick={open}
      aria-label={label}
    >
      <span className="m-row__main">
        <span className="m-row__thumb">
          {img.images ? (
            <img
              className={img.rotated ? "m-img--rotated" : undefined}
              src={img.images.src}
              srcSet={img.images.srcSet}
              sizes={img.images.sizes}
              onError={img.images.onError}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          ) : null}
        </span>
        <span className="m-row__text">
          <span className="m-row__name">{displayName}</span>
          {(size === "md" || size === "lg") && subtitle ? (
            <span className="m-row__sub">{subtitle}</span>
          ) : null}
          <span className="m-row__meta">
            {numEl}
            <RarityBadge rarity={card.rarity} size={14} iconOnly />
            {size === "md" ? <span className="m-row__type">{card.type}</span> : null}
            {card.aspects.length ? (
              <span className="m-row__aspects">
                {card.aspects.map((a) => (
                  <AspectIcon key={a} aspect={a} size={aspectSize} />
                ))}
              </span>
            ) : null}
          </span>
          {size === "lg" ? (
            <span className="m-row__stats">
              {hasStats ? (
                <>
                  {card.cost != null ? <StatBadge type="cost" value={card.cost} size={28} /> : null}
                  {card.power != null ? (
                    <StatBadge type="power" value={card.power} size={28} />
                  ) : null}
                  {card.hp != null ? <StatBadge type="hp" value={card.hp} size={28} /> : null}
                </>
              ) : null}
              <span className="m-row__type">{card.type}</span>
            </span>
          ) : null}
        </span>
      </span>
      {own}
    </button>
  );
}
