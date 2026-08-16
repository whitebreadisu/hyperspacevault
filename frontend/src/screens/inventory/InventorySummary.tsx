import React, { useEffect, useMemo, useRef, useState } from "react";
import type { InventoryCard } from "../../utils/inventory";
import type { ViewMode } from "../../components/FilterPanel";
import { buildSetBreakdown, computePanelMetrics, formatMoney } from "../../utils/completion";
import type { PriceMode, SetBreakdownRow, SetMeta } from "../../utils/completion";
import { useModalDismiss } from "../../hooks/useModalDismiss";
import { ValueSwitch } from "../cards/VariantScopeControls";
import type { WidthTier } from "../../utils/tableWidthTier";

/** BL-163 (Definition_CosmeticsBatch_2026-07-26.md §3): the completion
 * panel revamp -- four clipped-corner "blocks" (Playset complete %, Set
 * complete %, Cards, Collection value), a Filtered/All scope toggle, and a
 * click-to-expand "«metric» by set" breakdown popover per block. Replaces
 * the flat "label: value — label: value" strip (summaryStyle=blocks,
 * summaryAccent=white, progressViz=ticks/blue, breakdownLabel=image --
 * owner-saved defaults, Definition §0).
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
   * facet, search, or owned/incomplete toggle (Definition §3: "any
   * mechanism"). Governs whether the scope toggle renders at all; default
   * false (toggle hidden, panel always reads as "Filtered" -- equivalent to
   * "everything" when nothing is actually narrowed). */
  isNarrowed?: boolean;
  /** set_code -> true for the ten base sets (GET /api/sets' `is_base_set`),
   * used to scope the two completion percentages and exclude orphan base
   * cards (Definition §3). Defaults to empty (every card excluded from both
   * percentages -- a safe "not loaded yet" fallback that never shows a
   * fabricated 100%). */
  baseSetCodes?: Set<string>;
  /** The ten base sets, release-ordered (utils/catalog.ts's orderSetCodes),
   * for the breakdown popovers' row order. Defaults to empty, which shows
   * each popover's "No base-set cards in scope" empty state. */
  orderedBaseSets?: SetMeta[];
  children?: React.ReactNode;
  /** BL-56 §5.5: anonymous visitors have no inventory to summarize -- the
   * bar keeps its labels but every value renders as an em-dash instead of a
   * computed zero (a real zero would misleadingly imply "you own nothing,"
   * rather than "there is no inventory to look at"). Defaults to `true` so
   * every existing authenticated call site is unaffected. BL-163: also
   * empties every Ticks row and disables the scope toggle + all four
   * breakdown popovers (Definition §3's signed-out rule). */
  isAuthenticated?: boolean;
  /** BL-111 F3 (design handoff §3): "Table/gallery toggle sits LEFT of the
   * Add Cards button" -- CardsPage already owns viewMode as the single
   * source of truth (it also still feeds FilterPanel's own pre-existing
   * toggle, BL-73 Stage 1; see cards.css's .inv-summary__view-toggle
   * comment for why both controls coexist). Optional so every other/older
   * InventorySummary call site (and its tests) renders unchanged without
   * wiring a view mode. */
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  /** BL-226 (Issue #140): the Vault table's width-tier override -- AUTO /
   * COMPACT / STANDARD / FULL, rendered beside the Table/Gallery toggle
   * above, ONLY while `viewMode === "table"` (it has no meaning in
   * Gallery). Owned/persisted by CardsPage (utils/tableWidthTier.ts's
   * load/saveWidthTier), same optional-pair idiom as viewMode/
   * onViewModeChange above -- omitted entirely, the control simply doesn't
   * render, same as every other older/standalone InventorySummary call
   * site. */
  widthTier?: WidthTier;
  onWidthTierChange?: (tier: WidthTier) => void;
  /** BL-224 (unifies BL-179's parallel "home base set" dimension into the
   * sidebar's own Set facet): the popover rows' own universe -- every filter
   * applied EXCEPT the set facet itself (the rows are that facet's own
   * selection menu, and a menu never filters itself). Defaults to
   * `filteredCards`, which keeps every call site that doesn't wire it
   * exactly as it was. */
  breakdownCards?: InventoryCard[];
  /** BL-224: the set FACET's current selections (CardsPage's `filters.set`,
   * the single source of truth for both the sidebar and these popovers).
   * Rows render highlighted when their code is here -- effectively
   * `filters.set ∩ orderedBaseSets`, since only base sets ever get a row. */
  selectedSetCodes?: Set<string>;
  /** BL-224: row-click toggle -- writes the same set facet a sidebar click
   * would. Its presence is what makes rows selectable at all -- omitted
   * (older call sites, tests) renders the popovers exactly as before. */
  onToggleSetCode?: (code: string) => void;
}

