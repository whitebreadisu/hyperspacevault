import React, { useState, useMemo, useRef, useEffect } from "react";
import { SWUButton } from "../../components/SWUButton";
import { resolveRow, inventoryStatus, groupBy } from "../../utils/addCardsResolver";
import { useLimits } from "../../context/LimitsContext";
import { cardImageProps } from "../../utils/cardImages";
import type {
  Row,
  ResolveResult,
  InventoryStatus,
  AxisView,
  AddCardsCatalogEntry,
} from "../../utils/addCardsResolver";
import type { CardImageProps } from "../../utils/cardImages";
import type { CardSet } from "../../api/sets";

/** BL-111 F7 (design handoff §7): sizes for the fixed 196x274 preview frame
 * (ac-pad__resolve-image) -- grew from the pre-restyle 132x185. */
const PREVIEW_SIZES = "196px";

interface Props {
  setCode: string;
  rows: Row[];
  catalog: AddCardsCatalogEntry[];
  sets: CardSet[];
  onAppendRow: (rowData: Omit<Row, "id">) => void;
  onDeleteRow: (id: string) => void;
}

// "SOR — Spark of Rebellion" once the set list has loaded, else just the
// code. Labels the per-set groups in the batch list (BL-61 — a batch can
// span multiple sets).
function setLabel(code: string, sets: CardSet[]): string {
  const s = sets.find((x) => x.code === code);
  return s ? `${code} — ${s.name}` : code;
}

/** BL-111 F7 (design handoff §7): replaces the old green/red dot with a
 * two-line readout right of the card-number input.
 *   Line 1: "IN INVENTORY x/y" -- green under the limit, red otherwise.
 *   Line 2: "AFTER ADD a/y" -- omitted once the limit is already reached
 *     (owned alone, or owned + earlier batch copies of this exact printing),
 *     which instead collapses line 1 to "IN INVENTORY x/y (AT LIMIT)".
 * "No limit" buckets (status.effectiveLimit === null) drop the "/y" and stay
 * green always -- there's no boundary to warn about. capMode ("hard" vs
 * "soft") is deliberately NOT read here: the color already reflects it
 * (inventoryStatus returns "amber" in soft mode where hard would be "red"),
 * and both map to the same red "past limit" reading in this two-color
 * design -- soft mode's distinguishing behavior (the add still proceeds) is
 * unchanged downstream in splitForVerification/handleCommit, not in this
 * presentation. */
function InventoryReadout({ status }: { status: InventoryStatus | null }) {
  if (!status) return null;
  const { owned, effectiveLimit, afterAdd, color } = status;

  if (effectiveLimit === null) {
    return (
      <div className="ac-pad__readout">
        <div className="ac-pad__readout-line ac-pad__readout-line--green">IN INVENTORY {owned}</div>
        <div className="ac-pad__readout-line ac-pad__readout-line--green">AFTER ADD {afterAdd}</div>
      </div>
    );
  }

  if (color !== "green") {
    return (
      <div className="ac-pad__readout">
        <div className="ac-pad__readout-line ac-pad__readout-line--red">
          IN INVENTORY {owned}/{effectiveLimit} (AT LIMIT)
        </div>
      </div>
    );
  }

  return (
    <div className="ac-pad__readout">
      <div className="ac-pad__readout-line ac-pad__readout-line--green">
        IN INVENTORY {owned}/{effectiveLimit}
      </div>
      <div className="ac-pad__readout-line ac-pad__readout-line--green">
        AFTER ADD {afterAdd}/{effectiveLimit}
      </div>
    </div>
  );
}

