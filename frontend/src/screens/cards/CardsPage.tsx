import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { getBaseCardsList } from "../../api/baseCards";
import { getQuantities } from "../../api/inventory";
import { getSharedQuantities } from "../../api/sharedView";
import { getSets } from "../../api/sets";
import { toInventoryCards } from "../../utils/inventory";
import { InventorySummary } from "../inventory/InventorySummary";
import { CardsTable } from "./CardsTable";
import { GalleryGrid } from "./GalleryGrid";
import { GallerySortHeader } from "./GallerySortHeader";
import { CardPopup } from "./CardPopup";
import { FilterPanel, countActiveFilters } from "../../components/FilterPanel";
import { capture } from "../../analytics/analytics";
import { useLimits } from "../../context/LimitsContext";
import {
  applyFilters,
  DEFAULT_FILTERS,
  isDefaultFilterState,
  setFacetAfterRowTap,
} from "../../utils/filters";
import { SWUButton } from "../../components/SWUButton";
import { AddCardsModal } from "../inventory/AddCardsModal";
import { ShareManageModal } from "../shares/ShareManageModal";
import { deriveRenditions } from "../../utils/cardImages";
import { orderSetCodes } from "../../utils/catalog";
import {
  loadPriceKind,
  savePriceKind,
  loadValueDisplay,
  saveValueDisplay,
  isFinishSetScopedTo,
  sortCardsByScope,
  applyCollectionToggles,
} from "../../utils/variantScope";
import { sortCards, nextSortState, DEFAULT_SORT_STATE } from "../../utils/cardSort";
import type { SortState, SortColumn } from "../../utils/cardSort";
import { loadWidthTier, saveWidthTier } from "../../utils/tableWidthTier";
import type { WidthTier } from "../../utils/tableWidthTier";
import type { InventoryCard } from "../../utils/inventory";
import type { BaseCardCatalog, BaseCardCatalogWithQuantity } from "../../api/baseCards";
import type { AddCardsCatalogEntry } from "../../utils/addCardsResolver";
import type { FilterState } from "../../utils/filters";
import type { ViewMode } from "../../components/FilterPanel";
import type { BaseCard, SetOrderMap } from "../../utils/catalog";
import type { CardSet } from "../../api/sets";
import type { SetMeta } from "../../utils/completion";
import type { PriceMode, ValueDisplayMode } from "../../utils/variantScope";
import "./cards.css";

interface Props {
  isAuthenticated: boolean;
  /** Opens the shell's AuthModal (owned by App.tsx). Every inert anonymous
   * inventory control (Add Cards, Import / Export, Share, the Collection
   * toggles, the popup's signed-out plate) routes its click through this callback via requestSignIn() below.
   * Optional so CardsPage still renders standalone. */
  onRequestSignIn?: () => void;
  /** Mirrors AuthContext's emailVerified -- gates the Import / Export button's
   * third auth state (verified) alongside isAuthenticated's anonymous/signed-in
   * split. Defaults to `true` (the same default-true idiom InventorySummary's
   * own isAuthenticated prop uses), so the button renders in its normal active
   * state. */
  isEmailVerified?: boolean;
  /** Opens the shell's Import / Export pane (App-owned activeView state, same
   * App-owns-the-pane-switch pattern as onOpenSettings threading through
   * Header). Only ever called when both isAuthenticated and isEmailVerified
   * hold -- see the button's onClick below. Optional for the same
   * standalone-render reason as onRequestSignIn above. */
  onOpenImportExport?: () => void;
  /** Hands the Vault's own quantities refetch up to App.tsx, which forwards it
   * to ImportExportPage as `onImported`. CardsPage stays mounted the whole
   * time (App.tsx display:none's the inactive pane rather than unmounting it),
   * so without this an import commit would not refresh the Vault's quantities
   * until some unrelated auth change happened to re-run the effect below. A
   * ref-registration (not a global store): the function identity is
   * hand-delivered once per refreshQuantities change, nothing else reaches for
   * it. Optional so CardsPage still renders standalone. */
  onQuantitiesRefreshReady?: (refresh: () => Promise<void>) => void;
  /** When set, this instance renders the READ-ONLY viewer-mode Vault for a
   * shared link (SharedVaultPage; App Spec §19.1) instead of the caller's own
   * -- the seam is exactly the two per-tenant fetches below: quantities come
   * from GET /api/shared/{token}/quantities (the share's OWNER-tenant rows)
   * instead of GET /api/inventory/quantities, and every mutation affordance
   * (Add Cards, Import/Export, the popup's quantity stepper) is hidden rather
   * than merely disabled. The catalog fetch (getBaseCardsList/getSets, both
   * already public) is unaffected -- this prop touches nothing upstream of
   * `baseCards`.
   *
   * Independent of `isAuthenticated`: a signed-in viewer browsing someone
   * else's share still can't edit it (see `readOnly`/`hasData` below), and an
   * anonymous viewer sees the shared vault at full fidelity, not the empty
   * anonymous zero-state (see `hasData`). Optional (undefined = the caller's
   * own Vault). */
  shareToken?: string;
}

// A stable empty Set identity for building the popovers' "every filter except
// the set facet" breakdownCards below -- spreading `{ ...filters, set: new
// Set() }` inline would hand useMemo a fresh Set every render even when
// nothing else changed.
const EMPTY_SET_CODES: Set<string> = new Set();

/** Unified Cards view -- one list for everyone, inventory data layered on by
 * auth state rather than a second view.
 *
 * The list data arrives as two fetches merged client-side (App Spec §12;
 * ADR-0005's payload axis):
 *   1. getBaseCardsList: catalog only, no per-tenant data, publicly
 *      CDN/browser-cached server-side, fetched once on mount; and
 *   2. getQuantities: the caller's sparse variant_id -> quantity rows, tiny,
 *      auth-required, re-fetched on every auth change and after every
 *      inventory mutation (Add Cards commit, inventory popup).
 * Anonymous users skip fetch 2 entirely; every variant_id absent from the
 * quantities map renders as 0. Signing in/out therefore never re-downloads the
 * catalog -- only the quantities swap. */
