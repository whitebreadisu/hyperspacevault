import { useState } from "react";
import type { RefObject } from "react";
import { MIcon } from "../icons";
import type { IconName } from "../icons";
import { ScopeChip } from "./ScopeChip";
import { sortLabel } from "./SortSheet";
import type { GallerySize, RowSize, VaultView } from "./useVaultView";

// BL-247 S1-14 / S1-15 / S1-18: the Vault's status area, two rows (R5-3).
// Row one: the search box, Clear (only while narrowed; its slot is not
// reserved, the search box narrows), Filters (badge = desktop's active count).
// Row two: the count (left-most; amber while narrowed, the filtered count
// only), the scope chip, the icon-only Sort, the list / gallery toggle. While
// a size picker is open the count, chip and Sort step aside. Search focus
// enters search mode (S1-15, owned by Vault.tsx); blur leaves it.

const ROW_SIZE_OPTIONS: { key: RowSize; label: string; icon: IconName }[] = [
  { key: "none", label: "No image", icon: "sz0" },
  { key: "sm", label: "Small image", icon: "sz1" },
  { key: "md", label: "Medium image", icon: "sz2" },
  { key: "lg", label: "Large image", icon: "sz3" },
];
const GALLERY_SIZE_OPTIONS: { key: GallerySize; label: string; icon: IconName }[] = [
  { key: 1, label: "One card across", icon: "g1" },
  { key: 2, label: "Two cards across", icon: "g2" },
  { key: 3, label: "Three cards across", icon: "g3" },
];

export const SEARCH_PLACEHOLDER = "Search the vault";

function SearchField({
  value,
  onChange,
  inputRef,
  onFocus,
  onBlur,
}: {
  value: string;
  onChange: (q: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onFocus: () => void;
  onBlur: () => void;
}) {
  return (
    <form
      className="m-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        inputRef.current?.blur();
      }}
    >
      <MIcon name="search" size={20} className="m-search__glass" />
      <input
        ref={inputRef}
        className="m-search__input"
        type="search"
        enterKeyHint="search"
        value={value}
        placeholder={SEARCH_PLACEHOLDER}
        aria-label={SEARCH_PLACEHOLDER}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      {value ? (
        <button
          type="button"
          className="m-iconbtn m-search__clear"
          // Keep focus in the field: clearing the query never ends search mode.
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
        >
          <MIcon name="close" size={18} />
        </button>
      ) : null}
    </form>
  );
}

function ViewToggle({
  view,
  rowSize,
  gallerySize,
  sizesOpen,
  setSizesOpen,
  vv,
}: {
  view: VaultView["prefs"]["view"];
  rowSize: RowSize;
  gallerySize: GallerySize;
  sizesOpen: boolean;
  setSizesOpen: (open: boolean) => void;
  vv: VaultView;
}) {
  const rows = view === "rows";
  const openRows = sizesOpen && rows;
  const openGal = sizesOpen && !rows;
  return (
    <span
      className={
        "m-seg m-viewseg" +
        (openRows ? " m-viewseg--open-rows" : "") +
        (openGal ? " m-viewseg--open-gal" : "")
      }
      role="group"
      aria-label="View"
    >
      <span
        className="m-viewseg__sizes m-viewseg__sizes--rows"
        aria-hidden={openRows ? undefined : true}
      >
        {ROW_SIZE_OPTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            tabIndex={openRows ? 0 : -1}
            className={"m-seg__btn m-viewseg__size" + (rowSize === s.key ? " m-seg__btn--on" : "")}
            onClick={() => {
              vv.setRowSize(s.key);
              setSizesOpen(false);
            }}
            aria-pressed={rowSize === s.key}
            aria-label={"Rows: " + s.label}
          >
            <MIcon name={s.icon} size={20} />
          </button>
        ))}
      </span>
      <button
        type="button"
        className={"m-seg__btn m-viewseg__list" + (rows ? " m-seg__btn--on" : "")}
        onClick={() => {
          if (rows) setSizesOpen(!sizesOpen);
          else {
            vv.setView("rows");
            setSizesOpen(false);
          }
        }}
        aria-pressed={rows}
        aria-expanded={rows ? sizesOpen : undefined}
        aria-label={rows ? (sizesOpen ? "List: close row sizes" : "List: choose row size") : "List"}
      >
        <MIcon name={openRows ? "close" : "rows"} size={18} />
      </button>
      <span
        className="m-viewseg__sizes m-viewseg__sizes--gal"
        aria-hidden={openGal ? undefined : true}
      >
        {GALLERY_SIZE_OPTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            tabIndex={openGal ? 0 : -1}
            className={
              "m-seg__btn m-viewseg__size m-viewseg__gsize" +
              (gallerySize === s.key ? " m-seg__btn--on" : "")
            }
            onClick={() => {
              vv.setGallerySize(s.key);
              setSizesOpen(false);
            }}
            aria-pressed={gallerySize === s.key}
            aria-label={"Gallery: " + s.label}
          >
            <MIcon name={s.icon} size={20} />
          </button>
        ))}
      </span>
      <button
        type="button"
        className={"m-seg__btn m-viewseg__gal" + (!rows ? " m-seg__btn--on" : "")}
        onClick={() => {
          if (!rows) setSizesOpen(!sizesOpen);
          else {
            vv.setView("gallery");
            setSizesOpen(false);
          }
        }}
        aria-pressed={!rows}
        aria-expanded={!rows ? sizesOpen : undefined}
        aria-label={
          !rows
            ? sizesOpen
              ? "Gallery: close card sizes"
              : "Gallery: choose cards across"
            : "Gallery"
        }
      >
        <MIcon name={openGal ? "close" : "grid"} size={18} />
      </button>
    </span>
  );
}

