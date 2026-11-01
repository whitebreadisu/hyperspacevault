import React, { useEffect, useMemo, useRef, useState } from "react";
import type { InventoryCard } from "../../utils/inventory";
import type { ViewMode } from "../../components/FilterPanel";
import { buildSetBreakdown, computePanelMetrics, formatMoney } from "../../utils/completion";
import type { PriceMode, SetBreakdownRow, SetMeta } from "../../utils/completion";
import { useModalDismiss } from "../../hooks/useModalDismiss";
import { ValueSwitch } from "../cards/VariantScopeControls";
import type { WidthTier } from "../../utils/tableWidthTier";
import { capture } from "../../analytics/analytics";

/** The completion panel (App Spec §5.13, §5.15) -- four clipped-corner
 * "blocks" (Playset complete %, Set complete %, Cards, Collection value)
 * with blue tick progress, a Filtered/All scope toggle, and a
 * click-to-expand "«metric» by set" breakdown popover per block whose rows
 * show set logos.
 *
 * Every calc rule (universe scoping, orphan exclusion, Collection-value
 * fallback chain) lives in utils/completion.ts, unit-tested there -- this
 * component is presentation plus the scope/expanded/priceMode UI state that
 * feeds those pure functions. */

interface Props {
  /** The currently-visible (post-filter/toggle) card list -- what "Filtered"
   * scope computes over, and the only list used when the scope toggle isn't
   * rendered (unfiltered list, or `isNarrowed` omitted/false). */
  filteredCards: InventoryCard[];
  /** The full, pre-filter catalog card list -- what "All" scope computes
   * over. Defaults to `filteredCards` when omitted (every call site that
   * doesn't wire scope, e.g. a standalone render/test, then has no
   * observable "All" scope to switch to, which is correct: there's nothing
   * narrower than `filteredCards` to compare against). */
  allCards?: InventoryCard[];
  /** True when `filteredCards` is a genuine narrowing of `allCards` -- any
   * facet, search, or owned/incomplete toggle, by any mechanism. Governs
   * whether the scope toggle renders at all; default
   * false (toggle hidden, panel always reads as "Filtered" -- equivalent to
   * "everything" when nothing is actually narrowed). */
  isNarrowed?: boolean;
  /** set_code -> true for the base sets (GET /api/sets' `is_base_set`),
   * used to scope the two completion percentages and exclude orphan base
   * cards (App Spec §5.13). Defaults to empty (every card excluded from both
   * percentages -- a safe "not loaded yet" fallback that never shows a
   * fabricated 100%). */
  baseSetCodes?: Set<string>;
  /** The base sets, in display order (utils/catalog.ts's orderSetCodes),
   * for the breakdown popovers' row order. Defaults to empty, which shows
   * each popover's "No base-set cards in scope" empty state. */
  orderedBaseSets?: SetMeta[];
  children?: React.ReactNode;
  /** Anonymous visitors have no inventory to summarize -- the bar keeps its
   * labels but every value renders as an em-dash instead of a computed zero
   * (a real zero would misleadingly imply "you own nothing," rather than
   * "there is no inventory to look at"). Signed out, every Ticks row is
   * empty, the scope toggle is hidden and the four breakdown popovers cannot
   * open. Defaults to `true`. */
  isAuthenticated?: boolean;
  /** The Table/Gallery toggle, rendered in the actions slot left of the Add
   * Cards button (`children`). CardsPage owns viewMode as the single source
   * of truth. Optional: a call site that wires no view mode renders no
   * toggle. */
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  /** The Vault table's width-tier override -- AUTO / COMPACT / STANDARD /
   * FULL (App Spec §5.15), offered as a hover flyout on the Table button of
   * the toggle above; picking one also switches to Table. Owned/persisted by
   * CardsPage (utils/tableWidthTier.ts's load/saveWidthTier), same
   * optional-pair idiom as viewMode/onViewModeChange above -- omitted, the
   * Table button is a plain button with no flyout. */
  widthTier?: WidthTier;
  onWidthTierChange?: (tier: WidthTier) => void;
  /** The popover rows' own universe -- every filter applied EXCEPT the set
   * facet itself (the rows are that facet's own selection menu, and a menu
   * never filters itself; App Spec §5.15). Defaults to `filteredCards`. */
  breakdownCards?: InventoryCard[];
  /** The set FACET's current selections (CardsPage's `filters.set`,
   * the single source of truth for both the sidebar and these popovers).
   * Rows render highlighted when their code is here -- effectively
   * `filters.set ∩ orderedBaseSets`, since only base sets ever get a row. */
  selectedSetCodes?: Set<string>;
  /** Row-click pick: the host replaces the set facet with the clicked set, or
   * clears it when that set is the only one selected. Its presence is what
   * makes rows selectable at all -- omitted, the popover rows are read-only. */
  onPickSetCode?: (code: string) => void;
}

