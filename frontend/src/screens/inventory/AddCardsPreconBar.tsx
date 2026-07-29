import type { CSSProperties } from "react";
import { SetMark, baseSetCodeFor } from "./AddCardsSetBar";
import { PreconDropdown } from "./PreconDropdown";
import { CURATED_SET_ORDER } from "../../utils/catalog";
import type { CardSet } from "../../api/sets";
import type { PreconEntry } from "../../data/preconDecks";
import type { AddCardsCatalogEntry } from "../../utils/addCardsResolver";

interface Props {
  entries: PreconEntry[];
  sets: CardSet[];
  /** BL-164 §5: threaded through to PreconDropdown so its hover-preview
   * panel can resolve each deck's leader/base composition
   * (utils/preconPreview.ts) -- the same catalog AddCardsModal already
   * holds, no new fetch. Unused once a deck is selected (the locked strip
   * below never reads it). */
  catalog: AddCardsCatalogEntry[];
  selectedKey: string | null;
  onChoose: (key: string) => void;
  onChangeDeck: () => void;
}

/** Exported (BL-164) so PreconDropdown's rail grouping shares the identical
 * set-code accessor rather than re-deriving it. */
export function entrySetCode(entry: PreconEntry): string {
  return entry.setCode;
}

/** BL-164 §5: the precon dropdown row's two separate lines -- PRODUCT (small
 * caps) and NAME (large) -- replacing the old single-string `entryLabel`
 * text in the row itself (the rail's own set logo now carries the set-code
 * context the old "SOR — " text prefix used to supply). `entryLabel` below
 * is kept, built from these two, for the LOCKED bar's single-string text. */
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

function setRank(code: string): number {
  const i = CURATED_SET_ORDER.indexOf(code);
  return i === -1 ? CURATED_SET_ORDER.length : i;
}

// §4-REV: "21 entries ... in Vault set order" -- same CURATED_SET_ORDER the
// rest of the app's set ordering already uses (utils/catalog.ts), borrowed
// rather than re-derived. Exported (BL-164) so PreconDropdown groups its
// rail using the identical order/tiebreak, rather than re-sorting.
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

/** BL-151 S2b (§4-REV, owner dev-review 2026-07-24): the precon chooser,
 * rebuilt from scratch to MIRROR AddCardsSetBar exactly -- same idiom
 * (unlocked native `<select>` -> a locked starfield strip with a "Change X"
 * button). `SetMark`/`baseSetCodeFor` are imported straight from
 * AddCardsSetBar rather than re-implemented, so the two bars' mark/starfield
 * rendering can never drift apart.
 *
 * BL-151 S2c (§4-REV2): whether this component renders AT ALL is now
 * AddCardsModal's call (route locking -- see its own `route` derivation) --
 * this component itself is unaware of the other bar/route; it just renders
 * whichever of its own two sub-states `selectedKey` implies, exactly as
 * before.
 *
 * Deliberately NOT mirrored: AddCardsSetBar's "Show all sets" toggle -- that
 * exists to reveal the manual flow's long-tail companion sets (Weekly Play,
 * Judge, ...), a concern this bar has no equivalent of (the dropdown's
 * source data is a small fixed 21-entry list, always shown in full).
 *
 * BL-164 §5: the unlocked native `<select>` is replaced by PreconDropdown, a
 * custom logo-rail listbox with an owner-locked hover preview panel (both
 * still gated behind the same `aria-label="Precon Deck"` contract). */
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
        {/* BL-151 S2c (§4-REV2 point 1): "Add a premade deck" -- paired with
            AddCardsSetBar's "Add individual cards". `aria-label="Precon
            Deck"` below is deliberately UNCHANGED -- stable test-facing
            accessible name, decoupled from this visible copy. */}
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
