import React, { useState, useEffect, useRef } from "react";
import { AspectIcon } from "./AspectIcon";
import { MultiSelect } from "./MultiSelect";
import { FinishFilter } from "./FinishFilter";
import { RangeSlider } from "./RangeSlider";
import { SWUButton } from "./SWUButton";
import { isInsideFilterMenuPortal } from "./FilterMenuPortal";
import type { BaseCard } from "../utils/catalog";
import { getSets } from "../api/sets";
import type { CardSet } from "../api/sets";
import { capture } from "../analytics/analytics";
import { tierForViewportHeight, fitsDockedViewport } from "../utils/filterPanelTiers";
import { allSetsGroups, isBaseSetCode } from "../utils/setGrouping";
import {
  ASPECT_LIST,
  NO_ASPECT,
  ASPECT_MATCH_MODES,
  TYPE_OPTIONS,
  RARITY_OPTIONS,
  ARENA_OPTIONS,
  COST_MAX,
  POWER_MAX,
  HP_MAX,
  distinctMulti,
  buildFinishTree,
  facetValidValues,
  facetedOptions,
  DEFAULT_FILTERS,
  isDefaultFilterState,
  countActiveFilters,
} from "../utils/filters";
import type { FilterState, SelectOption, AspectMatchMode } from "../utils/filters";
import "./FilterPanel.css";

// Panel UI only — filter logic, domain constants, FilterState/DEFAULT_FILTERS,
// applyFilters, and the faceting helpers live in utils/filters.ts.
//
// A collapsible console-styled sidebar (App Spec §5.6, §5.15). Outside the
// docked state it FLOATS over the table/gallery as an overlay (its content
// is absolutely positioned, so it takes no layout width and collapsing it
// does not change CardsTable/GalleryGrid's measured width). In the docked
// state (fitsDockedViewport) the expanded sidebar sits in-flow beside the
// content; the docking rules live in FilterPanel.css and cards.css. The
// sidebar styles the shell, aspects, search and reset button; the
// MultiSelect/FinishFilter dropdowns share the `ifp-multi*` classes in
// FilterPanel.css.

// ── AspectPicker ──────────────────────────────────────────────────────────
//
// Aspects default empty (= unfiltered), matching every other facet, so
// "everything lit up" is driven by `selected.size === 0` rather than
// `selected.size === ASPECT_LIST.length`. The universe includes the
// NO_ASPECT sentinel as an explicit "No Aspect" chit (rendered as a
// circle-slash glyph) and options arrive already faceted via
// `facetedOptions`, same as every other control.