export function CardsPage({
  isAuthenticated,
  onRequestSignIn,
  isEmailVerified = true,
  onOpenImportExport,
  onQuantitiesRefreshReady,
  shareToken,
}: Props) {
  // `readOnly` gates the genuinely MUTATING affordances (Add Cards,
  // Import/Export, the popup's quantity stepper) -- these key off
  // `isAuthenticated && !readOnly`. `hasData` gates everything else that
  // merely READS quantities (filter toggles, real numbers vs. em-dash,
  // clickable-to-view cells) -- real per-tenant data exists whenever the
  // caller is signed into their OWN Vault OR this is a shared read-only view,
  // so those checks use `hasData` instead of the raw `isAuthenticated`. See
  // the `shareToken` prop's own doc comment for the full rationale.
  const readOnly = shareToken != null;
  const hasData = isAuthenticated || readOnly;
  // The tenant's (or, in read-only viewer mode, the share owner's --
  // LimitsProvider's own shareToken seam) effective keep-limit matrix, with
  // the same null-means-code-defaults fallback every other limits consumer
  // uses (utils/limits.ts). Feeds overCapOnly's predicate below; nothing else
  // in this file reads it.
  const { limits } = useLimits();
  const [catalog, setCatalog] = useState<BaseCardCatalog[]>([]);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [quantitiesLoading, setQuantitiesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  // Parallel my-collection filter -- same shape/treatment as incompleteOnly
  // (state + pl-toggle + requestSignIn routing for anonymous).
  const [ownedOnly, setOwnedOnly] = useState(false);
  // Inverse of ownedOnly -- "what am I missing" shopping view. Same
  // state/pl-toggle/requestSignIn shape as its siblings, with one addition:
  // it's semantically the opposite of ownedOnly (owned total 0 vs. > 0), so
  // the two are mutually exclusive -- see the two setters below, which each
  // clear the other on the way to "on". incompleteOnly is left independent:
  // "no inventory" and "incomplete playset" aren't contradictory (a
  // zero-owned card is trivially an incomplete playset too), just narrower.
  const [noInventoryOnly, setNoInventoryOnly] = useState(false);
  // "Over my keep limit" discovery filter -- same state/pl-toggle/
  // requestSignIn shape as its three siblings above. Mutually exclusive with
  // noInventoryOnly specifically (over-cap implies owned, so "over cap" and
  // "no inventory" can never both hold -- see the two setters below, which
  // each clear the other on the way to "on"), but left independent of
  // ownedOnly/incompleteOnly the same way noInventoryOnly is independent of
  // incompleteOnly: redundant combinations are allowed, only contradictory
  // ones are blocked.
  const [overCapOnly, setOverCapOnly] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  // Owner-side share management modal (App Spec §19.1) -- the Vault header's
  // share affordance. Never rendered in read-only viewer mode (see the
  // `!readOnly` guard alongside Add Cards/Import Export below); this is the
  // OWNER's own tools for managing shares OF their Vault, not part of the
  // viewer-mode Vault at all.
  const [shareManageModalOpen, setShareManageModalOpen] = useState(false);
  // Table <-> Gallery view toggle, owned here (not FilterPanel) since it
  // governs which component below renders `filtered` -- FilterPanel only
  // displays/controls the value (see its ViewMode prop).
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  // ONE unified popup state: every opener (table name click, table
  // Playset-cell click, gallery cell click) targets the same popup. The Name
  // cell's click for anonymous users still opens it (its plate shows "Sign in
  // to manage inventory") instead of bouncing to requestSignIn -- the popup
  // itself is the nudge. The Playset cell's own click-to-edit affordance
  // (onSelectInventory below) is disabled entirely for anonymous users
  // (PlaysetCell.tsx); the Name cell already covers the anonymous nudge.
  const [popupBaseCardId, setPopupBaseCardId] = useState<number | null>(null);
  // The ordered base_card_id list for the popup's prev/next nav, SNAPSHOTTED
  // at the moment the popup opens (see openPopup below) rather than read live
  // off `filtered` on every render. State model: "the popup session's list is
  // whatever it was opened from" -- if the filter/sort result changes while
  // the popup is open (filters live behind the popup's overlay so this is
  // rare, but the state shape doesn't assume it's impossible), navigation
  // keeps browsing the frozen list rather than jumping around a moving
  // target. Cleared back to null on close so the next open always starts a
  // fresh snapshot.
  const [popupCardIds, setPopupCardIds] = useState<number[] | null>(null);
  // The finish the gallery cell was displaying when clicked (only when the
  // Finish filter drove that display) -- wins over `scope` as the popup's
  // initialFinish for that popup session; cleared on close.
  const [galleryDisplayedFinish, setGalleryDisplayedFinish] = useState<string | null>(null);
  // Which surface opened the currently-open popup -- card_popup_opened's
  // `source` property (App Spec §22). Only "table"/"gallery" are produced (see
  // openPopupFromTable/openPopupFromGallery below); "deck_check"/
  // "new_arrivals" are in the taxonomy's enum but have no popup-opening seam
  // in this codebase (neither screen renders CardPopup).
  const [popupSource, setPopupSource] = useState<"table" | "gallery">("table");
  const [setOrder, setSetOrder] = useState<SetOrderMap>({});
  const [setNameByCode, setSetNameByCode] = useState<Record<string, string>>({});
  // The raw getSets() rows, kept alongside the two derived maps above --
  // baseSetCodes/orderedBaseSets (below) need `is_base_set`, which neither
  // existing map carries.
  const [sets, setSets] = useState<CardSet[]>([]);
  // The "signed-in unverified" click nudge for the Import / Export button --
  // the anonymous click already has a mechanism (requestSignIn opens
  // AuthModal); this is its verified-email equivalent, same click-to-reveal
  // shape but with no modal to open (the site-wide VerifyEmailBanner is the
  // actual verification affordance -- this just points at it). Reset whenever
  // a click lands so re-clicking after the message is already showing still
  // reads as fresh feedback.
  const [importExportNudge, setImportExportNudge] = useState(false);
  // The Cards table's variant-scope control (Playset header; App Spec §5.14)
  // -- a single raw finish value, or null for "All variants". Transient by
  // design (never persisted, resets to null on every fresh load) -- see
  // utils/variantScope.ts. Picking/clearing a scope also drives
  // `filters.finish` directly (handleScopeChange below); the reverse never
  // happens automatically -- a *user* edit of the Finish filter instead
  // disengages the scope (handleFilterPanelChange below), per "scope drives
  // filter, never vice versa."
  const [scope, setScope] = useState<string | null>(null);
  // Market/Low kind for the Value column -- Market default, persisted across
  // visits (localStorage, headerStarfield's pattern).
  const [priceKind, setPriceKind] = useState<PriceMode>(() => loadPriceKind());
  // The Vault table's user-controlled column sort -- SESSION-ONLY (plain React
  // state, deliberately never localStorage) and single-column. Defaults to `#`
  // ascending, which IS the default row order (utils/cardSort.ts's
  // DEFAULT_SORT_STATE) -- there is no separate "unsorted" state.
  const [sortState, setSortState] = useState<SortState>(DEFAULT_SORT_STATE);
  // The Vault table's width-tier override -- AUTO default, persisted like
  // priceKind/valueDisplay above (localStorage, utils/tableWidthTier.ts's
  // load/saveWidthTier). Rendered for both the caller's own Vault AND a
  // read-only shared-Vault view (this component makes no isAuthenticated
  // distinction for it below) -- it's pure presentation, same reasoning as
  // viewMode itself.
  const [widthTier, setWidthTier] = useState<WidthTier>(() => loadWidthTier());

  /** The single handler every inert anonymous control routes through -- opens
   * the shell's AuthModal via the App-owned callback. */
  const requestSignIn = useCallback(() => {
    onRequestSignIn?.();
  }, [onRequestSignIn]);

  // Picking/clearing a scope REPLACES filters.finish wholesale -- picking sets
  // it to the single-value Set([raw]), clearing empties it. This is the one
  // path allowed to set `finish` without going through
  // handleFilterPanelChange's disengage check below (scope driving filter is
  // the expected direction; only the reverse needs guarding against).
  const handleScopeChange = useCallback((raw: string | null) => {
    // "all" represents the cleared/"All variants" selection -- capture()'s
    // properties can't carry null.
    capture("finish_scope_changed", { finish: raw ?? "all" });
    setScope(raw);
    setFilters((prev) => ({ ...prev, finish: raw ? new Set([raw]) : new Set<string>() }));
  }, []);

  const handlePriceKindChange = useCallback((kind: PriceMode) => {
    setPriceKind(kind);
    savePriceKind(kind);
  }, []);

  // Mirrors handlePriceKindChange's persist-on-change idiom exactly.
  const handleWidthTierChange = useCallback((tier: WidthTier) => {
    setWidthTier(tier);
    saveWidthTier(tier);
  }, []);

  // 2-state header click cycling (utils/cardSort.ts's nextSortState) -- a
  // different column lands on ascending, the already-active column toggles
  // asc<->desc.
  const handleSortChange = useCallback((column: SortColumn) => {
    setSortState((prev) => {
      const next = nextSortState(prev, column);
      capture("sort_changed", { column, direction: next.direction });
      return next;
    });
  }, []);

  // Unit/Collection display for the Value column -- Unit default, persisted
  // like priceKind above.
  const [valueDisplay, setValueDisplay] = useState<ValueDisplayMode>(() => loadValueDisplay());
  const handleValueDisplayChange = useCallback((mode: ValueDisplayMode) => {
    setValueDisplay(mode);
    saveValueDisplay(mode);
  }, []);

  // The ONLY other path that ever writes FilterState -- everything FilterPanel
  // does (every facet, Reset All Filters) flows through here instead of the
  // raw `setFilters`. If a scope is active and the resulting `finish` set is
  // no longer exactly the single value the scope itself set it to, the user
  // has directly edited the Finish filter (or reset everything) -- disengage
  // the scope (App Spec §5.14: "scope drives filter, never vice versa"; their
  // new selection stands untouched). Reads `filters` from this render's
  // closure rather than via a functional setFilters updater specifically so
  // the disengage decision -- a second, independent setState call -- never
  // has to happen from inside another state updater.
  const handleFilterPanelChange = useCallback(
    (update: FilterState | ((prev: FilterState) => FilterState)) => {
      const next = typeof update === "function" ? update(filters) : update;
      if (scope !== null && !isFinishSetScopedTo(next.finish, scope)) {
        setScope(null);
      }
      setFilters(next);
    },
    [filters, scope]
  );

  // Catalog: once on mount. Auth changes don't touch it -- the catalog is
  // identity-independent by construction.
  useEffect(() => {
    setCatalogLoading(true);
    setError(null);
    getBaseCardsList()
      .then(setCatalog)
      .catch((err) => setError(String(err)))
      .finally(() => setCatalogLoading(false));
  }, []);

  /** Quantities: re-fetched on auth change and after every inventory mutation
   * (the AddCardsModal / inventory-popup callbacks below). */
  const refreshQuantities = useCallback(async () => {
    // shareToken wins outright, checked before isAuthenticated -- the shared
    // endpoint returns the share's OWNER-tenant rows regardless of whether the
    // viewer themselves is signed in.
    if (readOnly) {
      const rows = await getSharedQuantities(shareToken!);
      const map: Record<number, number> = {};
      for (const r of rows) map[r.variant_id] = r.quantity;
      setQuantities(map);
      return;
    }
    if (!isAuthenticated) {
      setQuantities({});
      return;
    }
    const rows = await getQuantities();
    const map: Record<number, number> = {};
    for (const r of rows) map[r.variant_id] = r.quantity;
    setQuantities(map);
  }, [isAuthenticated, readOnly, shareToken]);

  useEffect(() => {
    // quantitiesLoading gates the initial signed-in render (below) so the
    // table never flashes an all-zeros collection while the sparse
    // quantities are still in flight.
    setQuantitiesLoading(true);
    refreshQuantities()
      .catch((err) => setError(String(err)))
      .finally(() => setQuantitiesLoading(false));
  }, [refreshQuantities]);

  // Hands the current refreshQuantities up to App.tsx on every identity change
  // (only ever changes with isAuthenticated -- see the callback's own deps
  // above) -- see this prop's own doc comment for why.
  useEffect(() => {
    onQuantitiesRefreshReady?.(refreshQuantities);
  }, [onQuantitiesRefreshReady, refreshQuantities]);

  const loading = catalogLoading || quantitiesLoading;

  /** The merged shape: slim catalog variants + quantity (0 when the caller
   * owns none / is anonymous). Typed as BaseCardCatalogWithQuantity (the slim
   * list shape), not BaseCardDetail (the fat detail shape) -- the two are not
   * structurally interchangeable; see toInventoryCards' doc comment
   * (utils/inventory.ts). */
  const baseCards = useMemo<BaseCardCatalogWithQuantity[]>(
    () =>
      catalog.map((base) => ({
        ...base,
        variants: base.variants.map((v) => ({
          ...v,
          quantity: quantities[v.variant_id] ?? 0,
        })),
      })),
    [catalog, quantities]
  );

  useEffect(() => {
    getSets()
      .then((fetchedSets) => {
        const nameMap: Record<string, string> = {};
        const orderMap: SetOrderMap = {};
        fetchedSets.forEach((s) => {
          nameMap[s.code] = s.name;
          orderMap[s.code] = s.release_date;
        });
        setSetNameByCode(nameMap);
        setSetOrder(orderMap);
        // baseSetCodes/orderedBaseSets (below) derive from the raw rows --
        // `is_base_set` isn't carried by either map above.
        setSets(fetchedSets);
      })
      .catch((err) => console.error("Failed to load sets:", err));
  }, []);

  // The completion panel's universe (App Spec §5.13) -- the base sets, by
  // `is_base_set` (true for TS26) -- plus the same set list release-ordered
  // for the panel's "by set" breakdown popovers.
  const baseSetCodes = useMemo(
    () => new Set(sets.filter((s) => s.is_base_set).map((s) => s.code)),
    [sets]
  );
  const orderedBaseSets = useMemo<SetMeta[]>(() => {
    const baseCodes = sets.filter((s) => s.is_base_set).map((s) => s.code);
    return orderSetCodes(baseCodes, setOrder).map((code) => ({
      code,
      name: setNameByCode[code] ?? code,
    }));
  }, [sets, setOrder, setNameByCode]);

  // Row order follows the active scope -- toInventoryCards already applies the
  // unscoped sortBaseCards order internally; sortCardsByScope re-sorts by the
  // scoped variant's own card_number when a scope is active, and is a no-op
  // re-sort (defers straight to sortBaseCards) when it isn't. `scope` joins
  // the dep list so re-engaging/clearing it recomputes this memo -- everything
  // downstream (toggleNarrowed -> filtered -> sortedCards, plus the popup's
  // openPopup snapshot) reads off this array, so the # column, table order,
  // and popup prev/next nav all follow the same order for free.
  const cards = useMemo<InventoryCard[]>(
    () => sortCardsByScope(toInventoryCards(baseCards, setOrder), setOrder, scope),
    [baseCards, setOrder, scope]
  );

  /** Flat per-variant rows for the Add Cards resolver (AddCardsModal /
   * addCardsResolver), derived from the same single fetch by flattening each
   * base card's nested variants -- no second endpoint call. */
  const addCardsCatalog = useMemo<AddCardsCatalogEntry[]>(() => {
    const flat: AddCardsCatalogEntry[] = [];
    for (const base of baseCards) {
      for (const v of base.variants) {
        flat.push({
          id: v.variant_id,
          name: base.name,
          subtitle: base.subtitle,
          type: base.type,
          variant_type: v.variant_type,
          finish: v.finish,
          channel: v.channel,
          // home base set (base.set_code) vs release set (v.source_set_code):
          // the resolver's family scoping needs both — see AddCardsCatalogEntry.
          set_code: base.set_code,
          source_set_code: v.source_set_code,
          card_number: v.card_number,
          is_token: base.is_token,
          quantity: v.quantity,
          front_image_url: v.front_image_url,
          // Derived client-side -- the list response ships no
          // front_images/back_images (App Spec §12), same derivation
          // toInventoryCards uses.
          front_images: v.front_image_url ? deriveRenditions(v.front_image_url) : undefined,
          // The resolve-panel preview needs the back side too -- Leaders
          // preview their portrait back, the same rule GalleryGrid's cellImage
          // already applies.
          back_image_url: v.back_image_url,
          back_images: v.back_image_url ? deriveRenditions(v.back_image_url) : undefined,
        });
      }
    }
    return flat;
  }, [baseCards]);

  // Toggle-narrowed base set -- incompleteOnly/ownedOnly applied, but not the
  // FilterPanel dropdown filters. This is what FilterPanel facets against (so
  // "show only cards I own" narrows dropdown options the same way it narrows
  // the table), and it's also the base `filtered` below applies `filters` to.
  // Toggles and filters are independent per-card predicates, so folding the
  // toggles in first vs. last doesn't change the final `filtered` set -- only
  // what FilterPanel sees.
  const toggleNarrowed = useMemo(
    () =>
      applyCollectionToggles(
        cards,
        {
          incomplete: incompleteOnly,
          owned: ownedOnly,
          unowned: noInventoryOnly,
          overcap: overCapOnly,
        },
        scope,
        limits
      ),
    [cards, incompleteOnly, ownedOnly, noInventoryOnly, overCapOnly, scope, limits]
  );

  const filtered = useMemo(
    () => applyFilters(toggleNarrowed as BaseCard[], filters) as InventoryCard[],
    [toggleNarrowed, filters]
  );

  // The completion popovers' rows are the sidebar Set facet's OWN selection
  // menu, so their universe is every filter applied EXCEPT the set facet
  // itself -- a menu never filters itself, or a set the collector already
  // picked would erase its own row out from under them.
  const breakdownCards = useMemo(
    () =>
      applyFilters(toggleNarrowed as BaseCard[], {
        ...filters,
        set: EMPTY_SET_CODES,
      }) as InventoryCard[],
    [toggleNarrowed, filters]
  );

  // A popover row-click replaces the sidebar's set facet with that one set;
  // tapping the set that is already the only selection clears it (the phone's
  // rule, setFacetAfterRowTap). Routed through handleFilterPanelChange (not a raw
  // setFilters) so a row-click carries the exact same side effects as any
  // other FilterPanel edit.
  const pickFilterSet = useCallback(
    (code: string) => {
      handleFilterPanelChange({ ...filters, set: setFacetAfterRowTap(filters.set, code) });
    },
    [filters, handleFilterPanelChange]
  );

  // The Collection checkboxes are real applied filters living outside
  // FilterState -- they feed the rail badge and keep Reset All Filters active
  // (which clears them alongside the FilterState reset). A set facet
  // selection, however it was made (sidebar or popover row), lives IN
  // FilterState and is already counted once by FilterPanel's own
  // countActiveFilters, so it is not counted again here.
  const externalActiveCount =
    (incompleteOnly ? 1 : 0) +
    (ownedOnly ? 1 : 0) +
    (noInventoryOnly ? 1 : 0) +
    (overCapOnly ? 1 : 0);

  // The SAME total FilterPanel's own collapsed-rail badge shows (its
  // countActiveFilters, exported for this) plus the toggles above --
  // filter_applied's active_filter_count property (App Spec §22).
  const activeFilterCount = countActiveFilters(filters) + externalActiveCount;

  // Which filter field a click/change just touched, stashed synchronously
  // (FilterPanel's onFieldChanged prop, or the four Collection toggle
  // onClicks below) so the effect further down can read the POST-change
  // results_count/active_filter_count off this component's own next render
  // before firing filter_applied. Cleared once consumed so an unrelated
  // `filtered`/`activeFilterCount` change (e.g. a quantities refresh) never
  // fires a spurious event.
  const pendingFilterFieldRef = useRef<string | null>(null);
  const handleFieldChanged = useCallback((field: string) => {
    pendingFilterFieldRef.current = field;
  }, []);

  const resetExternalFilters = useCallback(() => {
    setIncompleteOnly(false);
    setOwnedOnly(false);
    setNoInventoryOnly(false);
    setOverCapOnly(false);
  }, []);

  // base_card_id -> position in the default order (canonical set order,
  // numbers ascending) -- built off `cards` (the full scope-ordered list
  // BEFORE any filter/toggle narrows it), not `filtered`, so the index a row
  // carries never changes as filters/toggles come and go, only which rows are
  // visible. Every column's comparator falls back to this on a tie
  // (utils/cardSort.ts), and it's the literal definition of `#`/`Set`
  // ascending.
  const defaultIndex = useMemo(() => new Map(cards.map((c, i) => [c.base_card_id, i])), [cards]);

  // The row order the page actually renders -- `filtered` (every filter/toggle
  // narrowing already applied, set facet included) reordered by the active
  // single-column sort. Feeds CardsTable AND GalleryGrid from one call, so the
  // Gallery view inherits the same ordering for free, and the popup's
  // prev/next snapshot below follows the same order the collector is actually
  // looking at.
  const sortedCards = useMemo(
    () =>
      sortCards(filtered, sortState, {
        scope,
        valueMode: priceKind,
        unitMode: valueDisplay,
        setOrder,
        defaultIndex,
      }),
    [filtered, sortState, scope, priceKind, valueDisplay, setOrder, defaultIndex]
  );

  // "Any mechanism" that narrows the visible list -- a FilterPanel
  // facet/search (the set facet included), or any of the four toggles above --
  // makes `filtered` a genuine subset of `cards`, which is what governs
  // whether InventorySummary's Filtered/All scope toggle renders at all. A set
  // facet selection is already covered by `isDefaultFilterState(filters)`.
  const isNarrowed =
    !isDefaultFilterState(filters) || incompleteOnly || ownedOnly || noInventoryOnly || overCapOnly;

  // Fires filter_applied once per user-driven field change (App Spec §22),
  // reading the POST-change results_count/active_filter_count off THIS render
  // -- pendingFilterFieldRef is set synchronously in the same click/change
  // event that produced the `filters`/toggle state this render reflects, so by
  // the time this effect runs the values below are already current.
  useEffect(() => {
    const field = pendingFilterFieldRef.current;
    if (field == null) return;
    pendingFilterFieldRef.current = null;
    capture("filter_applied", {
      field,
      active_filter_count: activeFilterCount,
      results_count: filtered.length,
    });
  }, [filtered, activeFilterCount]);

  // search_performed (App Spec §22) -- debounce-follows the search box (never
  // per keystroke) and skips an emptied/never-typed box entirely (nothing to
  // report). Reads `filtered.length` from this render's closure rather than
  // listing it as a dep -- see the disable comment below; a `filtered` change
  // from something OTHER than this search text (e.g. a quantities refresh)
  // would otherwise restart the debounce for no reason.
  useEffect(() => {
    if (filters.search.length === 0) return undefined;
    const timeout = setTimeout(() => {
      capture("search_performed", {
        query_length: filters.search.length,
        results_count: filtered.length,
      });
    }, 400);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search]);

  /** Opens the unified popup AND snapshots the sorted list's base_card_id
   * order for prev/next nav -- the single entry point both the table (Name
   * cell + Playset cell) and the gallery route through, so every opener gets
   * identical nav behavior for free. */
  const openPopup = useCallback(
    (
      baseCardId: number,
      displayedFinish: string | null = null,
      source: "table" | "gallery" = "table"
    ) => {
      // Non-null only from a gallery cell whose image the Finish filter picked
      // -- that popup session opens on the finish the collector was looking at
      // (precedence over the scope preselect below). Table opens and
      // unfiltered gallery opens pass nothing and keep the default rules.
      setGalleryDisplayedFinish(displayedFinish);
      // Snapshot the SORTED order (not the pre-sort `filtered`) -- prev/next
      // browses in the same order the collector clicked from, table or Gallery
      // alike.
      setPopupCardIds(sortedCards.map((c) => c.base_card_id));
      setPopupBaseCardId(baseCardId);
      setPopupSource(source);
    },
    [sortedCards]
  );

  // card_popup_opened's `source` (App Spec §22) -- CardsTable's
  // onSelectCard/onSelectInventory take a single (baseCardId) argument,
  // GalleryGrid's onSelectCard takes (baseCardId, displayedFinish); neither
  // knows about `source` itself, so these thin wrappers are the minimal
  // plumbing that tags each opener without changing either component's own
  // contract.
  const openPopupFromTable = useCallback(
    (baseCardId: number) => openPopup(baseCardId, null, "table"),
    [openPopup]
  );
  const openPopupFromGallery = useCallback(
    (baseCardId: number, displayedFinish?: string | null) =>
      openPopup(baseCardId, displayedFinish ?? null, "gallery"),
    [openPopup]
  );

  const closePopup = useCallback(() => {
    setPopupBaseCardId(null);
    setPopupCardIds(null);
    setGalleryDisplayedFinish(null);
  }, []);

  /** Derives prev/next targets from the snapshotted `popupCardIds` (never from
   * live `filtered` -- see that state's own comment). Boundary behavior is
   * DISABLE, not wrap -- `canPrev`/`canNext` are what CardPopup uses to
   * disable each button and to guard the ArrowLeft/ArrowRight shortcuts;
   * `onPrev`/`onNext` at a disabled boundary are harmless no-ops rather than
   * `undefined`, so CardPopup never needs to null-check before calling them.
   * If the popup isn't open, or -- defensively -- the current id somehow isn't
   * in the snapshot, navigation is `undefined` entirely and the affordance
   * doesn't render at all (see CardPopup's `navigation` prop). */
  const popupNavigation = useMemo(() => {
    if (popupBaseCardId == null || popupCardIds == null) return undefined;
    const index = popupCardIds.indexOf(popupBaseCardId);
    if (index === -1) return undefined;
    const prevId = index > 0 ? popupCardIds[index - 1] : null;
    const nextId = index < popupCardIds.length - 1 ? popupCardIds[index + 1] : null;
    return {
      canPrev: prevId != null,
      canNext: nextId != null,
      onPrev: prevId != null ? () => setPopupBaseCardId(prevId) : () => {},
      onNext: nextId != null ? () => setPopupBaseCardId(nextId) : () => {},
    };
  }, [popupBaseCardId, popupCardIds]);

  if (error) return <p className="loading-text">Error: {error}</p>;

  return (
    <div className="screen">
      {loading ? (
        <p className="loading-text">Loading cards…</p>
      ) : (
        // FilterPanel and the summary+table/gallery stack are grouped under one
        // flex row (`.cards-layout`, cards.css); FilterPanel.tsx's own
        // open/collapsed state is untouched (no parallel state added here).
        // Wrapping it alongside a `.cards-content` column lets cards.css's
        // media query dock the expanded sidebar in-flow on wide viewports and
        // center the [sidebar + content] pair as one unit, while narrower
        // viewports (or the collapsed rail) float the sidebar over the table --
        // see cards.css's `.cards-layout` comment for the full mechanism and
        // the breakpoint arithmetic in FilterPanel.css.
        <div className="cards-layout">
          <FilterPanel
            filters={filters}
            setFilters={handleFilterPanelChange}
            cards={toggleNarrowed as BaseCard[]}
            onResetAll={resetExternalFilters}
            externalActiveCount={externalActiveCount}
            onFieldChanged={handleFieldChanged}
          >
            {/* The completion popovers' set selection IS the sidebar's own Set
                facet (no second dimension to surface here) -- a popover
                row-click shows up in the Set field's own chip/dropdown exactly
                like a sidebar click would. */}
            <div className="ifp-toggle-row">
              {/* While `scope` is active, each pl-toggle below also carries
                  `pl-toggle--scoped` -- the same amber outline/text/background
                  token family the # th uses (cards.css copies
                  `.vs-header-scope__trigger--on` verbatim), signaling that
                  these filters evaluate against the scoped finish
                  (toggleNarrowed above), not the card's total inventory.
                  Styling-only modifier; click handling is unaffected. */}
              <div className="ifp-toggle-row__buttons">
                <button
                  type="button"
                  className={`pl-toggle${incompleteOnly ? " pl-toggle--on" : ""}${
                    hasData ? "" : " pl-toggle--disabled"
                  }${scope ? " pl-toggle--scoped" : ""}`}
                  onClick={() => {
                    if (hasData) {
                      handleFieldChanged("completion");
                      setIncompleteOnly((v) => !v);
                    } else requestSignIn();
                  }}
                  aria-pressed={incompleteOnly}
                  aria-disabled={!hasData}
                >
                  <span className="pl-toggle__box" />
                  <span className="pl-toggle__label">Show only incomplete playsets</span>
                </button>
                {/* My-collection filter, mirrors incompleteOnly above -- same
                    pl-toggle markup and requestSignIn routing for anonymous
                    users (the inert-teaser mechanism). Gated on `hasData` (not
                    the raw isAuthenticated) so this toggle works for a
                    read-only shared-vault viewer too -- the owner's real
                    quantities exist to filter on even when the VIEWER
                    themselves is anonymous. */}
                <button
                  type="button"
                  className={`pl-toggle${ownedOnly ? " pl-toggle--on" : ""}${
                    hasData ? "" : " pl-toggle--disabled"
                  }${scope ? " pl-toggle--scoped" : ""}`}
                  onClick={() => {
                    if (!hasData) {
                      requestSignIn();
                      return;
                    }
                    handleFieldChanged("owned");
                    // Turning ownedOnly on contradicts noInventoryOnly (owned
                    // total > 0 vs. === 0) -- clear it on the way in.
                    setOwnedOnly((v) => {
                      const next = !v;
                      if (next) setNoInventoryOnly(false);
                      return next;
                    });
                  }}
                  aria-pressed={ownedOnly}
                  aria-disabled={!hasData}
                >
                  <span className="pl-toggle__box" />
                  <span className="pl-toggle__label">Show only cards I own</span>
                </button>
                {/* Inverse of ownedOnly -- same pl-toggle markup and
                    requestSignIn routing for anonymous users. Anonymous
                    inventory is all-zero, so the filter would be meaningless
                    noise for a signed-out visitor -- same inert-teaser
                    treatment as its siblings rather than a real toggle. */}
                <button
                  type="button"
                  className={`pl-toggle${noInventoryOnly ? " pl-toggle--on" : ""}${
                    hasData ? "" : " pl-toggle--disabled"
                  }${scope ? " pl-toggle--scoped" : ""}`}
                  onClick={() => {
                    if (!hasData) {
                      requestSignIn();
                      return;
                    }
                    handleFieldChanged("no_inventory");
                    // Turning noInventoryOnly on contradicts ownedOnly -- clear
                    // it on the way in (mirror of the setOwnedOnly handler
                    // above). It also contradicts overCapOnly (over-cap implies
                    // owned) -- clear that too.
                    setNoInventoryOnly((v) => {
                      const next = !v;
                      if (next) {
                        setOwnedOnly(false);
                        setOverCapOnly(false);
                      }
                      return next;
                    });
                  }}
                  aria-pressed={noInventoryOnly}
                  aria-disabled={!hasData}
                >
                  <span className="pl-toggle__box" />
                  <span className="pl-toggle__label">Only cards with no inventory</span>
                </button>
                {/* "Over my keep limit" discovery filter -- same pl-toggle
                    markup and requestSignIn routing as its siblings. Carries
                    pl-toggle--scoped like them: the predicate is scope-aware
                    (see toggleNarrowed's overCapOnly branch above), so the
                    amber "this filter evaluates against the scoped finish"
                    signal is accurate here too. */}
                <button
                  type="button"
                  className={`pl-toggle${overCapOnly ? " pl-toggle--on" : ""}${
                    hasData ? "" : " pl-toggle--disabled"
                  }${scope ? " pl-toggle--scoped" : ""}`}
                  onClick={() => {
                    if (!hasData) {
                      requestSignIn();
                      return;
                    }
                    handleFieldChanged("over_cap");
                    // Turning overCapOnly on contradicts noInventoryOnly
                    // (over-cap implies owned) -- clear it on the way in,
                    // mirroring the ownedOnly/noInventoryOnly exclusion above.
                    setOverCapOnly((v) => {
                      const next = !v;
                      if (next) setNoInventoryOnly(false);
                      return next;
                    });
                  }}
                  aria-pressed={overCapOnly}
                  aria-disabled={!hasData}
                >
                  <span className="pl-toggle__box" />
                  <span className="pl-toggle__label">Over keep limit</span>
                </button>
              </div>
              {/* Quiet persistent nudge near the toggles for anonymous users --
                  the passive half of the layered nudge treatment (the
                  click-to-prompt above is the active half). Suppressed for a
                  read-only shared-vault view (`hasData` is true there too) --
                  there's nothing to log in FOR on someone else's Vault. */}
              {!hasData && <p className="ifp-toggle-nudge">Log in to track your collection</p>}
            </div>
          </FilterPanel>
          <div className="cards-content">
            <InventorySummary
              filteredCards={filtered}
              allCards={cards}
              breakdownCards={breakdownCards}
              selectedSetCodes={filters.set}
              onPickSetCode={pickFilterSet}
              isNarrowed={isNarrowed}
              baseSetCodes={baseSetCodes}
              orderedBaseSets={orderedBaseSets}
              isAuthenticated={hasData}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              widthTier={widthTier}
              onWidthTierChange={handleWidthTierChange}
            >
              {/* Mutation affordances are REMOVED (not just disabled) in
                  read-only viewer mode (App Spec §19.1) -- Add Cards and
                  Import/Export never render at all for a shared vault. */}
              {!readOnly && (
                <>
                  <SWUButton
                    size="sm"
                    active={isAuthenticated}
                    ariaDisabled={!isAuthenticated}
                    onClick={() => {
                      if (isAuthenticated) setModalOpen(true);
                      else requestSignIn();
                    }}
                  >
                    Add Cards
                  </SWUButton>
                  {/* Same standard SWUButton, immediately right of Add Cards,
                      rendered for every auth state. Three-way click routing
                      mirrors the toggles' two-way routing above, extended with
                      the verified-email gate: anonymous -> requestSignIn (the
                      AuthModal, same as Add Cards); signed-in unverified ->
                      the local nudge below (import-export state stays
                      App-owned and unreachable, see onOpenImportExport?:
                      undefined-safe call); verified -> onOpenImportExport
                      (App's activeView switch). */}
                  <SWUButton
                    size="sm"
                    active={isAuthenticated && isEmailVerified}
                    ariaDisabled={!(isAuthenticated && isEmailVerified)}
                    onClick={() => {
                      if (isAuthenticated && isEmailVerified) onOpenImportExport?.();
                      else if (!isAuthenticated) requestSignIn();
                      else setImportExportNudge(true);
                    }}
                  >
                    Import / Export
                  </SWUButton>
                  {/* The Vault header's share affordance (App Spec §19.1) --
                      same inert-teaser routing as Add Cards above (anonymous
                      -> requestSignIn; signed-in -> opens ShareManageModal).
                      Unlike Import/Export, sharing isn't gated on verified
                      email -- §19.1 doesn't call for that gate, and sharing a
                      Vault carries none of import/export's data-integrity
                      stakes. */}
                  <SWUButton
                    size="sm"
                    active={isAuthenticated}
                    ariaDisabled={!isAuthenticated}
                    onClick={() => {
                      if (isAuthenticated) setShareManageModalOpen(true);
                      else requestSignIn();
                    }}
                  >
                    Share
                  </SWUButton>
                </>
              )}
            </InventorySummary>
            {/* The verify-email nudge -- a quiet inline message revealed by
                the click above, the unverified counterpart to the anonymous
                click-to-sign-in-modal above it. Points at the site-wide
                VerifyEmailBanner (App.tsx) rather than opening anything of its
                own, since that banner is already the app's one verify-email
                affordance. */}
            {!readOnly && importExportNudge && isAuthenticated && !isEmailVerified && (
              <p className="ie-entry-nudge">
                Verify your email to import or export your collection — see the banner above.
              </p>
            )}
            {!readOnly && modalOpen && (
              <AddCardsModal
                catalog={addCardsCatalog}
                onClose={() => setModalOpen(false)}
                // Awaited -- the modal's own commit-stage busy overlay holds
                // its "Refreshing your Vault…" stage on this promise before
                // dismissing. Errors are swallowed here so a failed refresh
                // never rejects the overlay's own settle step.
                onCommitted={async () => {
                  await refreshQuantities().catch(console.error);
                }}
              />
            )}
            {!readOnly && shareManageModalOpen && (
              <ShareManageModal onClose={() => setShareManageModalOpen(false)} />
            )}
            {viewMode === "table" ? (
              <CardsTable
                cards={sortedCards}
                setNameByCode={setNameByCode}
                isAuthenticated={hasData}
                onSelectCard={openPopupFromTable}
                onSelectInventory={openPopupFromTable}
                scope={scope}
                onScopeChange={handleScopeChange}
                priceKind={priceKind}
                onPriceKindChange={handlePriceKindChange}
                valueDisplay={valueDisplay}
                onValueDisplayChange={handleValueDisplayChange}
                sortState={sortState}
                onSortChange={handleSortChange}
                widthTier={widthTier}
              />
            ) : (
              // The Gallery view inherits the same ordering as the table --
              // GalleryGrid itself has no sort affordance of its own, it just
              // renders whatever order it's handed. The sort/scope AFFORDANCE
              // lives one level up, in GallerySortHeader -- the same
              // sortState/scope owned here, so a sort or scope change made from
              // the gallery header is visible in the table too the next time
              // the view is switched (no separate gallery-local state).
              <>
                <GallerySortHeader
                  sortState={sortState}
                  onSortChange={handleSortChange}
                  scope={scope}
                  onScopeChange={handleScopeChange}
                  valueDisplay={valueDisplay}
                  onValueDisplayChange={handleValueDisplayChange}
                  priceKind={priceKind}
                  onPriceKindChange={handlePriceKindChange}
                />
                <GalleryGrid
                  cards={sortedCards}
                  onSelectCard={openPopupFromGallery}
                  activeFinishes={filters.finish}
                  isAuthenticated={hasData}
                  scope={scope}
                />
              </>
            )}
          </div>
        </div>
      )}
      {popupBaseCardId != null && (
        <CardPopup
          baseCardId={popupBaseCardId}
          isAuthenticated={hasData}
          readOnly={readOnly}
          // The detail endpoint answers for the VIEWER's auth context, so in a
          // shared vault the popup must display the share owner's quantities --
          // the same map the table renders from -- not the response's.
          quantityOverrides={readOnly ? quantities : undefined}
          setNameByCode={setNameByCode}
          onClose={closePopup}
          onChanged={() => {
            refreshQuantities().catch(console.error);
          }}
          onRequestSignIn={requestSignIn}
          navigation={popupNavigation}
          source={popupSource}
          // Keeps the popup's initial/per-card selection in the same finish the
          // collector is scoped to -- companion to the scoped number/sort and
          // the rail's keyboard cycling. A finish-filtered gallery click showed
          // the collector a specific printing -- that displayed finish wins for
          // the session.
          initialFinish={galleryDisplayedFinish ?? scope}
        />
      )}
    </div>
  );
}
