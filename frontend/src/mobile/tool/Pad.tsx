import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useLimits } from "../../context/LimitsContext";
import { getPlaysetSize } from "../../utils/inventory";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import { MIcon } from "../icons";
import { SWUButton } from "../../components/SWUButton";
import { cellImage } from "../vault/cardImage";
import { useVaultData } from "../vault/useVaultData";
import {
  entryRow,
  padReadout,
  padSetBase,
  padView,
  preconByKey,
  preconShort,
  setLogoUrl,
  starfieldUrl,
  toCatalog,
} from "./padModel";
import type { PadChoice, Readout } from "./padModel";
import { PreconPanel } from "./PreconPanel";
import { SetChooserSheet } from "./SetChooserSheet";
import { useBatch } from "./batch";
import type { BatchRow } from "./batch";
import { addPadEntry, padKey, setPadPick, useToolState } from "./toolStore";
import { resolveRow } from "../../utils/addCardsResolver";

// BL-249 S3-02 .. S3-05: the keypad (rev4 MPad.jsx, R4-6 collide=deck, D2
// verify=1, F-1) on desktop's resolver (AddCardsKeypad.tsx). Lower part =
// the deck: entry row (set button · number · Verify) over the Russo One key
// grid. Upper part = the result zone: idle text, the resolved card panel
// (art, name / subtitle, set · number · printing, pips + readout, desktop's
// axis choices as chips, Card details / Add to batch pinned at the bottom),
// "Not in this set", or the card just added ("In batch"). While a number
// resolves the deck shrinks by one class flip (no transition).

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clr", "0", "del"];

function Keys({ rest }: { rest: boolean }) {
  return (
    <div className="m-keys" role="group" aria-label="Number pad">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          className={"m-key" + (k === "clr" || k === "del" ? " m-key--fn" : "")}
          onClick={() => padKey(k)}
          aria-disabled={rest || undefined}
          aria-label={k === "del" ? "Delete digit" : k === "clr" ? "Clear number" : k}
        >
          {k === "del" ? <MIcon name="bksp" size={26} /> : k === "clr" ? "Clear" : k}
        </button>
      ))}
    </div>
  );
}

/** S3-03: rev4 F-1 readout with desktop's numbers. The fraction stays here
 * (the one surface that keeps "n/m", R4-7). */
function ReadoutLines({ r }: { r: Readout }) {
  if (r.limit === null) {
    return (
      <div className="m-readout">
        <div className="ac-pad__readout-line ac-pad__readout-line--green">In vault {r.owned}</div>
        <div className="ac-pad__readout-line ac-pad__readout-line--green m-readout--dim">
          After add {r.after}
        </div>
      </div>
    );
  }
  if (r.atLimit) {
    return (
      <div className="m-readout">
        <div className="ac-pad__readout-line ac-pad__readout-line--red">
          In vault {r.owned}/{r.limit} ({r.overLimit ? "over limit" : "at limit"})
        </div>
        <div className="m-readout__sub">Adding goes past your keep limit</div>
      </div>
    );
  }
  return (
    <div className="m-readout">
      <div className="ac-pad__readout-line ac-pad__readout-line--green">
        In vault {r.owned}/{r.limit}
      </div>
      {r.afterOver ? (
        <div className="ac-pad__readout-line ac-pad__readout-line--red m-readout--dim">
          After add {r.after}/{r.limit} (over limit)
        </div>
      ) : (
        <div className="ac-pad__readout-line ac-pad__readout-line--green m-readout--dim">
          After add {r.after}/{r.limit}
        </div>
      )}
    </div>
  );
}

/** rev4 MPips size lg: the card's playset pips (owned total, playset size
 * per card type), no count chip (R4-7: no chip in the keypad panel). */
function Pips({ card, signedIn }: { card: InventoryCard; signedIn: boolean }) {
  const size = getPlaysetSize(card.type);
  const owned = signedIn ? card.variants.reduce((s, v) => s + (v.quantity || 0), 0) : 0;
  return (
    <span
      className={
        "playset m-pips m-pips--lg" +
        (owned >= size ? " playset--complete" : "") +
        (owned === 0 ? " playset--empty" : "")
      }
    >
      <span className="playset__pips">
        {Array.from({ length: size }).map((_, i) => (
          <span key={i} className={"playset__pip" + (i < owned ? " playset__pip--filled" : "")} />
        ))}
      </span>
    </span>
  );
}

export interface IdentProps {
  name: string;
  subtitle: string | null;
  card: InventoryCard | null;
  variant: InventoryVariant | null;
  readout: Readout | null;
  signedIn: boolean;
  choices: PadChoice[];
  hint: { text: string; attn: boolean } | null;
  /** S3-04: a finish-only share's cue with a Change link (chips folded). */
  note: { text: string; onChange: () => void } | null;
  compact: boolean;
  justAdded: number;
  addLabel: string;
  canAdd: boolean;
  onAdd: () => void;
  onDetails: (() => void) | null;
  /** BL-253 S7-17: the camera's hold shows "In batch n" (copies of this
   * printing waiting) and hides Add. */
  inBatch?: number;
  hideAdd?: boolean;
}

