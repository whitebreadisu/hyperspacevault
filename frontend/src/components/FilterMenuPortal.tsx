import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";

// BL-147 dev-review fix (fix 6, BL-144-family finding): the filter
// sidebar's outer `.ifp-sidebar__ring` clips descendant paint to its own
// angled-corner polygon (design idiom, not accidental overflow -- see
// FilterPanel.css's own comment on that rule) -- any dropdown menu
// (MultiSelect.tsx / FinishFilter.tsx's shared `.ifp-multi__menu`) that
// would visually extend past the ring's bottom edge got cut off there
// instead of rendering in full. Same root cause class as BL-45's existing
// portal precedent for VariantsTooltip: an absolutely-positioned popover
// nested inside a clipping/overflow ancestor.
//
// Fix: portal the menu to `document.body` (`position: fixed`, coordinates
// computed from the trigger button's own `getBoundingClientRect()`) so it
// escapes the ring's clip-path -- and every other overflow/stacking
// ancestor -- entirely. Position is recomputed on open, window resize, and
// any scroll event (capture phase, so it also tracks the fallback tier's
// internal `.ifp-sidebar__scroll-region` scrolling).
//
// The portaled root carries FILTER_MENU_PORTAL_ATTR so FilterPanel.tsx's
// own outside-click handling (fix 5) -- and MultiSelect/FinishFilter's
// pre-existing per-field outside-click, which also breaks once its menu is
// no longer a DOM descendant of the field's own ref -- can both treat a
// click landing in the portaled menu as "inside" via
// isInsideFilterMenuPortal, without needing a second ref threaded through.
export const FILTER_MENU_PORTAL_ATTR = "data-ifp-menu-portal";

/** True if `target` is inside any portaled filter-menu root (or not an
 * Element at all, e.g. a synthetic event with a non-Element target -- never
 * treated as inside in that case). Shared by MultiSelect/FinishFilter's own
 * outside-click handling and FilterPanel's panel-level outside-click
 * (fix 5), so both agree on what counts as "still interacting with a
 * filter control" once menus are portaled. */
export function isInsideFilterMenuPortal(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${FILTER_MENU_PORTAL_ATTR}]`) !== null;
}

interface FilterMenuPortalProps {
  /** The trigger button (or any element) the menu should hang below and
   * match the width of -- typically `.ifp-multi__button`. */
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  /** The owning field's own label (MultiSelect/FinishFilter's `label` prop,
   * e.g. "Set", "Keywords") -- stamped onto the portaled root as
   * `data-ifp-field`. Multiple dropdowns can be open at once (no mutual-
   * exclusivity between fields), and every portaled menu now lands as a
   * sibling under `document.body` rather than nested under its own field's
   * `.ifp-field` -- this is what lets a test (or any future code) still
   * scope to "the menu belonging to field X" via
   * `[data-ifp-field="Set"]` instead of DOM containment. */
  fieldLabel: string;
  /** BL-173 review round 4 (owner): optional floor for the MENU's width,
   * independent of the trigger. The menu still matches the trigger's width
   * by default (`width: rect.width`); a larger minWidth lets content-heavy
   * menus (Finish's Prestige label + three chips on one row) render wider
   * than the sidebar control without touching the control itself. Safe to
   * widen rightward: the sidebar sits at the layout's left edge. */
  minWidth?: number;
  children: React.ReactNode;
}

/** Portals `.ifp-multi__menu` to `document.body` with `position: fixed`
 * coordinates derived from `anchorRef`'s own rect, so it always renders
 * flush against its trigger regardless of any clipping ancestor. Renders
 * nothing while closed or before the first position measurement. */
export function FilterMenuPortal({
  anchorRef,
  open,
  fieldLabel,
  minWidth,
  children,
}: FilterMenuPortalProps) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    update();
    window.addEventListener("resize", update);
    // Capture phase: catches scroll on any ancestor (e.g. the fallback
    // tier's internal .ifp-sidebar__scroll-region), not just window scroll.
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorRef]);

  if (!open || !rect) return null;

  return createPortal(
    <div
      className="ifp-multi__menu ifp-multi__menu--portal"
      role="listbox"
      aria-multiselectable="true"
      {...{ [FILTER_MENU_PORTAL_ATTR]: "true" }}
      data-ifp-field={fieldLabel}
      style={{ position: "fixed", left: rect.left, top: rect.top, width: rect.width, minWidth }}
    >
      {children}
    </div>,
    document.body
  );
}
