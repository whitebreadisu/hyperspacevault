import "@testing-library/jest-dom";

// BL-95: cross-tab sync tests (AuthContext / VerifyEmailAction) use a real
// BroadcastChannel to exercise genuine ping/pong round-trips instead of a
// hand-rolled fake. No polyfill is needed here: vitest's jsdom environment
// runs on Node, and Node's own global `BroadcastChannel` (available since
// Node 18, spec-compliant WHATWG delivery semantics) comes through
// unshadowed -- confirmed present at test time even though jsdom itself
// implements no BroadcastChannel of its own.

// BL-44 Slice C: CardsTable virtualizes its rows with @tanstack/react-virtual,
// which measures its scroll container via element.offsetWidth/offsetHeight
// (see observeElementRect in @tanstack/virtual-core) as soon as the
// container mounts. jsdom has no layout engine and always reports 0 for
// both, which would make the virtualizer see a 0px viewport and render zero
// rows in every test that renders CardsTable/CardsPage -- non-deterministic,
// effectively-empty test output through no fault of the component. Fixed
// non-zero values give every test a stable, known windowful of rows without
// per-test mocking. No other component/test in this suite reads
// offsetWidth/offsetHeight, so this is a safe global default.
Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  value: 600,
});
Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
  configurable: true,
  value: 1200,
});

// BL-121: FilterPanel's vertical-tier model (utils/filterPanelTiers.ts)
// reads window.innerHeight on mount and on resize to pick a density/layout
// tier (full/compact/two-col/fallback). jsdom's own default (768) would
// silently land every pre-existing FilterPanel/CardsPage test in a shorter
// tier than the single-column layout they were written against. Default to
// a comfortably tall value so every test lands in FULL unless it
// deliberately overrides window.innerHeight and fires a resize event --
// BL-121's own tier tests do exactly that.
Object.defineProperty(window, "innerHeight", {
  configurable: true,
  writable: true,
  value: 1400,
});

// BL-144 (issue #356): FilterPanel now reads window.innerWidth once at
// mount to pick its initial open/collapsed state -- collapsed below the
// docked side-by-side breakpoint (utils/filterPanelTiers.ts's
// DOCKED_MIN_WIDTH; mirrors FilterPanel.css's own media query), open at/
// above it. jsdom's own default (1024) sits below that threshold, which
// would silently flip every pre-existing FilterPanel/CardsPage test
// (written against the sidebar starting open) into the new collapsed
// branch. Default to a value comfortably at/above the breakpoint so those
// tests keep exercising the "at/above breakpoint: unchanged" path
// unmodified; BL-144's own tests override window.innerWidth (and fire a
// resize event) to exercise the below-breakpoint / user-toggle branches
// deliberately, the same pattern the innerHeight default above already
// established for BL-121's vertical tiers.
Object.defineProperty(window, "innerWidth", {
  configurable: true,
  writable: true,
  value: 2400,
});

// BL-192: jsdom implements no scroll layout, so it has no scrollIntoView at
// all (unlike offsetHeight/offsetWidth above, which jsdom DOES define, just
// always at 0) -- the card popup's up/down variant-cycle keyboard shortcut
// calls it on the newly active rail row, which throws "not a function" under
// jsdom without this stub. A no-op is sufficient: no test in this suite
// asserts actual scroll position, only that the call happens (see
// CardPopup.test.tsx's BL-192 describe block).
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