// BL-223 (re-locked, builds on BL-224's set-facet unification): two-way --
// "filtered" (everything the table currently shows, BL-224 makes this true
// by construction) vs. "all" (the whole catalog, BL-163's original
// comparison). BL-179 round 9's third "selected" state (a parallel
// home-base-set dimension) is retired outright by BL-224 -- the set facet
// IS the sidebar's own dimension now, so there's nothing left for a third
// scope to distinguish.
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
  const btn = (mode: ViewMode, label: string, onClick?: () => void) => (
    <button
      type="button"
      className={`inv-summary__view-toggle-btn${
        viewMode === mode ? " inv-summary__view-toggle-btn--active" : ""
      }`}
      onClick={onClick ?? (() => onViewModeChange(mode))}
      aria-pressed={viewMode === mode}
    >
      {label}
    </button>
  );
  // BL-226 round 4 (owner's hybrid): the Table button ITSELF hosts the
  // width choice -- hovering (or keyboard-focusing) it reveals a flyout of
  // the four options; a plain Table click means AUTO. Only wired when the
  // caller passes the tier pair (older call sites/tests render the plain
  // two-button toggle unchanged).
  //
  // Round 5 (owner): the flyout closes the moment ANY selection is made --
  // CSS :hover alone can't do that (the cursor is still over the split), so
  // a `suppressed` state overrides the hover rule until the cursor leaves
  // and re-enters (mouseleave re-arms it).
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
              onViewModeChange("table");
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
                  onViewModeChange("table");
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

// BL-226 (Issue #140, owner-locked design): AUTO/COMPACT/STANDARD/FULL --
// same bordered-button-group visual idiom as ViewToggle above (matched
// class-for-class; only the padding/font-size are tuned slightly tighter, a
// judgment call to keep four longer labels from crowding the Add Cards/
// Import Export/Share buttons beside it -- see cards.css's
// .inv-summary__width-tier-toggle-btn comment).
const WIDTH_TIERS: { value: WidthTier; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "compact", label: "Compact" },
  { value: "standard", label: "Standard" },
  { value: "full", label: "Full" },
];

/** progressViz=ticks, progressColor=blue (Definition §0): 10 skewed tick
 * marks, `Math.round(pct / 10)` of them filled. `authed=false` always
 * renders every tick empty regardless of `pct` -- the signed-out "empty
 * ticks" rule (Definition §3), rather than a misleading filled bar over a
 * fabricated percentage. */
