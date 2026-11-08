import { useMemo, useState } from "react";
import { SWUButton } from "../../components/SWUButton";
import type { Stash } from "../../api/stashes";
import { useStashes } from "../../stashes/StashContext";
import {
  DEFAULT_STASH_SORT,
  narrowPrintings,
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
import { CheckIcon, PencilIcon } from "./stashIcons";
import { CreateStashModal, DeleteStashModal, MetaErrorLine, StashNameFields } from "./StashModals";
import { StashGallery } from "./StashGallery";
import { StashTable } from "./StashTable";
import type { ValueUnit } from "./StashTable";
import "./stashes.css";

// The desktop Stashes page, design 1b "Master-detail" (App Spec §26): the
// stash rail (creation order, + New stash) beside the content pane, which is
// the Vault narrowed to the selected stash -- its head (name, full
// description, pencil for the in-place edit), Cards and Value panels, the
// Table | Gallery toggle, the return feedback line with Undo, and the
// printing-level table or gallery. The Vault's filters (CardsPage's
// FilterPanel, beside this pane) narrow the rows. This page never adds
// copies and never changes an owned count. Desktop does not collapse.

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
}

function PriceSeg({
  kind,
  onKind,
  className,
}: {
  kind: PriceMode;
  onKind: (k: PriceMode) => void;
  className: string;
}) {
  return (
    <span className={"sp-seg " + className} role="group" aria-label="Price">
      {(["market", "low"] as const).map((k) => (
        <button
          key={k}
          type="button"
          className={"sp-seg__btn" + (kind === k ? " sp-seg__btn--on" : "")}
          aria-pressed={kind === k}
          onClick={() => onKind(k)}
        >
          {k === "market" ? "Market" : "Low"}
        </button>
      ))}
    </span>
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
}: {
  stashes: Stash[];
  selectedId: number;
  valueOf: (s: Stash) => number;
  priceKind: PriceMode;
  onPriceKind: (k: PriceMode) => void;
  onSelect: (id: number) => void;
  onNew: () => void;
}) {
  return (
    <aside className="sp-rail" aria-label="Stashes">
      <div className="sp-rail__inner">
        <div className="sp-rail__head">
          <h1 className="sp-rail__title">Stashes</h1>
          <PriceSeg kind={priceKind} onKind={onPriceKind} className="sp-seg--rail" />
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

function StatPanel({
  label,
  tag,
  value,
  mono,
  sub,
}: {
  label: string;
  tag?: string;
  value: string;
  mono?: boolean;
  sub?: string | null;
}) {
  return (
    <div className="sp-stat">
      <div className="sp-stat__inner">
        <span className="sp-stat__label">
          {label}
          {tag ? <span className="sp-stat__tag">{tag}</span> : null}
        </span>
        <span className="sp-stat__line">
          <span className={"sp-stat__value" + (mono ? " sp-stat__value--mono" : "")}>{value}</span>
          {sub ? <span className="sp-stat__sub">{sub}</span> : null}
        </span>
      </div>
    </div>
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
}: Props) {
  const ctx = useStashes();
  const meta = useStashMeta();
  const [view, setView] = useState<"table" | "gallery">("table");
  const [sort, setSort] = useState<StashSort>(DEFAULT_STASH_SORT);
  const [valueUnit, setValueUnit] = useState<ValueUnit>("total");
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const stash = ctx.stashes.find((s) => s.id === selectedId) ?? ctx.stashes[0] ?? null;
  const id = stash?.id ?? null;
  const ret = useStashReturn(id);

  // A stash change ends an edit in progress.
  const [seen, setSeen] = useState(id);
  if (seen !== id) {
    setSeen(id);
    setEditing(false);
  }

  const index = usePrintingIndex(cards);
  const { itemsOf } = ctx;
  const all = useMemo(
    () => (id != null ? stashPrintings(index, itemsOf(id)) : []),
    [index, itemsOf, id]
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

  const pickSort = (column: StashSortColumn) =>
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" }
    );
  const open = (r: StashPrinting) => {
    const order: number[] = [];
    for (const x of rows) if (!order.includes(x.card.base_card_id)) order.push(x.card.base_card_id);
    onOpenPrinting(r.card.base_card_id, r.variant.variant_id, order);
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
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
            setEditing(false);
            onSelect(null);
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
          <h1 className="sp-empty__title">Stashes</h1>
          <p className="sp-empty__text">{STASH_COPY.empty}</p>
          <SWUButton size="sm" onClick={() => setCreating(true)}>
            New stash
          </SWUButton>
        </div>
        {modals}
      </div>
    );
  }

  const zero = all.length === 0;
  return (
    <div className="cards-content sp-page">
      <div className="sp-layout">
        <Rail
          stashes={ctx.stashes}
          selectedId={stash.id}
          valueOf={valueOf}
          priceKind={priceKind}
          onPriceKind={onPriceKind}
          onSelect={onSelect}
          onNew={() => {
            meta.clearError();
            setCreating(true);
          }}
        />
        <section className="sp-content" aria-label={stash.name}>
          <div className="sp-top">
            <div className="sp-head">
              {editing ? (
                <EditHead
                  key={stash.id}
                  stash={stash}
                  meta={meta}
                  onDone={() => setEditing(false)}
                  onDelete={() => {
                    meta.clearError();
                    setDeleting(true);
                  }}
                />
              ) : (
                <div className="sp-read">
                  <h2 className="sp-read__name">{stash.name}</h2>
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
                      onClick={() => {
                        meta.clearError();
                        setEditing(true);
                      }}
                    >
                      <PencilIcon size={15} />
                    </button>
                  </span>
                </div>
              )}
              <div className="sp-stats">
                <StatPanel
                  label="Cards"
                  value={totals.copies.toLocaleString()}
                  sub={ret.last ? `${ret.last.copies} back in Vault` : null}
                />
                <StatPanel
                  label="Value"
                  tag={priceKind === "market" ? "Market" : "Low"}
                  value={totals.copies === 0 ? "—" : formatMoney(totals.value)}
                  mono
                />
              </div>
            </div>
            <span className="sp-viewseg" role="group" aria-label="View">
              {(["table", "gallery"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={"sp-viewseg__btn" + (view === v ? " sp-viewseg__btn--on" : "")}
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
          {zero ? (
            <p className="sp-zero">{STASH_COPY.zero(stash.name)}</p>
          ) : rows.length === 0 ? (
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
        </section>
      </div>
      {modals}
    </div>
  );
}