// Two-way totals scope (App Spec §5.15): "filtered" (everything the table
// currently shows) vs. "all" (the whole catalog). The set popovers write the
// sidebar's own Set facet, so "filtered" already covers a set pick and no
// third scope is needed.
type Scope = "filtered" | "all";
type BlockId = "playset" | "set" | "cards" | "value";

const EM_DASH = "—";
// Stable module-level fallbacks for the optional baseSetCodes/orderedBaseSets
// props (rather than `prop ?? new Set()` / `prop ?? []` inline, which would
// hand useMemo a fresh identity every render whenever the prop is omitted).
const EMPTY_BASE_SET_CODES: Set<string> = new Set();
const EMPTY_ORDERED_BASE_SETS: SetMeta[] = [];

function ViewToggle({
  viewMode,
  onViewModeChange,
  widthTier,
  onWidthTierChange,
}: {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  widthTier?: WidthTier;
  onWidthTierChange?: (tier: WidthTier) => void;
}) {
  // view_mode_changed (App Spec §22) -- fired only on a genuine mode switch
  // (not e.g. a width-tier pick made while already on Table).
  const changeViewMode = (mode: ViewMode) => {
    if (viewMode !== mode) capture("view_mode_changed", { mode });
    onViewModeChange(mode);
  };
  const btn = (mode: ViewMode, label: string, onClick?: () => void) => (
    <button
      type="button"
      className={`inv-summary__view-toggle-btn${
        viewMode === mode ? " inv-summary__view-toggle-btn--active" : ""
      }`}
      onClick={onClick ?? (() => changeViewMode(mode))}
      aria-pressed={viewMode === mode}
    >
      {label}
    </button>
  );
  // The Table button ITSELF hosts the width choice -- hovering (or
  // keyboard-focusing) it reveals a flyout of the four options; a plain
  // Table click means AUTO. Only wired when the caller passes the tier pair
  // (otherwise the plain two-button toggle renders).
  //
  // The flyout closes the moment ANY selection is made -- CSS :hover alone
  // can't do that (the cursor is still over the split), so a `suppressed`
  // state overrides the hover rule until the cursor leaves and re-enters
  // (mouseleave re-arms it).
  const [flyoutSuppressed, setFlyoutSuppressed] = useState(false);
  const wired = widthTier != null && onWidthTierChange != null;
  const closeFlyout = (e: React.MouseEvent<HTMLButtonElement>) => {
    setFlyoutSuppressed(true);
    e.currentTarget.blur();
  };
  return (
    <span role="group" aria-label="View" className="inv-summary__view-toggle">
      {wired ? (
        <span
          className={`inv-summary__table-split${
            flyoutSuppressed ? " inv-summary__table-split--suppressed" : ""
          }`}
          onMouseLeave={() => setFlyoutSuppressed(false)}
        >
          <button
            type="button"
            className={`inv-summary__view-toggle-btn${
              viewMode === "table" ? " inv-summary__view-toggle-btn--active" : ""
            }`}
            onClick={(e) => {
              changeViewMode("table");
              onWidthTierChange("auto");
              closeFlyout(e);
            }}
            aria-pressed={viewMode === "table"}
          >
            Table
          </button>
          <span role="group" aria-label="Table width" className="inv-summary__table-flyout">
            {WIDTH_TIERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`inv-summary__table-flyout-btn${
                  widthTier === value ? " inv-summary__table-flyout-btn--active" : ""
                }`}
                onClick={(e) => {
                  changeViewMode("table");
                  onWidthTierChange(value);
                  closeFlyout(e);
                }}
                aria-pressed={widthTier === value}
              >
                {label}
              </button>
            ))}
          </span>
        </span>
      ) : (
        btn("table", "Table")
      )}
      {btn("gallery", "Gallery")}
    </span>
  );
}

// The four width tiers, in the order ViewToggle's Table flyout lists them
// (.inv-summary__table-flyout-btn in cards.css).
const WIDTH_TIERS: { value: WidthTier; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "compact", label: "Compact" },
  { value: "standard", label: "Standard" },
  { value: "full", label: "Full" },
];

