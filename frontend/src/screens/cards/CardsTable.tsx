import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { parseCardDisplay } from "../../utils/catalog";
import { AspectIcon } from "../../components/AspectIcon";
import { StatBadge } from "../../components/StatBadge";
import { RarityBadge } from "../../components/RarityBadge";
import { VariantsTooltip } from "../../components/VariantsTooltip";
import { PlaysetCell } from "./PlaysetCell";
import { SortHeaderButton } from "./SortHeaderButton";
import {
  CardsScopeTrigger,
  CardsValueDisplayToggle,
  CardsValueKindToggle,
} from "./VariantScopeControls";
import {
  cardCollectionValue,
  cardValuePrice,
  formatCardValue,
  scopeShortName,
  scopedCardNumber,
} from "../../utils/variantScope";
import type { PriceMode, ValueDisplayMode } from "../../utils/variantScope";
import type { InventoryCard } from "../../utils/inventory";
import { DEFAULT_SORT_STATE, ariaSortValue } from "../../utils/cardSort";
import type { SortColumn, SortState } from "../../utils/cardSort";
import { selectAutoStepCount } from "../../utils/tableWidthTier";
import type { WidthTier } from "../../utils/tableWidthTier";

const ASPECTS = ["Vigilance", "Command", "Aggression", "Cunning", "Heroism", "Villainy"] as const;

