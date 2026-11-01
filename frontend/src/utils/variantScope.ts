// Pure logic for the Vault's variant-scope control (Playset header) + Value
// column (between Playset and Rarity), App Spec §5.14 and §5.16. Kept out of
// the components (CardsTable.tsx, PlaysetCell.tsx,
// screens/cards/VariantScopeControls.tsx, the phone vault) so the
// scope/price/persistence rules are independently unit-testable, following
// the same utils/ split every other Cards-view calc uses (inventory.ts,
// filters.ts, completion.ts).
//
// Raw finish values here are the SAME universe filters.ts's buildFinishTree
// works from (`v.finish ?? v.variant_type`): the literal finish/variant_type
// strings, e.g. "Hyperspace Foil", never abbreviated keys.

import type { InventoryCard, InventoryVariant } from "./inventory";
import { variantPriceValue } from "./completion";
import type { PriceMode } from "./completion";
import type { BaseCard, SetOrderMap } from "./catalog";
import { sortBaseCards, setReleaseRank } from "./catalog";
import { cardOwnedTotal, getPlaysetSize, isOwned, isPlaysetComplete } from "./inventory";
import { cardOverCap } from "./limits";
import type { LimitsMatrix } from "./limits";

export type { PriceMode };

// ── Price-kind persistence (App Spec §5.14) ─────────────────────────────────
// Market/Low toggle in the Value header. Market is the default; the choice
// persists across visits via localStorage, following the SAME
// degrade-gracefully shape as utils/headerStarfield.ts's
// applyHeaderStarfield: storage access is best-effort (private-mode/
// storage-denied environments just get the default), and a corrupt/absent
// stored value degrades to "market" rather than throwing. Scope itself is
// NEVER persisted (transient by design) -- there is no storage key for it
// anywhere in this file.

const PRICE_KIND_STORAGE_KEY = "swu.cardsValue.kind";

export function loadPriceKind(): PriceMode {
  try {
    const stored = window.localStorage.getItem(PRICE_KIND_STORAGE_KEY);
    return stored === "low" ? "low" : "market";
  } catch {
    /* storage unavailable -- degrade to the default */
    return "market";
  }
}

export function savePriceKind(kind: PriceMode): void {
  try {
    window.localStorage.setItem(PRICE_KIND_STORAGE_KEY, kind);
  } catch {
    /* best-effort, same as headerStarfield's own store */
  }
}

// ── Value display mode: Unit vs Collection (App Spec §5.14) ─────────────────
// The Value column header toggles between the unit price of one copy
// (cardValuePrice below) and the value of the viewer's OWNED copies of the
// row's card (cardCollectionValue). Persists like MKT/LOW (scope stays
// transient, this doesn't).

export type ValueDisplayMode = "unit" | "collection";

const VALUE_DISPLAY_STORAGE_KEY = "swu.cardsValue.display";

export function loadValueDisplay(): ValueDisplayMode {
  try {
    const stored = window.localStorage.getItem(VALUE_DISPLAY_STORAGE_KEY);
    return stored === "collection" ? "collection" : "unit";
  } catch {
    return "unit";
  }
}

export function saveValueDisplay(mode: ValueDisplayMode): void {
  try {
    window.localStorage.setItem(VALUE_DISPLAY_STORAGE_KEY, mode);
  } catch {
    /* best-effort */
  }
}

// ── Value column price (App Spec §5.14) ─────────────────────────────────────

/** The Value column's per-row price: the unit price of ONE copy of the
 * relevant printing (never price × quantity; that is COLLECTION mode).
 * - Scoped: the scoped variant's own price. `null` if the card carries no
 *   printing of that finish at all, or that printing is unpriced.
 * - Unscoped (`scope === null`, "All variants"): the card's Standard
 *   printing's price; when there is no Standard printing, or it's unpriced,
 *   falls back to the MINIMUM price (active kind) across the card's other
 *   priced printings -- consistent with the app's "cheapest =
 *   min-Low-across-variants" policy (App Spec §16.4). */