/** 10 skewed tick marks, `Math.round(pct / 10)` of them filled. `authed=false`
 * always renders every tick empty regardless of `pct` -- the signed-out
 * "empty ticks" rule, rather than a misleading filled bar over a fabricated
 * percentage. */
function Ticks({ pct, authed }: { pct: number; authed: boolean }) {
  const filled = authed ? Math.round(pct / 10) : 0;
  // At 100% the ticks read green -- the CSS scopes the green fill to the
  // popover context only (the block's own ticks stay blue), so the class is
  // emitted unconditionally here.
  const complete = authed && pct >= 100;
  return (
    <span
      className={`inv-summary__ticks${complete ? " inv-summary__ticks--complete" : ""}`}
      aria-hidden="true"
    >
      {Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          className={`inv-summary__tick${i < filled ? " inv-summary__tick--filled" : ""}`}
        />
      ))}
    </span>
  );
}

/** Market/Low toggle for the Collection-value block: the shared ValueSwitch
 * (App Spec §5.14), wrapped in `.inv-summary__pricemode` (cards.css) for
 * placement. */
function PriceModeToggle({
  mode,
  onChange,
}: {
  mode: PriceMode;
  onChange: (mode: PriceMode) => void;
}) {
  const isLow = mode === "low";
  return (
    // Nested inside the block's own click-to-expand div -- stopPropagation
    // keeps a mode switch from also toggling the breakdown popover.
    <span className="inv-summary__pricemode" onClick={(e) => e.stopPropagation()}>
      <ValueSwitch
        checked={isLow}
        label={isLow ? "LOW" : "MARKET"}
        ariaLabel={
          isLow ? "Showing low price — switch to market" : "Showing market price — switch to low"
        }
        title={
          isLow
            ? "Low price — cheapest listing. Click for market price."
            : "Market price — TCGplayer market average. Click for low price."
        }
        onToggle={() => onChange(isLow ? "market" : "low")}
      />
    </span>
  );
}

interface BlockDef {
  id: BlockId;
  label: string;
  value: string;
  sub?: string;
  /** Present only for the two percentage blocks -- drives the Ticks row. */
  pctValue?: number;
}

function popoverCell(
  blockId: BlockId,
  row: SetBreakdownRow,
  isAuthenticated: boolean
): { pctValue?: number; right?: string; sub?: string } {
  switch (blockId) {
    case "playset":
      return { pctValue: row.playsetPct };
    case "set":
      return { pctValue: row.setPct };
    case "cards":
      return {
        right: isAuthenticated ? row.totalCopies.toLocaleString() : EM_DASH,
        sub: isAuthenticated ? `(${row.uniqueOwned} unique)` : undefined,
      };
    case "value":
      return {
        right: isAuthenticated ? formatMoney(row.value) : EM_DASH,
        sub:
          isAuthenticated && row.unpricedCount > 0 ? `(${row.unpricedCount} unpriced)` : undefined,
      };
  }
}

