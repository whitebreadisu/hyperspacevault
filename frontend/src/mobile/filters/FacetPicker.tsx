import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CardSet } from "../../api/sets";
import { buildFinishTree, shapeFinishTree } from "../../utils/filters";
import type { FilterState, ShapedFinishRow } from "../../utils/filters";
import type { InventoryCard } from "../../utils/inventory";
import { MIcon } from "../icons";
import type { CollectionToggles } from "../vault/vaultModel";
import { COLLECTION_LONG } from "./collectionLabels";
import { facetValid, fieldOptions, listUniverse, setPickerGroups } from "./filterModel";
import type { filterActions } from "./filterModel";
import type { FacetId } from "./FacetRows";
import { CheckRow, FChip, PickerFrame, zero } from "./pickerParts";

// BL-248 stage 2B-2 (S2-17 / S2-18 / S2-19 pickers; rev4 MFilterPickers.jsx
// + MFilters.jsx SetFacet / CollectionFacet / FinishTree / PickerSheet). A
// picker opens over Filters (X top-right, Done) and edits the Vault's state
// live through the same actions as the rows. Local UI state (Show all sets,
// expanded finish families, the search box) starts fresh on every open, as
// desktop resets its menus on close.

export type PickerId = FacetId | "keyword" | "trait";

type Actions = ReturnType<typeof filterActions>;

export interface PickerProps {
  id: PickerId;
  f: FilterState;
  toggles: CollectionToggles;
  scope: string | null;
  /** The facet universe (toggles + search; S2-15 facetBase). */
  facetCards: InventoryCard[];
  /** Every card (the Finish tree and Keyword / Trait universes). */
  all: InventoryCard[];
  sets: CardSet[];
  setNameByCode: Record<string, string>;
  act: Actions;
  onClose: () => void;
}

export function FacetPicker(p: PickerProps) {
  if (p.id === "set") return <SetPicker {...p} />;
  if (p.id === "collection") return <CollectionPicker {...p} />;
  if (p.id === "finish") return <FinishPicker {...p} />;
  return <ListPicker {...p} field={p.id} />;
}

// ── S2-17 Set picker (desktop FilterPanel Set facet + its menubar) ──────────
function SetPicker({ f, facetCards, sets, setNameByCode, act, onClose }: PickerProps) {
  const [all, setAll] = useState(false);
  const groups = useMemo(() => setPickerGroups(sets), [sets]);
  const valid = facetValid(facetCards, f, "set");
  const opt = (code: string) => {
    const inert = valid !== null && !valid.has(code);
    return { value: code, label: zero(setNameByCode[code] ?? code, inert), inert };
  };
  // A selected long-tail set stays visible while the list is base-only.
  const shown = (codes: string[]) => (all ? codes : codes.filter((c) => f.set.has(c)));
  const weekly = shown(groups.weekly);
  const ex = shown(groups.exclusives);
  const row = (code: string) => {
    const o = opt(code);
    return (
      <CheckRow
        key={code}
        on={f.set.has(code)}
        inert={o.inert}
        label={o.label}
        fv={code}
        className="m-setrow-tail"
        onClick={() => act.toggleSet(code)}
        sub={<span className="m-fcheck__code">{code}</span>}
      >
        {o.label}
      </CheckRow>
    );
  };
  return (
    <PickerFrame
      id="set"
      title="Set"
      selected={f.set.size}
      className="m-sheet-layer--fpick m-sheet-layer--fpick-set"
      onClose={onClose}
    >
      <section className="m-fgroup m-fgroup--b1" data-facet="set" aria-label="Set">
        <div className="m-picker__bar m-fpick__bar">
          <button
            type="button"
            className="m-flink m-setfacet__all"
            aria-pressed={all}
            onClick={() => setAll((a) => !a)}
          >
            {all ? "Base sets only" : "Show all sets"}
          </button>
          <button type="button" className="m-flink" disabled={!f.set.size} onClick={act.clearSets}>
            Clear
          </button>
        </div>
        <div className="m-chipwrap m-setfacet">
          {groups.base.map((code) => (
            <FChip
              key={code}
              opt={opt(code)}
              selected={f.set}
              onToggle={act.toggleSet}
              className="m-chip--set m-setfacet__chip"
            >
              <img
                className={"m-chip__logo m-chip__logo--" + code}
                src={`/images/set_${code}.png`}
                alt=""
              />
            </FChip>
          ))}
        </div>
        {weekly.length ? (
          <div className="m-ftail" data-tail="weekly">
            {weekly.map(row)}
          </div>
        ) : null}
        {weekly.length && ex.length ? <div className="m-fdivider" role="presentation" /> : null}
        {ex.length ? (
          <div className="m-ftail" data-tail="exclusives">
            {ex.map(row)}
          </div>
        ) : null}
      </section>
    </PickerFrame>
  );
}

