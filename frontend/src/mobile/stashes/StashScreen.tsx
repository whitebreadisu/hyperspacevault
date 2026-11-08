import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { SWUButton } from "../../components/SWUButton";
import type { Stash } from "../../api/stashes";
import { CheckIcon, PencilIcon, ReturnIcon, TrashIcon } from "../../screens/stashes/stashIcons";
import { useStashes } from "../../stashes/StashContext";
import {
  DEFAULT_STASH_SORT,
  finishName,
  narrowPrintings,
  orderByCards,
  STASH_COPY,
  usePrintingIndex,
  printingLabel,
  printingNumber,
  sortPrintings,
  stashChipClass,
  stashPrintings,
  stashTotals,
  totalPrice,
  unitPrice,
} from "../../stashes/stashContents";
import type { StashPrinting } from "../../stashes/stashContents";
import { useStashMeta } from "../../stashes/useStashMeta";
import { useStashReturn } from "../../stashes/useStashReturn";
import { parseCardDisplay } from "../../utils/catalog";
import { formatMoney } from "../../utils/completion";
import { formatCardValue } from "../../utils/variantScope";
import type { PriceMode } from "../../utils/variantScope";
import { useVaultData } from "../../vault/useVaultData";
import { publishNav, setOpener, setOpenSource } from "../card/navList";
import { FiltersSheet } from "../filters/FiltersSheet";
import { MIcon } from "../icons";
import { go } from "../router";
import { cellImage } from "../vault/cardImage";
import { PriceSeg } from "../vault/CompletionHeader";
import { SortSheet, sortLabel } from "../vault/SortSheet";
import { useVaultView } from "../vault/useVaultView";
import { VaultScreen } from "../vault/VaultScreen";
import { SearchField } from "../vault/VaultStatus";
import { DeleteStashSheet, EditStashSheet } from "./StashSheets";
import "./stashes.css";

// Inside a stash at #/stashes/<id> (design 1d), in the Vault's own frame
// (VaultScreen: useCollapse + useHeaderSlot, App Spec §25.1 Collapse). The
// expanded panel below the header bar holds the name, the one-line
// description (a tap opens the full text in a popover), Market | Low and
// COPIES / VALUE; collapsed, COPIES / VALUE ride in the header bar's strip
// slot -- same hold, pull bar and never-re-expand-on-scroll rules as the
// Vault. Below: the Vault's status rows (search, Filters; count, Select,
// pencil, sort, list / gallery), the return feedback line, then one row per
// printing. A row's resting control is its count chip + Return; Return makes
// the row active with desktop's − / chip / trash, and the row goes back to
// resting when another row is tapped or a scroll starts. Select checks rows
// for a pinned "Return N to Vault". The bottom bar's Vault menu is the way
// back to the Stashes list (no X, no back chevron).

type SheetName = "filters" | "sort" | "edit" | "delete" | null;

function Readout({ copies, value }: { copies: string; value: string }) {
  return (
    <span className="m-stashstrip">
      <span className="m-stashstrip__fact">
        <span className="m-stashstrip__label">Copies</span>
        <span className="m-stashstrip__copies">{copies}</span>
      </span>
      <span className="m-stashstrip__fact">
        <span className="m-stashstrip__label">Value</span>
        <span className="m-stashstrip__value">{value}</span>
      </span>
    </span>
  );
}

