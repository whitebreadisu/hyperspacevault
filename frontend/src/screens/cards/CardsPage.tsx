import { useEffect, useState, useMemo, useCallback } from "react";
import { getBaseCardsList } from "../../api/baseCards";
import { getQuantities } from "../../api/inventory";
import { getSharedQuantities } from "../../api/sharedView";
import { getSets } from "../../api/sets";
import {
  toInventoryCards,
  isPlaysetComplete,
  isOwned,
  cardOwnedTotal,
} from "../../utils/inventory";
import { InventorySummary } from "../inventory/InventorySummary";
import { CardsTable } from "./CardsTable";
import { GalleryGrid } from "./GalleryGrid";
import { CardPopup } from "./CardPopup";
import { FilterPanel } from "../../components/FilterPanel";
import { applyFilters, DEFAULT_FILTERS, isDefaultFilterState } from "../../utils/filters";
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
  scopedOwnedCount,
  scopedPlaysetComplete,
} from "../../utils/variantScope";
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
  /** BL-56 §5.5 Slice 4: opens the shell's AuthModal (owned by App.tsx).
   * Every inert anonymous inventory control (Add Cards, the incomplete-
   * playsets toggle, an Inventory cell) routes its click through this
   * callback via requestSignIn() below. Optional so CardsPage still renders
   * standalone (e.g. existing tests that don't wire it). */
  onRequestSignIn?: () => void;
  /** BL-54 S3 (§8.1 P9): mirrors AuthContext's emailVerified -- gates the
   * Import / Export button's third auth state (verified) alongside
   * isAuthenticated's anonymous/signed-in split. Defaults to `true` so
   * every pre-existing call site (and this file's own pre-BL-54 tests)
   * renders the button in its normal active state unchanged, the same
   * default-true idiom InventorySummary's own isAuthenticated prop uses. */
  isEmailVerified?: boolean;
  /** BL-54 S3 (§8.1 P10): opens the shell's Import / Export pane (App-owned
   * activeView state, same App-owns-the-pane-switch pattern as
   * onOpenSettings threading through Header). Only ever called when both
   * isAuthenticated and isEmailVerified hold -- see the button's onClick
   * below. Optional for the same standalone-render reason as
   * onRequestSignIn above. */
  onOpenImportExport?: () => void;
  /** BL-196: hands the Vault's own quantities refetch up to App.tsx, which
   * forwards it to ImportExportPage as `onImported` -- CardsPage stays
   * mounted the whole time (App.tsx display:none's the inactive pane rather
   * than unmounting it), so without this an import commit never refreshed
   * the Vault's quantities until some unrelated auth change happened to
   * re-run the effect below. A ref-registration (not a global store): the
   * function identity is hand-delivered once per refreshQuantities change,
   * nothing else reaches for it. Optional so CardsPage still renders
   * standalone (e.g. this file's own tests) without wiring it. */
  onQuantitiesRefreshReady?: (refresh: () => Promise<void>) => void;
  /** BL-205 (§19.1): when set, this instance renders the READ-ONLY
   * viewer-mode Vault for a shared link (SharedVaultPage) instead of the
   * caller's own -- the seam is exactly the two per-tenant fetches below:
   * quantities come from GET /api/shared/{token}/quantities (the share's
   * OWNER-tenant rows) instead of GET /api/inventory/quantities, and every
   * mutation affordance (Add Cards, Import/Export, the popup's quantity
   * stepper) is hidden rather than merely disabled. The catalog fetch
   * (getBaseCardsList/getSets, both already public) is completely
   * unchanged -- this prop touches nothing upstream of `baseCards`.
   *
   * Independent of `isAuthenticated`: a signed-in viewer browsing someone
   * else's share still can't edit it (see `readOnly`/`hasData` below), and
   * an anonymous viewer sees the shared vault at full fidelity, not the
   * empty anonymous zero-state (see `hasData`). Optional so every existing
   * call site/test (the caller's own Vault) renders exactly as before. */
  shareToken?: string;
}

