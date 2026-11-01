import { useState } from "react";
import type { InventoryCard } from "../../utils/inventory";
import { playsetPlate } from "../../utils/variantScope";
import { ownedFinishBreakdown } from "./GalleryGrid";

interface Props {
  card: InventoryCard;
  /** Gates the count chip/pips visualization, the click-to-edit affordance,
   * and the hover dossier -- same isAuthenticated contract GalleryGrid's
   * console plate uses (CardsPage passes the same boolean to both views). */
  isAuthenticated: boolean;
  /** Opens the unified CardPopup for this card -- CardsTable wires this to
   * `onSelectInventory(card.base_card_id)`. */
  onOpen: () => void;
  /** Active finish scope, or null for "All variants". When set, the PIPS fill
   * from ONLY that variant's owned count; the count chip stays
   * total-owned/complete-green regardless of scope. Playset SIZE never
   * changes with scope. */
  scope: string | null;
}

/** The Cards table's merged Playset/Inventory cell: pips + an ALWAYS-shown
 * Russo One count chip, LEFT of the pips, + a click-to-edit affordance (opens
 * the card popup via onOpen) + a mouse-over dossier, same visual
 * pattern/classes as GalleryGrid's hover dossier. Playset completion
 * semantics come from utils/inventory.ts (getPlaysetSize / cardOwnedTotal /
 * isPlaysetComplete). ownedFinishBreakdown is IMPORTED from GalleryGrid, not
 * re-derived, so the table and gallery can never disagree about the
 * breakdown rules.
 *
 * Signed-out: em-dash in the chip slot, empty (unfilled) pips, and both the
 * hover dossier and the click-to-edit affordance disabled entirely --
 * editing requires auth. The Name cell already reaches the same popup (and
 * its "sign in to manage inventory" nudge) for anonymous visitors, so the
 * affordance isn't duplicated here. */
export function PlaysetCell({ card, isAuthenticated, onOpen, scope }: Props) {
  const [hovered, setHovered] = useState(false);
  const {
    size,
    owned,
    complete,
    scoped: isScoped,
    filled,
    scopedComplete,
  } = playsetPlate(card, scope, isAuthenticated);
  const showDossier = isAuthenticated && hovered;
  const breakdown = showDossier ? ownedFinishBreakdown(card) : [];

  const chipModifier = !isAuthenticated
    ? " playset-chip--signed-out"
    : complete
      ? " playset-chip--complete"
      : owned === 0
        ? " playset-chip--empty"
        : "";
  const totalClass = `gallery-plate__total${
    complete ? " gallery-plate__total--complete" : owned === 0 ? " gallery-plate__total--empty" : ""
  }`;

  return (
    <td
      className={`td-playset${isAuthenticated ? " td-playset--clickable" : ""}${
        scope != null ? " td-playset--scoped" : ""
      }`}
      onClick={isAuthenticated ? onOpen : undefined}
      title={isAuthenticated ? "Edit inventory" : undefined}
    >
      <span
        className={`playset${complete ? " playset--complete" : ""}${
          !isAuthenticated || owned === 0 ? " playset--empty" : ""
        }`}
      >
        {/* The hover dossier triggers on the COUNT CHIP only -- same
            hover-the-count behavior as the Variants column's .vt-button --
            not the whole cell (click-to-edit stays cell-wide). */}
        <span
          className={`playset-chip${chipModifier}`}
          onMouseEnter={isAuthenticated ? () => setHovered(true) : undefined}
          onMouseLeave={isAuthenticated ? () => setHovered(false) : undefined}
        >
          {isAuthenticated ? owned : "—"}
        </span>
        {/* Scoped pips are amber while the scoped variant is short of a
            playset (no plate); at scoped-COMPLETE the pips turn green inside
            an amber-outlined plate. Fill color is driven by CSS off the
            container's --scoped-complete class (cards.css), so the pip markup
            only carries --scoped. Unscoped rendering (isScoped false) has no
            plate class: plain filled/unfilled pips. */}
        <span
          className={`playset__pips${
            isScoped && scopedComplete ? " playset__pips--scoped-complete" : ""
          }`}
        >
          {Array.from({ length: size }).map((_, i) => {
            const isFilled = i < filled;
            return (
              <span
                key={i}
                className={`playset__pip${isFilled ? " playset__pip--filled" : ""}${
                  isScoped && isFilled ? " playset__pip--scoped" : ""
                }`}
              />
            );
          })}
        </span>
      </span>
      {showDossier && (
        <div className="gallery-dossier" role="tooltip">
          <div className="gallery-dossier__inner">
            <div
              className={`gallery-dossier__head${
                breakdown.length ? " gallery-dossier__head--with-rows" : ""
              }`}
            >
              {/* Scoped hover dossier head reads "OWNED — ALL VARIANTS": the
                  total is still the all-variants total, same totalClass/owned
                  as unscoped; only the label changes, to make clear the
                  number below it is NOT scope-narrowed even though the pips
                  above it are. */}
              <span className="gallery-dossier__label">
                {scope ? "OWNED — ALL VARIANTS" : "OWNED"}
              </span>
              <span className={totalClass}>
                {owned}
                <span className="gallery-plate__total-limit">/{size}</span>
              </span>
            </div>
            {breakdown.length === 0 ? (
              <div className="gallery-dossier__empty">NO COPIES OWNED</div>
            ) : (
              breakdown.map((entry) => (
                <div
                  key={entry.key}
                  className={`gallery-dossier__row${
                    entry.key === scope ? " gallery-dossier__row--scoped" : ""
                  }`}
                >
                  <span className="gallery-dossier__row-label">
                    {entry.key}
                    {entry.key === scope && (
                      <span className="gallery-dossier__row-scope-marker"> ◂ scope</span>
                    )}
                  </span>
                  <span className="gallery-dossier__row-qty">{entry.qty}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </td>
  );
}