// One of the Set / Stamp / Finish axes. Renders a <select> when the axis is a
// genuine choice (options.length > 1), plain read-only text otherwise, and
// nothing at all when the axis doesn't apply (e.g. Stamp on a non-tournament
// card). Its value comes from the resolver; the draft only overrides once the
// user actively changes it.
function AxisField({
  label,
  axis,
  draftValue,
  onChange,
  onKeyDown,
}: {
  label: string;
  axis: AxisView;
  draftValue: string | null;
  onChange: (value: string | null) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLSelectElement>;
}) {
  if (!axis.show) return null;

  if (axis.options.length > 1) {
    return (
      <div className="ac-pad__resolve-variant">
        <span className="ac-pad__label">{label}</span>
        <select
          className="ac-select"
          value={draftValue ?? axis.value ?? ""}
          aria-label={label}
          onChange={(e) => onChange(e.target.value || null)}
          onKeyDown={onKeyDown}
        >
          {axis.needsPick && axis.value === null && (
            <option value="">{`Select ${label.toLowerCase()}…`}</option>
          )}
          {axis.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="ac-pad__resolve-variant">
      <span className="ac-pad__label">{label}</span>
      <div className="ac-namefield">
        <span className="ac-namefield__name">{axis.value}</span>
      </div>
    </div>
  );
}

const EMPTY_DRAFT = {
  cardNumber: "",
  cardKey: null as string | null,
  setKey: null as string | null,
  stamp: null as string | null,
  finish: null as string | null,
};

// BL-62: typing "172" transiently resolves "1" and "17" as valid cards; a
// short hold keeps those intermediate images from ever being requested.
const IMAGE_DEBOUNCE_MS = 180;

/** BL-62 live preview: the resolved variant's front image, in a fixed
 * card-shaped frame (persistent placeholder — the panel never reflows as the
 * number resolves/unresolves). object-fit handles landscape leaders/bases.
 * BL-76 Phase 3: `images` is already the resolved src/srcSet/sizes triple
 * (cardImageProps falls back to the plain hotlink on its own when the
 * derived fields are absent), so this component only handles the debounce. */
function CardImagePreview({ images, name }: { images: CardImageProps | null; name: string }) {
  const [shown, setShown] = useState<{ images: CardImageProps; name: string } | null>(null);

  useEffect(() => {
    if (!images) {
      setShown(null);
      return;
    }
    const t = setTimeout(() => setShown({ images, name }), IMAGE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [images, name]);

  return (
    <div
      className={`ac-pad__resolve-image${shown ? " ac-pad__resolve-image--filled" : ""}`}
      aria-hidden={shown ? undefined : true}
    >
      {shown && (
        <img
          src={shown.images.src}
          srcSet={shown.images.srcSet}
          sizes={shown.images.sizes}
          onError={shown.images.onError}
          alt={shown.name}
        />
      )}
    </div>
  );
}

export function AddCardsKeypad({ setCode, rows, catalog, sets, onAppendRow, onDeleteRow }: Props) {
  // BL-25/BL-35: effective keep-limit matrix and cap_mode for the inventory
  // dots / headroom line (null/"hard" -> code defaults, matching
  // AddCardsModal's verification pass).
  const { limits, capMode } = useLimits();
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const cardInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(EMPTY_DRAFT);
  }, [setCode]);

  // New entries are always tagged with the currently active set (BL-61);
  // already-committed rows keep whichever set they were entered under.
  const draftRow: Row = useMemo(() => ({ id: "__draft__", setCode, ...draft }), [draft, setCode]);

  const resolved: ResolveResult = resolveRow(draftRow, catalog);

  const isResolved = resolved.status === "resolved";
  const hasError = resolved.status === "error";
  const state = resolved.status === "resolved" || resolved.status === "pending" ? resolved : null;

  const cardNeedsPick = state?.card.needsPick ?? false;
  const name = state?.name ?? null;
  const subtitle = state?.subtitle ?? null;

  const draftInv =
    resolved.status === "resolved"
      ? inventoryStatus([...rows, draftRow], draftRow, resolved, catalog, limits, capMode)
      : null;

  // BL-62: the image follows whatever variant the resolver currently points
  // at, so changing Which card / Set / Stamp / Finish live-swaps the art.
  // Pending/error/empty states (no concrete variant yet) show the placeholder.
  // BL-76 Phase 3: resolved via cardImageProps -- derived renditions when
  // present, the plain hotlink otherwise.
  // BL-111 F7 (design handoff §7): Leaders preview their portrait back side
  // -- same rule as GalleryGrid's cellImage (front is the landscape side for
  // a Leader; the back is the portrait/deployed side). Bases stay on their
  // (landscape) front here, unlike the gallery's rotate treatment -- the
  // design spec calls out only the Leader-back swap for this panel.
  const previewEntry =
    resolved.status === "resolved" ? catalog.find((c) => c.id === resolved.variantId) : undefined;
  const showBack = previewEntry?.type === "Leader" && !!previewEntry.back_image_url;
  const previewImages = previewEntry
    ? cardImageProps(
        showBack ? previewEntry.back_images : previewEntry.front_images,
        showBack ? previewEntry.back_image_url : previewEntry.front_image_url,
        "thumb",
        PREVIEW_SIZES
      )
    : null;

  const canCommit = isResolved;

  function commitDraft() {
    if (!canCommit) return;
    const { cardNumber, cardKey, setKey, stamp, finish } = draft;
    onAppendRow({ setCode, cardNumber, cardKey, setKey, stamp, finish });
    setDraft(EMPTY_DRAFT);
    setTimeout(() => cardInputRef.current?.focus(), 0);
  }

  // Enter on a focused <select> natively opens the dropdown rather than
  // submitting the form. Once every axis has settled (canCommit), intercept
  // Enter so the last pick can be committed with the keyboard alone.
  function onSelectKeyDown(e: React.KeyboardEvent<HTMLSelectElement>) {
    if (e.key === "Enter" && canCommit) {
      e.preventDefault();
      commitDraft();
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    commitDraft();
  }

  const committed = rows.filter((r) => r.cardNumber);
  // Group the batch by source set (BL-61) — a batch can span multiple sets,
  // so the list needs to show which set each chip belongs to.
  const committedGroups = groupBy(committed, (r) => r.setCode);

  return (
    <div className="ac-pad">
      <form className="ac-pad__entry" onSubmit={onSubmit} noValidate>
        <div>
          <span className="ac-pad__label">Card number</span>
          <div className="ac-pad__cardrow">
            <input
              ref={cardInputRef}
              type="text"
              inputMode="numeric"
              className={`ac-input ac-pad__big-input${hasError ? " ac-input--error" : ""}`}
              placeholder="000"
              value={draft.cardNumber}
              autoFocus
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d]/g, "");
                setDraft({ ...EMPTY_DRAFT, cardNumber: v });
              }}
            />
            <InventoryReadout status={draftInv} />
          </div>
          {hasError && resolved.status === "error" && (
            <div className="ac-row-error" style={{ marginTop: 8 }}>
              {resolved.message}
            </div>
          )}
        </div>

        <div className="ac-pad__resolve">
          <div className="ac-pad__resolve-main">
            <div
              className={`ac-pad__resolve-name${
                isResolved || state ? "" : " ac-pad__resolve-name--empty"
              }`}
            >
              {cardNeedsPick ? "Which card is it?" : (name ?? "Card name will appear here")}
            </div>
            {subtitle && <div className="ac-pad__resolve-sub">{subtitle}</div>}

            {/* Card picker gets its own full-width row: option labels (name +
              subtitle) are long, so stacking it keeps it readable and clear of
              the Set/Stamp/Finish controls below. */}
            {state?.card.show && (
              <div className="ac-pad__card-row">
                <span className="ac-pad__label">Which card?</span>
                <select
                  className="ac-select"
                  value={draft.cardKey ?? state.card.selectedKey ?? ""}
                  aria-label="Which card?"
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      cardKey: e.target.value || null,
                      setKey: null,
                      stamp: null,
                      finish: null,
                    }))
                  }
                  onKeyDown={onSelectKeyDown}
                >
                  {state.card.selectedKey === null && <option value="">Select the card…</option>}
                  {state.card.choices.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.key}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="ac-pad__resolve-controls">
              {state && (
                <>
                  <AxisField
                    label="Set"
                    axis={state.set}
                    draftValue={draft.setKey}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, setKey: v, stamp: null, finish: null }))
                    }
                    onKeyDown={onSelectKeyDown}
                  />
                  <AxisField
                    label="Stamp"
                    axis={state.stamp}
                    draftValue={draft.stamp}
                    onChange={(v) => setDraft((d) => ({ ...d, stamp: v, finish: null }))}
                    onKeyDown={onSelectKeyDown}
                  />
                  <AxisField
                    label="Finish"
                    axis={state.finish}
                    draftValue={draft.finish}
                    onChange={(v) => setDraft((d) => ({ ...d, finish: v }))}
                    onKeyDown={onSelectKeyDown}
                  />
                </>
              )}
              <SWUButton size="sm" active={canCommit} onClick={canCommit ? commitDraft : undefined}>
                Add Card
              </SWUButton>
            </div>

            {/* BL-111 F7 (design handoff §7): the old "Headroom: …" / at-limit
                hint line is removed -- the two-line inventory readout next to
                the card-number input (InventoryReadout, above) now carries
                that information. */}
            {cardNeedsPick && (
              <div className="ac-pad__resolve-sub" style={{ color: "var(--color-primary)" }}>
                This number is shared — pick the card you have.
              </div>
            )}
            {state?.card.show && !cardNeedsPick && (
              <div className="ac-pad__resolve-sub" style={{ color: "var(--color-text-muted)" }}>
                Shared number — defaulted to the base-set card; change “Which card?” for the alt
                printing.
              </div>
            )}
            {state && !isResolved && !cardNeedsPick && (
              <div className="ac-pad__resolve-sub" style={{ color: "var(--color-primary)" }}>
                Pick the highlighted option to enable Add Card.
              </div>
            )}
          </div>
          <CardImagePreview images={previewImages} name={name ?? ""} />
        </div>

        {/* Hidden submit button keeps Enter-to-submit working across browsers */}
        <button type="submit" style={{ display: "none" }} tabIndex={-1} aria-hidden="true" />
      </form>

      <div className="ac-pad__list-wrap">
        <div className="ac-pad__list-head">
          <span className="ac-pad__list-title">Cards in this batch</span>
          <span className="ac-pad__list-count">{committed.length}</span>
        </div>
        <div className="ac-pad__list">
          {committed.length === 0 && (
            <div className="ac-pad__list-empty">
              No cards yet. Type a card number and press Enter (or click Add Card) to begin building
              your batch.
            </div>
          )}
          {[...committedGroups.entries()].map(([groupSetCode, groupRows]) => (
            <div key={groupSetCode} className="ac-pad__list-group">
              <div className="ac-pad__list-group-head">{setLabel(groupSetCode, sets)}</div>
              {groupRows.map((row) => {
                const res = resolveRow(row, catalog);
                const inv =
                  res.status === "resolved"
                    ? inventoryStatus(rows, row, res, catalog, limits, capMode)
                    : null;
                const tag =
                  res.status === "resolved"
                    ? [res.stamp.value, res.finish.value].filter(Boolean).join(" · ")
                    : "";
                return (
                  <div key={row.id} className="ac-chip">
                    <span className="ac-chip__num">{row.cardNumber}</span>
                    <span
                      className="ac-chip__name"
                      title={res.status === "resolved" ? (res.name ?? "") : "Invalid"}
                    >
                      {res.status === "resolved" ? res.name : "—"}
                    </span>
                    <span
                      className={`ac-chip__var${
                        res.status === "resolved" && res.channel !== "Retail"
                          ? " ac-chip__var--op"
                          : ""
                      }`}
                    >
                      {tag}
                    </span>
                    <span
                      className={`ac-chip__ind${inv ? ` ac-chip__ind--${inv.color}` : ""}`}
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      className="ac-chip__del"
                      onClick={() => onDeleteRow(row.id)}
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