/** BL-44 Slice C (ADR-0005): fixed pixel widths for every §5.5 column, in
 * column order. The table uses `table-layout: fixed` (cards.css) driven by
 * this <colgroup>, instead of the browser's default auto-layout that
 * re-measures column widths from whichever rows currently happen to be in
 * the DOM. That auto-measurement is what would otherwise make columns
 * visibly jitter width as the virtualizer swaps rows in and out while
 * scrolling -- fixed widths make column width independent of which rows are
 * mounted. Values are guided by the pre-virtualization CSS min-widths (Name
 * ~200px) padded slightly for the rest; they are ratios, table-layout: fixed
 * stretches all of them proportionally to fill the wrapper's width. BL-129
 * R8 (Jeremy's dev review) re-introduces a cap on that stretch --
 * `.data-table-wrapper`'s `max-width` in cards.css now bounds how wide the
 * wrapper itself can get, so at very wide/ultrawide viewports the
 * proportional stretch tops out instead of ballooning the Name↔Variants/
 * Aspect↔Type/Keyword↔Arena gaps this ratio scheme produces past a certain
 * width. Below that cap, behavior is unchanged (full-width proportional
 * fill, the narrow-viewport density Jeremy likes).
 * Flag for visual tuning on dev: Trait and Keyword can hold long
 * comma-joined lists and are the columns most likely to feel cramped.
 * BL-129 R8: Cost/Power/HP are equal (60 each) so the three StatBadges --
 * left-aligned within their cells, flush after each cell's fixed 12px left
 * padding (cards.css) -- land the same visual distance apart; unequal column
 * widths previously meant the gap after a narrower column was
 * proportionally smaller than after a wider one (cost→power was measurably
 * tighter than power→HP).
 * BL-162: the standalone Inventory column is retired (its job moves into the
 * merged Playset cell, PlaysetCell.tsx) -- 15 columns become 14. Per the
 * design's COLUMN_WIDTHS (Definition_CosmeticsBatch_2026-07-26.md §2),
 * Playset widens 96->128 and Rarity widens 90->128 to hold the new chip and
 * the BL-161 symbol+label respectively; every other width (including the
 * BL-129 R8 equal Cost/Power/HP triple above) carries over unchanged -- the
 * design canvas's own raw array has a stale pre-R8 60/64/56 split for those
 * three (the canvas mirror predates that fix and the Definition's prose only
 * calls out Playset/Rarity widening), so this deliberately does NOT copy
 * that part verbatim.
 * BL-173 (Definition_VariantScope_2026-07-26.md §1/§3): a new Value column
 * lands between Playset and Rarity -- 14 columns become 15. It's a compact
 * right-aligned mono price cell (like Cost/Power/HP's StatBadge columns, not
 * a wide text column).
 * BL-173 owner dev review round 1 (2026-07-27): Cost/Power/HP 60->52 each
 * ("closer together"), superseding the BL-129 R8 note above: the equal-gap
 * goal is now met by CENTERING the th text and StatBadges in all three
 * columns (.th-stat / .td-stat) rather than by flush-left alignment, so
 * equal widths still give equal visual rhythm at the tighter size.
 * Round 2: Unit Value stacked (toggle ABOVE the label) -- the column only
 * needs max(toggle, "UNIT VALUE" label, "$xxx.xx" prices) + th padding.
 * Round 3 (owner): 108 -> 100 -- the widest real price is "$xxx.xx" (~53px
 * mono) and the true floor is the header's own MKT/LOW toggle (~68px) +
 * th padding.
 * Round 4 (owner): Unit Value 100 -> 90 -- possible only because the Value
 * th/td got their own tightened side padding (.th-value/.td-value,
 * cards.css) so the toggle still clears; Aspect 140 -> 108 (at most two
 * 20px icons + gap never needed 140).
 * Round 4 tail (owner, dialed live on the local loop): Unit Value 90 ->
 * 102 with the price text pulled 38px off the column's right edge -- the
 * air sits BETWEEN the value and Rarity, where the owner wanted it. The
 * in-header bracket overlay's width (.vs-bracket--inhead, cards.css)
 * mirrors Playset+Value = 128+102 -- retune it with these.
 * Round 5 (owner bug report): a fixed-layout table can NEVER render
 * narrower than this array's sum -- narrower wrappers scroll horizontally
 * instead (measured headlessly: overflow = sum - client, at every viewport
 * below sum + insets). BL-173's net +44px (1526 -> 1570) pushed the
 * natural width just past the owner's window, birthing a sliver
 * scrollbar. Reclaimed the 44px from six low-risk columns (# 56->50,
 * Variants 92->86, Name 220->210, Trait 150->144, Keyword 190->180,
 * Arena 80->74 -- all ellipsis-guarded or short content), restoring the
 * long-proven 1526 natural width. The BL-173 columns (Playset/Unit
 * Value/stats/Aspect) keep their owner-dialed widths untouched.
 * Owner-dialed 2026-07-31 (Unit/Collection switch round): Value 102 -> 114
 * so the large COLLECTION switch (96px track, 0.08em in-track label) clears
 * the th's own 6px side padding, both header rows centered. Docking
 * breakpoints and the cards.css cap trio retuned +6 net in the same round
 * (1906 -> 1918, 1540 -> 1552; MARKET/LOW switch sits LEFT of the Value label).
 * SYNC RULE: the sum of these widths (1538) + 2px wrapper border = 1540,
 * + 12px scrollbar-gutter allowance = 1552 must match the THREE 1552px
 * values in cards.css (.inv-summary max-width / .cards-content flex-basis /
 * .data-table-wrapper max-width) -- retune all three whenever this array
 * changes, or the wrapper cap either stretches columns or grows a
 * horizontal scrollbar (which is exactly what happened when BL-173's +92px
 * landed without retuning).
 * BL-226 (Issue #140, owner-locked design): three FIXED hide-only width
 * tiers (Compact/Standard/Full, TIER_COLUMN_KEYS below) join the always-
 * full-15 table this array has driven since BL-56 -- Full IS this array
 * unchanged, Compact/Standard are subsets of it (never new widths of their
 * own; a hidden column's width simply isn't summed for that tier). The SYNC
 * RULE above stays keyed to the FULL sum (1538) alone -- a CONSERVATIVE
 * judgment call, not an oversight: reworking the wrapper/content/summary cap
 * trio and the FilterPanel docking breakpoint (both below) to vary per-tier
 * would cascade through cards.css's layout math for a cosmetic gain (a
 * narrower tier's columns proportionally stretch to fill up to the
 * FULL-sized cap on a wide-enough viewport, same `table-layout: fixed`
 * stretch behavior the Full tier already exhibits above its own natural
 * width -- not a new failure mode, just a wider range it now applies over).
 * No functional cost: the cap only ever bounds width, so a narrower tier
 * never scrolls or overflows because of it. See WIDTH_BY_STEP_COUNT below
 * for the per-step sums this DOES drive (the AUTO-selection fit test). */
const COLUMN_WIDTHS = [50, 210, 86, 128, 114, 128, 108, 90, 52, 52, 52, 144, 180, 74, 70];

/** BL-226 (Issue #140, owner-locked design): the fifteen columns in the same
 * left-to-right order as COLUMN_WIDTHS above -- the two arrays are index-
 * paired, never maintained independently. This is the "same source of
 * truth" the width tiers below are required to derive from, not a second
 * list of magic numbers. */
const COLUMN_KEYS = [
  "number",
  "name",
  "variants",
  "playset",
  "value",
  "rarity",
  "aspect",
  "type",
  "cost",
  "power",
  "hp",
  "trait",
  "keyword",
  "arena",
  "set",
] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];

const WIDTH_BY_KEY: Record<ColumnKey, number> = Object.fromEntries(
  COLUMN_KEYS.map((key, i) => [key, COLUMN_WIDTHS[i]])
) as Record<ColumnKey, number>;