function Panel({
  stash,
  copies,
  value,
  sub,
  priceKind,
  onPriceKind,
}: {
  stash: Stash;
  copies: string;
  value: string;
  sub: string | null;
  priceKind: PriceMode;
  onPriceKind: (k: PriceMode) => void;
}) {
  const [popover, setPopover] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!popover) return undefined;
    const outside = (e: PointerEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setPopover(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopover(false);
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key);
    };
  }, [popover]);
  const desc = stash.description;
  return (
    <div className="m-summary m-stashpanel">
      <div className="m-summary__inner">
        <div className="m-summary__head m-stashpanel__head">
          <span className="m-stashpanel__titles">
            <span className="m-stashpanel__name">{stash.name}</span>
            <button
              type="button"
              className={
                "m-stashpanel__desc" +
                (desc ? "" : " m-stashpanel__desc--none") +
                (popover ? " m-stashpanel__desc--open" : "")
              }
              onClick={() => desc && setPopover(true)}
              aria-disabled={desc ? undefined : true}
              aria-expanded={desc ? popover : undefined}
              aria-label={desc ? "Description: show all" : "No description"}
            >
              {desc || "No description"}
            </button>
          </span>
          <PriceSeg mode={priceKind} onChange={onPriceKind} />
        </div>
        <div className="m-stashpanel__stats">
          <span className="m-stashpanel__stat">
            <span className="m-stashpanel__label">Copies</span>
            <span className="m-stashpanel__copies">{copies}</span>
            <span className="m-stashpanel__sub">{sub ?? ""}</span>
          </span>
          <span className="m-stashpanel__stat">
            <span className="m-stashpanel__label">Value</span>
            <span className="m-stashpanel__value">{value}</span>
            <span className="m-stashpanel__sub" />
          </span>
        </div>
      </div>
      {popover && desc ? (
        <div className="m-stashpop" ref={popRef} role="dialog" aria-label="Description">
          <div className="m-stashpop__inner">
            <p className="m-stashpop__text">{desc}</p>
            <button
              type="button"
              className="m-iconbtn m-stashpop__close"
              onClick={() => setPopover(false)}
              aria-label="Close"
            >
              <MIcon name="close" size={20} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Thumb({ row }: { row: StashPrinting }) {
  const img = cellImage(row.card, row.variant, "thumb", "46px");
  return (
    <span className="m-stashline__thumb">
      {img.images ? (
        <img
          className={img.rotated ? "m-img--rotated" : undefined}
          src={img.images.src}
          srcSet={img.images.srcSet}
          sizes={img.images.sizes}
          onError={img.images.onError}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : null}
    </span>
  );
}

function Line({
  row,
  priceKind,
  active,
  selecting,
  checked,
  dimmed,
  busy,
  onOpen,
  onActivate,
  onCheck,
  onReturn,
}: {
  row: StashPrinting;
  priceKind: PriceMode;
  active: boolean;
  selecting: boolean;
  checked: boolean;
  dimmed: boolean;
  busy: boolean;
  onOpen: () => void;
  onActivate: () => void;
  onCheck: () => void;
  onReturn: (quantity: number) => void;
}) {
  const { displayName, subtitle } = parseCardDisplay(row.card);
  const label = printingLabel(row);
  const fin = finishName(row.variant);
  const qty = dimmed ? 0 : row.qty;
  return (
    <div
      className={
        "m-stashline" +
        (active ? " m-stashline--active" : "") +
        (dimmed ? " m-stashline--dim" : "") +
        (checked ? " m-stashline--checked" : "")
      }
      data-variant={row.variant.variant_id}
    >
      <button
        type="button"
        className="m-stashline__main"
        onClick={selecting ? onCheck : onOpen}
        aria-label={
          selecting
            ? `${label}, ${row.qty} in this stash: ${checked ? "selected" : "select"}`
            : `${displayName}${subtitle ? ", " + subtitle : ""}, ${printingNumber(row.variant)} ${fin}: open card`
        }
        aria-pressed={selecting ? checked : undefined}
      >
        {selecting ? (
          <span className={"m-stashline__check" + (checked ? " m-stashline__check--on" : "")}>
            {checked ? <CheckIcon size={15} width={3.4} /> : null}
          </span>
        ) : null}
        <Thumb row={row} />
        <span className="m-stashline__text">
          <span className="m-stashline__name">{displayName}</span>
          {subtitle ? <span className="m-stashline__sub">{subtitle}</span> : null}
          <span className="m-stashline__meta">
            <span className="m-stashline__num">{printingNumber(row.variant)}</span>
            <span className="m-stashline__fin">{fin}</span>
          </span>
        </span>
      </button>
      <span className="m-stashline__side">
        <span className="m-stashline__total">{formatCardValue(totalPrice(row, priceKind))}</span>
        <span className="m-stashline__ctl">
          {active && !selecting ? (
            <button
              type="button"
              className="m-stashline__minus"
              aria-label={`Return one ${label} to the Vault`}
              aria-disabled={busy || undefined}
              onClick={() => !busy && onReturn(1)}
            >
              −
            </button>
          ) : null}
          <span className={stashChipClass(qty, row.card) + " m-stashline__chip"}>{qty}</span>
          {selecting || dimmed ? null : active ? (
            <button
              type="button"
              className="m-stashline__trash"
              aria-label={`Return all ${row.qty} ${label} to the Vault`}
              aria-disabled={busy || undefined}
              onClick={() => !busy && onReturn(row.qty)}
            >
              <TrashIcon size={18} />
            </button>
          ) : (
            <button
              type="button"
              className="m-stashline__return"
              aria-label={`Return ${label} to the Vault`}
              onClick={onActivate}
            >
              <ReturnIcon />
            </button>
          )}
        </span>
      </span>
    </div>
  );
}

function Tile({
  row,
  priceKind,
  onOpen,
}: {
  row: StashPrinting;
  priceKind: PriceMode;
  onOpen: () => void;
}) {
  const img = cellImage(row.card, row.variant, "thumb", "(max-width: 500px) 30vw, 120px");
  const { displayName } = parseCardDisplay(row.card);
  const fin = finishName(row.variant);
  return (
    <button
      type="button"
      className="m-stashtile"
      data-variant={row.variant.variant_id}
      onClick={onOpen}
      aria-label={`${displayName}, ${fin}, ${row.qty} in this stash`}
    >
      <span className="m-stashtile__art">
        {img.images ? (
          <img
            className={
              img.rotated ? "m-stashtile__img m-stashtile__img--rotated" : "m-stashtile__img"
            }
            src={img.images.src}
            srcSet={img.images.srcSet}
            sizes={img.images.sizes}
            onError={img.images.onError}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : null}
      </span>
      <span className="m-stashtile__plate">
        <span className={stashChipClass(row.qty, row.card) + " m-stashtile__chip"}>{row.qty}</span>
        <span className="m-stashtile__fin">{fin}</span>
      </span>
      <span className="m-stashtile__price">{formatCardValue(unitPrice(row, priceKind))}</span>
    </button>
  );
}

export function StashScreen({
  stashId,
  account,
  unread,
  onOpenChooser,
  onOpenFeedback,
  onSearchMode,
  onRequestSignIn,
}: {
  stashId: number;
  account: ReactNode;
  unread: boolean;
  onOpenChooser: () => void;
  onOpenFeedback: () => void;
  onSearchMode: (on: boolean) => void;
  onRequestSignIn?: () => void;
}) {
  const ctx = useStashes();
  const { cards, setOrder, loading } = useVaultData();
  const vv = useVaultView();
  const stash = ctx.stashes.find((s) => s.id === stashId) ?? null;
  const ret = useStashReturn(stash ? stashId : null);
  const meta = useStashMeta();
  const [view, setView] = useState<"rows" | "gallery">("rows");
  const [sheet, setSheet] = useState<SheetName>(null);
  const [searching, setSearching] = useState(false);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(() => new Set());

  // A stash that is gone (deleted elsewhere, a stale link) leads to the list.
  useEffect(() => {
    if (ctx.ready && !stash) go("#/stashes", true);
  }, [ctx.ready, stash]);

  useEffect(() => {
    onSearchMode(searching);
  }, [searching, onSearchMode]);
  useEffect(() => () => onSearchMode(false), [onSearchMode]);

  // The active row reverts the moment a scroll starts.
  useEffect(() => {
    if (!scrollEl || activeId == null) return undefined;
    // A scroll that actually moves the list (a few px; a focus nudge or
    // a re-measure is not a scroll the user started).
    const top = scrollEl.scrollTop;
    const off = () => {
      if (Math.abs(scrollEl.scrollTop - top) > 4) setActiveId(null);
    };
    scrollEl.addEventListener("scroll", off, { passive: true });
    return () => scrollEl.removeEventListener("scroll", off);
  }, [scrollEl, activeId]);

  const sid = stash?.id ?? null;
  const index = usePrintingIndex(cards);
  const { itemsOf } = ctx;
  const all = useMemo(
    () => (sid != null ? stashPrintings(index, itemsOf(sid)) : []),
    [index, itemsOf, sid]
  );
  // The printings the last bulk return emptied stay, dimmed at 0, beside
  // its Undo (design 1d "done").
  const ghosts = useMemo(() => {
    const last = ret.last;
    if (!last || last.items.length < 2) return [];
    const present = new Set(all.map((r) => r.variant.variant_id));
    const out: StashPrinting[] = [];
    for (const vid of last.emptied) {
      const hit = index.get(vid);
      if (present.has(vid) || !hit) continue;
      out.push({ ...hit, qty: last.items.find((i) => i.variant_id === vid)!.quantity });
    }
    return out;
  }, [ret.last, all, index]);
  const rows = useMemo(() => {
    const narrowed = narrowPrintings([...all, ...ghosts], vv.list, vv.state.filters.finish);
    // Set | # orders printings by their own number; Value by each row's
    // value as shown (the printing's price x its copies in the stash); the
    // other sorts are the Vault's card order.
    if (vv.sort.column === "number")
      return sortPrintings(
        narrowed,
        { ...DEFAULT_STASH_SORT, direction: vv.sort.direction },
        setOrder,
        vv.priceKind
      );
    if (vv.sort.column === "value")
      return sortPrintings(
        narrowed,
        { column: "value", direction: vv.sort.direction },
        setOrder,
        vv.priceKind,
        (r) => totalPrice(r, vv.priceKind)
      );
    return orderByCards(narrowed, vv.list, setOrder);
  }, [all, ghosts, vv.list, vv.state.filters.finish, vv.sort, setOrder, vv.priceKind]);
  const ghostIds = new Set(ghosts.map((g) => g.variant.variant_id));

  const totals = stashTotals(all, vv.priceKind);
  const copies = totals.copies.toLocaleString();
  const value = totals.copies === 0 ? "—" : formatMoney(totals.value);

  const openRow = (r: StashPrinting) => {
    setActiveId(null);
    const ids: number[] = [];
    for (const x of rows) if (!ids.includes(x.card.base_card_id)) ids.push(x.card.base_card_id);
    publishNav({
      ids,
      narrowed: vv.narrowed,
      scope: null,
      source: view === "gallery" ? "gallery" : "row",
      finishes: [...vv.state.filters.finish],
    });
    setOpenSource(view === "gallery" ? "gallery" : "row");
    const active = document.activeElement;
    setOpener(active instanceof HTMLElement && active !== document.body ? active : null);
    go("#/card/" + r.card.base_card_id + "?v=" + r.variant.variant_id);
  };

  const checkedRows = rows.filter(
    (r) => checked.has(r.variant.variant_id) && !ghostIds.has(r.variant.variant_id)
  );
  const checkedCopies = checkedRows.reduce((n, r) => n + r.qty, 0);
  const endSelect = () => {
    setSelecting(false);
    setChecked(new Set());
  };

  if (!stash) {
    return (
      <div className="m-screen">
        {ctx.failed ? (
          <p className="m-stashes__note" role="alert">
            {STASH_COPY.loadFailed}{" "}
            <button type="button" className="m-stashok__undo" onClick={() => void ctx.retry()}>
              {STASH_COPY.retry}
            </button>
          </p>
        ) : (
          <p className="m-stashes__note">{STASH_COPY.loading}</p>
        )}
      </div>
    );
  }

  const zero = all.length === 0 && ghosts.length === 0;
  const n = rows.length;
  const controls = (
    <div className="m-vault__controls m-stashctl">
      <div className="m-vault__searchrow">
        <SearchField
          value={vv.state.query}
          onChange={vv.setQuery}
          inputRef={searchRef}
          onFocus={() => setSearching(true)}
          onBlur={() => setSearching(false)}
          narrowed={vv.narrowed}
          placeholder="Search this stash"
        />
        {vv.narrowed ? (
          <button type="button" className="m-clearbtn" onClick={vv.clearAll}>
            Clear
          </button>
        ) : null}
        <button
          type="button"
          className={"m-filterbtn" + (vv.activeCount ? " m-filterbtn--on" : "")}
          onClick={() => setSheet("filters")}
          aria-label={vv.activeCount ? `Filters, ${vv.activeCount} active` : "Filters"}
        >
          <MIcon name="filter" size={20} />
          <span>Filters</span>
          {vv.activeCount ? <span className="m-filterbtn__n">{vv.activeCount}</span> : null}
        </button>
      </div>
      <div className="m-vault__status m-stashctl__status">
        <span className={"m-count" + (vv.narrowed ? " m-count--narrowed" : "")}>
          {n} {n === 1 ? "printing" : "printings"}
        </span>
        {zero ? null : (
          <button
            type="button"
            className={"m-stashctl__mode" + (selecting ? " m-stashctl__mode--on" : "")}
            aria-pressed={selecting}
            onClick={() => {
              setActiveId(null);
              if (selecting) endSelect();
              else setSelecting(true);
            }}
          >
            {selecting ? "Cancel" : "Select"}
          </button>
        )}
        <button
          type="button"
          className="m-stashctl__icon"
          aria-label="Edit stash"
          onClick={() => {
            meta.clearError();
            setSheet("edit");
          }}
        >
          <PencilIcon size={17} />
        </button>
        <button
          type="button"
          className="m-sortbtn m-sortbtn--icon"
          onClick={() => setSheet("sort")}
          aria-haspopup="dialog"
          aria-label={sortLabel(vv.sort)}
        >
          <MIcon name="sort" size={20} />
        </button>
        <span className="m-seg m-stashctl__view" role="group" aria-label="View">
          <button
            type="button"
            className={"m-seg__btn" + (view === "rows" ? " m-seg__btn--on" : "")}
            aria-pressed={view === "rows"}
            aria-label="List"
            onClick={() => setView("rows")}
          >
            <MIcon name="rows" size={18} />
          </button>
          <button
            type="button"
            className={"m-seg__btn" + (view === "gallery" ? " m-seg__btn--on" : "")}
            aria-pressed={view === "gallery"}
            aria-label="Gallery"
            onClick={() => {
              setActiveId(null);
              setView("gallery");
            }}
          >
            <MIcon name="grid" size={18} />
          </button>
        </span>
      </div>
      {ret.last ? (
        <div className="m-stashok" role="status">
          <CheckIcon />
          <span className="m-stashok__text">{ret.last.text}</span>
          <button
            type="button"
            className="m-stashok__undo"
            aria-disabled={ret.busy || undefined}
            onClick={() => void ret.undo()}
          >
            Undo
          </button>
        </div>
      ) : null}
      {ctx.stale ? (
        <p className="sp-error m-stasherr" role="alert">
          {STASH_COPY.staleFailed}{" "}
          <button type="button" className="m-stashok__undo" onClick={() => void ctx.retry()}>
            {STASH_COPY.retry}
          </button>
        </p>
      ) : null}
      {ret.error ? (
        <p className="sp-error m-stasherr" role="alert">
          {ret.error.what} <span className="sp-error__hint">{ret.error.hint}</span>
        </p>
      ) : null}
    </div>
  );

  return (
    <>
      <VaultScreen
        className="m-stashscreen"
        summary={{ pct: 0, copies: totals.copies, value: totals.value, narrowed: false }}
        readout={{
          content: <Readout copies={copies} value={value} />,
          label: `${stash.name}: copies ${copies}, value ${value}`,
        }}
        panel={
          <Panel
            stash={stash}
            copies={copies}
            value={value}
            sub={ret.last ? `${ret.last.copies} back in Vault` : null}
            priceKind={vv.priceKind}
            onPriceKind={vv.setPriceKind}
          />
        }
        account={account}
        unread={unread}
        onOpenChooser={onOpenChooser}
        onOpenFeedback={onOpenFeedback}
        searching={searching}
        onScrollEl={setScrollEl}
        listKey={view}
        controls={controls}
      >
        {zero ? (
          <p className="m-stashes__note m-stashes__zero">{STASH_COPY.zero(stash.name)}</p>
        ) : rows.length === 0 && !loading ? (
          <div className="m-empty m-empty--list">
            <p>{STASH_COPY.filtered}</p>
          </div>
        ) : view === "rows" ? (
          <div className="m-stashlines">
            {rows.map((r) => {
              const vid = r.variant.variant_id;
              return (
                <Line
                  key={vid}
                  row={r}
                  priceKind={vv.priceKind}
                  active={activeId === vid}
                  selecting={selecting}
                  checked={checked.has(vid)}
                  dimmed={ghostIds.has(vid)}
                  busy={ret.busy}
                  onOpen={() => {
                    if (activeId != null && activeId !== vid) setActiveId(null);
                    else openRow(r);
                  }}
                  onActivate={() => setActiveId(vid)}
                  onCheck={() =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (next.has(vid)) next.delete(vid);
                      else next.add(vid);
                      return next;
                    })
                  }
                  onReturn={(quantity) => {
                    void ret.returnRows([{ row: r, quantity }]).then((ok) => {
                      if (ok && quantity >= r.qty) setActiveId(null);
                    });
                  }}
                />
              );
            })}
          </div>
        ) : (
          <div className="m-stashgrid">
            {rows
              .filter((r) => !ghostIds.has(r.variant.variant_id))
              .map((r) => (
                <Tile
                  key={r.variant.variant_id}
                  row={r}
                  priceKind={vv.priceKind}
                  onOpen={() => openRow(r)}
                />
              ))}
          </div>
        )}
      </VaultScreen>
      {selecting ? (
        <div className="m-stashbulk" role="region" aria-label="Selected copies">
          <span className="m-stashbulk__text">
            <span className="m-stashbulk__count">
              {checkedRows.length} selected · {checkedCopies}{" "}
              {checkedCopies === 1 ? "copy" : "copies"}
            </span>
            <span className="m-stashbulk__note">Owned counts stay the same</span>
          </span>
          <SWUButton
            size="touch"
            active={checkedCopies > 0 && !ret.busy}
            ariaDisabled={checkedCopies === 0 || ret.busy}
            onClick={async () => {
              if (checkedCopies === 0 || ret.busy) return;
              const ok = await ret.returnRows(
                checkedRows.map((row) => ({ row, quantity: row.qty }))
              );
              if (ok) endSelect();
            }}
          >
            Return {checkedCopies} to Vault
          </SWUButton>
        </div>
      ) : null}
      {sheet === "filters" ? (
        <FiltersSheet
          vv={vv}
          onClose={() => setSheet(null)}
          onRequestSignIn={() => {
            setSheet(null);
            onRequestSignIn?.();
          }}
        />
      ) : null}
      {sheet === "sort" ? (
        <SortSheet sort={vv.sort} onPick={vv.pickSort} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === "edit" ? (
        <EditStashSheet
          stash={stash}
          meta={meta}
          onClose={() => setSheet(null)}
          onDelete={() => {
            meta.clearError();
            setSheet("delete");
          }}
        />
      ) : null}
      {sheet === "delete" ? (
        <DeleteStashSheet
          stash={stash}
          meta={meta}
          onClose={() => setSheet(null)}
          onDeleted={() => go("#/stashes", true)}
        />
      ) : null}
    </>
  );
}
