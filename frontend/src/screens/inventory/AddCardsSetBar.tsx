import type { CSSProperties } from "react";
import type { CardSet } from "../../api/sets";
import type { AddCardsCatalogEntry } from "../../utils/addCardsResolver";
import { headerLogoCodesFor } from "../../utils/setGrouping";
import { SetDropdown } from "./SetDropdown";

interface Props {
  sets: CardSet[];
  /** Read only by the locked header's base-set logo derivation
   * (headerLogoCodesFor) -- an Exclusives selection shows the home base
   * set(s) of the printings it released, which only the catalog knows. */
  catalog: AddCardsCatalogEntry[];
  setCode: string | null;
  onChoose: (code: string) => void;
  onChangeSet: () => void;
}

/** Exported (BL-151 S2b) so AddCardsPreconBar -- built to mirror this
 * component exactly, per the owner's §4-REV dev-review feedback -- shares
 * the identical mark/starfield rendering rather than a drifting copy. */
export function SetMark({ code }: { code: string }) {
  return (
    <img
      className="ac-setbar__mark"
      src={`/images/set_${code}.png`}
      alt={`${code} logo`}
      style={{ height: 28 }}
    />
  );
}

// Source-set picker (§5.1 / §5.4, restyled BL-164 §5): a custom logo-rail
// listbox (SetDropdown) replaces the old native `<select>` + external "Show
// all sets" button -- that toggle now lives inside the dropdown's own panel
// footer (Set_Grouping_Context_2026-07-26.md).
export function AddCardsSetBar({ sets, catalog, setCode, onChoose, onChangeSet }: Props) {
  if (!setCode) {
    return (
      <div className="ac-setbar">
        {/* BL-151 S2c (§4-REV2 point 1): "Add individual cards" -- paired
            with AddCardsPreconBar's "Add a premade deck" so the two routes'
            unlocked pickers read as an unmistakable choice when they're
            shown side by side (AddCardsModal's .ac-chooser-row). The
            `aria-label="Set"` below is deliberately UNCHANGED -- it's the
            stable test-facing accessible name, decoupled from this visible
            copy on purpose. */}
        <span className="ac-setbar__label">Add individual cards</span>
        <div className="ac-setbar__select">
          <SetDropdown sets={sets} onChoose={onChoose} />
        </div>
      </div>
    );
  }

  const set = sets.find((s) => s.code === setCode);
  const starfieldCode = baseSetCodeFor(setCode, sets);
  // "--ac-setbar-starfield" backs the CSS `var(--ac-setbar-starfield, url(tile))`
  // fallback below (same technique the design prototype and the app header's
  // own ASH strip, index.css's .app-header::before, both use for a
  // single-background-size/-position rule that still works whether the
  // per-set image resolves or not).
  const style = starfieldCode
    ? ({
        "--ac-setbar-starfield": `url(/images/starfields/starfield_${starfieldCode}.jpg)`,
      } as CSSProperties)
    : undefined;

  return (
    <div className="ac-setbar ac-setbar--locked" style={style}>
      {/* Design handoff §7: "Change set" sits LEFT of the set logo once a set
          is locked in (mirrors the console prototype's CSS `order:-1` trick,
          done here by physical JSX order since we can edit the real markup
          directly). */}
      <button type="button" className="ac-setbar__change" onClick={onChangeSet}>
        Change set
      </button>
      {/* The header logo is always a BASE set's mark (logo assets exist per
          base set only): a Weekly Play or Exclusives selection shows the base
          set(s) its printings belong to -- several side by side, canonical
          release order, when an Exclusives container spans base sets
          (headerLogoCodesFor). An unmappable selection renders no logo at
          all rather than a broken image. */}
      <span className="ac-setbar__marks">
        {headerLogoCodesFor(setCode, catalog).map((code) => (
          <SetMark key={code} code={code} />
        ))}
      </span>
      <span className="ac-setbar__locked">
        <span className="ac-setbar__locked-code">{setCode}</span>
        {set ? set.name : setCode}
      </span>
    </div>
  );
}

/** BL-111 F7 (design handoff §7): the locked set bar's background becomes
 * that set's starfield center strip -- but a batch can be entered against a
 * long-tail/companion set (e.g. "SORP" Weekly Play), which has no starfield
 * asset of its own (assets only exist per *base* set, public/images/
 * starfields/starfield_<SET>.jpg). Weekly-play codes are conventionally the
 * base code plus a trailing letter (SORP -> SOR), so this is a narrow,
 * documented heuristic rather than a general set-hierarchy lookup: try the
 * code verbatim against the fetched `sets` list's real `is_base_set` flag
 * (no hardcoded set-code table to drift), then its 3-char prefix. Codes that
 * don't conform to that pattern (e.g. "J25") resolve to null -- the setbar
 * then falls back to its plain tile background, never a missing image. */
export function baseSetCodeFor(setCode: string, sets: CardSet[]): string | null {
  if (sets.some((s) => s.code === setCode && s.is_base_set)) return setCode;
  const prefix = setCode.slice(0, 3);
  if (prefix !== setCode && sets.some((s) => s.code === prefix && s.is_base_set)) return prefix;
  return null;
}
