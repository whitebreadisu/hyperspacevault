import React, { useEffect, useMemo, useRef, useState } from "react";
import type { InventoryCard } from "../../utils/inventory";
import type { ViewMode } from "../../components/FilterPanel";
import { buildSetBreakdown, computePanelMetrics, formatMoney } from "../../utils/completion";
import type { PriceMode, SetBreakdownRow, SetMeta } from "../../utils/completion";
import { useModalDismiss } from "../../hooks/useModalDismiss";
import { ValueSwitch } from "../cards/VariantScopeControls";

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
  /** BL-179: the popover rows' own universe -- every filter applied EXCEPT
   * the home-base-set selection below (the rows are the selection menu, and
   * the menu never filters itself). Defaults to `filteredCards`, which keeps
   * every call site that doesn't wire selection exactly as it was. */
  breakdownCards?: InventoryCard[];
  /** BL-179: the shared home-base-set selection (one state across all four
   * blocks' popovers -- CardsPage owns it, same single-source-of-truth shape
   * as viewMode above). Rows render highlighted when their code is here. */
  selectedHomeSets?: Set<string>;
  /** BL-179: row-click toggle. Its presence is what makes rows selectable at
   * all -- omitted (older call sites, tests) renders the popovers exactly as
   * before. */
  onToggleHomeSet?: (code: string) => void;
  /** BL-179: the set FACET's current selections (release-ordered codes) --
   * the popovers' top-right "Sets selected:" readout, so the rows' universe
   * is legible when a FilterPanel set choice is shaping it. */
  filterSetCodes?: string[];
  /** BL-179 round 9 (owner): clears every popover base-set selection (the
   * amber strip row's ✕ -- never touches the FilterPanel facet). */
  onClearHomeSets?: () => void;
}