/** Unified Cards view (BL-56 §5.5) -- one list for everyone, inventory data
 * layered on by auth state rather than a second view.
 *
 * BL-101 catalog/quantity split (ADR-0005's payload axis): the list data
 * now arrives as two fetches merged client-side --
 *   1. getBaseCardsList: catalog only, no per-tenant data, publicly
 *      CDN/browser-cached server-side (the 4.3 MB that used to be
 *      regenerated per request), fetched once on mount; and
 *   2. getQuantities: the caller's sparse variant_id -> quantity rows,
 *      tiny, auth-required, re-fetched on every auth change and after
 *      every inventory mutation (Add Cards commit, inventory popup).
 * Anonymous users skip fetch 2 entirely; every variant_id absent from the
 * quantities map renders as 0. Signing in/out therefore no longer
 * re-downloads the catalog -- only the quantities swap. The merged shape
 * feeding toInventoryCards is identical to the pre-split response, so the
 * table, completion math, and Add Cards resolver are unchanged. */
export function CardsPage({
  isAuthenticated,
  onRequestSignIn,
  isEmailVerified = true,
  onOpenImportExport,
  onQuantitiesRefreshReady,
  shareToken,
}: Props) {
  // BL-205: `readOnly` gates the genuinely MUTATING affordances (Add Cards,
  // Import/Export, the popup's quantity stepper) -- these key off
  // `isAuthenticated && !readOnly`. `hasData` gates everything else that
  // merely READS quantities (filter toggles, real numbers vs. em-dash,
  // clickable-to-view cells) -- real per-tenant data exists whenever the
  // caller is signed into their OWN Vault OR this is a shared read-only
  // view, so those checks widen from the raw `isAuthenticated` to `hasData`
  // instead. See the `shareToken` prop's own doc comment for the full
  // rationale.
  const readOnly = shareToken != null;
  const hasData = isAuthenticated || readOnly;
  const [catalog, setCatalog] = useState<BaseCardCatalog[]>([]);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [quantitiesLoading, setQuantitiesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  // BL-60: parallel my-collection filter -- same shape/treatment as
  // incompleteOnly (state + pl-toggle + requestSignIn routing for anonymous).
  const [ownedOnly, setOwnedOnly] = useState(false);
  // BL-115: inverse of ownedOnly -- "what am I missing" shopping view. Same
  // state/pl-toggle/requestSignIn shape as its siblings, with one addition:
  // it's semantically the opposite of ownedOnly (owned total 0 vs. > 0), so
  // the two are mutually exclusive -- see the two setters below, which each
  // clear the other on the way to "on". incompleteOnly is left independent:
  // "no inventory" and "incomplete playset" aren't contradictory (a
  // zero-owned card is trivially an incomplete playset too), just narrower.
  const [noInventoryOnly, setNoInventoryOnly] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  // BL-205 (§19.1): owner-side share management modal -- the Vault header's
  // share affordance. Never rendered in read-only viewer mode (see the
  // `!readOnly` guard alongside Add Cards/Import Export below); this is the
  // OWNER's own tools for managing shares OF their Vault, not part of the
  // viewer-mode Vault at all.
  const [shareManageModalOpen, setShareManageModalOpen] = useState(false);
  // BL-73 Stage 1: Table <-> Gallery view toggle, owned here (not
  // FilterPanel) since it governs which component below renders `filtered`
  // -- FilterPanel only displays/controls the value (see its ViewMode prop).
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  // BL-111 F5: ONE unified popup state replaces the old two (selectedBaseCardId
  // for CardDetailPopup, inventoryPopupBaseCardId for CardInventoryPopup) --
  // every opener (table name click, table Playset-cell click, gallery cell
  // click) now targets the same popup. The Name cell's click for anonymous
  // users still opens it (its plate shows "Sign in to manage inventory")
  // instead of bouncing to requestSignIn -- the popup itself is the nudge.
  // BL-162: the Playset cell's own click-to-edit affordance (onSelectInventory
  // below) is now disabled entirely for anonymous users (PlaysetCell.tsx) --
  // the redundant "click opens the same popup as its own nudge" path the old
  // standalone Inventory cell had is retired along with that column; the
  // Name cell already covers the anonymous nudge.
  const [popupBaseCardId, setPopupBaseCardId] = useState<number | null>(null);
  // BL-148: the ordered base_card_id list for the popup's prev/next nav,
  // SNAPSHOTTED at the moment the popup opens (see openPopup below) rather
  // than read live off `filtered` on every render. State model (owner's
  // explicit call): "the popup session's list is whatever it was opened
  // from" -- if the filter/sort result changes while the popup is open
  // (filters live behind the popup's overlay so this is rare, but the state
  // shape doesn't assume it's impossible), navigation keeps browsing the
  // frozen list rather than jumping around a moving target. Cleared back to
  // null on close so the next open always starts a fresh snapshot.
  const [popupCardIds, setPopupCardIds] = useState<number[] | null>(null);
  // BL-201: the finish the gallery cell was displaying when clicked (only
  // when the Finish filter drove that display) -- wins over `scope` as the
  // popup's initialFinish for that popup session; cleared on close.
  const [galleryDisplayedFinish, setGalleryDisplayedFinish] = useState<string | null>(null);
  const [setOrder, setSetOrder] = useState<SetOrderMap>({});
  const [setNameByCode, setSetNameByCode] = useState<Record<string, string>>({});
  // BL-163: the raw getSets() rows, kept alongside the two derived maps
  // above -- baseSetCodes/orderedBaseSets (below) need `is_base_set`, which
  // neither existing map carries.
  const [sets, setSets] = useState<CardSet[]>([]);
  // BL-54 S3 (§8.1 P9): the "signed-in unverified" click nudge for the
  // Import / Export button -- the anonymous click already has a mechanism
  // (requestSignIn opens AuthModal); this is its verified-email equivalent,
  // same click-to-reveal shape but with no modal to open (the site-wide
  // VerifyEmailBanner is the actual verification affordance -- this just
  // points at it). Reset whenever a click lands so re-clicking after the
  // message is already showing still reads as fresh feedback.
  const [importExportNudge, setImportExportNudge] = useState(false);
  // BL-173 (Definition_VariantScope_2026-07-26.md §1): the Cards table's
  // variant-scope control (Playset header) -- a single raw finish value, or
  // null for "All variants" (today's behavior). Transient by design (never
  // persisted, resets to null on every fresh load) -- see
  // utils/variantScope.ts. Picking/clearing a scope also drives
  // `filters.finish` directly (handleScopeChange below); the reverse never
  // happens automatically -- a *user* edit of the Finish filter instead
  // disengages the scope (handleFilterPanelChange below), per "scope drives
  // filter, never vice versa."
  const [scope, setScope] = useState<string | null>(null);
  // BL-173: Market/Low kind for the Value column -- Market default,
  // persisted across visits (localStorage, headerStarfield's pattern).
  const [priceKind, setPriceKind] = useState<PriceMode>(() => loadPriceKind());

  /** BL-56 §5.5 Slice 4: the single handler every inert anonymous control
   * routes through -- opens the shell's AuthModal via the App-owned callback.
   * BL-57 later upgrades this into a full value-prop popup shown ahead of the
   * modal. */
  const requestSignIn = useCallback(() => {
    onRequestSignIn?.();
  }, [onRequestSignIn]);

  // BL-173: picking/clearing a scope REPLACES filters.finish wholesale --
  // picking sets it to the single-value Set([raw]), clearing empties it.
  // This is the one path allowed to set `finish` without going through
  // handleFilterPanelChange's disengage check below (scope driving filter is
  // the expected direction; only the reverse needs guarding against).
  const handleScopeChange = useCallback((raw: string | null) => {
    setScope(raw);
    setFilters((prev) => ({ ...prev, finish: raw ? new Set([raw]) : new Set<string>() }));
  }, []);

  const handlePriceKindChange = useCallback((kind: PriceMode) => {
    setPriceKind(kind);
    savePriceKind(kind);
  }, []);

  // Owner request 2026-07-31: Unit/Collection display for the Value column
  // -- Unit default, persisted like priceKind above.
  const [valueDisplay, setValueDisplay] = useState<ValueDisplayMode>(() => loadValueDisplay());
  const handleValueDisplayChange = useCallback((mode: ValueDisplayMode) => {
    setValueDisplay(mode);
    saveValueDisplay(mode);
  }, []);

  // BL-173: the ONLY other path that ever writes FilterState -- everything
  // FilterPanel does (every facet, Reset All Filters) flows through here
  // instead of the raw `setFilters`. If a scope is active and the resulting
  // `finish` set is no longer exactly the single value the scope itself set
  // it to, the user has directly edited the Finish filter (or reset
  // everything) -- disengage the scope (Definition §1: "scope drives filter,
  // never vice versa"; their new selection stands untouched). Reads `filters`
  // from this render's closure rather than via a functional setFilters
  // updater specifically so the disengage decision -- a second, independent
  // setState call -- never has to happen from inside another state updater.
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
  // identity-independent by construction (BL-101).
  useEffect(() => {
    setCatalogLoading(true);
    setError(null);
    getBaseCardsList()
      .then(setCatalog)
      .catch((err) => setError(String(err)))
      .finally(() => setCatalogLoading(false));
  }, []);

  /** Quantities: re-fetched on auth change and after every inventory
   * mutation (the AddCardsModal/CardInventoryPopup callbacks below) --
   * the split's replacement for the old full-list re-fetch. */
  const refreshQuantities = useCallback(async () => {
    // BL-205: shareToken wins outright, checked before isAuthenticated --
    // the shared endpoint returns the share's OWNER-tenant rows regardless
    // of whether the viewer themselves is signed in.
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

  // BL-196: hands the current refreshQuantities up to App.tsx on every
  // identity change (only ever changes with isAuthenticated -- see the
  // callback's own deps above) -- see this prop's own doc comment for why.
  useEffect(() => {
    onQuantitiesRefreshReady?.(refreshQuantities);
  }, [onQuantitiesRefreshReady, refreshQuantities]);

  const loading = catalogLoading || quantitiesLoading;

  /** The merged shape: slim catalog variants + quantity (0 when the caller
   * owns none / is anonymous). BL-146: typed as BaseCardCatalogWithQuantity
   * (the slim list shape), not BaseCardDetail (the fat detail shape) --
   * those two stopped being structurally interchangeable once the list
   * slimmed down; see toInventoryCards' BL-146 doc comment
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
        // BL-163: baseSetCodes/orderedBaseSets (below) derive from the raw
        // rows -- `is_base_set` isn't carried by either map above.
        setSets(fetchedSets);
      })
      .catch((err) => console.error("Failed to load sets:", err));
  }, []);

  // BL-163 (Definition_CosmeticsBatch_2026-07-26.md §3): the completion
  // panel's universe -- the ten base sets, by `is_base_set` (already true
  // for TS26 in prod, Definition §4) -- plus the same set list release-
  // ordered for the panel's "by set" breakdown popovers.
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

  // BL-187: row order follows
  // the active scope -- toInventoryCards already applies the unscoped
  // sortBaseCards order internally; sortCardsByScope re-sorts by the scoped
  // variant's own card_number when a scope is active, and is a no-op re-sort
  // (defers straight to sortBaseCards) when it isn't. `scope` joins the dep
  // list so re-engaging/clearing it recomputes this memo -- everything
  // downstream (toggleNarrowed -> filtered -> tableCards, plus the popup's
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
          // BL-146: derived client-side -- the list response no longer
          // ships front_images/back_images at all (Design_SparseList_
          // 2026-07-25.md §3), same derivation toInventoryCards uses.
          front_images: v.front_image_url ? deriveRenditions(v.front_image_url) : undefined,
          // BL-111 F7: the resolve-panel preview needs the back side too --
          // Leaders preview their portrait back (design handoff §7), same
          // rule GalleryGrid's cellImage already applies.
          back_image_url: v.back_image_url,
          back_images: v.back_image_url ? deriveRenditions(v.back_image_url) : undefined,
        });
      }
    }
    return flat;
  }, [baseCards]);

  // BL-70: toggle-narrowed base set -- incompleteOnly/ownedOnly applied, but
  // not the FilterPanel dropdown filters. This is what FilterPanel facets
  // against (so "show only cards I own" narrows dropdown options the same
  // way it narrows the table -- the reason BL-60 shipped before BL-70), and
  // it's also the base `filtered` below applies `filters` to. Toggles and
  // filters are independent per-card predicates, so folding the toggles in
  // first vs. last doesn't change the final `filtered` set -- only what
  // FilterPanel sees.
  // BL-195 (Issue #60): while a scope is active, all three collection
  // filters below evaluate against the SCOPED finish instead of the card's
  // total inventory -- e.g. "cards I don't own" with scope=Hyperspace
  // includes a card you own 3 Standard copies of but 0 Hyperspace of (the
  // owner's worked example). scope === null leaves every predicate exactly
  // as it was pre-BL-195 (isPlaysetComplete/isOwned/cardOwnedTotal, the
  // fixed-1/3-driven inventory.ts helpers) -- these existing behaviors are
  // untouched, not routed through the scoped helpers at all.
  const toggleNarrowed = useMemo(() => {
    let result = cards;
    if (incompleteOnly) {
      result = result.filter((c) =>
        scope
          ? !scopedPlaysetComplete(c.variants, scope, c.type)
          : !isPlaysetComplete(c.inventory, c.type)
      );
    }
    // BL-60: keep only cards with at least one owned copy across variants
    // (or, scoped, at least one owned copy of the scoped finish). Reuses the
    // existing isOwned/scopedOwnedCount helpers rather than re-deriving
    // ownership.
    if (ownedOnly) {
      result = result.filter((c) =>
        scope ? scopedOwnedCount(c.variants, scope) > 0 : isOwned(c.inventory)
      );
    }
    // BL-115: inverse of ownedOnly -- keep only cards with a zero owned
    // total (or, scoped, zero owned copies of the scoped finish). Mutually
    // exclusive with ownedOnly by construction (the setters below never let
    // both be true at once), so this filter and the one above never compound
    // in practice, but each is independently correct if that ever changes.
    if (noInventoryOnly) {
      result = result.filter((c) =>
        scope ? scopedOwnedCount(c.variants, scope) === 0 : cardOwnedTotal(c.inventory) === 0
      );
    }
    return result;
  }, [cards, incompleteOnly, ownedOnly, noInventoryOnly, scope]);

  const filtered = useMemo(
    () => applyFilters(toggleNarrowed as BaseCard[], filters) as InventoryCard[],
    [toggleNarrowed, filters]
  );

  // BL-179: the completion popovers' "home base set" selection -- a second,
  // independent set dimension ANDed with every filter above. Distinct from
  // filters.set on purpose: the facet matches home-OR-printing set (a
  // non-base selection reaches cards via source_set_code), while this
  // matches card.set_code (home set) only -- the same grouping the popover
  // rows themselves use.
  const [homeSets, setHomeSets] = useState<Set<string>>(new Set());

  const toggleHomeSet = useCallback((code: string) => {
    setHomeSets((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const clearHomeSets = useCallback(() => setHomeSets(new Set<string>()), []);

  // BL-179 round 11 (owner): the Collection checkboxes and the base-set
  // selection are real applied filters living outside FilterState -- they
  // feed the rail badge and keep Reset All Filters active (which clears
  // them all alongside the FilterState reset).
  const externalActiveCount =
    (incompleteOnly ? 1 : 0) +
    (ownedOnly ? 1 : 0) +
    (noInventoryOnly ? 1 : 0) +
    (homeSets.size > 0 ? 1 : 0);

  const resetExternalFilters = useCallback(() => {
    setHomeSets(new Set<string>());
    setIncompleteOnly(false);
    setOwnedOnly(false);
    setNoInventoryOnly(false);
  }, []);

  // BL-179: what the table/gallery/popup-nav/headline metrics see --
  // `filtered` further narrowed by the home-base-set selection. `filtered`
  // itself stays the popover rows' universe (every filter EXCEPT this
  // dimension): the rows are the selection menu, and the menu never filters
  // itself (BL-173's scope-control lesson; same ignore-own-dimension shape
  // as filters.ts's facetValidValues).
  const tableCards = useMemo(
    () => (homeSets.size ? filtered.filter((c) => homeSets.has(c.set_code)) : filtered),
    [filtered, homeSets]
  );

  // BL-179: the popovers' top-right "Sets selected:" readout -- the set
  // FACET's selections (release-ordered codes), shown so the rows' universe
  // is legible when a FilterPanel set choice is shaping it.
  const filterSetCodes = useMemo(
    () => orderSetCodes(Array.from(filters.set), setOrder),
    [filters.set, setOrder]
  );

  // BL-163 (Definition §3): "any mechanism" that narrows the visible list --
  // a FilterPanel facet/search, or any of the three toggles above -- makes
  // `filtered` a genuine subset of `cards`, which is what governs whether
  // InventorySummary's Filtered/All scope toggle renders at all.
  const isNarrowed =
    !isDefaultFilterState(filters) ||
    incompleteOnly ||
    ownedOnly ||
    noInventoryOnly ||
    // BL-179: a home-base-set selection narrows the visible list the same as
    // any facet -- it must count, or the scope toggle wouldn't render.
    homeSets.size > 0;

  /** BL-148: opens the unified popup AND snapshots `filtered`'s current
   * base_card_id order for prev/next nav -- the single entry point both the
   * table (name cell + inventory cell) and the gallery route through, so
   * every opener gets identical nav behavior for free. */
  const openPopup = useCallback(
    (baseCardId: number, displayedFinish: string | null = null) => {
      // BL-201: non-null only from a gallery cell whose image the Finish
      // filter picked -- that popup session opens on the finish the
      // collector was looking at (precedence over the BL-193 scope
      // preselect below). Table opens and unfiltered gallery opens pass
      // nothing and keep the existing rules.
      setGalleryDisplayedFinish(displayedFinish);
      setPopupCardIds(tableCards.map((c) => c.base_card_id));
      setPopupBaseCardId(baseCardId);
    },
    [tableCards]
  );

  const closePopup = useCallback(() => {
    setPopupBaseCardId(null);
    setPopupCardIds(null);
    setGalleryDisplayedFinish(null);
  }, []);

  /** BL-148: derives prev/next targets from the snapshotted `popupCardIds`
   * (never from live `filtered` -- see that state's own comment). Boundary
   * behavior is DISABLE, not wrap (the conventional default, and the owner
   * left the choice to build judgment) -- `canPrev`/`canNext` are what
   * CardPopup uses to disable each button and to guard the ArrowLeft/
   * ArrowRight shortcuts; `onPrev`/`onNext` at a disabled boundary are
   * harmless no-ops rather than `undefined`, so CardPopup never needs to
   * null-check before calling them. If the popup isn't open, or --
   * defensively -- the current id somehow isn't in the snapshot, navigation
   * is `undefined` entirely and the affordance doesn't render at all (see
   * CardPopup's `navigation` prop). */
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
        // BL-129 R2 (docked filter sidebar, extends R8): FilterPanel and the
        // summary+table/gallery stack are now grouped under one flex row
        // (`.cards-layout`, cards.css) instead of being three direct `.screen`
        // children -- FilterPanel.tsx's own open/collapsed state is untouched
        // (no parallel state added here), but wrapping it alongside a
        // `.cards-content` column lets cards.css's media query dock the
        // expanded sidebar in-flow on wide viewports and center the
        // [sidebar + content] pair as one unit, while narrower viewports (or
        // the collapsed rail) keep the existing float-over-the-table overlay
        // unchanged -- see cards.css's `.cards-layout` comment for the full
        // mechanism and the breakpoint arithmetic in FilterPanel.css.
        <div className="cards-layout">
          <FilterPanel
            filters={filters}
            setFilters={handleFilterPanelChange}
            cards={toggleNarrowed as BaseCard[]}
            onResetAll={resetExternalFilters}
            externalActiveCount={externalActiveCount}
          >
            {/* BL-179: the home-base-set narrowing lives outside FilterState
                (it's the completion popovers' own dimension), so the panel
                gets a visibility + clear affordance for it here -- without
                this, a selection made in a popover would invisibly shape the
                table from the filter side. */}
            {homeSets.size > 0 && (
              <div className="ifp-baseset-chip">
                <span className="ifp-baseset-chip__label">
                  Base sets: {orderSetCodes(Array.from(homeSets), setOrder).join(", ")}
                </span>
                <button
                  type="button"
                  className="ifp-baseset-chip__clear"
                  onClick={clearHomeSets}
                  aria-label="Clear base set selection"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="ifp-toggle-row">
              {/* BL-195 (Issue #60): while `scope` is active, each pl-toggle
                  below also carries `pl-toggle--scoped` -- the same amber
                  outline/text/background token family BL-194's # th uses
                  (cards.css copies `.vs-header-scope__trigger--on` verbatim),
                  signaling that these three filters now evaluate against the
                  scoped finish (toggleNarrowed above), not the card's total
                  inventory. Click handling/behavior is unchanged; this is a
                  styling-only modifier. */}
              <div className="ifp-toggle-row__buttons">
                <button
                  type="button"
                  className={`pl-toggle${incompleteOnly ? " pl-toggle--on" : ""}${
                    hasData ? "" : " pl-toggle--disabled"
                  }${scope ? " pl-toggle--scoped" : ""}`}
                  onClick={() => {
                    if (hasData) setIncompleteOnly((v) => !v);
                    else requestSignIn();
                  }}
                  aria-pressed={incompleteOnly}
                  aria-disabled={!hasData}
                >
                  <span className="pl-toggle__box" />
                  <span className="pl-toggle__label">Show only incomplete playsets</span>
                </button>
                {/* BL-60: my-collection filter, mirrors incompleteOnly above --
                    same pl-toggle markup and requestSignIn routing for
                    anonymous users (BL-56's inert-teaser mechanism). BL-205:
                    gated on `hasData` (not the raw isAuthenticated) so this
                    toggle works for a read-only shared-vault viewer too --
                    the owner's real quantities exist to filter on even when
                    the VIEWER themselves is anonymous. */}
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
                    // BL-115: turning ownedOnly on contradicts noInventoryOnly
                    // (owned total > 0 vs. === 0) -- clear it on the way in.
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
                {/* BL-115: inverse of ownedOnly -- same pl-toggle markup and
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
                    // BL-115: turning noInventoryOnly on contradicts ownedOnly
                    // -- clear it on the way in (mirror of the setOwnedOnly
                    // handler above).
                    setNoInventoryOnly((v) => {
                      const next = !v;
                      if (next) setOwnedOnly(false);
                      return next;
                    });
                  }}
                  aria-pressed={noInventoryOnly}
                  aria-disabled={!hasData}
                >
                  <span className="pl-toggle__box" />
                  <span className="pl-toggle__label">Only cards with no inventory</span>
                </button>
              </div>
              {/* BL-60/BL-56 §5.5: quiet persistent nudge near the toggles for
                  anonymous users -- the passive half of the layered nudge
                  treatment (the click-to-prompt above is the active half).
                  Suppressed for a read-only shared-vault view (`hasData` is
                  true there too) -- there's nothing to log in FOR on someone
                  else's Vault. */}
              {!hasData && <p className="ifp-toggle-nudge">Log in to track your collection</p>}
            </div>
          </FilterPanel>
          <div className="cards-content">
            <InventorySummary
              filteredCards={tableCards}
              allCards={cards}
              breakdownCards={filtered}
              selectedHomeSets={homeSets}
              onToggleHomeSet={toggleHomeSet}
              onClearHomeSets={clearHomeSets}
              filterSetCodes={filterSetCodes}
              isNarrowed={isNarrowed}
              baseSetCodes={baseSetCodes}
              orderedBaseSets={orderedBaseSets}
              isAuthenticated={hasData}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
            >
              {/* BL-205 (§19.1): mutation affordances are REMOVED (not just
                  disabled) in read-only viewer mode -- Add Cards and
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
                  {/* BL-54 S3 (§8.1 P10): same standard SWUButton, immediately
                      right of Add Cards, rendered for every auth state.
                      Three-way click routing mirrors the toggles' two-way
                      routing above, extended with the verified-email gate:
                      anonymous -> requestSignIn (the AuthModal, same as Add
                      Cards); signed-in unverified -> the local nudge below
                      (import-export state stays App-owned and unreachable, see
                      onOpenImportExport?: undefined-safe call); verified ->
                      onOpenImportExport (App's activeView switch). */}
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
                  {/* BL-205 (§19.1): the Vault header's share affordance --
                      same inert-teaser routing as Add Cards above (anonymous
                      -> requestSignIn; signed-in -> opens ShareManageModal).
                      Unlike Import/Export, sharing isn't gated on verified
                      email -- §19.1 doesn't call for that gate, and sharing
                      a Vault carries none of import/export's data-integrity
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
            {/* BL-54 S3 (§8.1 P9): the "same visual pattern" verify-email
                nudge -- a quiet inline message revealed by the click above,
                the unverified counterpart to the anonymous
                click-to-sign-in-modal above it. Points at the site-wide
                VerifyEmailBanner (App.tsx) rather than opening anything of
                its own, since that banner is already the app's one
                verify-email affordance. */}
            {!readOnly && importExportNudge && isAuthenticated && !isEmailVerified && (
              <p className="ie-entry-nudge">
                Verify your email to import or export your collection — see the banner above.
              </p>
            )}
            {!readOnly && modalOpen && (
              <AddCardsModal
                catalog={addCardsCatalog}
                onClose={() => setModalOpen(false)}
                // BL-196: awaited now (was fire-and-forget) -- the modal's
                // own commit-stage busy overlay holds its "Refreshing your
                // Vault…" stage on this promise before dismissing. Errors
                // still swallowed here (unchanged behavior) so a failed
                // refresh never rejects the overlay's own settle step.
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
                cards={tableCards}
                setNameByCode={setNameByCode}
                isAuthenticated={hasData}
                onSelectCard={openPopup}
                onSelectInventory={openPopup}
                scope={scope}
                onScopeChange={handleScopeChange}
                priceKind={priceKind}
                onPriceKindChange={handlePriceKindChange}
                valueDisplay={valueDisplay}
                onValueDisplayChange={handleValueDisplayChange}
              />
            ) : (
              <GalleryGrid
                cards={tableCards}
                onSelectCard={openPopup}
                activeFinishes={filters.finish}
                isAuthenticated={hasData}
              />
            )}
          </div>
        </div>
      )}
      {popupBaseCardId != null && (
        <CardPopup
          baseCardId={popupBaseCardId}
          isAuthenticated={hasData}
          readOnly={readOnly}
          setNameByCode={setNameByCode}
          onClose={closePopup}
          onChanged={() => {
            refreshQuantities().catch(console.error);
          }}
          onRequestSignIn={requestSignIn}
          navigation={popupNavigation}
          // BL-193: keeps the popup's initial/per-card selection in the same
          // finish the collector is scoped to (BL-173) -- companion to
          // BL-187's scoped number/sort and BL-192's rail cycling.
          // BL-201: a finish-filtered gallery click showed the collector a
          // specific printing -- that displayed finish wins for the session.
          initialFinish={galleryDisplayedFinish ?? scope}
        />
      )}
    </div>
  );
}
