// BL-257 FR1-07: the console plate's markup (desktop GalleryGrid.tsx plate +
// PlateTotal; classes = cards.css .gallery-plate, verbatim in vault.css),
// drawn once for the two surfaces that show it: the Vault's gallery cell and
// the card detail. The callers decide the numbers; this draws them.
//   pips   -- `filled` of `size`, amber (--scoped) while `scoped`;
//   ring   -- green + the amber inner wash at `complete` (--complete);
//   total  -- `total`, green at `totalComplete`, muted at 0;
//   signed out -- SIGN IN TO TRACK.

export function GalleryPlate({
  size,
  filled,
  scoped,
  complete,
  total,
  totalComplete,
  isAuthenticated,
}: {
  /** The card's playset size (pip count). */
  size: number;
  /** Filled pips (already clamped to `size`). */
  filled: number;
  /** Filled pips take the amber scoped idiom. */
  scoped: boolean;
  /** The plate's complete state (green ring, green pips, amber inner wash). */
  complete: boolean;
  /** The owned number at the right. */
  total: number;
  /** The owned number is green (a playset). */
  totalComplete: boolean;
  isAuthenticated: boolean;
}) {
  const totalClass = totalComplete
    ? " gallery-plate__total--complete"
    : total === 0
      ? " gallery-plate__total--empty"
      : "";
  return (
    <span className={`gallery-plate m-plate${complete ? " gallery-plate--complete" : ""}`}>
      <span
        className={`gallery-plate__inner${isAuthenticated ? "" : " gallery-plate__inner--signed-out"}`}
      >
        {isAuthenticated ? (
          <>
            <span className="gallery-plate__pips">
              {Array.from({ length: size }).map((_, i) => {
                const isFilled = i < filled;
                return (
                  <span
                    key={i}
                    className={`gallery-plate__pip${isFilled ? " gallery-plate__pip--filled" : ""}${
                      scoped && isFilled ? " gallery-plate__pip--scoped" : ""
                    }`}
                  />
                );
              })}
            </span>
            <span className={`gallery-plate__total${totalClass}`}>{total}</span>
          </>
        ) : (
          <span className="gallery-plate__sign-in">SIGN IN TO TRACK</span>
        )}
      </span>
    </span>
  );
}
