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

/** Fixed pixel widths for every column, in COLUMN_KEYS order. The table uses
 * `table-layout: fixed` (cards.css) driven by this <colgroup> instead of the
 * browser's default auto-layout, which re-measures column widths from
 * whichever rows are currently in the DOM and would make columns visibly
 * jitter as the virtualizer swaps rows in and out while scrolling (ADR-0005).
 * Fixed widths make column width independent of which rows are mounted.
 *
 * The values are ratios: `table-layout: fixed` stretches all of them
 * proportionally to fill the wrapper's width, and `.data-table-wrapper`'s
 * `max-width` in cards.css caps that stretch so, at very wide viewports, the
 * proportional stretch does not balloon the Name↔Variants / Aspect↔Type /
 * Keyword↔Arena gaps this ratio scheme produces. Below the cap the table
 * fills the wrapper's full width.
 *
 * Per-column constraints:
 * - Cost/Power/HP are equal (52 each) and their th text and StatBadges are
 *   CENTERED (.th-stat / .td-stat), so equal widths give equal visual rhythm
 *   between the three badges.
 * - Playset (128) holds the count chip + pips; Rarity (128) holds the
 *   symbol + label; Aspect (108) holds at most two 24px icons + gap.
 * - Value (114) is a compact right-aligned mono price cell. The width is set
 *   by the header, not the prices (the widest real price, "$xxx.xx", is ~53px
 *   mono): the header holds the large COLLECTION switch (86px track, 0.08em
 *   in-track label) inside the th's own 6px side padding, both header rows
 *   centered (.th-value carries that tightened side padding, cards.css). The
 *   price text sits 38px off the column's right edge, so the air falls
 *   between the value and Rarity. The in-header bracket's left/width are
 *   computed from WIDTH_BY_KEY (bracketLeft/bracketWidth below); the
 *   `.vs-bracket--inhead` left/width in cards.css are a Standard/Full
 *   fallback (# + Name + Variants + Playset + Value) to retune with these.
 * - #, Variants, Name, Trait, Keyword and Arena are ellipsis-guarded or short
 *   content, so they are the columns with room to give. Trait and Keyword can
 *   hold long comma-joined lists and are the most likely to feel cramped.
 *
 * A fixed-layout table can NEVER render narrower than this array's sum:
 * narrower wrappers scroll horizontally instead (overflow = sum - client
 * width), so any width added here moves the viewport width at which the
 * horizontal scrollbar appears.
 *
 * SYNC RULE: the sum of these widths (1538) + 2px wrapper border = 1540,
 * + 12px scrollbar-gutter allowance = 1552 must match the THREE 1552px
 * values in cards.css (.inv-summary max-width / .cards-content flex-basis /
 * .data-table-wrapper max-width) -- retune all three whenever this array
 * changes, or the wrapper cap either stretches columns or grows a
 * horizontal scrollbar.
 *
 * The width presets (Compact/Standard/Full, TIER_STEP_COUNT below) are
 * hide-only: Full IS this array unchanged, Compact/Standard are subsets of it
 * (never new widths of their own; a hidden column's width simply isn't summed
 * for that tier). The SYNC RULE stays keyed to the FULL sum alone. Varying the
 * wrapper/content/summary cap trio and the FilterPanel docking breakpoint per
 * tier would cascade through cards.css's layout math for a cosmetic gain: a
 * narrower tier's columns proportionally stretch to fill up to the FULL-sized
 * cap on a wide-enough viewport, the same `table-layout: fixed` stretch the
 * Full tier shows above its own natural width. No functional cost: the cap
 * only ever bounds width, so a narrower tier never scrolls or overflows
 * because of it. See WIDTH_BY_STEP_COUNT below for the per-step sums this DOES
 * drive (the AUTO-selection fit test). */
const COLUMN_WIDTHS = [50, 210, 86, 128, 114, 128, 108, 90, 52, 52, 52, 144, 180, 74, 70];

/** The fifteen columns in the same left-to-right order as COLUMN_WIDTHS
 * above -- the two arrays are index-paired, never maintained independently.
 * The width tiers below derive from this single source of truth rather than
 * from a second list of magic numbers. */
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

