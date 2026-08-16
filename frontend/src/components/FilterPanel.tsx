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
} from "../utils/filters";
import type { FilterState, SelectOption, AspectMatchMode } from "../utils/filters";
import "./FilterPanel.css";

// Panel UI only — filter logic, domain constants, FilterState/DEFAULT_FILTERS,
// applyFilters, and the BL-70 faceting helpers live in utils/filters.ts (RR-22).
//
// BL-111 F6 (design handoff §6, "collapsible sidebar" -- final,
// prototypes/cards-screen/FilterPanelRestyled.jsx is the functional drop-in
// reference): replaces the old top panel with a console-styled sidebar that
// FLOATS over the table/gallery rather than squeezing its layout width --
// the outer wrapper is `position:relative; height:0`, so it never occupies
// flex space in CardsPage regardless of open/collapsed state (confirmed
// against prototypes/filter-panel/FilterPanelOptions.dc.html Option C, whose
// table stand-in is explicitly captioned "full width; sidebar floats
// above"). Collapsing therefore doesn't change CardsTable/GalleryGrid's
// measured width -- it was always full width -- it just stops visually
// occluding it. MultiSelect/RangeSlider are reused completely unstyled (the
// prototype's own comment: "Reuses the original file's MultiSelect +
// RangeSlider globals") -- only the shell/aspects/search/checkboxes/reset
// button are restyled here.

// ── AspectPicker ──────────────────────────────────────────────────────────
//
// BL-90: aspects default empty (= unfiltered), matching every other facet,
// so "everything lit up" is driven by `selected.size === 0` rather than
// `selected.size === ASPECT_LIST.length`. The universe includes the
// NO_ASPECT sentinel as an explicit "No Aspect" chit (BL-111 F6: rendered as
// a circle-slash glyph per the design, was a text pill pre-restyle) and
// options arrive already faceted (BL-70) via `facetedOptions`, same as every
// other control.

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
        // BL-70 parity with MultiSelect: an inert (0-facet) option can't be
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

// ── AspectModeControl (BL-130, issue #306) ─────────────────────────────────
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

/** BL-73 Stage 1: Table ↔ Gallery view toggle. Kept here (rather than moved)
 * purely because it's the type's original home -- InventorySummary and
 * CardsPage both import `ViewMode` from this module. The toggle CONTROL
 * itself no longer renders inside FilterPanel: BL-111 F6's sidebar
 * (FilterPanelRestyled.jsx) explicitly drops it ("view toggle NOT rendered
 * here -- it moves to InventorySummaryRestyled"), and InventorySummary
 * already grew its own copy in F3 (design handoff §3) wired to the same
 * CardsPage-owned viewMode/onViewModeChange -- so removing FilterPanel's
 * copy here doesn't lose the control, just the duplicate. */
export type ViewMode = "table" | "gallery";

interface FilterPanelProps {
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  cards: BaseCard[];
  children?: React.ReactNode;
  /** BL-179 round 9 (owner): "Reset All Filters" clears EVERYTHING --
   * FilterState plus any state living outside it (the completion popovers'
   * base-set selections; round 11: the Collection checkboxes too). Called
   * alongside the DEFAULT_FILTERS reset. */
  onResetAll?: () => void;
  /** BL-179 round 11 (owner): how many out-of-FilterState filters are
   * active -- the CardsPage-owned Collection checkboxes (one each) and the
   * popover base-set selection (one when any). Feeds the collapsed rail's
   * badge (they ARE applied filters) and keeps Reset active whenever > 0 so
   * it can clear them. Supersedes round 9's boolean `resetAlsoClears`. */
  externalActiveCount?: number;
}

/** BL-111 F6: active-filter count for the collapsed rail's badge -- every
 * facet Set with a selection, a non-empty search, and every range narrowed
 * off its full [0, max] span counts once. Mirrors `isDefaultFilterState`'s
 * field list but returns a count instead of a boolean (the rail wants "how
 * many", the Reset button wants "any"). */
