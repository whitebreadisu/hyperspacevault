import type { CSSProperties } from "react";
import { SetMark, baseSetCodeFor } from "./AddCardsSetBar";
import { PreconDropdown } from "./PreconDropdown";
import { setSortRank } from "../../utils/setGrouping";
import type { CardSet } from "../../api/sets";
import type { PreconEntry } from "../../data/preconDecks";
import type { AddCardsCatalogEntry } from "../../utils/addCardsResolver";

interface Props {
  entries: PreconEntry[];
  sets: CardSet[];
  /** Threaded through to PreconDropdown so its hover-preview panel can
   * resolve each deck's leader/base composition (utils/preconPreview.ts) --
   * the same catalog AddCardsModal already holds, no new fetch. Unused once
   * a deck is selected (the locked strip below never reads it). */
  catalog: AddCardsCatalogEntry[];
  selectedKey: string | null;
  onChoose: (key: string) => void;
  onChangeDeck: () => void;
}

/** Exported so PreconDropdown's rail grouping shares the identical set-code
 * accessor rather than re-deriving it. */
export function entrySetCode(entry: PreconEntry): string {
  return entry.setCode;
}

/** The precon dropdown row's two separate lines -- PRODUCT (small caps) and
 * NAME (large); the rail's own set logo carries the set-code context, so
 * neither line repeats it. `entryLabel` below is built from these two for
 * the LOCKED bar's single-string text. */
export function entryProduct(entry: PreconEntry): string {
  return entry.kind === "ibhBox" ? "Whole box · 2 decks" : entry.deck.product;
}

export function entryName(entry: PreconEntry, sets: CardSet[]): string {
  if (entry.kind === "ibhBox") {
    const set = sets.find((s) => s.code === "IBH");
    return set ? set.name : "Intro Battle: Hoth";
  }
  return entry.deck.name;
}

// "Two-Player Starter — Luke Skywalker" for a plain deck; the IBH box uses
// the real set name from `sets` when it's loaded (falling back to a fixed
// string before the fetch resolves / if the code is ever absent) since
// there's no single "deck" whose own name would do -- it's the whole
// product, not either half.
export function entryLabel(entry: PreconEntry, sets: CardSet[]): string {
  if (entry.kind === "ibhBox") return entryName(entry, sets);
  return `${entryProduct(entry)} — ${entryName(entry, sets)}`;
}

const setRank = setSortRank;

// Entries in Vault set order -- the same setSortRank (utils/setGrouping.ts,
// newest main set first, ADR-0031) the rest of the app uses, borrowed rather
// than re-derived; set code breaks ties. Exported so PreconDropdown groups
// its rail using the identical order/tiebreak, rather than re-sorting.
export function sortedEntries(entries: PreconEntry[]): PreconEntry[] {
  return entries.slice().sort((a, b) => {
    const ra = setRank(entrySetCode(a));
    const rb = setRank(entrySetCode(b));
    if (ra !== rb) return ra - rb;
    const ca = entrySetCode(a);
    const cb = entrySetCode(b);
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });
}

/** The precon chooser (App Spec §18), built to MIRROR AddCardsSetBar
 * exactly -- same idiom (an unlocked picker -> a locked starfield strip with
 * a "Change X" button). `SetMark`/`baseSetCodeFor` are imported straight
 * from AddCardsSetBar rather than re-implemented, so the two bars'
 * mark/starfield rendering can never drift apart.
 *
 * Whether this component renders AT ALL is AddCardsModal's call (route
 * locking -- see its own `route` derivation); this component is unaware of
 * the other bar/route and just renders whichever of its own two sub-states
 * `selectedKey` implies.
 *
 * Deliberately NOT mirrored: SetDropdown's "Show all sets" toggle -- that
 * exists to reveal the manual flow's long-tail companion sets (Weekly Play,
 * Judge, ...), a concern this bar has no equivalent of (the dropdown's
 * source data is a small fixed list from data/preconDecks.json, always
 * shown in full).
 *
 * The unlocked picker is PreconDropdown, a custom logo-rail listbox with a
 * hover preview panel (App Spec §5.13), behind the `aria-label="Precon
 * Deck"` contract on its trigger and listbox. */
export function AddCardsPreconBar({
  entries,
  sets,
  catalog,
  selectedKey,
  onChoose,
  onChangeDeck,
}: Props) {
  if (!selectedKey) {
    return (
      <div className="ac-setbar">
        {/* "Add a premade deck" -- paired with AddCardsSetBar's "Add
            individual cards". PreconDropdown's `aria-label="Precon Deck"`
            is the stable test-facing accessible name, deliberately
            decoupled from this visible copy. */}
        <span className="ac-setbar__label">Add a premade deck</span>
        <div className="ac-setbar__select">
          <PreconDropdown entries={entries} sets={sets} catalog={catalog} onChoose={onChoose} />
        </div>
      </div>
    );
  }

  const entry = entries.find((e) => e.key === selectedKey);
  const setCode = entry ? entrySetCode(entry) : null;
  const starfieldCode = setCode ? baseSetCodeFor(setCode, sets) : null;
  const style = starfieldCode
    ? ({
        "--ac-setbar-starfield": `url(/images/starfields/starfield_${starfieldCode}.jpg)`,
      } as CSSProperties)
    : undefined;

  return (
    <div className="ac-setbar ac-setbar--locked" style={style}>
      <button type="button" className="ac-setbar__change" onClick={onChangeDeck}>
        Change deck
      </button>
      {setCode && <SetMark code={setCode} />}
      <span className="ac-setbar__locked">
        {setCode && <span className="ac-setbar__locked-code">{setCode}</span>}
        {entry ? entryLabel(entry, sets) : selectedKey}
      </span>
    </div>
  );
}