/** BL-226 round 2 (owner, 2026-08-16 -- supersedes the original three fixed
 * tiers for AUTO): column-AT-A-TIME escalation. The bare minimum is
 * #/Name/Playset; each ladder step adds columns in the OWNER's priority
 * order whenever the measured width permits (reducing runs the same ladder
 * backwards -- his framing: "reducing from compact: value, set, rarity").
 * Cost/Power/HP and Trait/Keyword move as atomic sets (owner spec -- no
 * partial-stats states). Column ORDER on screen is always the canonical
 * COLUMN_KEYS order above; the ladder only decides VISIBILITY, never order.
 * The manual Compact/Standard/Full presets are fixed PREFIXES of this same
 * ladder (TIER_STEP_COUNT below) -- one source of truth for both modes, and
 * both the header row and body row map over the SAME `visible` Set derived
 * from it, so header and cell rendering can never drift apart. */
const BASE_COLUMN_KEYS: readonly ColumnKey[] = ["number", "name", "playset"];
const PRIORITY_LADDER: readonly (readonly ColumnKey[])[] = [
  ["rarity"],
  ["set"],
  ["value"], // ← 3 steps in = the Compact preset
  ["aspect"],
  ["variants"],
  ["cost", "power", "hp"], // ← 6 steps in = the Standard preset
  ["type"],
  ["arena"],
  ["trait", "keyword"], // ← all 9 = the Full preset (today's table)
];

const TIER_STEP_COUNT: Record<Exclude<WidthTier, "auto">, number> = {
  compact: 3,
  standard: 6,
  full: PRIORITY_LADDER.length,
};

/** BL-226 round 2: cumulative natural width at each ladder step count --
 * index 0 = the bare minimum alone (388), last = Full's long-standing 1538
 * (the same sum the cards.css SYNC RULE tracks). Derived purely from
 * COLUMN_WIDTHS above; fed to selectAutoStepCount (utils/tableWidthTier.ts)
 * as AUTO's fit test against the measured wrapper width below. */
const WIDTH_BY_STEP_COUNT: readonly number[] = (() => {
  const widths: number[] = [BASE_COLUMN_KEYS.reduce((sum, key) => sum + WIDTH_BY_KEY[key], 0)];
  for (const step of PRIORITY_LADDER) {
    widths.push(widths[widths.length - 1] + step.reduce((sum, key) => sum + WIDTH_BY_KEY[key], 0));
  }
  return widths;
})();

/** Estimated row height in px, used only to seed the virtualizer's scroll
 * math (total scroll height + which rows are "in view"). It is an estimate,
 * not a hard row height -- rows still lay out at their natural height
 * (unaffected for the vast majority of rows; a wrapped subtitle can make a
 * row modestly taller), so a row being taller than this estimate cannot
 * cause visual overlap, only a small amount of scrollbar-length drift over a
 * very long scroll. Flag for visual tuning on dev if that drift becomes
 * noticeable. */
const ESTIMATED_ROW_HEIGHT = 34;
const OVERSCAN = 10;

interface Props {
  cards: InventoryCard[];
  /** code -> full set name, built from getSets(); passed through to VariantsTooltip. */
  setNameByCode: Record<string, string>;
  /** BL-162: gates the Playset cell's count/pips, click-to-edit affordance,
   * and hover dossier -- same isAuthenticated contract GalleryGrid already
   * takes from CardsPage. */
  isAuthenticated: boolean;
  onSelectCard: (baseCardId: number) => void;
  onSelectInventory: (baseCardId: number) => void;
  /** BL-173 (Definition_VariantScope_2026-07-26.md §1): active finish scope
   * for the Playset pips + Value column, or null for "All variants" (today's
   * behavior). Owned by CardsPage, which also drives FilterState.finish from
   * the same value -- see utils/variantScope.ts. Optional/defaulted (same
   * "default = today's unaffected behavior" idiom CardsPage's own
   * isEmailVerified prop uses) so every pre-existing test/call site that
   * doesn't care about scoping keeps compiling and rendering unscoped. */
  scope?: string | null;
  onScopeChange?: (raw: string | null) => void;
  /** BL-173: active Market/Low kind for the Value column -- persisted by
   * CardsPage via utils/variantScope.ts's load/savePriceKind. Same
   * optional/defaulted idiom as `scope` above. */
  priceKind?: PriceMode;
  onPriceKindChange?: (kind: PriceMode) => void;
  /** Owner request 2026-07-31: Unit vs Collection display for the Value
   * column -- persisted by CardsPage via load/saveValueDisplay, same idiom
   * as priceKind above. */
  valueDisplay?: ValueDisplayMode;
  onValueDisplayChange?: (mode: ValueDisplayMode) => void;
  /** BL-213 (Issue #122): the active single-column sort -- owned/persisted
   * (session-only, never localStorage) by CardsPage, applied to the row list
   * before it ever reaches this component (utils/cardSort.ts's sortCards).
   * CardsTable only renders the resulting header affordances (aria-sort +
   * the direction indicator) and reports clicks back up; it holds no sort
   * state of its own. Optional/defaulted to the same "# ascending is the
   * default order" state CardsPage itself initializes, same idiom every
   * other optional prop here uses so pre-existing call sites/tests keep
   * rendering unaffected. */
  sortState?: SortState;
  onSortChange?: (column: SortColumn) => void;
  /** BL-226 (Issue #140): the user's width-tier preference -- "auto" (the
   * default) resolves via measured available width below; a manual pick
   * (compact/standard/full) wins outright and is never re-derived from
   * measurement. Owned/persisted by CardsPage (utils/tableWidthTier.ts's
   * load/saveWidthTier), same optional/defaulted idiom as every other prop
   * here so every pre-existing call site/test keeps rendering the Full tier
   * unaffected (see WIDTH_BY_STEP_COUNT/measuredWidth below for why the
   * default pre-measurement state also resolves to Full). */
  widthTier?: WidthTier;
}