function countActiveFilters(filters: FilterState): number {
  let n = 0;
  if (filters.search) n++;
  // BL-130: the mode change alone (no selection) has no filtering effect
  // (matchesAspectMode's empty-selection short-circuit), so it doesn't earn
  // its own bump -- it counts as part of the same "Aspects" bucket the
  // selection already occupies, same one-bump-per-group shape as every
  // other field below.
  if (filters.aspects.size > 0 || filters.aspectMode !== DEFAULT_FILTERS.aspectMode) n++;
  if (filters.set.size > 0) n++;
  if (filters.type.size > 0) n++;
  if (filters.rarity.size > 0) n++;
  if (filters.finish.size > 0) n++;
  if (filters.keyword.size > 0) n++;
  if (filters.trait.size > 0) n++;
  if (filters.arena.size > 0) n++;
  const rangeActive = (r: [number, number], max: number) => r[0] !== 0 || r[1] !== max;
  if (rangeActive(filters.costRange, COST_MAX)) n++;
  if (rangeActive(filters.powerRange, POWER_MAX)) n++;
  if (rangeActive(filters.hpRange, HP_MAX)) n++;
  return n;
}

export function FilterPanel({
  filters,
  setFilters,
  cards,
  children,
  onResetAll,
  externalActiveCount = 0,
}: FilterPanelProps) {
  // BL-111 F6 (superseded by BL-144, then BL-179 round 7): used to start
  // OPEN unconditionally, then BL-144 keyed the initial state to the docked
  // width breakpoint, read once at mount with deliberately no resize
  // listener. BL-179 round 7 (owner) supersedes that state model: the
  // docked state (fitsDockedViewport -- one-column tier fits AND both
  // columns fit side by side) now asserts itself LIVE. Entering it
  // auto-expands the panel; leaving it collapses back to the overlay rail;
  // within it, only the explicit « button collapses (no hover-collapse,
  // and a « collapse is respected until the state is left and re-entered).
  // See the docked-transition effect below.
  const [open, setOpen] = useState(() => fitsDockedViewport(window.innerWidth, window.innerHeight));
  const [sets, setSets] = useState<CardSet[]>([]);
  // Base/long-tail set toggle (§5.1): defaults to base sets only; the
  // header button inside the Set dropdown expands to all sets.
  const [showAllSets, setShowAllSets] = useState(false);
  // BL-70: global "show all values" toggle -- off by default (hide values
  // that can't add anything given the other active filters/toggles), on
  // reveals them disabled/greyed alongside the valid ones.
  const [showInvalidValues, setShowInvalidValues] = useState(false);
  useEffect(() => {
    getSets()
      .then(setSets)
      .catch((err) => console.error("Failed to load sets:", err));
  }, []);

  const update = (patch: Partial<FilterState>) => setFilters((prev) => ({ ...prev, ...patch }));

  // BL-91: single-action reset back to DEFAULT_FILTERS -- search, every
  // facet Set, and the cost/power/HP ranges, in one click. Deliberately does
  // NOT touch ownedOnly/incompleteOnly (CardsPage-owned view-mode toggles,
  // not part of FilterState) or any other view state (sort, etc.) -- those
  // are out of scope per BL-91's resolved decision. `isDefaultFilterState`
  // (utils/filters.ts) drives the disabled state below so the control
  // doubles as a "filters are active" indicator.
  const isDefault = isDefaultFilterState(filters);
  // BL-179 rounds 9/11 (owner): Reset clears FilterState AND everything
  // wired through onResetAll (base-set selections, Collection checkboxes)
  // -- and stays active when only those exist.
  const resetInert = isDefault && externalActiveCount === 0;
  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    onResetAll?.();
  };

  const toggleAspect = (value: string) => {
    setFilters((prev) => {
      // BL-90: no snap-back -- deselecting the last active value is now a
      // stable "unfiltered" state (size 0), not forced back to all-selected.
      const noFilter = prev.aspects.size === 0;
      let next: Set<string>;
      if (noFilter) {
        // Everything reads as implicitly active when unfiltered; clicking
        // one narrows straight to just that value (same ergonomics as the
        // old all-selected default, just anchored on empty instead of full).
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

  // BL-173 review round 4 (owner, 2026-07-27), superseding the BL-164 rider:
  // the Set dropdown now orders its values with the SAME logic as the Add
  // Cards set picker (utils/setGrouping.ts's allSetsGroups /
  // Set_Grouping_Context_2026-07-26.md): base sets in canonical-then-
  // secondary release order with each set's Weekly Play container
  // IMMEDIATELY after it (SOR, SORP, SHD, SHDP, ...), then the Exclusives
  // in their subgroup order (Convention → Judge → Promos → Other promos).
  // The whole base+WP block is `pinned`, so MultiSelect's existing divider
  // primitive draws the one boundary before the Exclusives. Base view
  // (show-all off) stays the ten base sets only. Any future set code the
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
  // BL-133 (issue #318): the Finish field's universe is shaped into a
  // two-tier tree (pair rows/expandable groups/plain rows) instead of
  // distinctFinishes' flat pinned list -- see buildFinishTree/
  // shapeFinishTree in utils/filters.ts. FinishFilter.tsx does its own
  // faceted shaping internally (shapeFinishTree), so only the raw tree +
  // the facet-valid set are computed here, mirroring every other field's
  // `distinctX(cards)` + `facetValidValues(...)` pair below.
  const finishTree = buildFinishTree(cards);
  const finishValid = facetValidValues(cards, filters, "finish");
  const keywordOptions = distinctMulti(cards, "keywords");
  const traitOptions = distinctMulti(cards, "traits");

  // BL-70: facet each dropdown against "every other active filter" (the
  // dead-end-prevention rule -- own selection ignored), then fold the
  // result + the current selection + the show-all toggle into what each
  // MultiSelect actually renders. `cards` here is already toggle-narrowed
  // by the caller (CardsPage folds ownedOnly/incompleteOnly in before
  // passing it down), so facets automatically respect those toggles too.
  // BL-90: aspects universe is the 6 real aspects plus the explicit
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
    showInvalidValues
  );
  const facetedSetOptions = facetedOptions(
    setOptions,
    facetValidValues(cards, filters, "set"),
    filters.set,
    showInvalidValues
  );
  const facetedTypeOptions = facetedOptions(
    TYPE_OPTIONS,
    facetValidValues(cards, filters, "type"),
    filters.type,
    showInvalidValues
  );
  const facetedRarityOptions = facetedOptions(
    RARITY_OPTIONS,
    facetValidValues(cards, filters, "rarity"),
    filters.rarity,
    showInvalidValues
  );
  const facetedKeywordOptions = facetedOptions(
    keywordOptions,
    facetValidValues(cards, filters, "keyword"),
    filters.keyword,
    showInvalidValues
  );
  const facetedTraitOptions = facetedOptions(
    traitOptions,
    facetValidValues(cards, filters, "trait"),
    filters.trait,
    showInvalidValues
  );
  const facetedArenaOptions = facetedOptions(
    ARENA_OPTIONS,
    facetValidValues(cards, filters, "arena"),
    filters.arena,
    showInvalidValues
  );

  // BL-179 round 11 (owner): the rail badge counts the external filters
  // too -- the Collection checkboxes and base-set selection narrow the list
  // exactly like any facet, so a collapsed rail must not read "0 filters"
  // while they're active.
  const activeCount = countActiveFilters(filters) + externalActiveCount;

  // ── BL-121: vertical-tier model (design_handoff_filter_vertical/README.md
  // §2) -- one resize listener drives a `data-vtier` attribute that
  // FilterPanel.css reads to swap density (COMPACT) and, past that, a
  // designed two-column layout (TWO-COL) with a pinned-header internal-
  // scroll fallback for very short windows. tierForViewportHeight is the
  // pure avail -> tier decision (utils/filterPanelTiers.ts), unit-tested
  // independently of this component. No CSS media queries -- this is the
  // one source of truth for the thresholds.
  // BL-226 round 3 (owner: right-aligned controls "shake" during resize):
  // state holds the RESOLVED tier, not raw window.innerHeight -- the raw
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

  // ── BL-147 fix 5 (dev-review, BL-144-family finding): click-outside
  // collapses the expanded panel, but ONLY in the below-breakpoint
  // (non-docked/floating-overlay) presentation -- docked side-by-side mode
  // is unaffected, matching the owner's brief. `docked` is a LIVE tracked
  // width (unlike `open`'s own lazy-initializer-only read above), because
  // this effect needs to know the CURRENT presentation, not just the one at
  // mount, to attach/detach correctly as the window resizes across the
  // breakpoint.
  // BL-179 round 7 (owner): docked = the ONE-COLUMN sidebar and the
  // full-width table genuinely coexist -- width (the docking pair arithmetic)
  // AND height (tier still full/compact; a two-col/fallback tier's 452px
  // sidebar never docks). Mirrors the CSS docking media query exactly.
  // BL-226 round 3: same resolved-not-raw pattern as `tier` above -- the
  // boolean flips only at the breakpoint, so per-pixel resize events bail.
  const [docked, setDocked] = useState(() =>
    fitsDockedViewport(window.innerWidth, window.innerHeight)
  );
  useEffect(() => {
    const onResize = () => setDocked(fitsDockedViewport(window.innerWidth, window.innerHeight));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // BL-179 round 7 (owner): the docked state asserts itself on transitions.
  // Entering it -- page load handled by `open`'s initializer above, resize/
  // zoom here -- auto-expands the panel (the owner's "only case in which
  // the filter is auto-expanded"); leaving it collapses to the overlay
  // rail. Between transitions nothing competes with the user's own clicks:
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
      // Clicks inside a portaled filter dropdown (fix 6's
      // FilterMenuPortal, e.g. MultiSelect/FinishFilter's menu, which
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

  // BL-179 round 5/6 (owner): overlay-mode hover-collapse -- the floating
  // panel closes when the pointer settles on anything outside it; docked
  // mode (both columns genuinely fit side by side -- the owner's stated
  // exception) never auto-collapses. Deliberately a document-level
  // `mouseover` (fires on whatever element the pointer ENTERS) rather than
  // the sidebar's own mouseleave: leave-based dismissal misses the exit
  // path through a portaled facet menu (DOM-outside the sidebar, so the
  // sidebar's leave fires -- guarded -- when the pointer enters the menu,
  // and never again when it exits the menu outward; round 5 shipped that
  // hole). Guards: a held button (slider drag straying past the edge) is
  // not a leave, and the portaled menus themselves count as inside.
  //
  // Round 8 (owner bug report): ARMED like the completion popovers -- the
  // collapse fires only after the pointer has actually been inside the
  // panel once per open. The rail and the expanded panel occupy different
  // spots, so the expand click leaves the pointer "outside" the new panel
  // and the very next mouseover collapsed it on the spot (open-flash-
  // collapse). Click-away (the mousedown effect above) still covers a
  // never-hovered panel.
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

  // BL-130: the three-way matching-mode control lives beside the aspect
  // chits in every tier -- the single-column layout puts it in the
  // "Aspects" group's own header row; the two-col layout's top span drops
  // that label (§4/BL-121) but still needs the control, so it renders
  // directly beside the chits there instead.
  const aspectModeEl = (
    <AspectModeControl
      mode={filters.aspectMode}
      onChange={(aspectMode) => update({ aspectMode })}
    />
  );

  // BL-121 §1: regrouped per the vertical-tiers handoff -- Card = Set/
  // Rarity/Finish, Gameplay = the four multi-selects (Type/Arenas/Keywords/
  // Traits) then the three range sliders (Cost/Power/HP), Collection = the
  // host checkboxes only. Field order within each group is settled by the
  // handoff -- do not reorder. Applies at every tier (content change, not
  // layout).
  const cardGroup = (
    <div className="ifp-sidebar__group">
      <span className="ifp-sidebar__group-label">Card</span>
      <MultiSelect
        label="Set"
        values={filters.set}
        onChange={(v) => update({ set: v })}
        options={facetedSetOptions}
        placeholder="All sets"
        showAllButton={false}
        // BL-173 round 5 (owner): menu opens wide enough that no set label
        // wraps -- same treatment the Finish menu got; control width
        // unchanged.
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
        onChange={(v) => update({ rarity: v })}
        options={facetedRarityOptions}
        placeholder="All rarities"
      />
      <FinishFilter
        label="Finish"
        values={filters.finish}
        onChange={(v) => update({ finish: v })}
        tree={finishTree}
        valid={finishValid}
        showAllValues={showInvalidValues}
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
        onChange={(v) => update({ type: v })}
        options={facetedTypeOptions}
        placeholder="All types"
      />
      <MultiSelect
        label="Arenas"
        values={filters.arena}
        onChange={(v) => update({ arena: v })}
        options={facetedArenaOptions}
        placeholder="All arenas"
      />
      <MultiSelect
        label="Keywords"
        values={filters.keyword}
        onChange={(v) => update({ keyword: v })}
        options={facetedKeywordOptions}
        placeholder="All keywords"
        searchable
      />
      <MultiSelect
        label="Traits"
        values={filters.trait}
        onChange={(v) => update({ trait: v })}
        options={facetedTraitOptions}
        placeholder="All traits"
        searchable
      />
      <RangeSlider
        label="Cost"
        max={COST_MAX}
        value={filters.costRange}
        onChange={(v) => update({ costRange: v })}
      />
      <RangeSlider
        label="Power"
        max={POWER_MAX}
        value={filters.powerRange}
        onChange={(v) => update({ powerRange: v })}
      />
      <RangeSlider
        label="HP"
        max={HP_MAX}
        value={filters.hpRange}
        onChange={(v) => update({ hpRange: v })}
      />
    </div>
  );

  const collectionGroup = (
    <div className="ifp-sidebar__group">
      <span className="ifp-sidebar__group-label">Collection</span>
      {/* BL-115: "Only cards with no inventory" (ownedOnly's inverse) lives
          in `children` alongside incompleteOnly/ownedOnly -- CardsPage-owned
          state, same pl-toggle markup and requestSignIn routing. BL-121 §1:
          Finish moved out of this group into Card -- Collection is the
          three host-owned checkboxes only now. */}
      {children}
    </div>
  );

  const cascadeBtn = (
    <button
      type="button"
      className={`pl-toggle ifp-sidebar__cascade${showInvalidValues ? " pl-toggle--on" : ""}`}
      onClick={() => setShowInvalidValues((v) => !v)}
      aria-pressed={showInvalidValues}
    >
      <span className="pl-toggle__box" />
      <span className="pl-toggle__label">No filter cascade / Show all values</span>
    </button>
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
  // Single-column (FULL/COMPACT): search, Aspects group (label + BL-130
  // mode control sharing a header row, chits below), Card, Gameplay,
  // Collection, cascade toggle (own divider), Reset -- unchanged shape from
  // pre-BL-121, just density-varied by CSS custom properties keyed off
  // data-vtier (§3). Two-column (TWO-COL/fallback, §4): a top span (search +
  // aspect chits + BL-130 mode control, no "Aspects" label), a 2-col grid
  // (left: Card + Collection, right: Gameplay), and a footer row (cascade
  // left w/o its own divider, Reset right, shared divider on the row) --
  // the fallback tier additionally wraps the grid+footer in an internal
  // scroll region while the head and top span stay pinned (§5).
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
        {cascadeBtn}
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
        <div className="ifp-sidebar__footrow">
          {cascadeBtn}
          {resetBtn}
        </div>
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
                {/* Owner round 4 (2026-08-16): the amber count badge joins
                    the expanded head, right of the title -- same signal as
                    the collapsed rail's badge. */}
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
