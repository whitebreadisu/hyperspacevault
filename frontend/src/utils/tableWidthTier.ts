// BL-226 (Issue #140, owner-locked design): pure logic for the Vault table's
// width-tier override -- three FIXED hide-only tiers (Compact/Standard/Full,
// CardsTable.tsx's TIER_COLUMN_KEYS is the single source of truth for which
// columns each one shows) plus an AUTO mode that picks the widest tier that
// fits the table's own measured wrapper width without horizontal scroll.
// Kept out of the components the same way utils/variantScope.ts's
// price-kind/value-display persistence is -- independently unit-testable,
// same utils/ split every other Cards-view calc uses.

/** The user-facing control's four positions. "auto" is the default and the
 * only value that engages the measured-width selection below; the other
 * three are a manual override that wins outright (CardsTable.tsx never
 * re-derives a manual choice from measured width). */
export type WidthTier = "auto" | "compact" | "standard" | "full";

// (The original ResolvedWidthTier type retired with the round-2 ladder
// rework -- resolution now lands on a step COUNT, not a tier name; the
// manual presets are ladder prefixes defined in CardsTable.tsx.)

// ── Width-tier persistence ───────────────────────────────────────────────
// AUTO is the default; a manual pick persists across visits via
// localStorage, the SAME pattern utils/variantScope.ts's loadPriceKind/
// savePriceKind (and CardsPage.tsx's handlePriceKindChange) already
// establish for the Market/Low switch: storage access is best-effort
// (private-mode/storage-denied environments just get the default), and a
// corrupt/absent stored value degrades to "auto" rather than throwing.

const WIDTH_TIER_STORAGE_KEY = "swu.cardsTable.widthTier";

export function loadWidthTier(): WidthTier {
  try {
    const stored = window.localStorage.getItem(WIDTH_TIER_STORAGE_KEY);
    return stored === "compact" || stored === "standard" || stored === "full" ? stored : "auto";
  } catch {
    /* storage unavailable -- degrade to the default */
    return "auto";
  }
}

export function saveWidthTier(tier: WidthTier): void {
  try {
    window.localStorage.setItem(WIDTH_TIER_STORAGE_KEY, tier);
  } catch {
    /* best-effort, same as loadPriceKind's own store */
  }
}

/** AUTO's selection rule -- owner revision (round 2, 2026-08-16): column-AT-
 * A-TIME, not tier-at-a-time. CardsTable.tsx defines a PRIORITY_LADDER of
 * escalation steps over a bare minimum (#/Name/Playset); `widthByStepCount`
 * is the cumulative natural width at each step count (index 0 = the bare
 * minimum alone, derived from COLUMN_WIDTHS -- never fresh magic numbers).
 * This returns the LARGEST step count whose width fits `availableWidth`
 * (the table wrapper's OWN measured content-box width via ResizeObserver --
 * deliberately NOT window.innerWidth; the sidebar's dock/float state makes
 * the two diverge).
 *
 * Exact-fit comparison (>=), no hysteresis: the narrowest single step is
 * the Set column's 70px, comfortably above resize jitter. Returns 0 (bare
 * minimum) when
 * even that doesn't fit -- a very narrow wrapper scrolls horizontally in
 * the bare minimum, same as the pre-BL-226 Full-only table did below its
 * own natural width. The manual Compact/Standard/Full presets are fixed
 * prefixes of the same ladder (CardsTable.tsx's TIER_STEP_COUNT) -- one
 * source of truth for both modes. */
export function selectAutoStepCount(
  availableWidth: number,
  widthByStepCount: readonly number[]
): number {
  for (let steps = widthByStepCount.length - 1; steps >= 1; steps--) {
    if (availableWidth >= widthByStepCount[steps]) return steps;
  }
  return 0;
}