/** AUTO escalates column-AT-A-TIME. The bare minimum is #/Name/Playset; each
 * ladder step adds columns in priority order whenever the measured width
 * permits (reducing runs the same ladder backwards). Cost/Power/HP and
 * Trait/Keyword move as atomic sets -- no partial-stats states. Column ORDER
 * on screen is always the canonical COLUMN_KEYS order above; the ladder only
 * decides VISIBILITY, never order. The manual Compact/Standard/Full presets
 * are fixed PREFIXES of this same ladder (TIER_STEP_COUNT below) -- one
 * source of truth for both modes, and both the header row and body row map
 * over the SAME `visible` Set derived from it, so header and cell rendering
 * can never drift apart. */
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
  ["trait", "keyword"], // ← all 9 = the Full preset
];

const TIER_STEP_COUNT: Record<Exclude<WidthTier, "auto">, number> = {
  compact: 3,
  standard: 6,
  full: PRIORITY_LADDER.length,
};

/** Cumulative natural width at each ladder step count -- index 0 = the bare
 * minimum alone (388), last = Full's 1538 (the same sum the cards.css SYNC
 * RULE tracks). Derived purely from COLUMN_WIDTHS above; fed to
 * selectAutoStepCount (utils/tableWidthTier.ts) as AUTO's fit test against
 * the measured wrapper width below. */
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
  /** Gates the Playset cell's count/pips, click-to-edit affordance, and hover
   * dossier -- same isAuthenticated contract GalleryGrid takes from
   * CardsPage. */
  isAuthenticated: boolean;
  onSelectCard: (baseCardId: number) => void;
  onSelectInventory: (baseCardId: number) => void;
  /** Active finish scope for the Playset pips + Value column, or null for
   * "All variants". Owned by CardsPage, which also drives FilterState.finish
   * from the same value -- see utils/variantScope.ts. Optional/defaulted (the
   * same "default = unaffected behavior" idiom CardsPage's own
   * isEmailVerified prop uses) so call sites that don't care about scoping
   * render unscoped. */
  scope?: string | null;
  onScopeChange?: (raw: string | null) => void;
  /** Active Market/Low kind for the Value column -- persisted by CardsPage via
   * utils/variantScope.ts's load/savePriceKind. Same optional/defaulted idiom
   * as `scope` above. */
  priceKind?: PriceMode;
  onPriceKindChange?: (kind: PriceMode) => void;
  /** Unit vs Collection display for the Value column -- persisted by
   * CardsPage via load/saveValueDisplay, same idiom as priceKind above. */
  valueDisplay?: ValueDisplayMode;
  onValueDisplayChange?: (mode: ValueDisplayMode) => void;
  /** The active single-column sort -- owned by CardsPage and session-only
   * (never localStorage), applied to the row list before it ever reaches this
   * component (utils/cardSort.ts's sortCards). CardsTable only renders the
   * resulting header affordances (aria-sort + the direction indicator) and
   * reports clicks back up; it holds no sort state of its own. Optional,
   * defaulting to the "# ascending is the default order" state CardsPage
   * itself initializes. */
  sortState?: SortState;
  onSortChange?: (column: SortColumn) => void;
  /** The user's width-tier preference -- "auto" (the default) resolves via
   * measured available width below; a manual pick (compact/standard/full)
   * wins outright and is never re-derived from measurement. Owned/persisted
   * by CardsPage (utils/tableWidthTier.ts's load/saveWidthTier). Optional and
   * defaulted like every other prop here; the default pre-measurement state
   * resolves to Full (see WIDTH_BY_STEP_COUNT/measuredWidth below). */
  widthTier?: WidthTier;
}