// ── S2-18 Collection picker (CardsPage's four toggles + exclusions) ─────────
function CollectionPicker({ toggles, scope, act, onClose }: PickerProps) {
  const n = COLLECTION_LONG.filter(([k]) => toggles[k]).length;
  return (
    <PickerFrame
      id="collection"
      title="Collection"
      selected={n}
      className="m-sheet-layer--fpick m-sheet-layer--fpick-collection"
      onClose={onClose}
    >
      <section className="m-fgroup m-fgroup--b1" data-facet="collection" aria-label="Collection">
        {COLLECTION_LONG.map(([k, label]) => (
          <CheckRow
            key={k}
            on={toggles[k]}
            label={label}
            fv={k}
            className={scope ? "m-fcheck--scoped" : undefined}
            onClick={() => act.toggleToggle(k)}
          >
            {label}
          </CheckRow>
        ))}
        {scope ? <p className="m-fnote">Scoped: these read your {scope} copies only.</p> : null}
      </section>
    </PickerFrame>
  );
}

// ── S2-18 Finish picker (desktop FinishFilter's two-tier tree) ──────────────
function FinishPicker({ f, facetCards, all, act, onClose }: PickerProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildFinishTree(all), [all]);
  const valid = facetValid(facetCards, f, "finish");
  const rows = shapeFinishTree(tree, valid, f.finish, true);
  // Desktop FinishFilter menubar: All (every value the facet can still add)
  // and Clear.
  const addable = rows.flatMap((r) =>
    r.kind === "plain"
      ? r.inert
        ? []
        : [r.value]
      : r.kind === "pair"
        ? [r.base, r.foil].filter((v) => v && !v.inert).map((v) => v!.value)
        : r.children.filter((c) => !c.inert).map((c) => c.value)
  );
  const toggleOpen = (key: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  return (
    <PickerFrame
      id="finish"
      title="Finish"
      selected={f.finish.size}
      className="m-sheet-layer--fpick m-sheet-layer--fpick-finish"
      onClose={onClose}
    >
      <section className="m-fgroup m-fgroup--b1" data-facet="finish" aria-label="Finish">
        <div className="m-picker__bar m-fpick__bar">
          <button
            type="button"
            className="m-flink"
            disabled={addable.every((v) => f.finish.has(v))}
            onClick={() => act.setFinishes(new Set([...f.finish, ...addable]))}
          >
            All
          </button>
          <button
            type="button"
            className="m-flink"
            disabled={!f.finish.size}
            onClick={() => act.setFinishes(new Set())}
          >
            Clear
          </button>
        </div>
        <div className="m-ftree">
          {rows.map((row, i) => (
            <Fragment key={row.key}>
              <FinishRow
                row={row}
                idx={i}
                isOpen={open.has(row.key)}
                onExpand={() => toggleOpen(row.key)}
                onToggle={act.toggleFinish}
              />
              {row.pinned && rows[i + 1] && !rows[i + 1].pinned ? (
                <div className="m-fdivider" role="presentation" />
              ) : null}
            </Fragment>
          ))}
        </div>
      </section>
    </PickerFrame>
  );
}

const EMPTY = new Set<string>();