export function VaultStatus({
  vv,
  searchRef,
  onSearchFocus,
  onSearchBlur,
  onOpenFilters,
  onOpenScope,
  onOpenSort,
  initialSizesOpen = false,
}: {
  vv: VaultView;
  searchRef: RefObject<HTMLInputElement | null>;
  onSearchFocus: () => void;
  onSearchBlur: () => void;
  onOpenFilters: () => void;
  onOpenScope: () => void;
  onOpenSort: () => void;
  initialSizesOpen?: boolean;
}) {
  const [sizesOpen, setSizesOpen] = useState(initialSizesOpen);
  const n = vv.list.length;
  const count = vv.activeCount;
  return (
    <div className="m-vault__controls">
      <div className="m-vault__searchrow">
        <SearchField
          value={vv.state.query}
          onChange={vv.setQuery}
          inputRef={searchRef}
          onFocus={onSearchFocus}
          onBlur={onSearchBlur}
        />
        {vv.narrowed ? (
          <button type="button" className="m-clearbtn" onClick={vv.clearAll}>
            Clear
          </button>
        ) : null}
        <button
          type="button"
          className={"m-filterbtn" + (count ? " m-filterbtn--on" : "")}
          onClick={onOpenFilters}
          aria-label={count ? `Filters, ${count} active` : "Filters"}
        >
          <MIcon name="filter" size={20} />
          <span>Filters</span>
          {count ? <span className="m-filterbtn__n">{count}</span> : null}
        </button>
      </div>
      <div className={"m-vault__status" + (sizesOpen ? " m-vault__status--sizes" : "")}>
        <span className={"m-count" + (vv.narrowed ? " m-count--narrowed" : "")}>
          {n} {n === 1 ? "card" : "cards"}
        </span>
        <span className="m-vault__sizelabel" aria-hidden="true">
          {vv.prefs.view === "rows" ? "Row size" : "Cards across"}
        </span>
        <ScopeChip scope={vv.state.scope} onOpen={onOpenScope} />
        <button
          type="button"
          className="m-sortbtn m-sortbtn--icon"
          onClick={onOpenSort}
          aria-haspopup="dialog"
          aria-label={sortLabel(vv.sort)}
        >
          <MIcon name="sort" size={20} />
        </button>
        <ViewToggle
          view={vv.prefs.view}
          rowSize={vv.prefs.rowSize}
          gallerySize={vv.prefs.gallerySize}
          sizesOpen={sizesOpen}
          setSizesOpen={setSizesOpen}
          vv={vv}
        />
      </div>
    </div>
  );
}
