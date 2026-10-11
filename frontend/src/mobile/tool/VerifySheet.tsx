import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { CardSet } from "../../api/sets";
import { BusyOverlay } from "../../components/BusyOverlay";
import { useLimits } from "../../context/LimitsContext";
import { useBusyOverlay } from "../../hooks/useBusyOverlay";
import { groupBy } from "../../utils/addCardsResolver";
import type { VerificationRow } from "../../utils/addCardsResolver";
import { MSWUButton } from "../MSWUButton";
import { Sheet, useSheetClose } from "../Sheet";
import { useVaultData } from "../vault/useVaultData";
import { batchView, discardBatch, removeCopies, removeCopy, useBatch } from "./batch";
import { CommitError, commitPlan, committedRowIds, executeCommit } from "./commit";
import { DiscardConfirm } from "./DiscardConfirm";
import { toCatalog } from "./padModel";
import { toolAddCardsAbandoned } from "./toolAnalytics";
import { setToolState } from "./toolStore";
import "./verify.css";

// BL-249 S3-12 .. S3-16: the Verify cards sheet (R5-8; rev4 MVerify.jsx
// minus the Keep/Skip toggles and steppers). Content = desktop
// AddCardsVerification.tsx: the "Unresolved rows" data-integrity section
// (deck copies matching no catalogue card) when present, then "The
// following cards will be added to inventory" and, when any, "The following
// cards will not be added", each with its count and desktop's columns --
// Card#, Name, Set, Finish, Inventory (owned → after), Reason in the
// not-added section -- grouped by set under desktop's "SOR — Spark of
// Rebellion" heads. One row per copy (the batch model, S3-08); each added
// row has a 44 px quick remove that drops that one copy. Footer = desktop's
// "N of M cards will be added." hint, "Discard batch" (behind the close
// guard, S3-14) and "Add N cards to vault" (S3-15).
//
// S3-13: when the list does not fit the sheet AND both sections exist, the
// two section headers pin -- added at the top, not-added at the bottom --
// and act as a two-way accordion (the expanded section fills the panel and
// scrolls; the other collapses to its header). On open the added section
// is expanded. Everything fitting, or a single section: plain scroll. The
// only motion is the entering section's opacity + transform.

/** desktop AddCardsVerification setLabel. */
function setLabel(code: string, sets: CardSet[]): string {
  const s = sets.find((x) => x.code === code);
  return s ? `${code} — ${s.name}` : code;
}

const cardsWord = (n: number) => `${n} ${n === 1 ? "card" : "cards"}`;

type Kind = "add" | "skip";

interface RowsProps {
  kind: Kind;
  items: VerificationRow[];
  sets: CardSet[];
  onRemove: ((row: VerificationRow) => void) | null;
}

/** Desktop's table, per copy, laid out for 390 px: the column labels in a
 * header strip, each row = Card# · Name (over Set · Finish, Reason) ·
 * Inventory · quick remove. */