/** Unified Cards table (BL-56 §5.5) -- merges the old CatalogPage table and
 * InventoryTable into a single authenticated-view table. Column order is
 * fixed by the spec: # · Name · Variants · Playset · Rarity · Aspect · Type ·
 * Cost · Power · HP · Trait · Keyword · Arena · Set. (BL-162: the standalone
 * Inventory column is retired -- its click-to-edit affordance and owned
 * count move into the merged Playset cell, PlaysetCell.tsx.)
 *
 * BL-44 Slice C (ADR-0005): the body is virtualized with
 * @tanstack/react-virtual so only the on-screen rows (~a windowful) render
 * to the DOM at once -- the list is ~2,306 base-card rows at full catalog
 * scale, and a single-pass render of all of them is what causes the render
 * jank this slice fixes. The already-filtered `cards` array (computed by
 * CardsPage) is what gets windowed; filtering itself is untouched. */
export function CardsTable({
  cards,
  setNameByCode,
  isAuthenticated,
  onSelectCard,
  onSelectInventory,
  scope = null,
  onScopeChange = () => {},
  priceKind = "market",
  onPriceKindChange = () => {},
  valueDisplay = "unit",
  onValueDisplayChange = () => {},
  sortState = DEFAULT_SORT_STATE,
  onSortChange = () => {},
  widthTier = "auto",
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // BL-226: AUTO mode's own measurement -- the table wrapper's (this same
  // scrollRef element's) content-box width, tracked live via ResizeObserver
  // so the tier re-picks itself whenever the AVAILABLE width changes for any
  // reason, not just a window resize -- the filter sidebar docking/floating
  // (cards.css's `.cards-layout` media query) changes what's actually
  // available to this wrapper without the viewport itself changing size,
  // which is exactly the case a window-resize listener (GalleryGrid.tsx's
  // own container-width idiom) would miss. `null` until the first
  // observation lands; resolvedTier below treats that pre-measurement
  // instant as "assume Full fits" (NATURAL_WIDTHS.full), the same "default =
  // today's unaffected behavior" fallback idiom this file already uses for
  // every other optional prop -- a real browser delivers that first
  // observation before paint, so the assumption is corrected before a user
  // ever sees it; src/test/setup.ts's ResizeObserver mock delivers it
  // synchronously so tests never observe the pre-measurement instant at all.
  // Round 3 (owner: resizing "shakes"): state holds the RESOLVED step
  // count, not the raw measured width -- the observer fires per animation
  // frame during a drag, and storing raw pixels re-rendered the whole
  // virtualized table every frame (the visible churn). Resolving inside the
  // callback means setState almost always receives the SAME value (React
  // bails out without re-rendering), so the table repaints only at genuine
  // ladder-boundary crossings.
  const [autoStepCount, setAutoStepCount] = useState<number | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setAutoStepCount(selectAutoStepCount(entry.contentRect.width, WIDTH_BY_STEP_COUNT));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // BL-226 round 2: AUTO resolves to a ladder STEP COUNT (column-at-a-time);
  // a manual preset maps to its fixed prefix of the same ladder. The
  // pre-measurement instant assumes everything fits (every ladder step),
  // the same "default = today's unaffected behavior" idiom.
  const stepCount =
    widthTier === "auto" ? (autoStepCount ?? PRIORITY_LADDER.length) : TIER_STEP_COUNT[widthTier];
  const visible = new Set<ColumnKey>([
    ...BASE_COLUMN_KEYS,
    ...PRIORITY_LADDER.slice(0, stepCount).flat(),
  ]);
  // On-screen order is ALWAYS the canonical COLUMN_KEYS order -- the ladder
  // decides visibility, never position.
  const visibleKeys = COLUMN_KEYS.filter((key) => visible.has(key));
  const columnCount = visibleKeys.length;

  // BL-226: the scoped amber bracket (`.vs-bracket--inhead`, cards.css)
  // spans # through Value -- its geometry mirrors whichever columns actually
  // sit between them in the ACTIVE tier (Compact excludes Variants, so its
  // span is narrower than Standard/Full, which are identical to each other).
  // Anchored on the Playset th (position: relative via thead's own sticky
  // containing-block trick, see cards.css), so `left` is relative to
  // Playset's OWN left edge: 8px inset minus the columns before Playset that
  // are visible in this tier; `width` is those same columns plus Playset and
  // Value, minus the 16px inset both sides carry. Computed here (not a
  // second hardcoded CSS value per tier) so the two can never drift --
  // cards.css keeps the position/top/margin rule, this only overrides
  // left/width via inline style.
  const beforePlaysetWidth = visibleKeys
    .slice(0, visibleKeys.indexOf("playset"))
    .reduce((sum, key) => sum + WIDTH_BY_KEY[key], 0);
  const bracketLeft = 8 - beforePlaysetWidth;
  // Round 2: below-Compact states can hide the Value column -- the bracket
  // then ends at Playset (and the label drops its VALUE mention below).
  const bracketWidth =
    beforePlaysetWidth +
    WIDTH_BY_KEY.playset +
    (visible.has("value") ? WIDTH_BY_KEY.value : 0) -
    16;

  const rowVirtualizer = useVirtualizer({
    count: cards.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: OVERSCAN,
    // Testing note: react-virtual measures the scroll container via
    // element.offsetWidth/offsetHeight (see observeElementRect in
    // @tanstack/virtual-core), read synchronously as soon as the container
    // mounts. jsdom has no layout engine and always reports 0 for both,
    // which would make the virtualizer see a 0px viewport and render zero
    // rows -- non-deterministic (effectively empty) test output. `src/test/
    // setup.ts` mocks offsetWidth/offsetHeight to fixed non-zero values so
    // every test gets a stable, known windowful of rows; `initialRect` below
    // is the pre-measurement fallback (SSR / the instant before mount) and
    // isn't what makes jsdom deterministic on its own.
    initialRect: { width: 1200, height: 600 },
  });

  // Must run before any early return -- hooks can't be called conditionally.
  if (cards.length === 0) {
    return <p className="placeholder">No cards match the current filters.</p>;
  }

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0 ? totalSize - virtualRows[virtualRows.length - 1].end : 0;

  return (
    <div className="data-table-wrapper" ref={scrollRef}>
      <table className="data-table data-table--cards">
        <colgroup>
          {/* BL-226 round 4 (owner: resize "pulses"): in AUTO, the Name
              column carries NO width -- table-layout:fixed hands it all the
              slack, so every column right of Name keeps a CONSTANT distance
              from the window edge during a drag (only Name breathes,
              smoothly) instead of the all-columns proportional stretch
              re-dividing at every ladder boundary (the sawtooth the owner
              described). AUTO guarantees the specified sum fits, so Name
              always gets >= its natural 210. Manual overrides keep every
              width fixed -- a forced-wide tier on a narrow window must
              overflow into the h-scroll, not silently crush Name. */}
          {visibleKeys.map((key) => (
            <col
              key={key}
              style={
                widthTier === "auto" && key === "name" ? undefined : { width: WIDTH_BY_KEY[key] }
              }
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {/* BL-187 gave the # th the same faint `.th-scoped` wash the
                Playset/Value headers carry while scoped; BL-194 (owner)
                upgraded it to the scope control's own strong active-state
                treatment, since the # column's content is itself
                scope-driven (scopedCardNumber below). Owner dev-review
                2026-08-05 (two rounds): first the treatment moved off the
                th onto a bordered/filled chip around the # glyph, then the
                box came off too -- the scoped # is now amber TEXT only
                (the trigger--on font color, no border/fill), styled
                directly by `.th-cardnum-scoped` (cards.css), part of the
                same round that ambers the Playset/Value labels and toggle
                labels under the extended bracket. */}
            {/* BL-213: `aria-sort` lives on the <th> (ARIA's own home for
                it); the click affordance + direction indicator live on the
                inner button so wrapping never changes a header's
                textContent (every pre-existing header-text assertion stays
                valid unchanged). */}
            {/* BL-226: every header cell below is gated on `visible.has(key)`
                -- the SAME TIER_COLUMN_KEYS-derived Set the tbody row maps
                over further down, so header and cell visibility can never
                drift apart. */}
            {visible.has("number") && (
              <th
                className={scope ? "th-cardnum-scoped" : undefined}
                aria-sort={ariaSortValue(sortState, "number")}
              >
                <SortHeaderButton column="number" sortState={sortState} onSortChange={onSortChange}>
                  #
                </SortHeaderButton>
              </th>
            )}
            {visible.has("name") && (
              <th aria-sort={ariaSortValue(sortState, "name")}>
                <SortHeaderButton column="name" sortState={sortState} onSortChange={onSortChange}>
                  Name
                </SortHeaderButton>
              </th>
            )}
            {visible.has("variants") && (
              <th aria-sort={ariaSortValue(sortState, "variants")}>
                <SortHeaderButton
                  column="variants"
                  sortState={sortState}
                  onSortChange={onSortChange}
                >
                  Variants
                </SortHeaderButton>
              </th>
            )}
            <th
              className={`th-playset${scope ? " th-scoped" : ""}`}
              aria-sort={ariaSortValue(sortState, "playset")}
            >
              {/* BL-173 round 2 (owner, 2026-07-27): the amber bracket lives
                  INSIDE this header row now -- the original separate thead
                  <tr> read as table content, not header. It's an absolutely
                  positioned overlay anchored on this th. Owner dev-review
                  2026-08-05: the bracket now reaches LEFT to encompass the
                  # column too (its content is scope-driven, same as
                  Pips/Value), so the span runs # through Unit Value --
                  crossing Name/Variants on the way, which is why the label
                  names the affected columns explicitly ("Card # + Pips +
                  Value") instead of implying everything under the line is
                  scoped. Geometry lived as static values in
                  .vs-bracket--inhead (cards.css) through BL-173; BL-226
                  (Issue #140) made the spanned column SET itself vary by
                  width tier (Compact excludes Variants), so left/width are
                  now computed just below from WIDTH_BY_KEY/visibleKeys --
                  the CSS rule keeps position/top/margin only, see that
                  block's own updated comment. Still aria-hidden: the
                  trigger's own text carries the same information
                  accessibly. */}
              {scope && (
                <span
                  className="vs-bracket vs-bracket--inhead"
                  aria-hidden="true"
                  // BL-226: left/width computed above from the ACTIVE
                  // tier's visible columns (Compact excludes Variants, so
                  // its span is narrower) -- overrides the CSS class's
                  // Full/Standard-shaped default via inline style, same
                  // formula the retained comment above documents.
                  style={{ left: bracketLeft, width: bracketWidth }}
                >
                  <span className="vs-bracket__label">
                    {scopeShortName(scope)} - CARD # + PIPS{visible.has("value") ? " + VALUE" : ""}
                  </span>
                </span>
              )}
              {/* Round 2: trigger stacked ABOVE the column label. */}
              <span className="th-playset-inner">
                <CardsScopeTrigger scope={scope} onScopeChange={onScopeChange} />
                {/* Owner-dialed 2026-07-31: label (and the cells below, via
                    .td-playset padding) shift 15px right; the scope trigger
                    deliberately does NOT. BL-213: the label doubles as the
                    Playset column's sort button -- CardsScopeTrigger above
                    stays its own separate button, not nested inside this
                    one. */}
                <SortHeaderButton
                  column="playset"
                  sortState={sortState}
                  onSortChange={onSortChange}
                  className="th-playset-label"
                >
                  Playset
                </SortHeaderButton>
              </span>
            </th>
            {visible.has("value") && (
              <th
                className={`th-value${scope ? " th-scoped" : ""}`}
                aria-sort={ariaSortValue(sortState, "value")}
              >
                {/* Round 2: MKT/LOW stacked ABOVE the label; the scoped finish
                  tag is REMOVED from this header (owner call -- the bracket
                  + trigger already name the finish). Round 4: .th-value
                  carries the tightened side padding that lets the column sit
                  at 90px. Owner request 2026-07-31: a second UNIT/COLL pill
                  joins the stack and the label follows the active mode --
                  "Unit Value" (one copy's price) vs "Collection" (your owned
                  copies' worth, cardCollectionValue). */}
                {/* Owner-dialed (2026-07-31 round): TWO rows, no duplicate
                  text -- the UNIT/TOTAL switch ABOVE (large size, its
                  in-track label matching the th's own type), then the
                  static "Value" label with the small MKT/LOW switch to its
                  RIGHT. Reads top-to-bottom as "UNIT / VALUE·MKT". */}
                <span className="th-value-inner">
                  <CardsValueDisplayToggle mode={valueDisplay} onChange={onValueDisplayChange} />
                  <span className="th-value-mode">
                    <CardsValueKindToggle kind={priceKind} onChange={onPriceKindChange} />
                    {/* Owner dev-review 2026-08-05: while scoped, the Value
                      label renders in the trigger--on amber font color
                      (.th-value-label, activated by this th's .th-scoped
                      state class -- unscoped it's an unstyled span). The
                      round's earlier bordered/filled chip treatment is
                      retired; color only. */}
                    {/* BL-213: the Value label doubles as this column's sort
                      button -- the MKT/LOW and UNIT/COLLECTION switches
                      above stay their own separate buttons. */}
                    <SortHeaderButton
                      column="value"
                      sortState={sortState}
                      onSortChange={onSortChange}
                      className="th-value-label"
                    >
                      Value
                    </SortHeaderButton>
                  </span>
                </span>
              </th>
            )}
            {visible.has("rarity") && (
              <th aria-sort={ariaSortValue(sortState, "rarity")}>
                <SortHeaderButton column="rarity" sortState={sortState} onSortChange={onSortChange}>
                  Rarity
                </SortHeaderButton>
              </th>
            )}
            {visible.has("aspect") && <th>Aspect</th>}
            {visible.has("type") && <th>Type</th>}
            {/* BL-173 review round 1: header text centers over the centered
                StatBadges (.th-stat/.td-stat pair, cards.css). BL-213: Cost/
                Power/HP are sortable -- the button is an inline-block by
                default, so .th-stat's text-align: center still centers it.
                BL-226: Cost/Power/HP are Standard+ only -- gated together. */}
            {visible.has("cost") && (
              <th className="th-stat" aria-sort={ariaSortValue(sortState, "cost")}>
                <SortHeaderButton column="cost" sortState={sortState} onSortChange={onSortChange}>
                  Cost
                </SortHeaderButton>
              </th>
            )}
            {visible.has("power") && (
              <th className="th-stat" aria-sort={ariaSortValue(sortState, "power")}>
                <SortHeaderButton column="power" sortState={sortState} onSortChange={onSortChange}>
                  Power
                </SortHeaderButton>
              </th>
            )}
            {visible.has("hp") && (
              <th className="th-stat" aria-sort={ariaSortValue(sortState, "hp")}>
                <SortHeaderButton column="hp" sortState={sortState} onSortChange={onSortChange}>
                  HP
                </SortHeaderButton>
              </th>
            )}
            {visible.has("trait") && <th>Trait</th>}
            {visible.has("keyword") && <th>Keyword</th>}
            {visible.has("arena") && <th>Arena</th>}
            {visible.has("set") && (
              <th aria-sort={ariaSortValue(sortState, "set")}>
                <SortHeaderButton column="set" sortState={sortState} onSortChange={onSortChange}>
                  Set
                </SortHeaderButton>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr aria-hidden="true">
              <td colSpan={columnCount} style={{ height: paddingTop, padding: 0, border: 0 }} />
            </tr>
          )}
          {virtualRows.map((virtualRow) => {
            const card = cards[virtualRow.index];
            const { displayName, subtitle } = parseCardDisplay(card);
            const isBase = card.type === "Base";
            // BL-173: unit price of the relevant printing (scoped variant,
            // else Standard w/ min-priced fallback) -- see
            // utils/variantScope.ts's cardValuePrice for the full rule.
            // Owner request 2026-07-31: collection mode swaps in the owned
            // copies' value (cardCollectionValue) under the same scope/kind.
            const cardValue =
              valueDisplay === "collection"
                ? cardCollectionValue(card.variants, scope, priceKind)
                : cardValuePrice(card.variants, scope, priceKind);
            // BL-187: the # column follows the active scope -- the scoped
            // variant's own card_number when the card carries one, else the
            // usual base_card_number (see scopedCardNumber's own doc comment
            // for the early-set early-era finish-numbering rationale).
            const scopedNumber = scopedCardNumber(card.variants, scope);
            const cardNumber = scopedNumber ?? card.base_card_number;
            return (
              <tr
                key={card.base_card_id}
                data-index={virtualRow.index}
                className={virtualRow.index % 2 === 1 ? "row-alt" : undefined}
              >
                {/* BL-226: every cell below is gated on the SAME
                    `visible.has(key)` check the thead row above uses --
                    single source of truth, no separate cell-visibility
                    list. */}
                {visible.has("number") && (
                  <td
                    className={`cell-muted td-cardnum${
                      scopedNumber != null ? " td-cardnum--scoped" : ""
                    }`}
                  >
                    {cardNumber}
                  </td>
                )}
                {/* BL-132 J1: the ENTIRE Name cell is the click target (and
                    hover highlight), matching the Playset cell's
                    click-to-edit pattern below (PlaysetCell.tsx). The inner
                    .card-name-link button stays as the keyboard-accessible
                    path; its stopPropagation keeps a button click from also
                    bubbling into the cell handler (one click, one
                    onSelectCard call either way). */}
                {visible.has("name") && (
                  <td
                    className="td-name td-name--clickable"
                    onClick={() => onSelectCard(card.base_card_id)}
                    title="View card"
                  >
                    <button
                      type="button"
                      className="card-name-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCard(card.base_card_id);
                      }}
                    >
                      {displayName}
                    </button>
                    {subtitle && <span className="card-subtitle">{subtitle}</span>}
                  </td>
                )}
                {visible.has("variants") && (
                  <td>
                    <VariantsTooltip card={card} setNameByCode={setNameByCode} />
                  </td>
                )}
                <PlaysetCell
                  card={card}
                  isAuthenticated={isAuthenticated}
                  onOpen={() => onSelectInventory(card.base_card_id)}
                  scope={scope}
                />
                {/* BL-173: unit price, right-aligned mono, em-dash when
                    unpriced (same quiet state as the popup rail) -- fixed
                    column width via COLUMN_WIDTHS above, no stretch. */}
                {visible.has("value") && (
                  <td
                    className={`td-value${scope ? " td-value--scoped" : ""}${
                      cardValue == null ? " cell-muted" : ""
                    }`}
                  >
                    {formatCardValue(cardValue)}
                  </td>
                )}
                {visible.has("rarity") && (
                  <td className="td-ellipsis td-rarity">
                    <RarityBadge rarity={card.rarity} />
                  </td>
                )}
                {/* BL-111 F3 (design handoff §3) grew aspect icons 16 -> 22px;
                    owner dev review 2026-07-26 bumps them to 24px -- the stat
                    badges' RENDERED height at size 22 is 23-24px (width x1.05
                    cost / x1.1 power+hp), so 24 is the true height match.
                    `.td-icon-pad` tightens the cell's vertical padding to
                    compensate, so the larger icon doesn't grow the row
                    height. */}
                {visible.has("aspect") && (
                  <td className="td-icon-pad">
                    <span className="aspect-cell">
                      {card.aspects
                        .slice()
                        .sort(
                          (a, b) =>
                            ASPECTS.indexOf(a as (typeof ASPECTS)[number]) -
                            ASPECTS.indexOf(b as (typeof ASPECTS)[number])
                        )
                        .map((a) => (
                          <AspectIcon key={a} aspect={a} size={24} tooltip />
                        ))}
                      {card.aspects.length === 0 && <span className="cell-muted">—</span>}
                    </span>
                  </td>
                )}
                {visible.has("type") && <td className="td-ellipsis">{card.type}</td>}
                {/* BL-111 F3: Cost/Power/HP render through StatBadge (BL-111
                    F1) instead of plain numerals, sized 22px to match the
                    aspect icons. `.td-stat` tightens padding the same way
                    `.td-icon-pad` does for the aspect cell.
                    BL-132 J2 (Jeremy's 2026-07-14 review): a null stat now
                    renders NO badge at all -- an empty cell -- instead of the
                    old dash-numeral badge shape. Zero is a real stat value
                    (0-cost cards exist) and still gets its badge; only
                    null/absent suppresses. */}
                {visible.has("cost") && (
                  <td className="td-stat">
                    {card.cost != null && <StatBadge type="cost" value={card.cost} size={22} />}
                  </td>
                )}
                {visible.has("power") && (
                  <td className="td-stat">
                    {card.power != null && <StatBadge type="power" value={card.power} size={22} />}
                  </td>
                )}
                {visible.has("hp") && (
                  <td className="td-stat">
                    {card.hp != null && <StatBadge type="hp" value={card.hp} size={22} />}
                  </td>
                )}
                {visible.has("trait") && (
                  <td
                    className={`td-ellipsis${
                      isBase || card.traits.length === 0 ? " cell-muted" : ""
                    }`}
                  >
                    {isBase ? (card.traits[0] ?? "—") : card.traits.join(", ") || "—"}
                  </td>
                )}
                {visible.has("keyword") && (
                  <td className={`td-ellipsis${card.keywords.length === 0 ? " cell-muted" : ""}`}>
                    {card.keywords.join(", ") || "—"}
                  </td>
                )}
                {visible.has("arena") && (
                  <td className={`td-ellipsis${card.arena == null ? " cell-muted" : ""}`}>
                    {card.arena ?? "—"}
                  </td>
                )}
                {visible.has("set") && <td className="cell-muted td-ellipsis">{card.set_code}</td>}
              </tr>
            );
          })}
          {paddingBottom > 0 && (
            <tr aria-hidden="true">
              <td colSpan={columnCount} style={{ height: paddingBottom, padding: 0, border: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
