import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ReactNode } from "react";
import { SWUButton } from "../../components/SWUButton";
import type { Stash } from "../../api/stashes";
import { useModalDismiss } from "../../hooks/useModalDismiss";
import { useStashes } from "../../stashes/StashContext";
import {
  DEFAULT_STASH_SORT,
  narrowPrintings,
  nextStashSort,
  sortPrintings,
  STASH_COPY,
  stashPrintings,
  usePrintingIndex,
  useStashValues,
  stashTotals,
  totalPrice,
  unitPrice,
} from "../../stashes/stashContents";
import type { StashPrinting, StashSort, StashSortColumn } from "../../stashes/stashContents";
import { useStashMeta } from "../../stashes/useStashMeta";
import { useStashReturn } from "../../stashes/useStashReturn";
import { formatMoney } from "../../utils/completion";
import type { SetOrderMap } from "../../utils/catalog";
import type { InventoryCard } from "../../utils/inventory";
import type { PriceMode } from "../../utils/variantScope";
import { CardsValueKindToggle } from "../cards/VariantScopeControls";
import { CheckIcon, PencilIcon, TrashIcon } from "./stashIcons";
import { CreateStashModal, DeleteStashModal, MetaErrorLine, StashNameFields } from "./StashModals";
import { StashGallery } from "./StashGallery";
import { StashSortBar } from "./StashSort";
import { StashTable } from "./StashTable";
import type { ValueUnit } from "./StashTable";
import "./stashes.css";

// The desktop Stashes page, design 1b "Master-detail" (App Spec §26): the
// stash rail (creation order, Market / Low, + New stash; collapsible, R1-7)
// beside the content pane, which is the Vault narrowed to the selected
// stash -- its head (name, full description, pencil for the in-place edit,
// trash for delete), Cards and Value tiles (the Vault's collection tiles;
// the Value tile carries Market / Low too, bound to the same state, R1-6),
// the Table | Gallery toggle, the sort bar (R1-16), the return feedback line
// with Undo, and the printing-level table or gallery. The Vault's filters
// (CardsPage's FilterPanel, portalled into `onFilterSlot`, R1-5) float at
// the card list's top-left and narrow the rows. This page never adds copies
// and never changes an owned count.

interface Props {
  /** The catalogue with the caller's quantities (every card). */
  cards: InventoryCard[];
  /** The Vault's narrowed list (filters, toggles, search). */
  list: InventoryCard[];
  /** The Finish facet: a printing must carry one of these when set. */
  finishes: Set<string>;
  setOrder: SetOrderMap;
  priceKind: PriceMode;
  onPriceKind: (k: PriceMode) => void;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** Opens the card detail on a printing; `order` is the pane's card order. */
  onOpenPrinting: (cardId: number, variantId: number, order: number[]) => void;
  /** The element CardsPage portals the Vault's FilterPanel into: the card
   * list's top-left corner (null while no list shows). */
  onFilterSlot?: (el: HTMLElement | null) => void;
}

/** The rail docks beside the card list -- and its fold / unfold reflows the
 * list -- only when both fit; narrower, it floats like the Vault's filter
 * sidebar (FilterPanel's docked / overlay model, R2-2). The arithmetic, at
 * the threshold:
 *   app padding (index.css .app-main, 32 px each side)      64
 * + the rail (.sp-rail) + its gap (.sp-layout)          292 + 20
 * + the filters' edge-tab gutter (.sp-list__filters)          36
 * + the table's column ratios (StashTable COLS, 92+212+130+150+140+148) 872
 * = 1284: the table keeps its natural column widths. Measured against the
 * layout width (documentElement.clientWidth), which excludes a classic
 * scrollbar -- window.innerWidth includes it (~17 px on Windows); jsdom has
 * no layout, so it falls back to innerWidth there.
 * The filters dock on their own rule (FilterPanel, >= 1918 x 1052), so the
 * rail docks first and the filters float until there is room for both. */
