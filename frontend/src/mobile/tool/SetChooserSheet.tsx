import { useState } from "react";
import type { CardSet } from "../../api/sets";
import type { PreconEntry } from "../../data/preconDecks";
import { entryName, entryProduct } from "../../screens/inventory/AddCardsPreconBar";
import { findSet } from "../../utils/setGrouping";
import type { SetRailGroup } from "../../utils/setGrouping";
import { MIcon } from "../icons";
import { Sheet, useSheetClose } from "../Sheet";
import { PRECON_ENTRIES, padSetBase, setLogoUrl, setSheetGroups } from "./padModel";
import { choosePrecon, chooseSet } from "./toolStore";

// BL-249 S3-05 (R5-6 + F-3): the keypad's "Choose a set" sheet. Two
// collapsed choosers, one above the other -- "Set" and "Precon deck",
// desktop's unlocked set bar + precon bar triggers (AddCardsSetBar /
// AddCardsPreconBar) -- neither open on arrival; tapping one expands its
// list in place (and folds the other). The set list is desktop
// SetDropdown's two views from setGrouping.ts (Base sets only: canonical,
// newest main set first, divider, secondary; Show all sets: each base set with its
// Weekly Play set nested under it, divider, the Exclusives under desktop's
// subgroup labels), the toggle in the sheet foot; the deck list is desktop's
// 23 entries (preconEntries + sortedEntries). Picking closes the sheet and
// locks the keypad.

type Open = "set" | "precon" | null;

function SetRow({
  code,
  sets,
  value,
  kind,
  sub,
}: {
  code: string;
  sets: CardSet[];
  value: string | null;
  kind: "base" | "weekly" | "exclusive";
  sub?: boolean;
}) {
  const close = useSheetClose();
  const s = findSet(sets, code);
  if (!s) return null;
  const on = value === code;
  const logo = sub ? null : padSetBase(code);
  return (
    <button
      type="button"
      className={
        "m-choice__row m-choice__row--set m-setpick__row m-setpick__row--" +
        kind +
        (sub ? " m-setpick__row--sub" : "") +
        (on ? " m-choice__row--on" : "")
      }
      data-code={code}
      aria-pressed={on}
      aria-label={`${code} — ${s.name}`}
      onClick={() => {
        chooseSet(code);
        close();
      }}
    >
      {logo ? (
        <img src={setLogoUrl(logo)} alt="" className="m-choice__logo" />
      ) : (
        <span className="m-setpick__nologo" aria-hidden="true">
          {code}
        </span>
      )}
      <span className="m-choice__setname">
        {s.name}
        <span className="m-choice__code">{code}</span>
      </span>
      {on ? <MIcon name="check" size={20} /> : null}
    </button>
  );
}

