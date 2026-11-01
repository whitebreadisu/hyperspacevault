import type { InventoryCard } from "../../utils/inventory";
import { playsetPlate } from "../../utils/variantScope";

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
  const {
    size,
    owned,
    complete,
    scoped: isScoped,
    filled,
    scopedComplete,
  } = playsetPlate(card, scope, isAuthenticated);
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
