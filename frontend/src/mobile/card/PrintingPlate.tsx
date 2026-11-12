import type { InventoryVariant } from "../../utils/inventory";
import { scopeShortName } from "../../utils/variantScope";
import { GalleryPlate } from "../vault/GalleryPlate";
import { plateState } from "./cardDetailModel";

// ADR-0030, App Spec §25.2: the card-detail plate IS the gallery plate
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
//             printing's count, so it need not equal the stepper below it.
// Quantities are the shown ones, so a + / - tap moves the plate at once.
// There is no all-finishes state here: a printing is always selected. Signed
// out: the gallery's SIGN IN TO TRACK plate.

export function PrintingPlate({
  name,
  type,
  variants,
  scope,
  isAuthenticated,
  onClick,
  stashCount = false,
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
  /** The plate opens Owned by finish. */
  onClick?: () => void;
  /** A stash link's card (App Spec §19.1): the plate is the selected
   * printing's in-stash count alone -- no pips, no playset state, no
   * "owned", and it opens nothing. */
  stashCount?: boolean;
}) {
  if (stashCount) {
    const selected = variants.find((v) => (v.finish ?? v.variant_type) === scope);
    const qty = selected?.quantity ?? 0;
    return (
      <div
        className="m-plate-hit"
        data-plate-qty={qty}
        role="img"
        aria-label={`${name}: ${qty} in this stash`}
      >
        <GalleryPlate
          size={0}
          filled={0}
          scoped={false}
          complete={false}
          total={qty}
          totalComplete={false}
          isAuthenticated
        />
      </div>
    );
  }
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
