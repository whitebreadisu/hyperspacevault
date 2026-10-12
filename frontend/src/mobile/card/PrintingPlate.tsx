import { getPlaysetSize } from "../../utils/inventory";
import { GalleryPlate } from "../vault/GalleryPlate";

// BL-257 FR1-07 (owner decision 2026-10-12, ADR-0030; supersedes the S2-03 /
// R5-5 chip-and-pips hybrid): the card-detail plate IS the gallery plate
// (vault/GalleryPlate, the markup the Vault's gallery cell draws), in the
// state the gallery shows while the Vault is scoped to one finish -- with the
// SELECTED printing as that scope. Pips = the selected printing's count
// against the card's playset size, amber (scoped) while short; at a playset
// the plate takes the complete state (green ring, green pips, amber inner
// wash). The number at the right = the selected printing's count (green at a
// playset, muted at 0). There is no all-finishes state here: a printing is
// always selected. Signed out: the gallery's SIGN IN TO TRACK plate.

export function PrintingPlate({
  type,
  qty,
  isAuthenticated,
  onClick,
  label,
}: {
  /** The base card's type (playset size). */
  type: string;
  /** The selected printing's (shown) quantity. */
  qty: number;
  isAuthenticated: boolean;
  /** S2-10: the plate opens Owned by finish (rev4 MPlate onClick). */
  onClick?: () => void;
  label?: string;
}) {
  const size = getPlaysetSize(type);
  const complete = isAuthenticated && qty >= size;
  const frame = (
    <GalleryPlate
      size={size}
      filled={isAuthenticated ? Math.min(size, qty) : 0}
      scoped={isAuthenticated}
      complete={complete}
      total={qty}
      totalComplete={complete}
      isAuthenticated={isAuthenticated}
    />
  );
  const dataQty = isAuthenticated ? qty : undefined;
  return onClick ? (
    <button
      type="button"
      className="m-plate-hit m-plate-hit--btn"
      onClick={onClick}
      aria-label={label}
      data-plate-qty={dataQty}
    >
      {frame}
    </button>
  ) : (
    <div className="m-plate-hit" data-plate-qty={dataQty}>
      {frame}
    </div>
  );
}