/** rev4 MIdentified (R4-6 compact variant), desktop's axes as chip groups.
 * BL-253 S7-14: exported -- the camera's prompt is this same panel. */
export function Identified(p: IdentProps) {
  const img = p.card && p.variant ? cellImage(p.card, p.variant, "thumb", "200px") : null;
  return (
    <div
      className={
        "m-ident m-ident--big" +
        (p.compact ? " m-ident--compact" : "") +
        (p.justAdded ? " m-ident--added" : "")
      }
    >
      <button
        type="button"
        className="m-ident__art"
        onClick={p.onDetails ?? undefined}
        aria-label={`Open ${p.name}`}
        disabled={!p.onDetails}
      >
        <span
          className={"m-ident__frame" + (p.justAdded ? " m-ident__frame--flash" : "")}
          key={p.justAdded || 0}
        >
          {img?.images ? (
            <img
              src={img.images.src}
              srcSet={img.images.srcSet}
              sizes={img.images.sizes}
              onError={img.images.onError}
              className={img.rotated ? "m-img--rotated" : undefined}
              alt=""
            />
          ) : null}
        </span>
      </button>
      <div className="m-ident__info">
        {p.justAdded ? (
          <div className="m-ident__added">
            <MIcon name="check" size={14} /> In batch
            {p.inBatch != null ? " " + p.inBatch : null}
          </div>
        ) : null}
        <div className="m-ident__name">{p.name}</div>
        {p.subtitle ? <div className="m-ident__sub">{p.subtitle}</div> : null}
        {p.variant ? (
          <div className="m-ident__meta">
            {p.variant.source_set_code} {p.variant.card_number} ·{" "}
            {p.variant.finish ?? p.variant.variant_type}
          </div>
        ) : null}
        {p.card && p.readout ? (
          <div className="m-ident__own">
            <Pips card={p.card} signedIn={p.signedIn} />
            <ReadoutLines r={p.readout} />
          </div>
        ) : null}
      </div>
      {p.choices.length ? (
        <div className="m-ident__choices">
          {p.hint ? (
            <div
              className={"m-ident__choicehint" + (p.hint.attn ? " m-ident__choicehint--attn" : "")}
            >
              {p.hint.text}
            </div>
          ) : null}
          {p.choices.map((c) => (
            <div key={c.axis} className="m-ident__axis" data-axis={c.axis}>
              <div className="m-ident__axislabel">{c.label}</div>
              <div className="m-ident__chiprow" role="group" aria-label={c.label}>
                {c.options.map((o) => {
                  const on = o.value === c.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      className={
                        "m-chip m-chip--print" +
                        (on ? " m-chip--on" : "") +
                        ((on && c.defaulted) || (c.needsPick && c.value === null)
                          ? " m-chip--attn"
                          : "")
                      }
                      aria-pressed={on}
                      onClick={() => setPadPick(c.axis, o.value)}
                    >
                      {o.l2 ? (
                        <span className="m-chip__two">
                          <span className="m-chip__l1">{o.l1}</span>
                          <span className="m-chip__l2">{o.l2}</span>
                        </span>
                      ) : (
                        o.l1
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {p.note ? (
        <div className="m-ident__note">
          <span className="m-ident__notel m-ident__notel--attn">
            {p.note.text}
            <button type="button" className="m-textbtn m-ident__change" onClick={p.note.onChange}>
              Change
            </button>
          </span>
        </div>
      ) : null}
      <div className="m-ident__add">
        <button
          type="button"
          className="m-textbtn m-ident__details"
          onClick={p.onDetails ?? undefined}
          disabled={!p.onDetails}
        >
          Card details <MIcon name="fwd" size={16} />
        </button>
        {p.hideAdd ? null : (
          <SWUButton
            size="md"
            active={p.canAdd}
            ariaDisabled={!p.canAdd}
            onClick={p.onAdd}
            className="m-ident__addbtn"
          >
            {p.addLabel}
          </SWUButton>
        )}
      </div>
    </div>
  );
}

/** The entry row's Verify button (rev4 D2 LogButton, verify=1): the count
 * badge alone carries the amber ring while entries wait; dimmed and
 * aria-disabled while there are none, so the row never shifts. The Verify
 * cards sheet it opens is stage 3c (S3-12). */
export function VerifyButton({ n, onOpen }: { n: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={"m-logbtn m-logbtn--r2 m-logbtn--verify" + (n ? "" : " m-logbtn--empty")}
      onClick={n ? onOpen : undefined}
      aria-disabled={n ? undefined : true}
      aria-label={n ? `Verify cards, ${n} in batch` : "Verify cards, batch empty"}
    >
      <span>Verify</span>
      {n ? <span className="m-logbtn__n m-logbtn__n--batch">{n}</span> : null}
    </button>
  );
}

function IdleZone({ setName }: { setName: string }) {
  return (
    <div className="m-padidle m-padidle--a">
      <span className="m-padidle__frame" aria-hidden="true">
        <MIcon name="pad" size={28} />
      </span>
      <div className="m-padidle__text">
        <p className="m-padidle__lead">Type the number printed on a card.</p>
        <p className="m-padidle__sub">
          You&apos;ll see at once whether you own it. Add puts it in the batch, and the pad clears
          for the next card.
        </p>
        <p className="m-padidle__set">Set: {setName}</p>
      </div>
    </div>
  );
}

export interface PadProps {
  onRequestSignIn: () => void;
  onOpenCard: (card: InventoryCard, variant: InventoryVariant) => void;
  onOpenVerify: () => void;
}

export function Pad({ onRequestSignIn, onOpenCard, onOpenVerify }: PadProps) {
  const { cards, sets, setNameByCode, isAuthenticated } = useVaultData();
  const { limits, capMode } = useLimits();
  const st = useToolState();
  const batch = useBatch();
  const catalog = useMemo(() => toCatalog(cards), [cards]);
  const [chooserOpen, setChooserOpen] = useState(false);
  // S3-04: which number's folded finish choices were unfolded by Change.
  const numKey = st.setCode + "|" + st.num;
  const [changeFor, setChangeFor] = useState<string | null>(null);

  const precon = preconByKey(st.preconKey);
  const view = precon ? null : padView(st.setCode, st.num, st.picks, catalog, cards);
  const readout =
    view && view.kind === "card"
      ? padReadout(st.setCode, st.num, st.picks, batch, catalog, limits, capMode)
      : null;

  const lastEntry: BatchRow | null = st.lastAdded
    ? (batch.find((e) => e.id === st.lastAdded!.entryId) ?? null)
    : null;

  const add = () => {
    if (!view || view.kind !== "card" || !view.variant || !view.card) return;
    if (!isAuthenticated) {
      onRequestSignIn();
      return;
    }
    addPadEntry({
      via: "keypad",
      force: false,
      setCode: st.setCode,
      cardNumber: st.num,
      picks: st.picks,
      variantId: view.variant.variant_id,
      baseCardId: view.card.base_card_id,
    });
  };
  const addAgain = (e: BatchRow) => {
    if (!isAuthenticated) {
      onRequestSignIn();
      return;
    }
    addPadEntry({
      via: "keypad",
      force: false,
      setCode: e.setCode,
      cardNumber: e.cardNumber,
      picks: e.picks,
      variantId: e.variantId,
      baseCardId: e.baseCardId,
    });
  };

  // Hardware keyboard (rev4 MPad): digits, Backspace, Enter = Add. Ignored
  // while a sheet or the card layer is over the pad, or a field has focus.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (document.querySelector(".m-sheet-layer, .m-cardlayer, .m-d2-confirm-layer")) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (/^[0-9]$/.test(e.key)) {
        padKey(e.key);
        e.preventDefault();
      } else if (e.key === "Backspace") {
        padKey("del");
        e.preventDefault();
      } else if (e.key === "Enter" && view && view.kind === "card") {
        add();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  // ── Result zone ──
  let zone: ReactNode = null;
  let resultZone = false;
  if (precon) {
    zone = (
      <PreconPanel
        entry={precon}
        onChangeSet={() => setChooserOpen(true)}
        onRequestSignIn={onRequestSignIn}
      />
    );
  } else if (view && view.kind === "card") {
    resultZone = true;
    const res = view.resolved;
    const canAdd = res.status === "resolved" && !!view.variant;
    // S3-04: a number shared only by finishes keeps desktop's non-foil
    // default (BL-191) -- the cue + a Change link; Change unfolds the chips.
    const finishOnly =
      view.choices.length === 1 &&
      view.choices[0].axis === "finish" &&
      view.choices[0].defaulted &&
      st.picks.finish === null;
    const folded = finishOnly && changeFor !== numKey;
    const choices = folded ? [] : view.choices;
    zone = (
      <Identified
        name={res.card.needsPick ? "Which card is it?" : (res.name ?? "")}
        subtitle={res.card.needsPick ? null : res.subtitle}
        card={view.card}
        variant={view.variant}
        readout={readout}
        signedIn={isAuthenticated}
        choices={choices}
        hint={folded ? null : view.hint}
        note={
          folded && view.hint
            ? { text: view.hint.text, onChange: () => setChangeFor(numKey) }
            : null
        }
        compact={choices.length > 0}
        justAdded={0}
        addLabel="Add to batch"
        canAdd={canAdd && isAuthenticated}
        onAdd={canAdd ? add : () => {}}
        onDetails={view.card && view.variant ? () => onOpenCard(view.card!, view.variant!) : null}
      />
    );
  } else if (view && view.kind === "miss") {
    zone = (
      <div className="m-padmsg m-padmsg--error">
        <div className="m-padmsg__err">Not in this set</div>
        <div className="m-padmsg__rec">
          Card# {st.num} is not valid for the selected set. Check the set, then the number printed
          at the bottom right of the card.
        </div>
      </div>
    );
  } else if (lastEntry && st.lastAdded) {
    const card = cards.find((c) => c.base_card_id === lastEntry.baseCardId) ?? null;
    const variant = card?.variants.find((v) => v.variant_id === lastEntry.variantId) ?? null;
    if (card && variant) {
      resultZone = true;
      const res = resolveRow(entryRow(lastEntry), catalog);
      // The readout for one more copy: owned + every entry of this printing + 1.
      const r = padReadout(
        lastEntry.setCode,
        lastEntry.cardNumber,
        lastEntry.picks,
        batch,
        catalog,
        limits,
        capMode
      );
      zone = (
        <Identified
          name={res.status === "resolved" ? (res.name ?? card.name) : card.name}
          subtitle={res.status === "resolved" ? res.subtitle : card.subtitle}
          card={card}
          variant={variant}
          readout={r}
          signedIn={isAuthenticated}
          choices={[]}
          hint={null}
          note={null}
          compact={false}
          justAdded={st.lastAdded.at}
          addLabel="Add another"
          canAdd={isAuthenticated}
          onAdd={() => addAgain(lastEntry)}
          onDetails={() => onOpenCard(card, variant)}
        />
      );
    }
  }
  if (!zone) zone = <IdleZone setName={setNameByCode[st.setCode] ?? st.setCode} />;

  // ── Entry row ──
  const shrink = !!view && view.kind === "card";
  const btnCode = precon ? precon.setCode : st.setCode;
  const base = padSetBase(btnCode);
  const sub = !precon && base !== null && base !== btnCode;
  const setStyle = {
    "--starfield": base ? `url(${starfieldUrl(base)})` : "url(/images/circuit-tile.webp)",
  } as CSSProperties;

  return (
    <div
      className={
        "m-pad m-pad--r2 m-pad--big" +
        (shrink ? " m-pad--result" : "") +
        (precon ? " m-pad--precon" : "")
      }
    >
      <div
        className={
          "m-pad__zone" +
          (resultZone ? " m-pad__zone--result" : "") +
          (precon ? " m-pad__zone--precon" : "")
        }
        aria-live="polite"
      >
        {zone}
      </div>
      <div className="m-pad__deck">
        <div className="m-pad__entry m-pad__entry--r2">
          <button
            type="button"
            className={
              "m-padset" +
              (base ? "" : " m-padset--nologo") +
              (sub ? " m-padset--sub" : "") +
              (precon ? " m-padset--deck" : "")
            }
            style={setStyle}
            onClick={() => setChooserOpen(true)}
            aria-label={
              precon
                ? `Precon deck: ${precon.kind === "ibhBox" ? "Whole box" : precon.deck.product}, ${
                    precon.kind === "ibhBox"
                      ? (setNameByCode.IBH ?? "Intro Battle: Hoth")
                      : precon.deck.name
                  }. Change set`
                : `Set: ${setNameByCode[st.setCode] ?? st.setCode}. Change set`
            }
          >
            {base ? <img className="m-padset__logo" src={setLogoUrl(base)} alt="" /> : null}
            <span className="m-padset__code">{precon ? preconShort(precon) : st.setCode}</span>
            <MIcon name="chevdown" size={16} />
          </button>
          <div
            className={
              "m-padnum" +
              (view && view.kind === "miss" ? " m-padnum--error" : "") +
              (st.num && !precon ? "" : " m-padnum--empty") +
              (precon ? " m-padnum--deck" : "")
            }
            role="status"
            aria-label={
              precon
                ? "Card number: not used for a precon deck"
                : "Card number" + (st.num ? " " + st.num : ", empty")
            }
          >
            <span className="m-padnum__val">{precon ? "Deck" : st.num || "000"}</span>
            {precon ? null : <span className="m-padnum__caret" aria-hidden="true" />}
          </div>
          <VerifyButton n={batch.length} onOpen={onOpenVerify} />
        </div>
        <Keys rest={!!precon} />
      </div>
      {chooserOpen ? (
        <SetChooserSheet
          sets={sets}
          setCode={precon ? null : st.setCode}
          preconKey={st.preconKey}
          onClose={() => setChooserOpen(false)}
        />
      ) : null}
    </div>
  );
}