// BL-179 round 9: three-way -- "selected" (filter panel + popover base-set
// selections) exists only while such selections do; "filtered" (filter
// panel only); "all" (whole catalog, BL-163's original comparison).
type Scope = "selected" | "filtered" | "all";
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
}: {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}) {
  const btn = (mode: ViewMode, label: string) => (
    <button
      type="button"
      className={`inv-summary__view-toggle-btn${
        viewMode === mode ? " inv-summary__view-toggle-btn--active" : ""
      }`}
      onClick={() => onViewModeChange(mode)}
      aria-pressed={viewMode === mode}
    >
      {label}
    </button>
  );
  return (
    <span role="group" aria-label="View" className="inv-summary__view-toggle">
      {btn("table", "Table")}
      {btn("gallery", "Gallery")}
    </span>
  );
}

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
  breakdownCards,
  selectedHomeSets,
  onToggleHomeSet,
  filterSetCodes,
  onClearHomeSets,
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

  // BL-179 round 9 (owner): the toggle is three-way once popover base-set
  // selections exist. "Selected sets" = filter panel + base-set selections
  // (what the table shows; segment renders only while selections exist);
  // "Filtered" = filter panel only; "All" = the whole catalog (BL-163's
  // original comparison, restored after round-8's two-way redesign briefly
  // dropped it).
  const hasHomeSelection = !!onToggleHomeSet && (selectedHomeSets?.size ?? 0) > 0;

  // Auto-follow on transitions so the headline keeps matching the table:
  // the first base-set selection jumps the scope to "Selected sets"; the
  // last one clearing falls back to "Filtered". Between transitions the
  // user's own toggle choice is never fought.
  const prevHasHomeSelRef = useRef(hasHomeSelection);
  useEffect(() => {
    if (prevHasHomeSelRef.current === hasHomeSelection) return;
    prevHasHomeSelRef.current = hasHomeSelection;
    if (hasHomeSelection) setScope("selected");
    else setScope((cur) => (cur === "selected" ? "filtered" : cur));
  }, [hasHomeSelection]);

  // Effective scope guards the stale-"selected" instant before the effect
  // above lands (and the toggle-hidden case).
  const effectiveScope = !showScopeToggle
    ? "filtered"
    : scope === "selected" && !hasHomeSelection
      ? "filtered"
      : scope;

  const activeCards =
    effectiveScope === "all"
      ? (allCards ?? filteredCards)
      : effectiveScope === "filtered" && hasHomeSelection
        ? (breakdownCards ?? filteredCards)
        : // "selected" (filter panel + base-set selections), and the plain
          // filtered case when no base-set selection exists -- both are the
          // caller's post-everything list.
          filteredCards;

  const metrics = useMemo(
    () => computePanelMetrics(activeCards, codes, priceMode),
    [activeCards, codes, priceMode]
  );

  // BL-179: the rows' universe -- under "Selected sets" AND "Filtered" the
  // rows ignore the home-base-set selection (the menu never filters
  // itself), i.e. both use breakdownCards; under "All" they cover the whole
  // catalog exactly as before.
  const rowCards =
    effectiveScope === "all" ? (allCards ?? filteredCards) : (breakdownCards ?? filteredCards);

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
            className="inv-summary__block-wrap"
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
                  {/* BL-179: the set FACET's selections, shown so the rows'
                      universe is legible when a FilterPanel set choice
                      (typically a non-base set) is shaping it. */}
                  {filterSetCodes && filterSetCodes.length > 0 && (
                    <span className="inv-summary__popover-filtersets">
                      Sets selected: {filterSetCodes.join(", ")}
                    </span>
                  )}
                </div>
                {sets.length === 0 ? (
                  <div className="inv-summary__popover-empty">No base-set cards in scope</div>
                ) : (
                  breakdown.map((row) => {
                    const cell = popoverCell(block.id, row, isAuthenticated);
                    // BL-179: rows are a filter control when the toggle is
                    // wired. A zero-universe row (no cards in scope map to
                    // this set) is inert -- selecting it could only produce
                    // an empty table -- EXCEPT when already selected: a
                    // selection must always be removable, or a later filter
                    // change could strand it.
                    const selected = selectedHomeSets?.has(row.code) ?? false;
                    const selectable =
                      isAuthenticated && !!onToggleHomeSet && (row.universeSize > 0 || selected);
                    const rowToggle = selectable ? () => onToggleHomeSet(row.code) : undefined;
                    return (
                      <div
                        className={`inv-summary__popover-row${
                          selectable ? " inv-summary__popover-row--selectable" : ""
                        }${selected ? " inv-summary__popover-row--selected" : ""}${
                          onToggleHomeSet && !selectable ? " inv-summary__popover-row--inert" : ""
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

      {(viewMode != null || children) && (
        <span className="inv-summary__actions">
          {viewMode != null && onViewModeChange && (
            <ViewToggle viewMode={viewMode} onViewModeChange={onViewModeChange} />
          )}
          {children}
        </span>
      )}

      {/* BL-179 round 9 (owner): full-width strip row under the blocks --
          LAST in DOM so flex-wrap keeps the blocks + actions on row one.
          Amber bracket-style readout of the popover base-set selections
          (with its clear ✕) when any exist, and the scope toggle (moved
          from beside the blocks; three-way while selections exist). */}
      {showScopeToggle && (
        <div className="inv-summary__scoperow">
          {hasHomeSelection && (
            <span className="inv-summary__basesets">
              <span className="inv-summary__basesets-label">
                Base sets:{" "}
                {sets
                  .filter((s) => selectedHomeSets!.has(s.code))
                  .map((s) => s.code)
                  .join(" · ")}
              </span>
              {onClearHomeSets && (
                <button
                  type="button"
                  className="inv-summary__basesets-clear"
                  onClick={onClearHomeSets}
                  aria-label="Clear base set selections"
                >
                  ✕
                </button>
              )}
            </span>
          )}
          <span className="inv-summary__scope">
            <span className="inv-summary__scope-toggle">
              <span className="inv-summary__scope-toggle-label">Scope</span>
              <span role="group" aria-label="Metric scope" className="inv-summary__scope-group">
                {hasHomeSelection && (
                  <button
                    type="button"
                    className={`inv-summary__scope-btn${
                      effectiveScope === "selected" ? " inv-summary__scope-btn--active" : ""
                    }`}
                    aria-pressed={effectiveScope === "selected"}
                    onClick={() => setScope("selected")}
                  >
                    Selected sets
                  </button>
                )}
                <button
                  type="button"
                  className={`inv-summary__scope-btn${
                    effectiveScope === "filtered" ? " inv-summary__scope-btn--active" : ""
                  }`}
                  aria-pressed={effectiveScope === "filtered"}
                  onClick={() => setScope("filtered")}
                >
                  Filtered
                </button>
                <button
                  type="button"
                  className={`inv-summary__scope-btn${
                    effectiveScope === "all" ? " inv-summary__scope-btn--active" : ""
                  }`}
                  aria-pressed={effectiveScope === "all"}
                  onClick={() => setScope("all")}
                >
                  All
                </button>
              </span>
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