interface AspectPickerProps {
  options: SelectOption[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}

export function AspectPicker({ options, selected, onToggle }: AspectPickerProps) {
  const noFilter = selected.size === 0;
  return (
    <div className="ifp-aspects">
      {options.map((opt) => {
        const isChecked = selected.has(opt.value);
        const isActive = noFilter || isChecked;
        // Same rule as MultiSelect: an inert (0-facet) option can't be
        // newly added, but if it's already selected (a stale value) it
        // stays clickable so it can still be removed.
        const disabled = opt.inert && !isChecked;
        return (
          <button
            key={opt.value}
            type="button"
            className={`ifp-aspect${isChecked ? " ifp-aspect--checked" : ""}${
              isActive ? "" : " ifp-aspect--off"
            }${opt.inert ? " ifp-aspect--inert" : ""}`}
            onClick={() => onToggle(opt.value)}
            title={opt.label}
            aria-pressed={isActive}
            disabled={disabled}
          >
            {opt.value === NO_ASPECT ? (
              <svg className="ifp-aspect__none-icon" width="18" height="18" viewBox="0 0 20 20">
                <circle cx="10" cy="10" r="7" stroke="currentColor" fill="none" strokeWidth="2" />
                <path
                  d="M5.4 5.4L14.6 14.6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <AspectIcon aspect={opt.value} size={24} />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── AspectModeControl ──────────────────────────────────────────────────────
//
// Three-way segmented control -- [ Any | Within | Exact ] -- governing how
// the aspect selection above is matched (see AspectMatchMode in
// utils/filters.ts for the semantics). Styled after the same compact
// bordered-row segmented idiom InventorySummary's Table/Gallery toggle uses
// (`.inv-summary__view-toggle*`, cards.css) rather than ADR-0013's
// full-width radio-with-description list (`.sl-capmode`, SettingsPage.tsx)
// -- that control's own layout doesn't fit a group header, but it's the
// same steel-blue active-fill idiom (`var(--color-primary)` on the active
// segment) both controls already share.

const ASPECT_MODE_META: Record<AspectMatchMode, { label: string; tooltip: string }> = {
  any: {
    label: "Any",
    tooltip: "Any — cards carrying any one of the selected aspects.",
  },
  within: {
    label: "Within",
    tooltip:
      "Within — no card carrying an aspect outside the selection (what fits a deck built from these aspects).",
  },
  exact: {
    label: "Exact",
    tooltip: "Exact — the card's aspect set matches the selection exactly.",
  },
};

interface AspectModeControlProps {
  mode: AspectMatchMode;
  onChange: (mode: AspectMatchMode) => void;
}

export function AspectModeControl({ mode, onChange }: AspectModeControlProps) {
  return (
    <div className="ifp-aspect-mode" role="radiogroup" aria-label="Aspect matching mode">
      {ASPECT_MATCH_MODES.map((value) => {
        const meta = ASPECT_MODE_META[value];
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`ifp-aspect-mode__btn${active ? " ifp-aspect-mode__btn--active" : ""}`}
            title={meta.tooltip}
            onClick={() => onChange(value)}
          >
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}

// ── FilterPanel ───────────────────────────────────────────────────────────

/** Table ↔ Gallery view mode. The type lives in this module because other
 * modules import `ViewMode` from here; the toggle CONTROL itself is not in
 * FilterPanel -- it renders in InventorySummary's actions slot (App Spec
 * §5.6), wired to the CardsPage-owned viewMode/onViewModeChange. */
export type ViewMode = "table" | "gallery";

interface FilterPanelProps {
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  cards: BaseCard[];
  children?: React.ReactNode;
  /** "Reset All Filters" clears EVERYTHING -- FilterState plus any filter
   * state living outside it (the CardsPage-owned Collection checkboxes).
   * Called alongside the DEFAULT_FILTERS reset. */
  onResetAll?: () => void;
  /** How many out-of-FilterState filters are active -- the CardsPage-owned
   * Collection checkboxes (one each). Feeds the rail and head badges (they
   * ARE applied filters) and keeps Reset active whenever > 0 so it can
   * clear them. */
  externalActiveCount?: number;
  /** Fired synchronously, once per individual field a control here
   * actually changes (search excluded -- CardsPage instruments that
   * separately as search_performed) -- CardsPage stashes the field name in a
   * ref and reads the post-change results_count/active_filter_count off its
   * own next render, since this component has no visibility into the
   * filtered row count (event fields: App Spec §22). Optional. */
  onFieldChanged?: (field: string) => void;
}

export function FilterPanel({
  filters,
  setFilters,
  cards,
  children,
  onResetAll,
  externalActiveCount = 0,
  onFieldChanged,
}: FilterPanelProps) {
  // Starts open exactly when the viewport is in the docked state
  // (fitsDockedViewport -- one-column tier fits AND both columns fit side
  // by side). The docked state asserts itself LIVE: entering it
  // auto-expands the panel; leaving it collapses back to the overlay rail;
  // within it, only the explicit « button collapses (no hover-collapse,
  // and a « collapse is respected until the state is left and re-entered).
  // See the docked-transition effect below.
  const [open, setOpen] = useState(() => fitsDockedViewport(window.innerWidth, window.innerHeight));
  const [sets, setSets] = useState<CardSet[]>([]);
  // Base/long-tail set toggle (App Spec §5.1): defaults to base sets only;
  // the header button inside the Set dropdown expands to all sets.
  const [showAllSets, setShowAllSets] = useState(false);
  useEffect(() => {
    getSets()
      .then(setSets)
      .catch((err) => console.error("Failed to load sets:", err));
  }, []);

  const update = (patch: Partial<FilterState>) => setFilters((prev) => ({ ...prev, ...patch }));

  // Single-action reset back to DEFAULT_FILTERS -- search, every facet
  // Set, and the cost/power/HP ranges, in one click -- plus whatever
  // onResetAll clears (the Collection checkboxes). It does NOT touch other
  // view state (sort, view mode, etc.). `isDefaultFilterState`
  // (utils/filters.ts) plus externalActiveCount drive the inert state below,
  // so the control doubles as a "filters are active" indicator: it stays
  // active when only the external filters are on.
  const isDefault = isDefaultFilterState(filters);
  const resetInert = isDefault && externalActiveCount === 0;
  const resetFilters = () => {
    capture("filters_cleared", {});
    setFilters(DEFAULT_FILTERS);
    onResetAll?.();
  };

  const toggleAspect = (value: string) => {
    onFieldChanged?.("aspect");
    setFilters((prev) => {
      // No snap-back -- deselecting the last active value is a stable
      // "unfiltered" state (size 0), not forced back to all-selected.
      const noFilter = prev.aspects.size === 0;
      let next: Set<string>;
      if (noFilter) {
        // Everything reads as implicitly active when unfiltered; clicking
        // one narrows straight to just that value.
        next = new Set([value]);
      } else if (prev.aspects.has(value)) {
        next = new Set(prev.aspects);
        next.delete(value);
      } else {
        next = new Set(prev.aspects);
        next.add(value);
      }
      return { ...prev, aspects: next };
    });
  };

  // The Set dropdown orders its values with the SAME logic as the Add
  // Cards set picker (utils/setGrouping.ts's allSetsGroups): base sets in
  // canonical-then-secondary display order (newest main set first, App Spec
  // §5.1, ADR-0031) with each set's Weekly Play container IMMEDIATELY after
  // it (HMW, HMWP, ASH, ...), then the Exclusives in their subgroup order
  // (Convention → Judge → Promos → Other promos).
  // The whole base+WP block is `pinned`, so MultiSelect's divider
  // primitive draws the one boundary before the Exclusives. Base view
  // (show-all off) stays the base sets only. Any future set code the
  // curated grouping doesn't know yet falls in at the end alphabetically
  // rather than silently vanishing (allSetsGroups only emits codes it
  // recognizes).
  const { baseGroups, exclusiveGroups } = allSetsGroups(sets);
  const baseBlockCodes = baseGroups.flatMap((g) => g.memberCodes);
  const exclusiveCodes = exclusiveGroups.flatMap((g) => g.memberCodes);
  const groupedCodes = new Set([...baseBlockCodes, ...exclusiveCodes]);
  const leftoverCodes = sets
    .map((s) => s.code)
    .filter((code) => !groupedCodes.has(code))
    .sort((a, b) => a.localeCompare(b));
  const visibleSetCodes = showAllSets
    ? [...baseBlockCodes, ...exclusiveCodes, ...leftoverCodes]
    : baseBlockCodes.filter(isBaseSetCode);
  const setOptions = visibleSetCodes.map((code) => {
    const set = sets.find((s) => s.code === code)!;
    return {
      value: code,
      label: `${code} — ${set.name}`,
      pinned: baseBlockCodes.includes(code),
    };
  });
  // The Finish field's universe is shaped into a two-tier tree (pair
  // rows/groups/plain rows) -- see buildFinishTree/shapeFinishTree in
  // utils/filters.ts. FinishFilter.tsx does its own
  // faceted shaping internally (shapeFinishTree), so only the raw tree +
  // the facet-valid set are computed here, mirroring every other field's
  // `distinctX(cards)` + `facetValidValues(...)` pair below.
  const finishTree = buildFinishTree(cards);
  const finishValid = facetValidValues(cards, filters, "finish");
  const keywordOptions = distinctMulti(cards, "keywords");
  const traitOptions = distinctMulti(cards, "traits");

  // Facet each dropdown against "every other active filter" (the
  // dead-end-prevention rule -- own selection ignored; App Spec §5.6), then
  // fold the result + the current selection into what each MultiSelect
  // actually renders. Every universe value is listed: one with no matches
  // is greyed with "(0)" and cannot be added (a selected one stays
  // removable). `cards` here is already toggle-narrowed by the caller
  // (CardsPage folds the Collection toggles in before passing it down), so
  // facets automatically respect those toggles too.
  // The aspects universe is the 6 real aspects plus the explicit
  // "No Aspect" pseudo-option; faceted identically to every other field --
  // its count is the aspectless cards in the current (other-filters-
  // applied) result set, same mechanism as any other value going inert.
  const aspectUniverse: SelectOption[] = [
    ...ASPECT_LIST.map((a) => ({ value: a, label: a })),
    { value: NO_ASPECT, label: "No Aspect" },
  ];
  const facetedAspectOptions = facetedOptions(
    aspectUniverse,
    facetValidValues(cards, filters, "aspects"),
    filters.aspects,
    true
  );
  const facetedSetOptions = facetedOptions(
    setOptions,
    facetValidValues(cards, filters, "set"),
    filters.set,
    true
  );
  const facetedTypeOptions = facetedOptions(
    TYPE_OPTIONS,
    facetValidValues(cards, filters, "type"),
    filters.type,
    true
  );
  const facetedRarityOptions = facetedOptions(
    RARITY_OPTIONS,
    facetValidValues(cards, filters, "rarity"),
    filters.rarity,
    true
  );
  const facetedKeywordOptions = facetedOptions(
    keywordOptions,
    facetValidValues(cards, filters, "keyword"),
    filters.keyword,
    true
  );
  const facetedTraitOptions = facetedOptions(
    traitOptions,
    facetValidValues(cards, filters, "trait"),
    filters.trait,
    true
  );
  const facetedArenaOptions = facetedOptions(
    ARENA_OPTIONS,
    facetValidValues(cards, filters, "arena"),
    filters.arena,
    true
  );

  // The badges count the external filters too -- the Collection checkboxes
  // narrow the list exactly like any facet, so a collapsed rail must not
  // read "0 filters" while they're active.
  const activeCount = countActiveFilters(filters) + externalActiveCount;

  // ── Vertical-tier model (App Spec §5.6) -- one resize listener drives a
  // `data-vtier` attribute that
  // FilterPanel.css reads to swap density (COMPACT) and, past that, a
  // designed two-column layout (TWO-COL) with a pinned-header internal-
  // scroll fallback for very short windows. tierForViewportHeight is the
  // pure avail -> tier decision (utils/filterPanelTiers.ts), unit-tested
  // independently of this component. No CSS media queries -- this is the
  // one source of truth for the thresholds.
  // State holds the RESOLVED tier, not raw window.innerHeight -- the raw
  // value changes every frame of a drag, re-rendering this (heavy) panel
  // per-pixel and starving the frame budget; resolving inside the listener
  // means setState almost always receives the same value (React bails out),
  // so the panel re-renders only at genuine tier crossings. Same pattern as
  // CardsTable's own step-count observer.
  const [tier, setTier] = useState(() => tierForViewportHeight(window.innerHeight));
  useEffect(() => {
    const onResize = () => setTier(tierForViewportHeight(window.innerHeight));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const twoCol = tier === "two-col" || tier === "fallback";

  // ── Click-outside collapses the expanded panel, but ONLY in the
  // non-docked (floating-overlay) presentation -- docked side-by-side mode
  // is unaffected. `docked` is LIVE tracked state (unlike `open`'s own
  // lazy-initializer read above), because the effects below need the
  // CURRENT presentation, not just the one at mount, to attach/detach
  // correctly as the window resizes across the breakpoint.
  // Docked = the ONE-COLUMN sidebar and the full-width table genuinely
  // coexist -- width (the docking pair arithmetic) AND height (tier still
  // full/compact; a two-col/fallback tier's 452px sidebar never docks).
  // Mirrors the CSS docking media query exactly. Same resolved-not-raw
  // pattern as `tier` above -- the boolean flips only at the breakpoint, so
  // per-pixel resize events bail.
  const [docked, setDocked] = useState(() =>
    fitsDockedViewport(window.innerWidth, window.innerHeight)
  );
  useEffect(() => {
    const onResize = () => setDocked(fitsDockedViewport(window.innerWidth, window.innerHeight));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // The docked state asserts itself on transitions. Entering it -- page
  // load handled by `open`'s initializer above, resize/zoom here --
  // auto-expands the panel (the only case in which the filter
  // auto-expands); leaving it collapses to the overlay rail. Between
  // transitions nothing competes with the user's own clicks:
  // a « collapse while docked sticks until the state is left and
  // re-entered.
  const prevDockedRef = useRef(docked);
  useEffect(() => {
    if (prevDockedRef.current === docked) return;
    prevDockedRef.current = docked;
    setOpen(docked);
  }, [docked]);

  useEffect(() => {
    if (!open || docked) return undefined;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // The collapse ("«") toggle button lives INSIDE .ifp-sidebar, so a
      // click on it is "inside" here -- its own onClick handles closing,
      // this listener staying silent for that click is what keeps the
      // toggle a single state change instead of close-then-reopen flicker.
      // Clicks inside a portaled filter dropdown (FilterMenuPortal,
      // e.g. MultiSelect/FinishFilter's menu, which
      // renders under document.body, escaping this DOM subtree) also count
      // as "inside" -- interacting with a filter's own dropdown must not
      // collapse the panel out from under it.
      if (
        sidebarRef.current &&
        !sidebarRef.current.contains(target) &&
        !isInsideFilterMenuPortal(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open, docked]);

  // Overlay-mode hover-collapse -- the floating panel closes when the
  // pointer settles on anything outside it; docked mode (both columns
  // genuinely fit side by side) never auto-collapses. Deliberately a
  // document-level `mouseover` (fires on whatever element the pointer
  // ENTERS) rather than the sidebar's own mouseleave: leave-based dismissal
  // misses the exit path through a portaled facet menu (DOM-outside the
  // sidebar, so the sidebar's leave fires -- guarded -- when the pointer
  // enters the menu, and never again when it exits the menu outward).
  // Guards: a held button (slider drag straying past the edge) is not a
  // leave, and the portaled menus themselves count as inside.
  //
  // ARMED like the completion popovers -- the collapse fires only after the
  // pointer has actually been inside the panel once per open. The rail and
  // the expanded panel occupy different spots, so the expand click leaves
  // the pointer "outside" the new panel and an unarmed listener would
  // collapse it on the very next mouseover (open-flash-collapse).
  // Click-away (the mousedown effect above) still covers a never-hovered
  // panel.
  const hoverArmedRef = useRef(false);
  useEffect(() => {
    hoverArmedRef.current = false;
  }, [open]);
  useEffect(() => {
    if (!open || docked) return undefined;
    const onDocOver = (e: MouseEvent) => {
      if (e.buttons !== 0) return;
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (sidebarRef.current?.contains(target) || isInsideFilterMenuPortal(target)) {
        hoverArmedRef.current = true;
        return;
      }
      if (!hoverArmedRef.current) return;
      setOpen(false);
    };
    document.addEventListener("mouseover", onDocOver);
    return () => document.removeEventListener("mouseover", onDocOver);
  }, [open, docked]);

  // ── Blocks (identical content across tiers -- only arrangement varies) ──
  const searchEl = (
    <div className="ifp-search">
      <svg className="ifp-search__icon" width="13" height="13" viewBox="0 0 16 16">
        <circle cx="7" cy="7" r="5" stroke="currentColor" fill="none" strokeWidth="1.5" />
        <path d="M10.5 10.5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        type="text"
        placeholder="Search cards…"
        value={filters.search}
        onChange={(e) => update({ search: e.target.value })}
      />
      {filters.search && (
        <button
          type="button"
          className="ifp-search__clear"
          onClick={() => update({ search: "" })}
          aria-label="Clear search"
        >
          ×
        </button>
      )}
    </div>
  );

  const aspectsEl = (
    <AspectPicker
      options={facetedAspectOptions}
      selected={filters.aspects}
      onToggle={toggleAspect}
    />
  );

  // The three-way matching-mode control lives beside the aspect chits in
  // every tier -- the single-column layout puts it in the "Aspects" group's
  // own header row; the two-col layout's top span drops that label but
  // still needs the control, so it renders directly beside the chits there
  // instead.
  const aspectModeEl = (
    <AspectModeControl
      mode={filters.aspectMode}
      onChange={(aspectMode) => {
        onFieldChanged?.("aspect_mode");
        update({ aspectMode });
      }}
    />
  );

  // Groups: Card = Set/Rarity/Finish, Gameplay = the four multi-selects
  // (Type/Arenas/Keywords/Traits) then the three range sliders
  // (Cost/Power/HP), Collection = the host checkboxes only. Field order
  // within each group is a fixed design decision -- do not reorder. Applies
  // at every tier (content, not layout).
  const cardGroup = (
    <div className="ifp-sidebar__group">
      <span className="ifp-sidebar__group-label">Card</span>
      <MultiSelect
        label="Set"
        values={filters.set}
        onChange={(v) => {
          onFieldChanged?.("set");
          update({ set: v });
        }}
        options={facetedSetOptions}
        placeholder="All sets"
        showAllButton={false}
        // Menu opens wide enough that no set label wraps -- same treatment
        // as the Finish menu; control width unchanged.
        menuMinWidth={320}
        menubarExtra={
          <button
            type="button"
            className="ifp-multi__bar-btn"
            onClick={(e) => {
              e.stopPropagation();
              setShowAllSets((v) => !v);
            }}
          >
            {showAllSets ? "Base sets only" : "Show all sets"}
          </button>
        }
      />
      <MultiSelect
        label="Rarity"
        values={filters.rarity}
        onChange={(v) => {
          onFieldChanged?.("rarity");
          update({ rarity: v });
        }}
        options={facetedRarityOptions}
        placeholder="All rarities"
      />
      <FinishFilter
        label="Finish"
        values={filters.finish}
        onChange={(v) => {
          onFieldChanged?.("finish");
          update({ finish: v });
        }}
        tree={finishTree}
        valid={finishValid}
        showAllValues
        placeholder="All finishes"
      />
    </div>
  );

  const gameplayGroup = (
    <div className="ifp-sidebar__group">
      <span className="ifp-sidebar__group-label">Gameplay</span>
      <MultiSelect
        label="Type"
        values={filters.type}
        onChange={(v) => {
          onFieldChanged?.("type");
          update({ type: v });
        }}
        options={facetedTypeOptions}
        placeholder="All types"
      />
      <MultiSelect
        label="Arenas"
        values={filters.arena}
        onChange={(v) => {
          onFieldChanged?.("arena");
          update({ arena: v });
        }}
        options={facetedArenaOptions}
        placeholder="All arenas"
      />
      <MultiSelect
        label="Keywords"
        values={filters.keyword}
        onChange={(v) => {
          onFieldChanged?.("keyword");
          update({ keyword: v });
        }}
        options={facetedKeywordOptions}
        placeholder="All keywords"
        searchable
      />
      <MultiSelect
        label="Traits"
        values={filters.trait}
        onChange={(v) => {
          onFieldChanged?.("trait");
          update({ trait: v });
        }}
        options={facetedTraitOptions}
        placeholder="All traits"
        searchable
      />
      <RangeSlider
        label="Cost"
        max={COST_MAX}
        value={filters.costRange}
        onChange={(v) => {
          onFieldChanged?.("cost");
          update({ costRange: v });
        }}
      />
      <RangeSlider
        label="Power"
        max={POWER_MAX}
        value={filters.powerRange}
        onChange={(v) => {
          onFieldChanged?.("power");
          update({ powerRange: v });
        }}
      />
      <RangeSlider
        label="HP"
        max={HP_MAX}
        value={filters.hpRange}
        onChange={(v) => {
          onFieldChanged?.("hp");
          update({ hpRange: v });
        }}
      />
    </div>
  );

  const collectionGroup = (
    <div className="ifp-sidebar__group">
      <span className="ifp-sidebar__group-label">Collection</span>
      {/* The Collection checkboxes arrive as `children` -- CardsPage-owned
          state and pl-toggle markup. This group holds only those host-owned
          checkboxes. */}
      {children}
    </div>
  );

  const resetBtn = (
    <SWUButton
      size="sm"
      active={!resetInert}
      ariaDisabled={resetInert}
      onClick={() => {
        if (!resetInert) resetFilters();
      }}
    >
      Reset All Filters
    </SWUButton>
  );

  // ── Arrangement per tier ──────────────────────────────────────────────
  // Single-column (FULL/COMPACT): search, Aspects group (label + mode
  // control sharing a header row, chits below), Card, Gameplay, Collection,
  // Reset (under a divider) -- density-varied by CSS custom properties
  // keyed off data-vtier. Two-column (TWO-COL/fallback): a top span
  // (search + aspect chits + mode control, no "Aspects" label), a 2-col
  // grid (left: Card + Collection, right: Gameplay), and a footer row
  // (Reset right, divider above the row) -- the fallback tier additionally
  // wraps the grid+footer in an internal scroll region while the head and
  // top span stay pinned.
  let body: React.ReactNode;
  if (!twoCol) {
    body = (
      <>
        {searchEl}
        <div className="ifp-sidebar__group">
          <div className="ifp-sidebar__group-headrow">
            <span className="ifp-sidebar__group-label">Aspects</span>
            {aspectModeEl}
          </div>
          {aspectsEl}
        </div>
        {cardGroup}
        {gameplayGroup}
        {collectionGroup}
        <div className="ifp-sidebar__reset">{resetBtn}</div>
      </>
    );
  } else {
    const gridAndFoot = (
      <>
        <div className="ifp-sidebar__grid">
          <div className="ifp-sidebar__col">
            {cardGroup}
            {collectionGroup}
          </div>
          <div className="ifp-sidebar__col">{gameplayGroup}</div>
        </div>
        <div className="ifp-sidebar__footrow">{resetBtn}</div>
      </>
    );
    body = (
      <>
        <div className="ifp-sidebar__toprow">
          {searchEl}
          {aspectsEl}
          {aspectModeEl}
        </div>
        {tier === "fallback" ? (
          <div className="ifp-sidebar__scroll-region">{gridAndFoot}</div>
        ) : (
          gridAndFoot
        )}
      </>
    );
  }

  return (
    <div className="ifp-sidebar-wrap">
      {!open && (
        <div className="ifp-sidebar-tab-ring">
          <button
            type="button"
            className="ifp-sidebar-tab"
            onClick={() => setOpen(true)}
            title="Expand filters"
          >
            <svg width="15" height="14" viewBox="0 0 16 15" aria-hidden="true">
              <path
                d="M1 1h14L10 7.5V13l-4 1.5V7.5L1 1Z"
                stroke="currentColor"
                fill="none"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            {activeCount > 0 && <span className="ifp-sidebar-tab__badge">{activeCount}</span>}
            <span className="ifp-sidebar-tab__label">Filters</span>
          </button>
        </div>
      )}

      {open && (
        <div className="ifp-sidebar" data-vtier={tier} ref={sidebarRef}>
          <div className="ifp-sidebar__ring">
            <div className="ifp-sidebar__panel">
              <div className="ifp-sidebar__head">
                {/* The amber count badge sits in the expanded head, right of
                    the title -- same signal as the collapsed rail's badge. */}
                <span className="ifp-sidebar__title-wrap">
                  <span className="ifp-sidebar__title">Filters</span>
                  {activeCount > 0 && <span className="ifp-sidebar__badge">{activeCount}</span>}
                </span>
                <button
                  type="button"
                  className="ifp-sidebar__collapse"
                  onClick={() => setOpen(false)}
                  title="Collapse filters"
                  aria-label="Collapse filters"
                >
                  «
                </button>
              </div>

              {body}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