function Ticks({ pct, authed }: { pct: number; authed: boolean }) {
  const filled = authed ? Math.round(pct / 10) : 0;
  // Owner dev review 2026-07-26: at 100% the ticks read green -- the CSS
  // scopes the green fill to the popover context only (the block's own
  // ticks stay blue), so the class is emitted unconditionally here.
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

/** Market/Low toggle for the Collection-value block, styled after (but not
 * imported from -- CardPopup is being decomposed by a parallel BL-155
 * effort) CardPopup.tsx's `cp-rail__pricemode`/`cp-rail__pricemode-btn`
 * rail-header pattern. Lives under its own `.inv-summary__pricemode*`
 * namespace in cards.css. */
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
  onToggleSetCode,
}: Props) {
  const [scope, setScope] = useState<Scope>("filtered");
  const [priceMode, setPriceMode] = useState<PriceMode>("market");
  const [expanded, setExpanded] = useState<BlockId | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // The open block's wrap element (block + popover) -- the click-away
  // boundary. Assigned via the wrap's conditional ref below; React nulls it
  // when the popover closes or moves to another block.
  const openWrapRef = useRef<HTMLSpanElement | null>(null);
  // BL-179 round 4 (owner): hover-dismiss arming. The popover closes on
  // pointer-leave only after the pointer has actually been inside it once
  // (the "display until I mouse over it" rule) -- and the leave boundary is
  // the whole wrap (block + gap-bridge + popover), so drifting between the
  // popover and its block never counts as leaving (round 2's popover-only
  // mouseleave felt twitchy across the 8px gap).
  const hoverArmedRef = useRef(false);

  const codes = baseSetCodes ?? EMPTY_BASE_SET_CODES;
  const sets = orderedBaseSets ?? EMPTY_ORDERED_BASE_SETS;

  // Scope toggle only renders when the list is genuinely narrowed AND the
  // caller is authenticated -- Definition §3's "hidden when unfiltered" +
  // signed-out "scope toggle hidden" rules.
  const showScopeToggle = isNarrowed && isAuthenticated;

  // BL-223: binary once more -- the toggle-hidden case always reads as
  // Filtered (unchanged BL-163 behavior).
  const effectiveScope: Scope = !showScopeToggle ? "filtered" : scope;

  // BL-223 §3 (owner-locked): the "narrowed state" amber treatment -- the
  // switch AND all four blocks -- applies only while the switch actually
  // renders AND reads Filtered. Hidden-toggle and All both read as today's
  // fully neutral look.
  const narrowedFiltered = showScopeToggle && effectiveScope === "filtered";

  const activeCards = effectiveScope === "all" ? (allCards ?? filteredCards) : filteredCards;

  const metrics = useMemo(
    () => computePanelMetrics(activeCards, codes, priceMode),
    [activeCards, codes, priceMode]
  );

  // BL-224: the popover rows' universe is ALWAYS "every filter except the
  // set facet" -- independent of the Filtered/All switch above, which only
  // ever governs the four blocks' own headline metrics. The rows are the
  // set facet's selection menu; a menu never filters itself.
  const rowCards = breakdownCards ?? filteredCards;

  const breakdown = useMemo(
    () => buildSetBreakdown(rowCards, sets, priceMode),
    [rowCards, sets, priceMode]
  );

  // Click-away close, MultiSelect.tsx's established idiom: a document-level
  // mousedown listener, attached only while a popover is open. Owner dev
  // review 2026-07-26: scoped to the OPEN block's wrap (block + its popover)
  // rather than the whole summary strip -- clicking anywhere else, including
  // the strip's other blocks/toggles/empty space, closes the panel.
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
                // BL-179 round 4: entering the popover arms the wrap-level
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
                    // BL-224: rows are a filter control when the toggle is
                    // wired, reading/writing the sidebar's own set facet. A
                    // zero-universe row (no cards in scope map to this set)
                    // is inert -- selecting it could only produce an empty
                    // table -- EXCEPT when already selected: a selection
                    // must always be removable, or a later filter change
                    // could strand it.
                    const selected = selectedSetCodes?.has(row.code) ?? false;
                    const selectable =
                      isAuthenticated && !!onToggleSetCode && (row.universeSize > 0 || selected);
                    const rowToggle = selectable ? () => onToggleSetCode(row.code) : undefined;
                    return (
                      <div
                        className={`inv-summary__popover-row${
                          selectable ? " inv-summary__popover-row--selectable" : ""
                        }${selected ? " inv-summary__popover-row--selected" : ""}${
                          onToggleSetCode && !selectable ? " inv-summary__popover-row--inert" : ""
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
                            {/* Round 5 (owner): fixed two-column layout --
                                count right-aligned, sub left-aligned, both
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

      {/* BL-223 (re-locked): the Filtered/All switch sits immediately right
          of the fourth block, inside the block row -- BEFORE the actions
          slot (View toggle / children). BL-224 retired the old full-width
          strip row entirely (nothing else lived in it once the amber
          base-set readout and the three-way toggle both went away). */}
      {showScopeToggle && (
        <span
          className={`inv-summary__totals${narrowedFiltered ? " inv-summary__totals--amber" : ""}`}
        >
          {/* Owner review rounds 2-3 (2026-08-16): caption stacked ABOVE
              the switch; round 3 reverted the size back to the small
              MKT/LOW height. */}
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
          {/* BL-226 round 4 (owner's hybrid -- supersedes the standalone
              stacked control): the width choice lives INSIDE the Table
              button (hover flyout; plain click = AUTO). */}
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
