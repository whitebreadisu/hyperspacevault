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

/** What a WidthTier always resolves to once AUTO itself has been resolved --
 * the three tiers that actually decide which columns render. */
export type ResolvedWidthTier = "compact" | "standard" | "full";

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

/** AUTO's own selection rule: the widest tier whose natural column-width sum
 * (CardsTable.tsx's NATURAL_WIDTHS, derived from COLUMN_WIDTHS -- never a
 * fresh magic number here) fits inside `availableWidth` (the table wrapper's
 * OWN measured content-box width, via ResizeObserver -- CardsTable.tsx;
 * deliberately NOT window.innerWidth, see that component's own comment for
 * why the sidebar's dock/float state makes the two diverge).
 *
 * Exact-fit comparison (>=), no hysteresis band: Compact/Standard/Full's
 * natural widths are 700/1050/1538px -- 350px+ apart -- so a boundary
 * flicker between adjacent tiers is not a realistic concern at any window
 * size a user would actually rest on (a resize that crosses a tier boundary
 * has to cross hundreds of px, nowhere near the few-px jitter hysteresis
 * exists to damp). Falls through to Compact (the narrowest tier) when even
 * Compact's own sum doesn't fit -- there is no narrower tier to fall back
 * to, so a very narrow wrapper still scrolls horizontally in Compact, same
 * as the pre-BL-226 Full-only table already did below its own natural
 * width. */
export function selectAutoTier(
  availableWidth: number,
  naturalWidths: Record<ResolvedWidthTier, number>
): ResolvedWidthTier {
  if (availableWidth >= naturalWidths.full) return "full";
  if (availableWidth >= naturalWidths.standard) return "standard";
  return "compact";
}
