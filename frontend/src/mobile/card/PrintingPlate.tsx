import { getPlaysetSize } from "../../utils/inventory";

// BL-248 S2-03 (R5-5): the card-detail plate = rev4 MPlate `table`
// (MPrimitives.jsx:186-251; m-rev4.css:54-67) describing the SELECTED
// printing. Inside the steel-ring console frame (cards.css .gallery-plate,
// verbatim in vault.css): desktop's count chip + 10 px pips (PlaysetCell DOM
// and cards.css literals). Chip = the selected printing's count (neutral;
// --complete green at a playset; --empty muted at 0; --signed-out "—").
// Pips = that count in desktop's scoped idiom: amber filled while short of
// the playset (--scoped), green inside the amber-outlined plate at a
// playset (--scoped-complete). Playset size per card (1 leader/base, 3
// otherwise). No fraction, no scope marker.

export function PrintingPlate({
  type,
  qty,
  isAuthenticated,
}: {
  /** The base card's type (playset size). */
  type: string;
  /** The selected printing's (shown) quantity. */
  qty: number;
  isAuthenticated: boolean;
}) {
  const size = getPlaysetSize(type);
  const filled = isAuthenticated ? Math.min(size, qty) : 0;
  const complete = isAuthenticated && qty >= size;
  const empty = !isAuthenticated || qty === 0;
  const chipMod = !isAuthenticated
    ? " playset-chip--signed-out"
    : complete
      ? " playset-chip--complete"
      : qty === 0
        ? " playset-chip--empty"
        : "";
  return (
    <div className="m-plate-hit" data-plate-qty={isAuthenticated ? qty : undefined}>
      <span className="gallery-plate m-plate m-plate--table">
        <span className="gallery-plate__inner">
          <span
            className={
              "playset m-pips m-pips--chip" +
              (complete ? " playset--complete" : "") +
              (empty ? " playset--empty" : "")
            }
          >
            <span className={"playset-chip" + chipMod}>{isAuthenticated ? qty : "—"}</span>
            <span className={"playset__pips" + (complete ? " playset__pips--scoped-complete" : "")}>
              {Array.from({ length: size }, (_, i) => (
                <span
                  key={i}
                  className={
                    "playset__pip" +
                    (i < filled ? " playset__pip--filled playset__pip--scoped" : "")
                  }
                />
              ))}
            </span>
          </span>
        </span>
      </span>
    </div>
  );
}