export function cardValuePrice(
  variants: Pick<InventoryVariant, "variant_type" | "finish" | "price">[],
  scope: string | null,
  kind: PriceMode
): number | null {
  if (scope) {
    const variant = variants.find((v) => (v.finish ?? v.variant_type) === scope);
    return variant ? variantPriceValue(variant, kind) : null;
  }
  const standard = variants.find((v) => v.variant_type === "Standard");
  const standardPrice = standard ? variantPriceValue(standard, kind) : null;
  if (standardPrice != null) return standardPrice;

  let min: number | null = null;
  for (const v of variants) {
    const price = variantPriceValue(v, kind);
    if (price == null) continue;
    if (min == null || price < min) min = price;
  }
  return min;
}

/** The Value column's per-row COLLECTION value:
 * what the viewer's owned copies of this card are worth, mirroring the
 * summary panel's Collection-value math (utils/completion.ts cardValue) at
 * row grain so the column visibly decomposes the header block's total.
 * - Unscoped: Σ over owned variants of qty × that variant's own price
 *   (active kind), unpriced variants falling back to the card's Standard
 *   price -- the completion.ts fallback chain exactly.
 * - Scoped: owned quantity OF THE SCOPED FINISH × that finish's own price
 *   (consistent with the scoped pips; deliberately NO fallback, matching
 *   scoped unit mode's no-fallback rule).
 * - `null` (renders as the em-dash) when the viewer owns no copies in
 *   scope, or owns copies but none contributed a price -- a computed $0.00
 *   would misread as "worthless" rather than "unpriced". */
export function cardCollectionValue(
  variants: Pick<InventoryVariant, "variant_type" | "finish" | "price" | "quantity">[],
  scope: string | null,
  kind: PriceMode
): number | null {
  if (scope) {
    const qty = scopedOwnedCount(variants, scope);
    if (qty <= 0) return null;
    const variant = variants.find((v) => (v.finish ?? v.variant_type) === scope);
    const price = variant ? variantPriceValue(variant, kind) : null;
    return price == null ? null : price * qty;
  }
  const standard = variants.find((v) => v.variant_type === "Standard");
  const standardPrice = standard ? variantPriceValue(standard, kind) : null;
  let value = 0;
  let priced = false;
  for (const v of variants) {
    const qty = v.quantity || 0;
    if (qty <= 0) continue;
    const effective = variantPriceValue(v, kind) ?? standardPrice;
    if (effective != null) {
      value += effective * qty;
      priced = true;
    }
  }
  return priced ? value : null;
}

/** Em-dash for an unpriced printing -- the same quiet state as the popup
 * rail. Prices >= $100 render as whole dollars ("$325", not "$325.00",
 * App Spec §5.14) -- the showcase-leader price range is exactly where the
 * cents stop earning their width in the compact Value column. Used by the
 * Vault table and the phone's card rows; the popup rail (CardPopupRail)
 * keeps its own always-cents format. */
export function formatCardValue(price: number | null): string {
  if (price == null) return "—";
  return price >= 100 ? `$${Math.round(price)}` : `$${price.toFixed(2)}`;
}

// ── Scoped pips (App Spec §5.14) ────────────────────────────────────────────

/** Owned copies of ONE finish, summed across every variant of the card that
 * carries it (there's normally exactly one, but this stays total rather than
 * find-first in case a future catalog wrinkle ever produces more than one
 * variant row sharing a raw finish value on the same card). Playset SIZE
 * never changes with scope -- only which owned count the pips fill from;
 * getPlaysetSize/isPlaysetComplete (utils/inventory.ts) still drive the
 * count chip. */
export function scopedOwnedCount(
  variants: Pick<InventoryVariant, "variant_type" | "finish" | "quantity">[],
  scope: string
): number {
  return variants
    .filter((v) => (v.finish ?? v.variant_type) === scope)
    .reduce((sum, v) => sum + (v.quantity || 0), 0);
}

/** The `#` column's scoped card number (App Spec §5.16) -- when a scope is
 * active and the card carries a
 * variant matching it, that variant's OWN `card_number` (early sets: e.g.
 * SOR Corellian Freighter Standard is "019", Hyperspace is "508" -- the two
 * finishes are genuinely different printings with different numbers).
 * FIRST match in `variants` order wins (same caveat as `scopedOwnedCount`
 * above -- normally exactly one variant carries a given raw finish, but this
 * stays find-first rather than asserting uniqueness). `null` when `scope` is
 * null (nothing to scope to) or the card has no printing of that finish --
 * either way the caller falls back to `base_card_number`. */
