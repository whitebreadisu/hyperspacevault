// BL-121: pure tier-selection logic for the filter sidebar's vertical-
// responsive model (design_handoff_filter_vertical/README.md §2, "Option
// B — discrete snap, designed two-column"). Kept separate from
// FilterPanel.tsx so the avail -> tier decision is unit-testable without
// mounting the component (same split rationale as utils/filters.ts: pure
// logic here, UI wiring in the component).
//
// avail = window.innerHeight - CHROME_OFFSET; tier is picked by comparing
// avail against each tier's natural rendered height (H_*) plus a small
// margin absorbing font/wrap variance. No hysteresis -- comparisons are
// deterministic, so the same avail always yields the same tier.

export type FilterPanelTier = "full" | "compact" | "two-col" | "fallback";

// ── Measured constants ──────────────────────────────────────────────────
// Re-measured against the real running app (not the mirror's sample data)
// per README §2's instruction. Method: Playwright against the live
// docker-compose dev stack (localhost:5173, anonymous, real catalog/sets
// data), `.ifp-sidebar` mounted and settled (1.5s post-load). Raw
// measurements also recorded in the BL-121 PR description and
// learning_journal/Session_Notes_BL121_FilterVerticalTiers_2026-07-13.md.
//
// CHROME_OFFSET: `.ifp-sidebar__panel`'s `getBoundingClientRect().top`
// (constant across viewport heights -- nothing above the sidebar is
// viewport-height-dependent: app-header 101px + gap/separator 46px +
// InventorySummary 66px + gap 16px + the sidebar wrapper's own 8-9px
// absolute-position offset = 238px measured) plus an 8px breathing-room
// margin reserved below the panel = 246. (Confirmed the Firebase-emulator
// dev banner some sessions see is `position:fixed` pinned near the
// viewport BOTTOM -- it does not participate in this layout flow and does
// not skew the measurement.) This is ~106px taller than the exploration
// mirror's own instrumented 140 -- production carries a real app header +
// circuit separator + InventorySummary the standalone mirror harness
// didn't reproduce.
//
export const CHROME_OFFSET = 246;

// H_FULL / H_COMPACT / H_TWO: the panel's natural `scrollHeight` (real set
// list, real anonymous sign-in nudge under the toggles) at each tier's
// density, measured with the browser tall enough that the tier in question
// renders unclipped (`max-height`/`overflow` are `none`/`visible` in every
// non-fallback tier, so `scrollHeight` reads true content height with no
// cap to hide behind). Landed within ~2% of the mirror's own sample-data
// measurements (974/765/434) despite the very different CHROME_OFFSET --
// the panel's *internal* content height is largely independent of what's
// above it.
export const H_FULL = 995;
export const H_COMPACT = 786;
// Owner dev report 2026-07-24: `.ifp-sidebar__toprow` now wraps (FilterPanel
// .css) instead of clipping its Any/Within/Exact mode control past the
// panel's right edge -- at the two-col/fallback tier's 452px width, the
// mode control (~120px wide) doesn't fit alongside the search + 6 chits
// (140 + 188 + 20px of gaps = 348px used of the 430px content span, leaving
// only 82px, short of the control's ~120px) and wraps to its own second
// line. That second line adds real, rendered height that H_TWO (measured
// pre-fix, single-line toprow) didn't include: the wrapped line's own
// height (~20px for the mode control, the only thing on that line) plus
// the toprow's 10px row-gap between the two lines = ~30px. This is
// structural added content, not incidental font/wrap variance, so it's
// folded into the base measurement rather than MARGIN_TWO.
//
// BL-147 REVERT (2026-07-24, owner call, 32" monitor -- 125% was too much):
// the wrap-fix above was measured and folded in AFTER BL-147's x1.25 rescale
// (543 + 30 = 573, both terms in 125%-real-screen-px), so undoing the scale
// isn't a blind restore of the pre-147 434 -- that would silently drop the
// wrap-fix's real content-height addition. Instead each rescaled term is
// individually divided back by 1.25 and rounded (matching the forward
// rescale's own round-per-constant convention, confirmed by DOCKED_MIN_WIDTH
// round-tripping exactly: 2266 -> 2832.5 -> 2833 -> 2266.4 -> 2266): base
// 434 (543 / 1.25 = 434.4 -> 434, i.e. the original BL-121 measurement) +
// 24 (30 / 1.25 = 24, the wrap's 100%-scale content height) = 458.
export const H_TWO = 458;

const MARGIN_FULL = 16;
const MARGIN_COMPACT = 20;
const MARGIN_TWO = 22;

/** Pure avail -> tier decision (README §2's comparison ladder). */
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

// ── BL-144 (issue #356): docked/side-by-side breakpoint (width) ──────────
//
// Separate axis from the vertical tiers above (those are height-driven
// density/layout; this is the width-driven docked-vs-overlay choice from
// BL-129 R2). Mirrors FilterPanel.css's `@media (min-width: 1906px)`
// exactly -- see that rule's own comment for the full sidebar-width +
// gap + table-cap + padding arithmetic that derives 1906 (BL-179 round 5:
// retuned from the stale 2266, which still assumed the wrapper's original
// 1900px cap). Kept here as a plain exported constant (not read from the
// stylesheet -- a media query isn't introspectable from JS) so
// FilterPanel.tsx's initial-open decision, its hover-collapse exception,
// and the CSS docking rule stay pinned to the same number; if the CSS
// value ever changes, this one must be updated by hand alongside it.
export const DOCKED_MIN_WIDTH = 1906;

/** Pure innerWidth -> "does the docked sidebar + full-width table both fit
 * side by side" decision, used by FilterPanel to pick its initial open/
 * collapsed state (BL-144: collapsed below this width, unchanged -- open --
 * at or above it, matching the CSS docking breakpoint above). */
export function fitsSideBySide(innerWidth: number): boolean {
  return innerWidth >= DOCKED_MIN_WIDTH;
}

// BL-179 round 7 (owner): the docked state is defined on the sidebar's
// ONE-COLUMN format specifically -- "if the filter can be expanded in its
// one-column format and the screen still has room for the table with no
// overlap". Width alone can't guarantee that: the 1906px arithmetic above
// assumes the 278px full/compact-tier sidebar, but a SHORT viewport drops
// the tier to two-col/fallback (452px wide, height-driven -- see
// tierForViewportHeight), which the docked arithmetic deliberately never
// accounted for. So docking also requires the viewport to be tall enough
// that the tier is still one-column: avail >= H_COMPACT + MARGIN_COMPACT,
// i.e. innerHeight >= 786 + 20 + CHROME_OFFSET(246) = 1052. Mirrored by
// hand in TWO media queries (FilterPanel.css's docking rule, cards.css's
// overlay-pin scope) -- keep all three in sync.
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