export function InventorySummary({
  filteredCards,
  allCards,
  isNarrowed = false,
  baseSetCodes,
  orderedBaseSets,
  children,
  isAuthenticated = true,
  viewMode,
  onViewModeChange,
  widthTier,
  onWidthTierChange,
  breakdownCards,
  selectedSetCodes,
  onPickSetCode,
}: Props) {
  const [scope, setScope] = useState<Scope>("filtered");
  const [priceMode, setPriceMode] = useState<PriceMode>("market");
  const [expanded, setExpanded] = useState<BlockId | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // The open block's wrap element (block + popover) -- the click-away
  // boundary. Assigned via the wrap's conditional ref below; React nulls it
  // when the popover closes or moves to another block.
  const openWrapRef = useRef<HTMLSpanElement | null>(null);
  // Hover-dismiss arming (App Spec §5.15). The popover closes on
  // pointer-leave only after the pointer has actually been inside it once
  // (it stays displayed until moused over) -- and the leave boundary is the
  // whole wrap (block + gap-bridge + popover), so drifting between the
  // popover and its block never counts as leaving (a popover-only
  // mouseleave would fire across the gap).
  const hoverArmedRef = useRef(false);

  const codes = baseSetCodes ?? EMPTY_BASE_SET_CODES;
  const sets = orderedBaseSets ?? EMPTY_ORDERED_BASE_SETS;

  // Scope toggle only renders when the list is genuinely narrowed AND the
  // caller is authenticated -- hidden when unfiltered, hidden signed out.
  const showScopeToggle = isNarrowed && isAuthenticated;

  // The toggle-hidden case always reads as Filtered.
  const effectiveScope: Scope = !showScopeToggle ? "filtered" : scope;

  // The "narrowed state" amber treatment -- the switch AND all four blocks
  // (App Spec §5.15) -- applies only while the switch actually renders AND
  // reads Filtered. Hidden-toggle and All both use the neutral look.
  const narrowedFiltered = showScopeToggle && effectiveScope === "filtered";

  const activeCards = effectiveScope === "all" ? (allCards ?? filteredCards) : filteredCards;

  const metrics = useMemo(
    () => computePanelMetrics(activeCards, codes, priceMode),
    [activeCards, codes, priceMode]
  );

  // The popover rows' universe is ALWAYS "every filter except the
  // set facet" -- independent of the Filtered/All switch above, which only
  // ever governs the four blocks' own headline metrics. The rows are the
  // set facet's selection menu; a menu never filters itself.
  const rowCards = breakdownCards ?? filteredCards;

  const breakdown = useMemo(
    () => buildSetBreakdown(rowCards, sets, priceMode),
    [rowCards, sets, priceMode]
  );

  // Click-away close, MultiSelect.tsx's idiom: a document-level mousedown
  // listener, attached only while a popover is open, scoped to the OPEN
  // block's wrap (block + its popover) rather than the whole summary strip
  // -- clicking anywhere else, including the strip's other blocks/toggles/
  // empty space, closes the panel.
  useEffect(() => {
    if (expanded == null) return undefined;
    const onDocDown = (e: MouseEvent) => {
      if (openWrapRef.current && !openWrapRef.current.contains(e.target as Node)) {
        setExpanded(null);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [expanded]);

  useModalDismiss(() => setExpanded(null), { enabled: expanded != null });

  const displayPct = (n: number) => (isAuthenticated ? `${n}%` : EM_DASH);
  const displayCards = isAuthenticated ? metrics.totalCopies.toLocaleString() : EM_DASH;
  const displayUnique = isAuthenticated ? metrics.uniqueOwned.toLocaleString() : EM_DASH;
  const displayValue = isAuthenticated ? formatMoney(metrics.value) : EM_DASH;
  const valueSub =
    isAuthenticated && metrics.unpricedCount > 0
      ? `(${metrics.unpricedCount} unpriced)`
      : undefined;

  const blocks: BlockDef[] = [
    {
      id: "playset",
      label: "Playset complete",
      value: displayPct(metrics.playsetPct),
      pctValue: metrics.playsetPct,
    },
    {
      id: "set",
      label: "Set complete",
      value: displayPct(metrics.setPct),
      pctValue: metrics.setPct,
    },
    { id: "cards", label: "Cards", value: displayCards, sub: `(${displayUnique} unique)` },
    { id: "value", label: "Collection value", value: displayValue, sub: valueSub },
  ];

  return (
    <div className="inv-summary" ref={containerRef}>
      {blocks.map((block) => {
        const clickable = isAuthenticated;
        const open = clickable && expanded === block.id;
        const toggle = () => {
          hoverArmedRef.current = false;
          setExpanded((cur) => (cur === block.id ? null : block.id));
        };

        return (
          <span
            className={`inv-summary__block-wrap${
              narrowedFiltered ? " inv-summary__block-wrap--amber" : ""
            }`}
            key={block.id}
            ref={open ? openWrapRef : undefined}
            onMouseLeave={
              open
                ? () => {
                    if (hoverArmedRef.current) {
                      hoverArmedRef.current = false;
                      setExpanded(null);
                    }
                  }
                : undefined
            }
          >
            <span className={`inv-summary__block${open ? " inv-summary__block--open" : ""}`}>
              <div
                className="inv-summary__block-inner"
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                aria-expanded={clickable ? open : undefined}
                data-testid={`inv-summary-block-${block.id}`}
                onClick={clickable ? toggle : undefined}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle();
                        }
                      }
                    : undefined
                }
              >
                <span className="inv-summary__label-row">
                  <span className="inv-summary__label">{block.label}</span>
                  {clickable && (
                    <span className="inv-summary__chevron" aria-hidden="true">
                      {open ? "▴" : "▾"}
                    </span>
                  )}
                  {block.id === "value" && (
                    <PriceModeToggle mode={priceMode} onChange={setPriceMode} />
                  )}
                </span>
                <span className="inv-summary__value-row">
                  <span className="inv-summary__value">{block.value}</span>
                  {block.sub && <span className="inv-summary__sub">{block.sub}</span>}
                </span>
                {block.pctValue != null && <Ticks pct={block.pctValue} authed={isAuthenticated} />}
              </div>
            </span>
            {open && (
              <div
                className="inv-summary__popover"
                onClick={(e) => e.stopPropagation()}
                // Entering the popover arms the wrap-level
                // hover-dismiss above (click-away/Esc still work as
                // fallbacks for a never-hovered popover).
                onMouseEnter={() => {
                  hoverArmedRef.current = true;
                }}
              >
                <div className="inv-summary__popover-title">
                  <span>{block.label} by set</span>
                </div>
                {sets.length === 0 ? (
                  <div className="inv-summary__popover-empty">No base-set cards in scope</div>
                ) : (
                  breakdown.map((row) => {
                    const cell = popoverCell(block.id, row, isAuthenticated);
                    // Rows are a filter control when the pick handler is
                    // wired, reading/writing the sidebar's own set facet. A
                    // zero-universe row (no cards in scope map to this set)
                    // is inert -- selecting it could only produce an empty
                    // table -- EXCEPT when already selected, so a selected
                    // row never reads as dead.
                    const selected = selectedSetCodes?.has(row.code) ?? false;
                    const selectable =
                      isAuthenticated && !!onPickSetCode && (row.universeSize > 0 || selected);
                    const rowToggle = selectable ? () => onPickSetCode(row.code) : undefined;
                    return (
                      <div
                        className={`inv-summary__popover-row${
                          selectable ? " inv-summary__popover-row--selectable" : ""
                        }${selected ? " inv-summary__popover-row--selected" : ""}${
                          onPickSetCode && !selectable ? " inv-summary__popover-row--inert" : ""
                        }`}
                        key={row.code}
                        role={rowToggle ? "button" : undefined}
                        tabIndex={rowToggle ? 0 : undefined}
                        aria-pressed={rowToggle ? selected : undefined}
                        onClick={rowToggle}
                        onKeyDown={
                          rowToggle
                            ? (e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  rowToggle();
                                }
                              }
                            : undefined
                        }
                      >
                        <img
                          className="inv-summary__popover-logo"
                          src={`/images/set_${row.code}.png`}
                          alt={row.name}
                          title={row.name}
                        />
                        {cell.pctValue != null ? (
                          <>
                            <Ticks pct={cell.pctValue} authed={isAuthenticated} />
                            <span className="inv-summary__popover-pct">
                              {isAuthenticated ? `${cell.pctValue}%` : EM_DASH}
                            </span>
                          </>
                        ) : (
                          <span className="inv-summary__popover-right">
                            {/* Fixed two-column layout -- count
                                right-aligned, sub left-aligned, both
                                at constant x down the panel. The sub cell
                                renders even when empty (Value rows with no
                                unpriced cards) so the columns never shift. */}
                            <span className="inv-summary__popover-count">{cell.right}</span>
                            <span className="inv-summary__sub">{cell.sub ?? ""}</span>
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </span>
        );
      })}

      {/* The Filtered/All switch sits immediately right of the fourth
          block, inside the block row -- BEFORE the actions slot (View
          toggle / children). */}
      {showScopeToggle && (
        <span
          className={`inv-summary__totals${narrowedFiltered ? " inv-summary__totals--amber" : ""}`}
        >
          {/* Caption stacked ABOVE the switch; the switch keeps
              ValueSwitch's default (MKT/LOW) size. */}
          <span className="inv-summary__totals-label">Totals</span>
          <ValueSwitch
            checked={effectiveScope === "all"}
            label={effectiveScope === "all" ? "ALL" : "FILTERED"}
            ariaLabel={
              effectiveScope === "all"
                ? "Totals: showing all — switch to filtered"
                : "Totals: showing filtered — switch to all"
            }
            title={
              effectiveScope === "all"
                ? "All — every card in the catalog. Click for filtered totals."
                : "Filtered — matches what the table currently shows. Click for the whole catalog."
            }
            accent={narrowedFiltered ? "amber" : undefined}
            onToggle={() => setScope((cur) => (cur === "all" ? "filtered" : "all"))}
          />
        </span>
      )}

      {(viewMode != null || children) && (
        <span className="inv-summary__actions">
          {/* The width choice lives INSIDE the Table button (hover flyout;
              plain click = AUTO). */}
          {viewMode != null && onViewModeChange && (
            <ViewToggle
              viewMode={viewMode}
              onViewModeChange={onViewModeChange}
              widthTier={widthTier}
              onWidthTierChange={onWidthTierChange}
            />
          )}
          {children}
        </span>
      )}
    </div>
  );
}