export function scopedCardNumber(
  variants: Pick<InventoryVariant, "variant_type" | "finish" | "card_number">[],
  scope: string | null
): string | null {
  if (!scope) return null;
  const variant = variants.find((v) => (v.finish ?? v.variant_type) === scope);
  return variant ? variant.card_number : null;
}

// ── Scoped completeness (App Spec §5.16) ────────────────────────────────────

/** Single source for "is the scoped finish's owned count a full playset" --
 * the plate's scoped completeness (playsetPlate below: amber plate, green
 * pips), the "incomplete playsets" Collection toggle
 * (applyCollectionToggles below) and the phone card detail all call it, so
 * they can never disagree. The threshold is the PLAYSET SIZE
 * (utils/inventory.ts's getPlaysetSize: 1 for Leaders/Bases, 3 otherwise)
 * -- the same concept the header completion panel computes against.
 *
 * The tenant's keep-limit matrix does NOT factor into playset completeness
 * anywhere -- the playset complete flag only cares about playset (App Spec
 * §5.16); keep-limits are an inventory-cap concept, deliberately separate
 * (see utils/limits.ts's own "do not merge the two" note, which this honors
 * for the scoped state exactly as the unscoped isPlaysetComplete does). */
export function scopedPlaysetComplete(
  variants: Pick<InventoryVariant, "variant_type" | "finish" | "quantity">[],
  scope: string,
  type: string
): boolean {
  return scopedOwnedCount(variants, scope) >= getPlaysetSize(type);
}

// ── Playset plate ───────────────────────────────────────────────────────────

/** What a card's playset pips and owned count show. `owned` and `complete`
 * are always the card's all-finishes total (the count chip and the plate
 * total never narrow with scope); while signed in with a scope active the
 * pips fill from the scoped finish's owned count and `scopedComplete` is
 * that count at a playset. `pipsComplete` is the plate's complete state:
 * scoped completion while scoped, else overall completion. Signed out
 * nothing fills and nothing is complete; the playset size never changes. */
export function playsetPlate(
  card: Pick<InventoryCard, "type" | "inventory" | "variants">,
  scope: string | null,
  isAuthenticated: boolean
) {
  const size = getPlaysetSize(card.type);
  const owned = cardOwnedTotal(card.inventory);
  const complete = isAuthenticated && isPlaysetComplete(card.inventory, card.type);
  const scoped = isAuthenticated && scope != null;
  const scopedOwned = scope ? scopedOwnedCount(card.variants, scope) : owned;
  const filled = isAuthenticated ? Math.min(size, scoped ? scopedOwned : owned) : 0;
  const scopedComplete =
    scoped && scope != null && scopedPlaysetComplete(card.variants, scope, card.type);
  return {
    size,
    owned,
    complete,
    scoped,
    filled,
    scopedComplete,
    pipsComplete: scoped ? scopedComplete : complete,
  };
}

// ── Collection toggles ──────────────────────────────────────────────────────

/** The four Collection toggles: applied filters that live outside FilterState. */
export interface CollectionToggles {
  incomplete: boolean;
  owned: boolean;
  unowned: boolean;
  overcap: boolean;
}

/** The cards the Collection toggles keep, in input order. Each toggle is an
 * independent per-card predicate. While a scope is active every predicate
 * reads the scoped finish (its owned count, its playset, its keep-limit)
 * instead of the card's total, so "cards I don't own" scoped to Hyperspace
 * keeps a card with three Standard copies and no Hyperspace one. "No
 * inventory" is mutually exclusive with "owned only" and with "over keep
 * limit": the shared toggle setter (vault/vaultModel.ts's withToggle) turns
 * the other off, because no card
 * can pass both. Combined anyway, each filter here still applies on its own
 * terms. */
