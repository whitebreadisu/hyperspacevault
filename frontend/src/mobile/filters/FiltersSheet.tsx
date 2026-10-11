import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLimits } from "../../context/LimitsContext";
import { MSWUButton } from "../MSWUButton";
import { capturePhone } from "../phoneAnalytics";
import { Sheet, useSheetClose } from "../Sheet";
import { useVaultData } from "../vault/useVaultData";
import type { VaultView } from "../vault/useVaultView";
import { FacetPicker } from "./FacetPicker";
import type { PickerId } from "./FacetPicker";
import { FacetRow, RarityRow } from "./FacetRows";
import {
  collectionChips,
  facetBase,
  filterActions,
  finishChips,
  gameplayCount,
  rarityOptions,
  setChips,
} from "./filterModel";
import type { FilterField } from "./filterModel";
import { GameplayBody, GameplaySection } from "./GameplaySection";
import { useSheetGrow } from "./useSheetGrow";
import "./filters.css";

// BL-248 stages 2B-1 (S2-12 … S2-16) + 2B-2 (S2-17 … S2-20): the Filters sheet (rev4 MFilters.jsx
// FilterSheet, R4-2 / R4-3 compact rows, R5 switches filters=compact +
// sheetfit=content). Compact, content-fit (max 86 %), grows with a
// transform-only move (useSheetGrow). Order: Set, Rarity, Collection,
// Finish, Gameplay (collapsed). Edits are live on the Vault's state (S2-14:
// desktop applies immediately, rev4 too). Footer: Reset filters (amber
// outline idiom, inert at default) + "Show N cards" (live; closes the sheet).
// Nothing here is persisted: the state is the Vault's plain React state.

interface Props {
  vv: VaultView;
  onClose: () => void;
  /** Signed out, the Collection row routes here (desktop pl-toggle teaser). */
  onRequestSignIn: () => void;
}

export function FiltersSheet({ vv, onClose, onRequestSignIn }: Props) {
  const { isAuthenticated, sets, setNameByCode } = useVaultData();
  const { limits } = useLimits();
  const [picker, setPicker] = useState<PickerId | null>(null);
  const [gameOpen, setGameOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useSheetGrow(anchor);

  const { state } = vv;
  const f = state.filters;
  const n = vv.activeCount;
  const onField = useFilterApplied(vv.list, n);
  const act = filterActions(vv, onField);
  const baseCodes = useMemo(
    () => new Set(sets.filter((s) => s.is_base_set).map((s) => s.code)),
    [sets]
  );
  const facetCards = useMemo(() => facetBase(vv.all, state, limits), [vv.all, state, limits]);
  const rarities = useMemo(() => rarityOptions(facetCards, f), [facetCards, f]);

  return (
    <>
      <Sheet
        title="Filters"
        sub={n ? `${n} active` : null}
        labelId="sheet-filters"
        className="m-sheet-layer--filters m-sheet-layer--fcompact m-sheet-layer--fit"
        onClose={onClose}
      >
        <div className="m-filters" ref={setAnchor}>
          <div className="m-filters__scroll">
            <FacetRow
              id="set"
              label="Set"
              placeholder="All sets"
              chips={setChips(f, baseCodes, setNameByCode)}
              onOpen={() => setPicker("set")}
              onRemove={act.removeSet}
            />
            <RarityRow options={rarities} selected={f.rarity} onToggle={act.toggleRarity} />
            <FacetRow
              id="collection"
              label="Collection"
              placeholder={isAuthenticated ? "Any" : "Sign in to filter"}
              chips={collectionChips(state.toggles, state.scope, isAuthenticated)}
              onOpen={isAuthenticated ? () => setPicker("collection") : onRequestSignIn}
              onRemove={(k) => act.removeToggle(k as keyof typeof state.toggles)}
            />
            <FacetRow
              id="finish"
              label="Finish"
              placeholder="All finishes"
              chips={finishChips(f, state.scope)}
              onOpen={() => setPicker("finish")}
              onRemove={act.removeFinish}
            />
            <GameplaySection
              count={gameplayCount(f)}
              open={gameOpen}
              onToggle={() => setGameOpen((o) => !o)}
            >
              <GameplayBody f={f} facetCards={facetCards} act={act} onPick={setPicker} />
            </GameplaySection>
          </div>
          <FiltersFooter active={n > 0} count={vv.list.length} onReset={act.reset} />
        </div>
      </Sheet>
      {picker ? (
        <FacetPicker
          id={picker}
          f={f}
          toggles={state.toggles}
          scope={state.scope}
          facetCards={facetCards}
          all={vv.all}
          sets={sets}
          setNameByCode={setNameByCode}
          act={act}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </>
  );
}

/** S2-20 (BL-244): desktop CardsPage's filter_applied -- once per user edit,
 * after the render that applied it, with desktop's properties (`field`, the
 * post-change `active_filter_count` and `results_count`) + layout: phone.
 * The field is stashed synchronously by the action; the effect reads the
 * new list and count, then clears it, so nothing else (a quantities
 * refresh) fires a spurious event. Reset is desktop's filters_cleared
 * (useVaultView.clearAll); a scope pick is finish_scope_changed (S1-16). */
export function useFilterApplied(
  list: readonly unknown[],
  activeCount: number
): (field: FilterField) => void {
  const pending = useRef<FilterField | null>(null);
  useEffect(() => {
    const field = pending.current;
    if (field == null) return;
    pending.current = null;
    capturePhone("filter_applied", {
      field,
      active_filter_count: activeCount,
      results_count: list.length,
    });
  }, [list, activeCount]);
  return useCallback((field: FilterField) => {
    pending.current = field;
    // An action that changes nothing renders nothing: drop the stash once the
    // action's render has had its turn, so the next unrelated change is not
    // attributed to it. (A macrotask, not a microtask: filterActions calls
    // this BEFORE the setter, so a microtask would run before React's own
    // flush and swallow every real event.)
    setTimeout(() => {
      if (pending.current === field) pending.current = null;
    }, 0);
  }, []);
}

function FiltersFooter({
  active,
  count,
  onReset,
}: {
  active: boolean;
  count: number;
  onReset: () => void;
}) {
  const close = useSheetClose();
  return (
    <div className="m-filters__foot">
      <div className="m-filterfoot">
        <button
          type="button"
          className={"m-resetbtn" + (active ? "" : " m-resetbtn--inert")}
          aria-disabled={active ? undefined : true}
          onClick={() => {
            if (active) onReset();
          }}
        >
          Reset filters
        </button>
        <MSWUButton size="md" onClick={close} className="m-filterfoot__show">
          {count === 1 ? "Show 1 card" : `Show ${count} cards`}
        </MSWUButton>
      </div>
    </div>
  );
}