function Rows({ kind, items, sets, onRemove }: RowsProps) {
  const groups = groupBy(items, (i) => i.groupKey);
  return (
    <div
      className="m-vtable"
      role="table"
      aria-label={kind === "add" ? "Cards to add" : "Cards not added"}
    >
      <div className="m-vhead" role="row">
        <span className="m-vhead__c m-vhead__num" role="columnheader">
          Card#
        </span>
        <span className="m-vhead__main">
          <span className="m-vhead__c" role="columnheader">
            Name
          </span>
          <span className="m-vhead__sub">
            <span className="m-vhead__c" role="columnheader">
              Set
            </span>
            <span aria-hidden="true"> · </span>
            <span className="m-vhead__c" role="columnheader">
              Finish
            </span>
          </span>
          {kind === "skip" ? (
            <span className="m-vhead__c" role="columnheader">
              Reason
            </span>
          ) : null}
        </span>
        <span className="m-vhead__c m-vhead__inv" role="columnheader">
          Inventory
        </span>
        {onRemove ? <span className="m-vhead__rm" aria-hidden="true" /> : null}
      </div>
      {[...groups.entries()].map(([code, rows]) => (
        <Fragment key={code}>
          <div className="m-vgroup" role="row">
            <span role="cell">{setLabel(code, sets)}</span>
          </div>
          {rows.map((r) => (
            <div key={r.id} className="m-vfyrow" role="row" data-row={r.id}>
              <span className="m-vfyrow__num" role="cell" data-col="Card#">
                {r.cardNumber}
              </span>
              <span className="m-vfyrow__main">
                <span className="m-vfyrow__name" role="cell" data-col="Name">
                  {r.name}
                  {r.subtitle ? <span className="m-vfyrow__sub">{r.subtitle}</span> : null}
                </span>
                <span className="m-vfyrow__meta">
                  {r.setText ? (
                    <span
                      className={"m-vfyrow__set" + (r.isOP ? " m-vfyrow__set--op" : "")}
                      role="cell"
                      data-col="Set"
                    >
                      {r.setText}
                    </span>
                  ) : null}
                  {r.setText && r.finishText ? <span aria-hidden="true"> · </span> : null}
                  {r.finishText ? (
                    <span className="m-vfyrow__finish" role="cell" data-col="Finish">
                      {r.finishText}
                    </span>
                  ) : null}
                </span>
                {r.overLimitNote ? (
                  <span className="ac-verify__over-limit-note">{r.overLimitNote}</span>
                ) : null}
                {kind === "skip" && r.skipReason ? (
                  <span className="ac-verify__skip-reason" role="cell" data-col="Reason">
                    {r.skipReason}
                  </span>
                ) : null}
              </span>
              <span className="ac-dot-row m-vfyrow__inv" role="cell" data-col="Inventory">
                {r.inventoryText ? (
                  <>
                    <span className={`ac-dot ac-dot--${r.dotColor}`} aria-hidden="true" />
                    <span>{r.inventoryText}</span>
                  </>
                ) : null}
              </span>
              {onRemove ? (
                <button
                  type="button"
                  className="m-step m-vfyrow__remove"
                  onClick={() => onRemove(r)}
                  aria-label={`Remove one ${r.name}, ${r.groupKey} ${r.cardNumber}${
                    r.finishText ? ", " + r.finishText : ""
                  }`}
                >
                  −
                </button>
              ) : null}
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

interface SectionProps {
  kind: Kind;
  title: string;
  count: number;
  items: VerificationRow[];
  sets: CardSet[];
  integrity?: boolean;
  onRemove: ((row: VerificationRow) => void) | null;
  /** S3-13 accordion: null = plain section. */
  accordion: { expanded: boolean; onToggle: () => void } | null;
}

function Section({
  kind,
  title,
  count,
  items,
  sets,
  integrity,
  onRemove,
  accordion,
}: SectionProps) {
  const head = (
    <>
      <span className="m-vsec__title">{title}</span>
      <span className="ac-verify__section-rule" />
      <span className="ac-verify__count">{cardsWord(count)}</span>
    </>
  );
  const expanded = !accordion || accordion.expanded;
  return (
    <section
      className={
        `m-vsec ac-verify__section--${kind}` +
        (integrity ? " ac-precon-verify__integrity" : "") +
        (accordion ? " m-vsec--acc" : "") +
        (accordion && !expanded ? " m-vsec--collapsed" : "")
      }
      data-section={integrity ? "unresolved" : kind}
    >
      {accordion ? (
        <button
          type="button"
          className="ac-verify__section-title m-vsec__head m-vsec__head--btn"
          aria-expanded={expanded}
          onClick={accordion.onToggle}
        >
          {head}
        </button>
      ) : (
        <div className="ac-verify__section-title m-vsec__head">{head}</div>
      )}
      <div
        className={"m-vsec__list" + (accordion && expanded ? " m-vsec__list--enter" : "")}
        aria-hidden={expanded ? undefined : true}
        inert={!expanded}
        key={accordion ? String(expanded) : "plain"}
      >
        <Rows kind={kind} items={items} sets={sets} onRemove={onRemove} />
      </div>
    </section>
  );
}

/** Closes the sheet (with its leave motion) after `ms`. */
function AutoClose({ ms }: { ms: number }) {
  const close = useSheetClose();
  useEffect(() => {
    const t = setTimeout(close, ms);
    return () => clearTimeout(t);
  }, [close, ms]);
  return null;
}

/** The confirm inside the sheet, so Discard & Close can close the sheet. */
function DiscardInSheet({ pending, onReturn }: { pending: number; onReturn: () => void }) {
  const close = useSheetClose();
  return (
    <DiscardConfirm
      onReturn={onReturn}
      onDiscard={() => {
        toolAddCardsAbandoned(pending); // BL-235 shape, S3-16
        discardBatch();
        setToolState({ lastAdded: null });
        onReturn();
        close();
      }}
    />
  );
}

export interface VerifySheetProps {
  onClose: () => void;
}

export function VerifySheet({ onClose }: VerifySheetProps) {
  const { cards, sets, refreshQuantities } = useVaultData();
  const { limits, capMode } = useLimits();
  const batch = useBatch();
  const catalog = useMemo(() => toCatalog(cards), [cards]);
  const view = useMemo(
    () => batchView(batch, { catalog, limits, capMode }),
    [batch, catalog, limits, capMode]
  );
  const overlay = useBusyOverlay();
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [open, setOpen] = useState<Kind>("add");
  const [long, setLong] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const adds = view.added.length;
  const total = batch.length;
  const both = adds > 0 && view.notAdded.length > 0 && view.unresolved.length === 0;
  const accordion = both && long;

  // S3-13: does the list fit? Natural height = the lists' own content
  // (scrollHeight survives a collapsed or scrolled list) + the headers.
  const measure = useCallback(() => {
    const own = bodyRef.current;
    const body = own?.parentElement; // .m-sheet__body, the scroller
    if (!own || !body) return;
    const avail = body.clientHeight;
    if (own.classList.contains("m-verify--acc")) {
      const cs = getComputedStyle(body);
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const lists = [...own.querySelectorAll<HTMLElement>(".m-vsec__list")];
      const heads = [...own.querySelectorAll<HTMLElement>(".m-vsec__head")];
      const natural =
        pad +
        lists.reduce((s, l) => s + l.scrollHeight, 0) +
        heads.reduce((s, h) => s + h.offsetHeight, 0);
      // Hysteresis: back to the plain scroll only once it clearly fits.
      setLong(natural > avail - 24);
    } else setLong(body.scrollHeight > avail + 1);
  }, []);
  useLayoutEffect(() => {
    measure();
  }, [measure, batch, view, accordion, open]);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => measure());
    ro.observe(body);
    return () => ro.disconnect();
  }, [measure]);

  const remove = (r: VerificationRow) => {
    setError(null);
    removeCopy(r.id);
  };

  const commit = async () => {
    if (!adds || committing) return;
    setCommitting(true);
    setError(null);
    const plan = commitPlan(batch, view, capMode);
    try {
      await overlay.run(
        {
          message: `Applying ${plan.total.toLocaleString()} ${plan.total === 1 ? "card" : "cards"}…`,
        },
        {
          task: () => executeCommit(plan),
          settleStage: { message: "Refreshing your Vault…" },
          settle: async () => {
            await refreshQuantities().catch(() => {});
          },
        }
      );
    } catch (err) {
      if (err instanceof CommitError) {
        // Copies already written are in the vault now: they leave the batch.
        removeCopies(committedRowIds(batch, view, capMode, err));
        refreshQuantities().catch(() => {});
        setError(err.message);
      } else setError(String(err));
      setCommitting(false);
      return;
    }
    setCommitting(false);
    discardBatch();
    setToolState({ lastAdded: null });
    setDone(plan.total);
  };

  if (done !== null) {
    return (
      <Sheet
        title="Verify cards"
        labelId="m-verify-title"
        className="m-sheet-layer--verify"
        onClose={onClose}
      >
        <p className="m-d2-verify__success" role="status">
          {cardsWord(done)} added.
        </p>
        <AutoClose ms={1300} />
      </Sheet>
    );
  }

  const footer = total ? (
    <div className="m-d2-verify__foot">
      {error ? (
        <span className="m-d2-verify__error" role="alert">
          {error}
        </span>
      ) : null}
      <span className="m-d2-verify__hint">
        {adds} of {total} cards will be added.
      </span>
      <div className="m-d2-verify__actions">
        <button
          type="button"
          className="m-textbtn m-d2-verify__discard"
          onClick={() => setConfirming(true)}
        >
          Discard batch
        </button>
        <MSWUButton
          size="md"
          active={adds > 0 && !committing}
          ariaDisabled={!adds || committing}
          onClick={commit}
          className="m-d2-verify__commit"
        >
          Add {cardsWord(adds)} to vault
        </MSWUButton>
      </div>
    </div>
  ) : null;

  return (
    <Sheet
      title="Verify cards"
      sub={total ? `${cardsWord(total)} in this batch` : "Batch empty"}
      labelId="m-verify-title"
      className={"m-sheet-layer--verify" + (accordion ? " m-sheet-layer--verify-long" : "")}
      onClose={onClose}
      footer={footer}
    >
      <div
        ref={bodyRef}
        className={"m-verify" + (accordion ? " m-verify--acc" : "")}
        data-mode={accordion ? "accordion" : "plain"}
      >
        {total === 0 ? (
          <div className="m-empty">No cards in the batch. Type a card number and press Add.</div>
        ) : (
          <>
            {view.unresolved.length ? (
              <Section
                kind="skip"
                integrity
                title="Unresolved rows — this shouldn't happen with precon data"
                count={view.unresolved.length}
                items={view.unresolved}
                sets={sets}
                onRemove={null}
                accordion={null}
              />
            ) : null}
            <Section
              kind="add"
              title="The following cards will be added to inventory"
              count={adds}
              items={view.added}
              sets={sets}
              onRemove={remove}
              accordion={
                accordion ? { expanded: open === "add", onToggle: () => setOpen("add") } : null
              }
            />
            {view.notAdded.length ? (
              <Section
                kind="skip"
                title="The following cards will not be added"
                count={view.notAdded.length}
                items={view.notAdded}
                sets={sets}
                onRemove={null}
                accordion={
                  accordion ? { expanded: open === "skip", onToggle: () => setOpen("skip") } : null
                }
              />
            ) : null}
          </>
        )}
      </div>
      {confirming ? <DiscardInSheet pending={total} onReturn={() => setConfirming(false)} /> : null}
      {/* Outside the sheet's clip-path (desktop's overlay, z 300). */}
      {createPortal(<BusyOverlay stage={overlay.stage} />, document.body)}
    </Sheet>
  );
}