export function applyCollectionToggles<T extends InventoryCard>(
  cards: T[],
  toggles: CollectionToggles,
  scope: string | null,
  limits: LimitsMatrix | null
): T[] {
  let result = cards;
  if (toggles.incomplete) {
    result = result.filter((c) =>
      scope
        ? !scopedPlaysetComplete(c.variants, scope, c.type)
        : !isPlaysetComplete(c.inventory, c.type)
    );
  }
  if (toggles.owned) {
    result = result.filter((c) =>
      scope ? scopedOwnedCount(c.variants, scope) > 0 : isOwned(c.inventory)
    );
  }
  if (toggles.unowned) {
    result = result.filter((c) =>
      scope ? scopedOwnedCount(c.variants, scope) === 0 : cardOwnedTotal(c.inventory) === 0
    );
  }
  if (toggles.overcap) {
    result = result.filter((c) => cardOverCap(c.variants, c.type, limits, scope));
  }
  return result;
}

// ── Scoped row order (App Spec §5.16) ───────────────────────────────────────

/** The Vault's default row order while a scope is active -- the SAME
 * set-release / tokens-last precedence `sortBaseCards` (utils/catalog.ts)
 * applies, but the final tiebreak compares the SCOPED variant's
 * `card_number` (via `scopedCardNumber` above) instead of `base_card_number`,
 * so the `#` column and the row order always agree while scoped. A card with
 * no printing of the scoped finish falls back to its own `base_card_number`
 * -- keeps the comparator total/deterministic even though such cards are
 * normally filtered out of view while a scope is engaged (engaging a scope
 * pins `FilterState.finish` to exactly that scope, vault/vaultModel.ts's
 * `withScope`) -- the array handed to this function can still contain them
 * pre-filter (buildVaultList sorts before it filters). `scope === null`
 * defers entirely to `sortBaseCards`. Same no-mutation contract as
 * `sortBaseCards` -- a fresh array via `slice().sort()`, input untouched. */
export function sortCardsByScope<T extends BaseCard>(
  cards: T[],
  setOrder: SetOrderMap = {},
  scope: string | null = null
): T[] {
  if (!scope) return sortBaseCards(cards, setOrder);

  return cards.slice().sort((a, b) => {
    const [aTier, aKey] = setReleaseRank(a.set_code, setOrder);
    const [bTier, bKey] = setReleaseRank(b.set_code, setOrder);
    if (aTier !== bTier) return aTier - bTier;
    if (aKey !== bKey) return aKey < bKey ? -1 : 1;

    if (a.is_token !== b.is_token) return Number(a.is_token) - Number(b.is_token);

    const aNumber = scopedCardNumber(a.variants, scope) ?? a.base_card_number;
    const bNumber = scopedCardNumber(b.variants, scope) ?? b.base_card_number;
    return aNumber.localeCompare(bNumber, undefined, { numeric: true });
  });
}

// ── Scope <-> Finish-filter interplay (App Spec §5.14) ──────────────────────

/** True iff `finish` is EXACTLY the single-value set a scope pick would have
 * produced (`Set([scope])`). vault/vaultModel.ts's withFilters (desktop
 * FilterPanel edits and the phone Filters sheet) uses this to decide
 * whether a `FilterState.finish` change came from the user editing the
 * Finish filter directly (which must disengage the scope: "scope drives
 * filter, never vice versa") versus an unrelated field changing (which
 * leaves `finish` untouched and must NOT disengage it). */
export function isFinishSetScopedTo(finish: Set<string>, scope: string): boolean {
  return finish.size === 1 && finish.has(scope);
}

// ── Scope menu option set (App Spec §5.14) ──────────────────────────────────
// 14 scopes + "All finishes": the pinned section (3 pair rows, Prestige's
// 3-chip group and the single-chip Showcase row) plus an expandable "Show
// all finishes…" tail (4 more single-chip rows). Values here are literal
// raw finish strings (== the exported variant_type values) -- they are NOT
// faceted against the live catalog (the option SET itself is fixed static
// config, not data-driven).

export interface ScopeChip {
  rawValue: string;
  label: string;
}

interface ScopePairRow {
  kind: "pair";
  key: string;
  label: string;
  chips: [ScopeChip, ScopeChip];
}