function SetList({ sets, value, all }: { sets: CardSet[]; value: string | null; all: boolean }) {
  const g = setSheetGroups(sets);
  const row = (grp: SetRailGroup) => (
    <SetRow key={grp.key} code={grp.memberCodes[0]} sets={sets} value={value} kind="base" />
  );
  return (
    <div className="m-choice m-setpick" data-view={all ? "all" : "base"}>
      {!all ? g.base.canonical.map(row) : null}
      {!all && g.base.secondary.length ? (
        <div className="m-setpick__group" data-tail="secondary">
          <div className="m-fdivider" role="presentation" />
          {g.base.secondary.map(row)}
        </div>
      ) : null}
      {all
        ? g.all.baseGroups.map((bg) => (
            <div key={bg.key} className="m-setpick__rgroup" data-base={bg.key}>
              {bg.memberCodes.map((code, i) => (
                <SetRow
                  key={code}
                  code={code}
                  sets={sets}
                  value={value}
                  kind={i ? "weekly" : "base"}
                  sub={i > 0}
                />
              ))}
            </div>
          ))
        : null}
      {all && g.all.exclusiveGroups.length ? (
        <div className="m-setpick__group" data-tail="exclusives">
          <div className="m-fdivider" role="presentation" />
          {g.all.exclusiveGroups.map((eg) => (
            <div key={eg.key} className="m-setpick__sub">
              <div className="m-setpick__g">{eg.label}</div>
              {eg.memberCodes.map((code) => (
                <SetRow key={code} code={code} sets={sets} value={value} kind="exclusive" />
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DeckList({ sets, value }: { sets: CardSet[]; value: string | null }) {
  const close = useSheetClose();
  return (
    <div className="m-choice m-d2-decks" role="listbox" aria-label="Precon Deck">
      {PRECON_ENTRIES.map((e: PreconEntry) => {
        const on = value === e.key;
        return (
          <button
            key={e.key}
            type="button"
            role="option"
            aria-selected={on}
            data-deck={e.key}
            className={"m-choice__row m-d2-deck" + (on ? " m-choice__row--on" : "")}
            aria-label={`${entryProduct(e)} — ${entryName(e, sets)}`}
            onClick={() => {
              choosePrecon(e.key);
              close();
            }}
          >
            <img className="m-choice__logo m-d2-deck__logo" src={setLogoUrl(e.setCode)} alt="" />
            <span className="m-d2-deck__text">
              <span className="m-d2-deck__product">{entryProduct(e)}</span>
              <span className="m-d2-deck__name">{entryName(e, sets)}</span>
            </span>
            {on ? <MIcon name="check" size={20} /> : null}
          </button>
        );
      })}
    </div>
  );
}

function Chooser({
  id,
  label,
  value,
  open,
  onToggle,
}: {
  id: string;
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={"m-setchooser" + (open ? " m-setchooser--open" : "")}
      aria-expanded={open}
      aria-controls={id}
      onClick={onToggle}
    >
      <span className="m-setchooser__text">
        <span className="m-setchooser__label">{label}</span>
        <span className="m-setchooser__value">{value}</span>
      </span>
      <MIcon name={open ? "chevup" : "chevdown"} size={20} />
    </button>
  );
}

export function SetChooserSheet({
  sets,
  setCode,
  preconKey,
  onClose,
}: {
  sets: CardSet[];
  /** The locked set (null while a deck is chosen). */
  setCode: string | null;
  preconKey: string | null;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<Open>(null);
  // A subset already chosen opens the "all" view, so the selection is never
  // hidden (rev4 MSetPicker; desktop has no locked-subset reopen).
  const [all, setAll] = useState(!!setCode && padSetBase(setCode) !== setCode);
  const deck = preconKey ? PRECON_ENTRIES.find((e) => e.key === preconKey) : undefined;
  const setName = setCode ? (findSet(sets, setCode)?.name ?? setCode) : null;
  return (
    <Sheet
      title="Choose a set"
      labelId="sheet-setpick"
      className="m-sheet-layer--setpick"
      onClose={onClose}
      footer={
        open === "set" ? (
          <button
            type="button"
            className="m-flink m-setpick__all"
            aria-pressed={all}
            onClick={() => setAll(!all)}
          >
            {all ? "Base sets only" : "Show all sets"}
          </button>
        ) : null
      }
    >
      <div className="m-setchoosers">
        <Chooser
          id="m-setchooser-set"
          label="Set"
          value={setCode ? `${setCode} · ${setName}` : "Select a set"}
          open={open === "set"}
          onToggle={() => setOpen(open === "set" ? null : "set")}
        />
        {open === "set" ? (
          <div id="m-setchooser-set" className="m-setchooser__list">
            <SetList sets={sets} value={setCode} all={all} />
          </div>
        ) : null}
        <Chooser
          id="m-setchooser-precon"
          label="Precon deck"
          value={deck ? `${entryProduct(deck)} · ${entryName(deck, sets)}` : "Select a precon deck"}
          open={open === "precon"}
          onToggle={() => setOpen(open === "precon" ? null : "precon")}
        />
        {open === "precon" ? (
          <div id="m-setchooser-precon" className="m-setchooser__list">
            <DeckList sets={sets} value={preconKey} />
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