export const RAIL_DOCK_MIN_WIDTH = 1284;
function railFits(): boolean {
  if (typeof window === "undefined") return true;
  const width = document.documentElement.clientWidth || window.innerWidth;
  return width >= RAIL_DOCK_MIN_WIDTH;
}

/** The docked rail's collapsed state, per viewer (the tableWidthTier
 * pattern: best-effort localStorage; missing or unreadable = expanded). */
export const RAIL_KEY = "swu.stashes.railCollapsed";
function loadRailCollapsed(): boolean {
  try {
    return window.localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
}
function saveRailCollapsed(on: boolean): void {
  try {
    window.localStorage.setItem(RAIL_KEY, on ? "1" : "0");
  } catch {
    /* best-effort */
  }
}

function ChevronIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={dir === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"}
        stroke="currentColor"
        strokeWidth="2.2"
      />
    </svg>
  );
}

function Rail({
  stashes,
  selectedId,
  valueOf,
  priceKind,
  onPriceKind,
  onSelect,
  onNew,
  flyout = false,
  onFold,
  foldRef,
}: {
  stashes: Stash[];
  selectedId: number;
  valueOf: (s: Stash) => number;
  priceKind: PriceMode;
  onPriceKind: (k: PriceMode) => void;
  onSelect: (id: number) => void;
  onNew: () => void;
  /** Floated over the pane from the edge tab (narrow windows). */
  flyout?: boolean;
  /** Docked: collapse (the list widens). Flyout: close it. */
  onFold: () => void;
  /** The chevron, for focus moves (docked unfold). */
  foldRef?: RefObject<HTMLButtonElement | null>;
}) {
  const fold = flyout ? "Hide the stash list" : "Collapse the stash list";
  return (
    <aside
      className={"sp-rail" + (flyout ? " sp-rail--flyout" : "")}
      aria-label="Stashes"
      id={flyout ? "sp-rail-flyout" : undefined}
    >
      <div className="sp-rail__inner">
        <div className="sp-rail__head">
          <h1 className="sp-rail__title" data-tour="stashes-heading">
            Stashes
          </h1>
          <CardsValueKindToggle kind={priceKind} onChange={onPriceKind} />
          <button
            ref={foldRef}
            type="button"
            className="sp-rail__fold"
            onClick={onFold}
            aria-label={fold}
            title={fold}
          >
            <ChevronIcon dir="left" />
          </button>
        </div>
        <div className="sp-rail__list">
          {stashes.map((s) => {
            const on = s.id === selectedId;
            return (
              <button
                key={s.id}
                type="button"
                className={"sp-railrow" + (on ? " sp-railrow--on" : "")}
                aria-current={on ? "true" : undefined}
                onClick={() => onSelect(s.id)}
                data-stash={s.id}
                title={s.name}
              >
                <span className="sp-railrow__line">
                  <span className="sp-railrow__name">{s.name}</span>
                  <span
                    className={
                      "sp-railrow__copies" + (s.copies === 0 ? " sp-railrow__copies--zero" : "")
                    }
                  >
                    {s.copies}
                  </span>
                </span>
                <span className="sp-railrow__line">
                  <span className="sp-railrow__desc">
                    {s.description || STASH_COPY.noDescription}
                  </span>
                  <span className="sp-railrow__value">
                    {s.copies === 0 ? "—" : formatMoney(valueOf(s))}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <button type="button" className="sp-newbtn" onClick={onNew}>
          <span className="sp-newbtn__plus" aria-hidden="true">
            +
          </span>
          New stash
        </button>
      </div>
    </aside>
  );
}

/** The folded rail: the Vault's edge tab (FilterPanel's `ifp-sidebar-tab`)
 * with the stash count and "Stashes". Docked, a click unfolds the rail (the
 * list narrows back); narrow, it floats the full list over the pane. Either
 * way every stash stays one click away. */
function RailTab({
  count,
  open,
  floating,
  onOpen,
  tabRef,
}: {
  count: number;
  open: boolean;
  floating: boolean;
  onOpen: () => void;
  tabRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <span className="ifp-sidebar-tab-ring sp-railtab">
      <button
        ref={tabRef}
        type="button"
        className="ifp-sidebar-tab"
        onClick={onOpen}
        aria-expanded={open}
        aria-controls={open && floating ? "sp-rail-flyout" : undefined}
        aria-label={`Stashes, ${count}: show the list`}
      >
        <span className="sp-railtab__count">{count}</span>
        <span className="ifp-sidebar-tab__label">Stashes</span>
      </button>
    </span>
  );
}

/** A Vault collection tile (InventorySummary's `inv-summary__block`). Not
 * clickable here, so it keeps its resting ring on hover (sp-stat). */
export function StatTile({
  label,
  value,
  sub,
  control,
}: {
  label: string;
  value: string;
  sub?: string | null;
  control?: ReactNode;
}) {
  return (
    <span className="inv-summary__block-wrap sp-stat">
      <span className="inv-summary__block">
        <span className="inv-summary__block-inner">
          <span className="inv-summary__label-row">
            <span className="inv-summary__label">{label}</span>
            {control}
          </span>
          <span className="inv-summary__value-row">
            <span className="inv-summary__value">{value}</span>
            {sub ? <span className="inv-summary__sub sp-stat__sub">{sub}</span> : null}
          </span>
        </span>
      </span>
    </span>
  );
}

function EditHead({
  stash,
  meta,
  onDone,
  onDelete,
}: {
  stash: Stash;
  meta: ReturnType<typeof useStashMeta>;
  onDone: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(stash.name);
  const [description, setDescription] = useState(stash.description ?? "");
  const ready = meta.canSubmit(name);
  const save = async () => {
    if (!ready) return;
    if (await meta.save(stash.id, name, description)) onDone();
  };
  return (
    <form
      className="sp-edit"
      aria-label="Edit stash"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <StashNameFields
        idPrefix="sp-edit"
        name={name}
        description={description}
        onName={(v) => {
          setName(v);
          if (meta.error) meta.clearError();
        }}
        onDescription={setDescription}
        error={meta.error}
        big
      />
      <MetaErrorLine error={meta.error} />
      <span className="sp-edit__actions">
        <SWUButton size="sm" active={ready} ariaDisabled={!ready} onClick={() => void save()}>
          Save
        </SWUButton>
        <button
          type="button"
          className="sp-textbtn"
          onClick={() => {
            meta.clearError();
            onDone();
          }}
        >
          Cancel
        </button>
        <span className="sp-edit__gap" />
        <button type="button" className="sp-textbtn sp-textbtn--danger" onClick={onDelete}>
          Delete stash
        </button>
      </span>
    </form>
  );
}

export function StashesPane({
  cards,
  list,
  finishes,
  setOrder,
  priceKind,
  onPriceKind,
  selectedId,
  onSelect,
  onOpenPrinting,
  onFilterSlot,
}: Props) {
  const ctx = useStashes();
  const meta = useStashMeta();
  const [view, setView] = useState<"table" | "gallery">("table");
  const [sort, setSort] = useState<StashSort>(DEFAULT_STASH_SORT);
  const [valueUnit, setValueUnit] = useState<ValueUnit>("total");
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  // The stash to land on after a delete (its neighbour), or null.
  const [deleting, setDeleting] = useState<{ next: number | null } | null>(null);
  const [collapsed, setCollapsed] = useState(loadRailCollapsed);
  const [flyout, setFlyout] = useState(false);
  // Where focus goes after a rail change removes the focused control: the
  // edge tab (flyout closed, docked fold), the docked chevron (unfold, or
  // docking while the flyout was open) or the stash heading (a pick from
  // the flyout). Applied after the render, and only when focus was lost --
  // a click outside that focused something else keeps that focus.
  const focusNext = useRef<"tab" | "fold" | "heading" | "rail" | null>(null);
  // Docked or floating, tracked live like FilterPanel's `docked`; the flag
  // flips only at the breakpoint, so per-pixel resizes bail.
  const [fits, setFits] = useState(railFits);
  const fitsRef = useRef(fits);
  useEffect(() => {
    const onResize = () => {
      const next = railFits();
      if (next === fitsRef.current) return;
      // Crossing the threshold drops an open flyout; focus goes to the rail
      // control that is there after the switch (tab or chevron). In the
      // handler, never inside a state updater.
      fitsRef.current = next;
      focusNext.current = "rail";
      setFlyout(false);
      setFits(next);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const railRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<HTMLButtonElement>(null);
  const foldRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const stash = ctx.stashes.find((s) => s.id === selectedId) ?? ctx.stashes[0] ?? null;
  const id = stash?.id ?? null;
  const ret = useStashReturn(id);

  // A stash change ends an edit in progress.
  const [seen, setSeen] = useState(id);
  if (seen !== id) {
    setSeen(id);
    setEditing(false);
  }

  // Docked: fold / unfold, remembered per viewer. Floating: never folds
  // the docked state; the tab opens the flyout.
  const fold = (on: boolean) => {
    setCollapsed(on);
    setFlyout(false);
    saveRailCollapsed(on);
    focusNext.current = on ? "tab" : "fold";
  };
  const docked = fits && !collapsed;
  const closeFlyout = useCallback((to: "tab" | "heading" = "tab") => {
    setFlyout(false);
    focusNext.current = to;
  }, []);

  useLayoutEffect(() => {
    const to = focusNext.current;
    if (!to) return;
    focusNext.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const el =
      to === "tab"
        ? tabRef.current
        : to === "fold"
          ? foldRef.current
          : to === "heading"
            ? headingRef.current
            : (tabRef.current ?? foldRef.current);
    el?.focus();
  });

  // The flyout closes on a click outside it.
  useEffect(() => {
    if (!flyout) return undefined;
    const outside = (e: MouseEvent) => {
      if (railRef.current && !railRef.current.contains(e.target as Node)) closeFlyout();
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [flyout, closeFlyout]);
  // Escape through the app's one dismissal hook (useModalDismiss). Every
  // overlay there listens on its own, so one Escape would close all of
  // them; the flyout yields when something sits above it -- an open modal
  // dialog (the card detail, the stash modals) or a Set | # menu -- so a
  // single Escape closes only the topmost layer.
  const escapeFlyout = useCallback(() => {
    if (document.querySelector('[aria-modal="true"], .sp-numsort__menu')) return;
    closeFlyout();
  }, [closeFlyout]);
  useModalDismiss(escapeFlyout, { enabled: flyout });

  // The FilterPanel slot is the card list's corner; it unmounts with the list.
  const slotRef = useCallback((el: HTMLDivElement | null) => onFilterSlot?.(el), [onFilterSlot]);

  const index = usePrintingIndex(cards);
  const { itemsOf, stashedAtOf } = ctx;
  const all = useMemo(
    () => (id != null ? stashPrintings(index, itemsOf(id), (vid) => stashedAtOf(id, vid)) : []),
    [index, itemsOf, stashedAtOf, id]
  );
  const totals = stashTotals(all, priceKind);
  const rows = useMemo(
    () =>
      sortPrintings(narrowPrintings(all, list, finishes), sort, setOrder, priceKind, (r) =>
        valueUnit === "unit" ? unitPrice(r, priceKind) : totalPrice(r, priceKind)
      ),
    [all, list, finishes, sort, setOrder, priceKind, valueUnit]
  );
  const values = useStashValues(index, ctx, priceKind);
  const valueOf = (s: Stash) => values.get(s.id) ?? 0;

  const pickSort = (column: StashSortColumn) => setSort((prev) => nextStashSort(prev, column));
  const open = (r: StashPrinting) => {
    const order: number[] = [];
    for (const x of rows) if (!order.includes(x.card.base_card_id)) order.push(x.card.base_card_id);
    onOpenPrinting(r.card.base_card_id, r.variant.variant_id, order);
  };
  const startDelete = () => {
    if (!stash) return;
    meta.clearError();
    const at = ctx.stashes.findIndex((s) => s.id === stash.id);
    const next = ctx.stashes[at + 1] ?? ctx.stashes[at - 1] ?? null;
    setDeleting({ next: next ? next.id : null });
  };

  const modals = (
    <>
      {creating ? (
        <CreateStashModal
          meta={meta}
          onClose={() => setCreating(false)}
          onCreated={(s) => {
            setCreating(false);
            onSelect(s.id);
          }}
        />
      ) : null}
      {deleting && stash ? (
        <DeleteStashModal
          stash={stash}
          meta={meta}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            const next = deleting.next;
            setDeleting(null);
            setEditing(false);
            // Land on the stash beside the deleted one, else the empty state.
            onSelect(next);
          }}
        />
      ) : null}
    </>
  );

  if (!ctx.ready) {
    return (
      <div className="cards-content sp-page">
        {ctx.failed ? (
          <p className="sp-error" role="alert">
            {STASH_COPY.loadFailed}{" "}
            <button type="button" className="sp-textbtn" onClick={() => void ctx.retry()}>
              {STASH_COPY.retry}
            </button>
          </p>
        ) : (
          <p className="loading-text">{STASH_COPY.loading}</p>
        )}
      </div>
    );
  }

  if (!stash) {
    return (
      <div className="cards-content sp-page">
        <div className="sp-empty">
          <h1 className="sp-empty__title" data-tour="stashes-heading">
            Stashes
          </h1>
          <p className="sp-empty__text">{STASH_COPY.empty}</p>
          <SWUButton size="sm" onClick={() => setCreating(true)}>
            New stash
          </SWUButton>
        </div>
        {modals}
      </div>
    );
  }

  const newStash = () => {
    meta.clearError();
    setFlyout(false);
    setCreating(true);
  };
  const railProps = {
    stashes: ctx.stashes,
    selectedId: stash.id,
    valueOf,
    priceKind,
    onPriceKind,
    onNew: newStash,
  };
  const zero = all.length === 0;
  return (
    <div className="cards-content sp-page">
      <div className={"sp-layout" + (docked ? "" : " sp-layout--folded")}>
        {docked ? (
          <div className="sp-railwrap">
            <Rail {...railProps} onSelect={onSelect} onFold={() => fold(true)} foldRef={foldRef} />
          </div>
        ) : (
          <div className="sp-railwrap sp-railwrap--folded" ref={railRef}>
            <RailTab
              count={ctx.stashes.length}
              open={flyout}
              floating={!fits}
              tabRef={tabRef}
              onOpen={() => (fits ? fold(false) : setFlyout((o) => !o))}
            />
            {flyout && !fits ? (
              <Rail
                {...railProps}
                flyout
                onFold={() => closeFlyout()}
                onSelect={(sid) => {
                  // The pick's result is the stash shown: focus its heading.
                  closeFlyout("heading");
                  onSelect(sid);
                }}
              />
            ) : null}
          </div>
        )}
        <section className="sp-content" aria-label={stash.name}>
          <div className="sp-top">
            <div className="sp-head">
              {editing ? (
                <EditHead
                  key={stash.id}
                  stash={stash}
                  meta={meta}
                  onDone={() => setEditing(false)}
                  onDelete={startDelete}
                />
              ) : (
                <div className="sp-read">
                  <h2 className="sp-read__name" ref={headingRef} tabIndex={-1}>
                    {stash.name}
                  </h2>
                  <span className="sp-read__descline">
                    <span
                      className={
                        "sp-read__desc" + (stash.description ? "" : " sp-read__desc--none")
                      }
                    >
                      {stash.description || STASH_COPY.noDescription}
                    </span>
                    <button
                      type="button"
                      className="sp-pencil"
                      aria-label="Edit name and description"
                      title="Edit name and description"
                      onClick={() => {
                        meta.clearError();
                        setEditing(true);
                      }}
                    >
                      <PencilIcon size={15} />
                    </button>
                    <button
                      type="button"
                      className="sp-pencil sp-pencil--danger"
                      aria-label={`Delete ${stash.name}`}
                      title="Delete stash"
                      onClick={startDelete}
                    >
                      <TrashIcon size={15} />
                    </button>
                  </span>
                </div>
              )}
              <div className="sp-stats">
                <StatTile
                  label="Cards"
                  value={totals.copies.toLocaleString()}
                  sub={ret.last ? `${ret.last.copies} back in Vault` : null}
                />
                <StatTile
                  label="Value"
                  value={totals.copies === 0 ? "—" : formatMoney(totals.value)}
                  control={
                    // The Vault's placement (InventorySummary PriceModeToggle) of the
                    // shared Market / Low switch, the rail's own component.
                    <span className="inv-summary__pricemode">
                      <CardsValueKindToggle kind={priceKind} onChange={onPriceKind} />
                    </span>
                  }
                />
              </div>
            </div>
            <span role="group" aria-label="View" className="inv-summary__view-toggle sp-viewtoggle">
              {(["table", "gallery"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={
                    "inv-summary__view-toggle-btn" +
                    (view === v ? " inv-summary__view-toggle-btn--active" : "")
                  }
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                >
                  {v === "table" ? "Table" : "Gallery"}
                </button>
              ))}
            </span>
          </div>
          {ret.last ? (
            <div className="sp-ok" role="status">
              <CheckIcon />
              <span className="sp-ok__text">{ret.last.text}</span>
              <button
                type="button"
                className="sp-textbtn sp-ok__undo"
                aria-disabled={ret.busy || undefined}
                onClick={() => void ret.undo()}
              >
                Undo
              </button>
            </div>
          ) : null}
          {ctx.stale ? (
            <p className="sp-error" role="alert">
              {STASH_COPY.staleFailed}{" "}
              <button type="button" className="sp-textbtn" onClick={() => void ctx.retry()}>
                {STASH_COPY.retry}
              </button>
            </p>
          ) : null}
          {ret.error ? (
            <p className="sp-error" role="alert">
              {ret.error.what} <span className="sp-error__hint">{ret.error.hint}</span>
            </p>
          ) : null}
          {/* The list area is always drawn for a stash, so the filters keep
              one anchor (an empty stash included). */}
          <div className="sp-list">
            <div className="sp-list__filters" ref={slotRef} />
            <div className="sp-list__body">
              {zero ? (
                <p className="sp-zero">{STASH_COPY.zero(stash.name)}</p>
              ) : (
                <StashSortBar sort={sort} onSort={pickSort} />
              )}
              {zero ? null : rows.length === 0 ? (
                <p className="sp-zero">{STASH_COPY.filtered}</p>
              ) : view === "table" ? (
                <StashTable
                  rows={rows}
                  sort={sort}
                  onSort={pickSort}
                  priceKind={priceKind}
                  valueUnit={valueUnit}
                  onValueUnit={setValueUnit}
                  busy={ret.busy}
                  onOpen={open}
                  onReturn={(row, quantity) => void ret.returnRows([{ row, quantity }])}
                />
              ) : (
                <StashGallery rows={rows} priceKind={priceKind} onOpen={open} />
              )}
            </div>
          </div>
        </section>
      </div>
      {modals}
    </div>
  );
}
