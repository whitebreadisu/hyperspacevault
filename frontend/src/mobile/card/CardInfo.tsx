import type { BaseCardDetail } from "../../api/baseCards";
import { AspectIcon } from "../../components/AspectIcon";
import { RarityBadge } from "../../components/RarityBadge";
import { StatBadge } from "../../components/StatBadge";
import type { InventoryCard } from "../../utils/inventory";

// BL-248 S2-06: the card's text and facts (rev4 MCardDetail.jsx Info,
// m-layout.css:404-417). The rules-text panel is desktop's .cp-text
// (12 / 11 px cuts, steel ring) with desktop CardPopup.tsx's text logic:
// a section header only on a double-sided card, Epic Action inline, the
// back's text under a hairline. Text, artist and set name come from the
// detail fetch (getBaseCardDetail); until it lands the panel is absent and
// every fact that is missing reads "—".

const ASPECT_GLOW: Record<string, string> = {
  Vigilance: "#3ea0d6",
  Command: "#178a3a",
  Aggression: "#c02b30",
  Cunning: "#e2a33c",
  Heroism: "#d8d3c3",
  Villainy: "#7c3aed",
};
const ASPECT_ORDER = ["Vigilance", "Command", "Aggression", "Cunning", "Heroism", "Villainy"];

/** Desktop CardPopup.tsx orderAspects. */
function orderAspects(aspects: string[]): string[] {
  const at = (a: string) => {
    const i = ASPECT_ORDER.indexOf(a);
    return i === -1 ? ASPECT_ORDER.length : i;
  };
  return [...aspects].sort((a, b) => at(a) - at(b));
}

export function CardInfo({
  card,
  detail,
  setName,
  onOpenAspects,
  ghost = false,
}: {
  card: InventoryCard;
  detail: BaseCardDetail | null;
  setName: string;
  /** S2-07b: a tap on the aspect icons opens the Aspects sheet. */
  onOpenAspects?: (aspects: string[]) => void;
  /** The neighbour page drawn during a slide: no ids (they are the live page's). */
  ghost?: boolean;
}) {
  const aspects = orderAspects(card.aspects);
  const glow = aspects.length ? (ASPECT_GLOW[aspects[0]] ?? "#2563eb") : "#2563eb";
  const hasBackText = !!(detail?.double_sided && detail?.back_text);
  const hasText = !!(detail && (detail.front_text || detail.epic_action || hasBackText));
  const hasStats = card.cost != null || card.power != null || card.hp != null;
  return (
    <section className="m-sec m-info" aria-labelledby={ghost ? undefined : "sec-card"}>
      <div className="m-sec__head">
        <h2 className="m-sec__title" id={ghost ? undefined : "sec-card"}>
          Card
        </h2>
      </div>
      <div className="m-info__setrow">
        <RarityBadge rarity={card.rarity} size={30} iconOnly />
        <div className="m-info__settext">
          <span className="m-info__setname">{detail?.set_name ?? setName}</span>
          <span className="m-info__meta">
            <span className="m-info__num">#{card.base_card_number}</span>
            <RarityBadge rarity={card.rarity} labelOnly />
          </span>
        </div>
      </div>
      <div className="m-info__typerow">
        <span className="m-info__type">
          {card.type}
          {detail?.type2 ? ` · ${detail.type2}` : ""}
          {card.arena ? ` · ${card.arena}` : ""}
        </span>
        {aspects.length ? (
          <button
            type="button"
            className="m-info__aspects"
            onClick={() => onOpenAspects?.(aspects)}
            aria-label={"Aspects: " + aspects.join(", ")}
          >
            {aspects.map((a) => (
              <AspectIcon key={a} aspect={a} size={30} />
            ))}
          </button>
        ) : null}
      </div>
      {hasStats ? (
        <div className="m-info__stats">
          {card.cost != null ? (
            <span className="m-stat">
              <StatBadge type="cost" value={card.cost} size={42} />
              <span className="m-stat__l">Cost</span>
            </span>
          ) : null}
          {card.power != null ? (
            <span className="m-stat">
              <StatBadge type="power" value={card.power} size={42} />
              <span className="m-stat__l">Power</span>
            </span>
          ) : null}
          {card.hp != null ? (
            <span className="m-stat">
              <StatBadge type="hp" value={card.hp} size={42} />
              <span className="m-stat__l">HP</span>
            </span>
          ) : null}
        </div>
      ) : null}
      {hasText && detail ? (
        <div className="cp-text">
          <div className="cp-text__inner">
            {hasBackText ? (
              <div className="cp-text__header" style={{ color: glow }}>
                {detail.type}
              </div>
            ) : null}
            {detail.front_text ? <p className="cp-text__body">{detail.front_text}</p> : null}
            {detail.epic_action ? (
              <p className="cp-text__body">
                <span className="cp-text__epic-label">Epic Action: </span>
                {detail.epic_action}
              </p>
            ) : null}
            {hasBackText ? (
              <div className="cp-text__back">
                <div className="cp-text__header" style={{ color: glow }}>
                  {detail.type2 ?? "Back"}
                </div>
                <p className="cp-text__body">{detail.back_text}</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <dl className="m-facts">
        <div className="m-facts__row">
          <dt>Traits</dt>
          <dd>{card.traits.length ? card.traits.join(", ") : "—"}</dd>
        </div>
        <div className="m-facts__row">
          <dt>Keywords</dt>
          <dd>{card.keywords.length ? card.keywords.join(", ") : "—"}</dd>
        </div>
        <div className="m-facts__row">
          <dt>Artist</dt>
          <dd>{detail?.artist || "—"}</dd>
        </div>
      </dl>
    </section>
  );
}
