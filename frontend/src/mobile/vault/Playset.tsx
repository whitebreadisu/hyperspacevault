import { cardOwnedTotal, getPlaysetSize, isPlaysetComplete } from "../../utils/inventory";
import type { InventoryCard } from "../../utils/inventory";
import { scopedOwnedCount, scopedPlaysetComplete } from "../../utils/variantScope";

// BL-247 S1-19: the row's count chip + pips -- desktop's DOM and rules, ported
// from screens/cards/PlaysetCell.tsx:54-130 (the cell's <td>, click-to-edit
// and hover dossier stay desktop-only; the row itself is the tap target).
// Chip = owned TOTAL only (never the scope): --complete at a playset (over
// included), --empty at 0, --signed-out "—" anonymous. Pips fill from the
// scoped finish's count while scoped (--scoped amber), green inside the amber
// plate at scoped-complete (--scoped-complete). No "n/m" anywhere.

export function Playset({
  card,
  scope,
  isAuthenticated,
}: {
  card: InventoryCard;
  scope: string | null;
  isAuthenticated: boolean;
}) {
  const size = getPlaysetSize(card.type);
  const owned = cardOwnedTotal(card.inventory);
  const complete = isAuthenticated && isPlaysetComplete(card.inventory, card.type);
  const isScoped = isAuthenticated && scope != null;
  const scopedOwned = scope ? scopedOwnedCount(card.variants, scope) : owned;
  const filled = isAuthenticated ? Math.min(size, isScoped ? scopedOwned : owned) : 0;
  const scopedComplete =
    isScoped && scope != null && scopedPlaysetComplete(card.variants, scope, card.type);
  const chipModifier = !isAuthenticated
    ? " playset-chip--signed-out"
    : complete
      ? " playset-chip--complete"
      : owned === 0
        ? " playset-chip--empty"
        : "";

  return (
    <span
      className={`playset${complete ? " playset--complete" : ""}${
        !isAuthenticated || owned === 0 ? " playset--empty" : ""
      }`}
    >
      <span className={`playset-chip${chipModifier}`}>{isAuthenticated ? owned : "—"}</span>
      <span
        className={`playset__pips${isScoped && scopedComplete ? " playset__pips--scoped-complete" : ""}`}
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
  );
}
