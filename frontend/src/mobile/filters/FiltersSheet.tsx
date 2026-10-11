import { useMemo, useState } from "react";
import { useLimits } from "../../context/LimitsContext";
import { MSWUButton } from "../MSWUButton";
import { Sheet, useSheetClose } from "../Sheet";
import { useVaultData } from "../vault/useVaultData";
import type { VaultView } from "../vault/useVaultView";
import { FacetPicker } from "./FacetPicker";
import { FacetRow, RarityRow } from "./FacetRows";
import type { FacetId } from "./FacetRows";
import {
  collectionChips,
  facetBase,
  filterActions,
  finishChips,
  gameplayCount,
  rarityOptions,
  setChips,
} from "./filterModel";
import { GameplaySection } from "./GameplaySection";
import { useSheetGrow } from "./useSheetGrow";
import "./filters.css";

// BL-248 stage 2B-1 (S2-12 … S2-16): the Filters sheet (rev4 MFilters.jsx
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
  const [picker, setPicker] = useState<FacetId | null>(null);
  const [gameOpen, setGameOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useSheetGrow(anchor);

  const { state } = vv;
  const f = state.filters;
  const act = filterActions(vv);
  const baseCodes = useMemo(
    () => new Set(sets.filter((s) => s.is_base_set).map((s) => s.code)),
    [sets]
  );
  const facetCards = useMemo(() => facetBase(vv.all, state, limits), [vv.all, state, limits]);
  const rarities = useMemo(() => rarityOptions(facetCards, f), [facetCards, f]);
  const n = vv.activeCount;

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
              <p className="m-sheet__soon m-fgame__soon">
                Gameplay filters arrive with the next stage.
              </p>
            </GameplaySection>
          </div>
          <FiltersFooter active={n > 0} count={vv.list.length} onReset={act.reset} />
        </div>
      </Sheet>
      {picker ? <FacetPicker facet={picker} onClose={() => setPicker(null)} /> : null}
    </>
  );
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
