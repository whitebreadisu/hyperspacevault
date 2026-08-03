import { useState } from "react";
import { cardOwnedTotal, getPlaysetSize, isPlaysetComplete } from "../../utils/inventory";
import type { InventoryCard } from "../../utils/inventory";
import { scopedOwnedCount, scopedPlaysetComplete } from "../../utils/variantScope";
import { ownedFinishBreakdown } from "./GalleryGrid";

interface Props {
  card: InventoryCard;
  /** BL-111 F4/BL-162: gates the count chip/pips visualization, the
   * click-to-edit affordance, and the hover dossier -- same isAuthenticated
   * contract GalleryGrid's console plate already uses (see CardsPage, which
   * passes the same boolean to both views). */
  isAuthenticated: boolean;
  /** Opens the unified CardPopup for this card -- CardsTable wires this to
   * the same `onSelectInventory(card.base_card_id)` callback the retired
   * standalone Inventory column used to call directly. */
  onOpen: () => void;
  /** BL-173 (Definition_VariantScope_2026-07-26.md §1): active finish scope,
   * or null for "All variants" (today's behavior, unchanged). When set, the
   * PIPS fill from ONLY that variant's owned count -- the count chip stays
   * total-owned/complete-green exactly as today ("Count chip UNCHANGED").
   * Playset SIZE never changes with scope. */
  scope: string | null;
}

/** BL-162: the Cards table's merged Playset/Inventory cell. Two former
 * components are retired into this one (both moved from screens/inventory/,
 * whose only consumer was ever this table -- that location predated the
 * BL-56 unified Cards view and was never corrected):
 *   - VariantInventory.tsx (the standalone Inventory column's read-only
 *     "Label: N" chip list) -- deleted; its job is now the always-on count
 *     chip below.
 *   - the old PlaysetCell.tsx (pips + an overflow-only numeral) -- replaced
 *     by this file; playset completion semantics are unchanged
 *     (utils/inventory.ts's getPlaysetSize/cardOwnedTotal/isPlaysetComplete).
 *
 * New cell = pips + an ALWAYS-shown Russo One count chip, LEFT of the pips
 * (owner-saved design defaults invStyle="chip"/invAlwaysShow=true/
 * invNumLeft=true -- Definition_CosmeticsBatch_2026-07-26.md §0/§2) + the
 * Inventory cell's old click-to-edit affordance (same title, same onOpen
 * path) + a mouse-over dossier, same visual pattern/classes as GalleryGrid's
 * hover dossier -- ownedFinishBreakdown is IMPORTED from GalleryGrid, not
 * re-derived, so the table and gallery can never disagree about the
 * breakdown rules.
 *
 * Signed-out (Definition §2): em-dash in the chip slot, empty (unfilled)
 * pips, and both the hover dossier and the click-to-edit affordance
 * disabled entirely -- editing requires auth, and the old Inventory
 * column's anonymous behavior (click through to the unified popup as its
 * own "sign in to manage inventory" nudge) is retired along with the
 * column; the Name cell already reaches that same popup/nudge for
 * anonymous visitors, so the affordance isn't lost, just no longer
 * duplicated here. */
export function PlaysetCell({ card, isAuthenticated, onOpen, scope }: Props) {
  const [hovered, setHovered] = useState(false);
  const size = getPlaysetSize(card.type);
  const owned = cardOwnedTotal(card.inventory);
  const complete = isAuthenticated && isPlaysetComplete(card.inventory, card.type);
  const showDossier = isAuthenticated && hovered;
  const breakdown = showDossier ? ownedFinishBreakdown(card) : [];
  // BL-173: scoped pips fill from the scoped variant's own owned count, not
  // the total -- the chip above stays wired to `owned` (total), untouched.
  const isScoped = isAuthenticated && scope != null;
  const scopedOwned = scope ? scopedOwnedCount(card.variants, scope) : owned;
  const filled = isAuthenticated ? Math.min(size, isScoped ? scopedOwned : owned) : 0;
  // BL-195: the plate's complete/incomplete threshold comes from
  // scopedPlaysetComplete (utils/variantScope.ts) -- the SAME helper the
  // CardsPage "incomplete playsets" filter calls, so the two can never
  // disagree. Numerically identical to the old inline `scopedOwned >= size`
  // (the helper is playset-size-based -- owner decision, see its doc).
  const scopedComplete =
    isScoped && scope != null && scopedPlaysetComplete(card.variants, scope, card.type);

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
        {/* Owner dev review 2026-07-26 (round 2): the hover dossier triggers
            on the COUNT CHIP only -- same hover-the-count behavior as the
            Variants column's .vt-button -- not the whole cell (click-to-edit
            stays cell-wide, unchanged). */}
        <span
          className={`playset-chip${chipModifier}`}
          onMouseEnter={isAuthenticated ? () => setHovered(true) : undefined}
          onMouseLeave={isAuthenticated ? () => setHovered(false) : undefined}
        >
          {isAuthenticated ? owned : "—"}
        </span>
        {/* BL-173 (round 4 owner revision, final scheme): scoped pips are
            amber while the scoped variant is short of a playset (no plate);
            at scoped-COMPLETE the pips turn green inside an amber-outlined
            plate. Fill color is driven by CSS off the container's
            --scoped-complete class (cards.css), so the pip markup only
            carries --scoped. Unscoped rendering (isScoped false) is
            untouched: no plate class, plain filled/unfilled pips. */}
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
              {/* BL-173: scoped hover dossier head reads "OWNED — ALL
                  VARIANTS" (Definition §2) -- the total is still the
                  all-variants total, same totalClass/owned as unscoped; only
                  the label changes, to make clear the number below it is NOT
                  scope-narrowed even though the pips above it are. */}
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
