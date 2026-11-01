// Pure tier-selection logic for the filter sidebar's vertical-responsive
// model (App Spec §5.6, "Vertical behavior": discrete snap between tiers,
// with a designed two-column tier). Kept separate from FilterPanel.tsx so
// the avail -> tier decision is unit-testable without mounting the
// component (same split rationale as utils/filters.ts: pure logic here, UI
// wiring in the component).
//
// avail = window.innerHeight - CHROME_OFFSET; tier is picked by comparing
// avail against each tier's natural rendered height (H_*) plus a small
// margin absorbing font/wrap variance. No hysteresis -- comparisons are
// deterministic, so the same avail always yields the same tier.

export type FilterPanelTier = "full" | "compact" | "two-col" | "fallback";

// ── Measured constants ──────────────────────────────────────────────────
// Measured against the real running app: Playwright against the
// docker-compose dev stack (localhost:5173, anonymous, real catalog/sets
// data), `.ifp-sidebar` mounted and settled (1.5s post-load).
//
// CHROME_OFFSET: `.ifp-sidebar__panel`'s `getBoundingClientRect().top`
// (238px, constant across viewport heights -- nothing above the sidebar is
// viewport-height-dependent: app header, separator, InventorySummary and
// the sidebar wrapper's own offset) plus an 8px breathing-room margin
// reserved below the panel = 246. The Firebase-emulator dev banner is
// `position:fixed` near the viewport bottom, so it is outside this layout
// flow and does not skew the measurement.
//
export const CHROME_OFFSET = 246;

// H_FULL / H_COMPACT / H_TWO: the panel's natural `scrollHeight` (real set
// list, real anonymous sign-in nudge under the toggles) at each tier's
// density, measured with the browser tall enough that the tier in question
// renders unclipped (`max-height`/`overflow` are `none`/`visible` in every
// non-fallback tier, so `scrollHeight` reads true content height with no
// cap to hide behind).
export const H_FULL = 995;
export const H_COMPACT = 786;
// H_TWO = the measured two-column panel (434) + 24 for the wrapped toprow.
// `.ifp-sidebar__toprow` wraps (FilterPanel.css) instead of clipping its
// Any/Within/Exact mode control past the panel's right edge: at the
// two-col/fallback tier's 452px width the mode control doesn't fit beside
// the search + 6 chits and wraps to its own second line. That line (the
// mode control's height plus the toprow's row-gap) is structural added
// content, not incidental font/wrap variance, so it's folded into the base
// measurement rather than MARGIN_TWO.
export const H_TWO = 458;

const MARGIN_FULL = 16;
const MARGIN_COMPACT = 20;
const MARGIN_TWO = 22;

/** Pure avail -> tier decision: the first tier whose height + margin fits. */
export function tierForAvail(avail: number): FilterPanelTier {
  if (avail >= H_FULL + MARGIN_FULL) return "full";
  if (avail >= H_COMPACT + MARGIN_COMPACT) return "compact";
  if (avail >= H_TWO + MARGIN_TWO) return "two-col";
  return "fallback";
}

/** Convenience wrapper: viewport height -> tier, applying CHROME_OFFSET. */
export function tierForViewportHeight(innerHeight: number): FilterPanelTier {
  return tierForAvail(innerHeight - CHROME_OFFSET);
}

// ── Docked/side-by-side breakpoint (width) ───────────────────────────────
//
// Separate axis from the vertical tiers above (those are height-driven
// density/layout; this is the width-driven docked-vs-overlay choice,
// App Spec §5.15). Mirrors FilterPanel.css's `@media (min-width: 1918px)`
// exactly -- see that rule's own comment for the full sidebar-width +
// gap + table-cap + padding arithmetic that derives 1918. Kept here as a
// plain exported constant (not read from the
// stylesheet -- a media query isn't introspectable from JS) so
// FilterPanel.tsx's initial-open decision, its hover-collapse exception,
// and the CSS docking rule stay pinned to the same number; if the CSS
// value ever changes, this one must be updated by hand alongside it.
export const DOCKED_MIN_WIDTH = 1918;

/** Pure innerWidth -> "does the docked sidebar + full-width table both fit
 * side by side" decision, used by FilterPanel to pick its initial open/
 * collapsed state (collapsed below this width, open at or above it,
 * matching the CSS docking breakpoint above). */
export function fitsSideBySide(innerWidth: number): boolean {
  return innerWidth >= DOCKED_MIN_WIDTH;
}

// The docked state is defined on the sidebar's ONE-COLUMN format
// specifically: the filter expands in its one-column format and the screen
// still has room for the table with no overlap (App Spec §5.15). Width
// alone can't guarantee that: the 1918px arithmetic above
// assumes the 278px full/compact-tier sidebar, but a SHORT viewport drops
// the tier to two-col/fallback (452px wide, height-driven -- see
// tierForViewportHeight), which the docked arithmetic deliberately never
// accounted for. So docking also requires the viewport to be tall enough
// that the tier is still one-column: avail >= H_COMPACT + MARGIN_COMPACT,
// i.e. innerHeight >= 786 + 20 + CHROME_OFFSET(246) = 1052. Mirrored by
// hand in TWO media queries (FilterPanel.css's docking rule, and its
// inverse, cards.css's overlay-pin scope) -- keep all three in sync.
export const DOCKED_MIN_HEIGHT = H_COMPACT + MARGIN_COMPACT + CHROME_OFFSET;

/** Pure viewport -> "dock the one-column sidebar beside the full-width
 * table" decision: wide enough for the pair AND tall enough that the
 * sidebar's tier is still one-column (full/compact). Drives FilterPanel's
 * initial open state, its docked-vs-overlay behavior split (auto-expand on
 * entering this state; hover-collapse only outside it), and mirrors the
 * CSS docking media query. */
export function fitsDockedViewport(innerWidth: number, innerHeight: number): boolean {
  return fitsSideBySide(innerWidth) && innerHeight >= DOCKED_MIN_HEIGHT;
}