/** Unified Cards table. Column order is COLUMN_KEYS above. The owned count and
 * click-to-edit affordance live in the merged Playset cell (PlaysetCell.tsx).
 *
 * The body is virtualized with @tanstack/react-virtual (ADR-0005) so only the
 * on-screen rows (~a windowful) render to the DOM at once -- the list is
 * ~2,306 base-card rows at full catalog scale, and a single-pass render of all
 * of them causes render jank. The already-filtered `cards` array (computed by
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

  // AUTO mode's own measurement: the table wrapper's (this same scrollRef
  // element's) content-box width, tracked live via ResizeObserver so the tier
  // re-picks itself whenever the AVAILABLE width changes for any reason, not
  // just a window resize. The filter sidebar docking/floating (cards.css's
  // `.cards-layout` media query) changes what's actually available to this
  // wrapper without the viewport itself changing size, which is exactly the
  // case a window-resize listener (GalleryGrid.tsx's own container-width
  // idiom) would miss. `null` until the first observation lands; resolvedTier
  // below treats that pre-measurement instant as "assume everything fits"
  // (the same "default = unaffected behavior" fallback idiom this file uses
  // for every other optional prop) -- a real browser delivers that first
  // observation before paint, so the assumption is corrected before a user
  // ever sees it; src/test/setup.ts's ResizeObserver mock delivers it
  // synchronously so tests never observe the pre-measurement instant at all.
  // State holds the RESOLVED step count, not the raw measured width: the
  // observer fires per animation frame during a drag, and storing raw pixels
  // would re-render the whole virtualized table every frame. Resolving inside
  // the callback means setState almost always receives the SAME value (React
  // bails out without re-rendering), so the table repaints only at genuine
  // ladder-boundary crossings.
  const [autoStepCount, setAutoStepCount] = useState<number | null>(null);

  // An empty result renders a placeholder instead of the table, so the table
  // element is replaced; observe again whenever it comes back. A zero width
  // only means the element left the page, never that the user has no room.
  const isEmpty = cards.length === 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0) {
        setAutoStepCount(selectAutoStepCount(entry.contentRect.width, WIDTH_BY_STEP_COUNT));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [isEmpty]);

  // AUTO resolves to a ladder STEP COUNT (column-at-a-time); a manual preset
  // maps to its fixed prefix of the same ladder. The pre-measurement instant
  // assumes everything fits (every ladder step).
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

  // The scoped amber bracket (`.vs-bracket--inhead`, cards.css) spans #
  // through Value -- its geometry mirrors whichever columns actually sit
  // between them in the ACTIVE tier (Compact excludes Variants, so its span is
  // narrower than Standard/Full, which are identical to each other).
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
  // Below-Compact states can hide the Value column -- the bracket then ends
  // at Playset (and the label drops its VALUE mention below).
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
          {/* In AUTO, the Name column carries NO width -- table-layout:fixed
              hands it all the slack, so every column right of Name keeps a
              CONSTANT distance from the window edge during a drag (only Name
              breathes, smoothly) instead of the all-columns proportional
              stretch re-dividing at every ladder boundary (a sawtooth). AUTO
              guarantees the specified sum fits, so Name always gets >= its
              natural 210. Manual overrides keep every width fixed -- a
              forced-wide tier on a narrow window must overflow into the
              h-scroll, not silently crush Name. */}
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
            {/* While scoped, the # th carries the scope control's own strong
                active-state treatment, since the # column's content is itself
                scope-driven (scopedCardNumber below). The treatment is amber
                TEXT only (the trigger--on font color, no border/fill), styled
                directly by `.th-cardnum-scoped` (cards.css) -- the same
                treatment that ambers the Playset/Value labels and toggle
                labels under the extended bracket. */}
            {/* `aria-sort` lives on the <th> (ARIA's own home for it); the
                click affordance + direction indicator live on the inner
                button so wrapping never changes a header's textContent. */}
            {/* Every header cell below is gated on `visible.has(key)` -- the
                SAME Set the tbody row maps over further down, so header and
                cell visibility can never drift apart. */}
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
              {/* The amber bracket lives INSIDE this header row (a separate
                  thead <tr> would read as table content, not header), as an
                  absolutely positioned overlay anchored on this th. It
                  reaches LEFT to encompass the # column too (its content is
                  scope-driven, same as Pips/Value), so the span runs #
                  through Unit Value -- crossing Name/Variants on the way,
                  which is why the label names the affected columns
                  explicitly ("Card # + Pips + Value") instead of implying
                  everything under the line is scoped. The spanned column SET
                  varies by width tier (Compact excludes Variants), so
                  left/width are computed just below from
                  WIDTH_BY_KEY/visibleKeys; the CSS rule keeps
                  position/top/margin only. Still aria-hidden: the trigger's
                  own text carries the same information accessibly. */}
              {scope && (
                <span
                  className="vs-bracket vs-bracket--inhead"
                  aria-hidden="true"
                  // left/width computed above from the ACTIVE tier's visible
                  // columns (Compact excludes Variants, so its span is
                  // narrower) -- overrides the CSS class's Full/Standard-shaped
                  // default via inline style, same formula documented above.
                  style={{ left: bracketLeft, width: bracketWidth }}
                >
                  <span className="vs-bracket__label">
                    {scopeShortName(scope)} - CARD # + PIPS{visible.has("value") ? " + VALUE" : ""}
                  </span>
                </span>
              )}
              {/* Trigger stacked ABOVE the column label. */}
              <span className="th-playset-inner">
                <CardsScopeTrigger scope={scope} onScopeChange={onScopeChange} />
                {/* Label (and the cells below, via .td-playset padding) shift
                    7px right; the scope trigger deliberately does NOT. The
                    label doubles as the Playset column's sort button --
                    CardsScopeTrigger above stays its own separate button, not
                    nested inside this one. */}
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
                {/* The scoped finish tag is not shown in this header: the
                  bracket + trigger already name the finish. .th-value carries
                  the tightened side padding that lets the narrow column
                  clear the toggle. */}
                {/* TWO rows, no duplicate text -- the UNIT/COLLECTION switch
                  ABOVE (large size, its in-track label matching the th's own
                  type; its aria-label and title say total, the internal mode
                  value is "collection"), then the small MKT/LOW switch with
                  the static "Value" label to its RIGHT. Reads top-to-bottom
                  as "UNIT / MKT·VALUE". */}
                <span className="th-value-inner">
                  <CardsValueDisplayToggle mode={valueDisplay} onChange={onValueDisplayChange} />
                  <span className="th-value-mode">
                    <CardsValueKindToggle kind={priceKind} onChange={onPriceKindChange} />
                    {/* While scoped, the Value label renders in the
                      trigger--on amber font color (.th-value-label,
                      activated by this th's .th-scoped state class --
                      unscoped it's an unstyled span). Color only: no chip or
                      fill. */}
                    {/* The Value label doubles as this column's sort button
                      -- the MKT/LOW and UNIT/COLLECTION switches above stay
                      their own separate buttons. */}
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
            {/* Header text centers over the centered StatBadges
                (.th-stat/.td-stat pair, cards.css). Cost/Power/HP are
                sortable -- the button is an inline-block by default, so
                .th-stat's text-align: center still centers it. Cost/Power/HP
                move together as one ladder step -- gated together. */}
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
            // Unit price of the relevant printing (scoped variant, else
            // Standard w/ min-priced fallback) -- see utils/variantScope.ts's
            // cardValuePrice for the full rule. Collection mode swaps in the
            // owned copies' value (cardCollectionValue) under the same
            // scope/kind.
            const cardValue =
              valueDisplay === "collection"
                ? cardCollectionValue(card.variants, scope, priceKind)
                : cardValuePrice(card.variants, scope, priceKind);
            // The # column follows the active scope -- the scoped variant's
            // own card_number when the card carries one, else the usual
            // base_card_number (see scopedCardNumber's own doc comment for the
            // early-era finish-numbering rationale).
            const scopedNumber = scopedCardNumber(card.variants, scope);
            const cardNumber = scopedNumber ?? card.base_card_number;
            return (
              <tr
                key={card.base_card_id}
                data-index={virtualRow.index}
                className={virtualRow.index % 2 === 1 ? "row-alt" : undefined}
              >
                {/* Every cell below is gated on the SAME `visible.has(key)`
                    check the thead row above uses -- single source of truth,
                    no separate cell-visibility list. */}
                {visible.has("number") && (
                  <td
                    className={`cell-muted td-cardnum${
                      scopedNumber != null ? " td-cardnum--scoped" : ""
                    }`}
                  >
                    {cardNumber}
                  </td>
                )}
                {/* The ENTIRE Name cell is the click target (and hover
                    highlight), matching the Playset cell's click-to-edit
                    pattern below (PlaysetCell.tsx). The inner .card-name-link
                    button stays as the keyboard-accessible path; its
                    stopPropagation keeps a button click from also bubbling
                    into the cell handler (one click, one onSelectCard call
                    either way). */}
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
                {/* Unit price, right-aligned mono, em-dash when unpriced
                    (same quiet state as the popup rail) -- fixed column width
                    via COLUMN_WIDTHS above, no stretch. */}
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
                {/* Aspect icons are 24px: the stat badges' RENDERED height at
                    size 22 is 23-24px (width x1.05 cost / x1.1 power+hp), so
                    24 is the true height match. `.td-icon-pad` tightens the
                    cell's vertical padding to compensate, so the larger icon
                    doesn't grow the row height. */}
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
                {/* Cost/Power/HP render through StatBadge, sized 22px.
                    `.td-stat` tightens padding the same way `.td-icon-pad`
                    does for the aspect cell. A null stat renders NO badge at
                    all -- an empty cell. Zero is a real stat value (0-cost
                    cards exist) and still gets its badge; only null/absent
                    suppresses. */}
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
