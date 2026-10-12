import type { InventoryVariant } from "../../utils/inventory";
import { scopeShortName } from "../../utils/variantScope";
import { GalleryPlate } from "../vault/GalleryPlate";
import { plateState } from "./cardDetailModel";

// BL-257 FR1-07 (owner decisions 2026-10-12, ADR-0030; supersedes the S2-03 /
// R5-5 chip-and-pips hybrid): the card-detail plate IS the gallery plate
// (vault/GalleryPlate, the markup the Vault's gallery cell draws) and it
// behaves EXACTLY like a gallery tile while the Vault is scoped to one finish,
// with the SELECTED printing's finish as that scope (cardDetailModel
// plateState = the helpers vault/GalleryCell.tsx calls):
//   pips   -- every owned printing of the selected printing's finish, summed,
//             against the card's playset size, amber (scoped); at a playset
//             of that finish the plate takes the complete state (green ring,
//             green pips, amber inner wash);
//   number -- the card's total owned across ALL printings (green when that
//             total is a playset, muted at 0). It is not the selected
//             printing's count, so it need not equal the stepper below it
//             (owner-accepted).
// Quantities are the shown ones, so a + / - tap moves the plate at once.
// First built the same day with the selected printing's own quantity for
// pips, ring and number; the owner changed it after the review (ADR-0030).
// There is no all-finishes state here: a printing is always selected. Signed
// out: the gallery's SIGN IN TO TRACK plate.

export function PrintingPlate({
  name,
  type,
  variants,
  scope,
  isAuthenticated,
  onClick,
}: {
  /** The card's name (the button's label). */
  name: string;
  /** The base card's type (playset size). */
  type: string;
  /** Every printing of the card, with the quantity to SHOW for each. */
  variants: InventoryVariant[];
  /** The selected printing's raw finish (`finish ?? variant_type`). */
  scope: string;
  isAuthenticated: boolean;
  /** S2-10: the plate opens Owned by finish (rev4 MPlate onClick). */
  onClick?: () => void;
}) {
  const s = plateState(variants, scope, type, isAuthenticated);
  const frame = (
    <GalleryPlate
      size={s.size}
      filled={s.filled}
      scoped={s.scoped}
      complete={s.pipsComplete}
      total={s.owned}
      totalComplete={s.totalComplete}
      isAuthenticated={isAuthenticated}
    />
  );
  // The number drawn (the card total) and the pips' source (the finish sum).
  const dataQty = isAuthenticated ? s.owned : undefined;
  const dataScoped = isAuthenticated ? s.scopedOwned : undefined;
  return onClick ? (
    <button
      type="button"
      className="m-plate-hit m-plate-hit--btn"
      onClick={onClick}
      aria-label={`${name}: ${s.owned} owned, ${s.scopedOwned} ${scopeShortName(scope)}. Show owned by finish`}
      data-plate-qty={dataQty}
      data-plate-scoped={dataScoped}
    >
      {frame}
    </button>
  ) : (
    <div className="m-plate-hit" data-plate-qty={dataQty} data-plate-scoped={dataScoped}>
      {frame}
    </div>
  );
}