interface ScopeGroupRow {
  kind: "group";
  key: string;
  label: string;
  chips: ScopeChip[];
}

/** A one-value row drawn in the picker's own single-select idiom: the
 * label column plus ONE chip. `chips` keeps the pair/group shape, so every
 * row kind carries `chips` and no consumer needs a special case. The picker
 * has no check-box row: it is single-select (App Spec §5.14). */
interface ScopeSingleRow {
  kind: "single";
  key: string;
  label: string;
  chips: [ScopeChip];
}

export type ScopeMenuRow = ScopePairRow | ScopeGroupRow | ScopeSingleRow;

/* The pinned option set: Standard, Hyperspace, Prestige, Weekly Play, then
 * Showcase as the LAST pinned row -- visible without expanding, before the
 * divider and "Show all finishes…". Showcase is in the picker so a
 * collector can scope to Showcase leaders (App Spec §5.14, ADR-0030
 * amendment). It is a single-chip row -- the picker is single-select and
 * has no check-box row. Rows carry no "leaders · playset 1" annotations. */
export const SCOPE_PINNED_ROWS: ScopeMenuRow[] = [
  {
    kind: "pair",
    key: "Standard",
    label: "Standard",
    chips: [
      { rawValue: "Standard", label: "Non-foil" },
      { rawValue: "Standard Foil", label: "Foil" },
    ],
  },
  {
    kind: "pair",
    key: "Hyperspace",
    label: "Hyperspace",
    chips: [
      { rawValue: "Hyperspace", label: "Non-foil" },
      { rawValue: "Hyperspace Foil", label: "Foil" },
    ],
  },
  {
    kind: "group",
    key: "Prestige",
    label: "Prestige",
    chips: [
      { rawValue: "Standard Prestige", label: "Std" },
      { rawValue: "Foil Prestige", label: "Foil" },
      { rawValue: "Serialized Prestige", label: "Serialized" },
    ],
  },
  {
    kind: "pair",
    key: "Weekly Play",
    label: "Weekly Play",
    chips: [
      { rawValue: "Weekly Play", label: "Non-foil" },
      { rawValue: "Weekly Play Foil", label: "Foil" },
    ],
  },
  {
    kind: "single",
    key: "Showcase",
    label: "Showcase",
    chips: [{ rawValue: "Showcase", label: "Showcase" }],
  },
];

/* The four extra finishes behind "Show all finishes…": the same single-chip
 * row as Showcase (App Spec §5.14). The chip repeats the
 * row's full label, as Showcase's does: the longest ("Convention
 * Exclusive") fits one line beside its label at 390 px, so no short name. */
const singleRow = (rawValue: string): ScopeMenuRow => ({
  kind: "single",
  key: rawValue,
  label: rawValue,
  chips: [{ rawValue, label: rawValue }],
});

export const SCOPE_EXPANDED_ROWS: ScopeMenuRow[] = [
  singleRow("Convention Exclusive"),
  singleRow("Event Exclusive"),
  singleRow("Prerelease Promo"),
  singleRow("Movie Promo"),
];

/** Short display name for a raw scope value: the desktop header trigger
 * and bracket (e.g. "PIPS · HS Foil", "HS Foil - CARD # + PIPS + VALUE")
 * and the phone's scope chip and finish labels. */
export const SCOPE_SHORT_NAME: Record<string, string> = {
  Standard: "Standard",
  "Standard Foil": "Std Foil",
  Hyperspace: "Hyperspace",
  "Hyperspace Foil": "HS Foil",
  "Weekly Play": "Weekly Play",
  "Weekly Play Foil": "WP Foil",
  Showcase: "Showcase",
  "Standard Prestige": "Std Prestige",
  "Foil Prestige": "Foil Prestige",
  "Serialized Prestige": "Ser. Prestige",
  "Convention Exclusive": "Conv. Excl.",
  "Event Exclusive": "Event Excl.",
  "Prerelease Promo": "Prerelease",
  "Movie Promo": "Movie Promo",
};

export function scopeShortName(raw: string): string {
  return SCOPE_SHORT_NAME[raw] ?? raw;
}
