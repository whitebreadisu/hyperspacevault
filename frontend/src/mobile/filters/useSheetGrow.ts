import { useLayoutEffect } from "react";

// BL-248 S2-12 (R5 switch sheetfit=content; rev4 MFilters.jsx F-4
// M.watchSheetGrow): the content-fit Filters sheet never animates its height.
// A ResizeObserver on the sheet sees every height change after layout and
// before paint -- a render (Gameplay opened, chips added) or a set logo that
// arrives later. A growth starts the sheet at its previous top with
// translateY(<growth>) and lets the sheet's own `transition: transform 0.2s
// ease-out` carry it to none. A grow during a grow starts from where the
// sheet is drawn now. A shrink snaps (translating up would open a gap under a
// bottom-anchored sheet). Reduced motion: no transform at all.

const reducedMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Watch the `.m-sheet` that contains `anchor` (null until the sheet mounts). */
export function useSheetGrow(anchor: HTMLElement | null): void {
  useLayoutEffect(() => {
    const sheet = anchor?.closest<HTMLElement>(".m-sheet");
    if (!sheet || typeof ResizeObserver === "undefined") return undefined;
    let prev = sheet.getBoundingClientRect().height;
    const ro = new ResizeObserver(() => {
      const h = sheet.getBoundingClientRect().height;
      const d = Math.round(h - prev);
      prev = h;
      // A drag on the head owns the inline transform (Sheet.tsx); leave it.
      if (d < 1 || sheet.style.transform || reducedMotion()) return;
      const cur = new DOMMatrixReadOnly(getComputedStyle(sheet).transform).m42 || 0;
      sheet.style.transition = "none";
      sheet.style.transform = `translateY(${Math.round(d + cur)}px)`;
      sheet.getBoundingClientRect(); // commit the start position
      sheet.style.transition = "";
      sheet.style.transform = "";
    });
    ro.observe(sheet);
    return () => ro.disconnect();
  }, [anchor]);
}
