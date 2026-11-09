import { useLayoutEffect } from "react";
import type { RefObject } from "react";

/** The card image never shrinks below this (px tall). */
export const IMAGE_FLOOR_PX = 160;
/** Stash rows kept in view under the image, at most. */
const ROWS_IN_VIEW = 3;

/**
 * The card detail's centre column while the stash rows are open (owner
 * 2026-11-09): only the stash list scrolls, and a short window scales the
 * card image down -- keeping its shape -- instead of scrolling the column.
 *
 * Measured, not a fixed `100vh - N` sum, so a two-line title, the expanded
 * price history or a leader's flip button are all accounted for:
 *   room   = the shell's cap (its max-height) less everything in the shell
 *            that is not the body row (header, nav, history, the ring);
 *   image  = room less the column's padding and gaps, every other child
 *            (the flip button), the plate's pinned parts (stepper, readout,
 *            Vault row, New stash, Done, errors) and min(3, rows) stash rows
 *            -- or, when that would put the image under its floor, the
 *            list's own floor (two rows).
 * Written as the column's max-height and `--cp-image-hmax` (CardPopup.css
 * caps the image's width by it times the image's aspect). Below the 160 px
 * floor the column gets `cp-center--tight`: the plate keeps its full height
 * and the column scrolls, so New stash and Done are never clipped.
 *
 * Only while `.cp-stash__rows` is in the column: signed out, read mode, a
 * shared vault and the public card page keep the image's own size and the
 * stylesheet's column cap.
 */
export function useStashImageBudget(center: RefObject<HTMLElement | null>, deps: unknown[]): void {
  useLayoutEffect(() => {
    const el = center.current;
    if (!el) return undefined;
    const fit = () => applyBudget(el);
    fit();
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    window.addEventListener("resize", later);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(later);
    const shell = el.closest(".cp-shell");
    if (ro) {
      ro.observe(el);
      if (shell) ro.observe(shell);
    }
    // Opening or closing the rows, a stash added: measure again.
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(later);
    mo?.observe(el, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", later);
      ro?.disconnect();
      mo?.disconnect();
      clearBudget(el);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function clearBudget(el: HTMLElement): void {
  el.style.removeProperty("max-height");
  el.style.removeProperty("--cp-image-hmax");
  el.classList.remove("cp-center--tight", "cp-center--budget");
}

/** Measure the column and write its cap, the image budget and the tight
 * flag (see useStashImageBudget). */
function applyBudget(el: HTMLElement): void {
  const px = (v: string) => parseFloat(v) || 0;
  const h = (n: Element | null) => (n ? n.getBoundingClientRect().height : 0);
  const rows = el.querySelector<HTMLElement>(".cp-stash__rows");
  const scroll = rows?.querySelector<HTMLElement>(".cp-stash__scroll") ?? null;
  const shell = el.closest<HTMLElement>(".cp-shell");
  const body = el.parentElement;
  if (!rows || !scroll || !shell || !body) {
    clearBudget(el);
    return;
  }
  // Everything in the shell that is not the body row -- the ring, the
  // header, the nav, the price history, the body's own (negative) margin --
  // summed from the parts, so a clamped shell never hides any of it.
  const modal = body.parentElement;
  const cap = px(getComputedStyle(shell).maxHeight) || window.innerHeight;
  const ring = modal ? h(shell) - h(modal) : 0;
  const parts = modal
    ? (Array.from(modal.children) as HTMLElement[])
        .filter((k) => k !== body)
        .reduce((sum, k) => sum + h(k), 0)
    : 0;
  const bodyMargin = px(getComputedStyle(body).marginTop) + px(getComputedStyle(body).marginBottom);
  const room = Math.floor(cap - ring - parts - bodyMargin);
  const cs = getComputedStyle(el);
  const kids = Array.from(el.children) as HTMLElement[];
  const plate = el.querySelector<HTMLElement>(".cp-plate");
  const wrap = el.querySelector<HTMLElement>(".cp-image-wrap");
  const others = kids.filter((k) => k !== plate && k !== wrap).reduce((sum, k) => sum + h(k), 0);
  const gaps = px(cs.rowGap) * Math.max(0, kids.length - 1);
  // The plate's pinned parts, summed from the parts (the plate may already
  // be squeezed and clipping them): its ring, the inner's padding and gaps,
  // every inner child but the rows, and every row-block child but the list.
  const inner = plate?.querySelector<HTMLElement>(".cp-plate__inner") ?? null;
  const box = (n: HTMLElement) => {
    const c = getComputedStyle(n);
    return (
      px(c.paddingTop) +
      px(c.paddingBottom) +
      px(c.borderTopWidth) +
      px(c.borderBottomWidth) +
      px(c.rowGap) * Math.max(0, n.children.length - 1)
    );
  };
  const sumBut = (n: HTMLElement, skip: Element) =>
    (Array.from(n.children) as HTMLElement[])
      .filter((k) => k !== skip)
      .reduce((sum, k) => sum + h(k), 0);
  const plateRing = plate && inner ? h(plate) - inner.getBoundingClientRect().height : 0;
  const rowsBox = box(rows) + px(getComputedStyle(rows).marginTop) + sumBut(rows, scroll);
  const pinned = inner ? plateRing + box(inner) + sumBut(inner, rows) + rowsBox : h(plate);
  const stashRows = scroll.querySelectorAll(".cp-stash__row");
  const rowH = stashRows.length ? h(stashRows[0]) : 40;
  // Up to three rows under the image; when the image would go under its
  // floor, the rows give way first, down to the list's own floor (two rows).
  const want = Math.min(ROWS_IN_VIEW, stashRows.length) * rowH;
  const least = Math.min(want, px(getComputedStyle(scroll).minHeight) || 2 * rowH);
  const fixed = room - px(cs.paddingTop) - px(cs.paddingBottom) - gaps - others - pinned;
  const image = Math.max(fixed - want, Math.min(IMAGE_FLOOR_PX, fixed - least));
  el.style.maxHeight = `${room}px`;
  el.style.setProperty("--cp-image-hmax", `${Math.max(IMAGE_FLOOR_PX, Math.floor(image))}px`);
  el.classList.add("cp-center--budget");
  el.classList.toggle("cp-center--tight", fixed - least < IMAGE_FLOOR_PX);
}