function FinishRow({
  row,
  idx,
  isOpen,
  onExpand,
  onToggle,
}: {
  row: ShapedFinishRow;
  idx: number;
  isOpen: boolean;
  onExpand: () => void;
  onToggle: (v: string) => void;
}) {
  // A chip's accessible name is the full raw value (desktop); the face is
  // the generic Non-foil / Foil, or Std / Foil / Serialized for Prestige.
  const chip = (v: { value: string; checked: boolean; inert: boolean }, text: string) => (
    <FChip
      key={v.value}
      opt={{ value: v.value, label: zero(v.value, v.inert), inert: v.inert }}
      selected={v.checked ? new Set([v.value]) : EMPTY}
      onToggle={onToggle}
      className="m-ffin__chip"
    >
      {text}
    </FChip>
  );
  if (row.kind === "pair") {
    const allInert = (!row.base || row.base.inert) && (!row.foil || row.foil.inert);
    return (
      <div
        className={"m-ffin m-ffin--pair" + (allInert ? " m-ffin--inert" : "")}
        data-row={row.key}
      >
        <span className="m-ffin__label">{row.label}</span>
        <span className="m-ffin__chips">
          {row.base ? chip(row.base, "Non-foil") : null}
          {row.foil ? chip(row.foil, "Foil") : null}
        </span>
      </div>
    );
  }
  if (row.kind === "plain") {
    return (
      <CheckRow
        on={row.checked}
        inert={row.inert}
        label={zero(row.label, row.inert)}
        fv={row.value}
        className="m-ffin m-ffin--plain"
        onClick={() => onToggle(row.value)}
      >
        {zero(row.label, row.inert)}
      </CheckRow>
    );
  }
  if (row.key === "Prestige") {
    return (
      <div
        className={"m-ffin m-ffin--prestige" + (row.allInert ? " m-ffin--inert" : "")}
        data-row={row.key}
      >
        <span className="m-ffin__label">{row.label}</span>
        <span className="m-ffin__chips">
          {row.children.map((c) => chip(c, c.displayLabel === "Standard" ? "Std" : c.displayLabel))}
        </span>
      </div>
    );
  }
  const badge = !isOpen && row.selectedCount > 0;
  return (
    <div
      className={"m-ffin m-ffin--group" + (row.allInert ? " m-ffin--inert" : "")}
      data-row={row.key}
    >
      <button
        type="button"
        className={"m-ffin__head" + (badge ? " m-ffin__head--sel" : "")}
        aria-expanded={isOpen}
        aria-controls={"ffin-" + idx}
        onClick={onExpand}
      >
        <MIcon
          name="chevdown"
          size={18}
          className={"m-ffin__chev" + (isOpen ? " m-ffin__chev--open" : "")}
        />
        <span className="m-ffin__label">{row.label}</span>
        {badge ? <span className="m-ffin__badge">· {row.selectedCount}</span> : null}
      </button>
      {isOpen ? (
        <div className="m-ffin__kids" id={"ffin-" + idx}>
          {row.children.map((c) => (
            <CheckRow
              key={c.value}
              on={c.checked}
              inert={c.inert}
              label={zero(c.value, c.inert)}
              fv={c.value}
              className="m-ffin__kid"
              onClick={() => onToggle(c.value)}
            >
              {zero(c.displayLabel, c.inert)}
            </CheckRow>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── S2-19 Keyword / Trait picker (desktop MultiSelect `searchable`) ─────────
function ListPicker({
  field,
  f,
  facetCards,
  all,
  act,
  onClose,
}: PickerProps & { field: "keyword" | "trait" }) {
  const label = field === "keyword" ? "Keywords" : "Traits";
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // Desktop focuses the search when the menu opens; after the Sheet's own
  // focus move to its X (a parent effect, so a tick later).
  useEffect(() => {
    const t = setTimeout(() => input.current?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(t);
  }, []);
  const universe = useMemo(() => listUniverse(all, field), [all, field]);
  const sel = f[field];
  const opts = fieldOptions(facetCards, f, field, universe, sel);
  const needle = query.trim().toLowerCase();
  const shown = needle ? opts.filter((o) => o.value.toLowerCase().includes(needle)) : opts;
  const addable = shown.filter((o) => !o.inert);
  return (
    <PickerFrame
      id={field}
      title={label}
      selected={sel.size}
      className={"m-sheet-layer--plist m-sheet-layer--plist-" + field}
      onClose={onClose}
    >
      <div className="m-picker" data-picker-field={field}>
        <div className="m-picker__search">
          <form
            className="m-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              input.current?.blur();
            }}
          >
            <MIcon name="search" size={20} className="m-search__glass" />
            <input
              ref={input}
              className="m-search__input"
              type="search"
              enterKeyHint="search"
              value={query}
              placeholder={"Search " + label.toLowerCase()}
              aria-label={"Search " + label.toLowerCase()}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
            />
          </form>
        </div>
        <div className="m-picker__bar">
          <button
            type="button"
            className="m-flink"
            disabled={!addable.length}
            onClick={() => act.setValues(field, new Set([...sel, ...addable.map((o) => o.value)]))}
          >
            {needle ? `All matches (${addable.length})` : "All"}
          </button>
          <button
            type="button"
            className="m-flink"
            disabled={!sel.size}
            onClick={() => act.setValues(field, new Set())}
          >
            Clear
          </button>
        </div>
        <div className="m-picker__list" role="group" aria-label={label}>
          {shown.length === 0 ? (
            <div className="m-picker__empty">No matches</div>
          ) : (
            shown.map((o) => (
              <CheckRow
                key={o.value}
                on={sel.has(o.value)}
                inert={!!o.inert}
                label={o.label}
                fv={o.value}
                onClick={() => act.toggleIn(field, o.value)}
              >
                {o.label}
              </CheckRow>
            ))
          )}
        </div>
      </div>
    </PickerFrame>
  );
}
