import { useState } from "react";
import { SWUButton } from "../../components/SWUButton";
import { DESCRIPTION_MAX, NAME_MAX } from "../../stashes/useStashEditor";
import type { StashEditor } from "../../stashes/useStashEditor";

// Desktop 1a "Place rows" (claude_design/design_handoff_card_stash
// README): the stash UI inside the popup's inventory panel, under the owned
// stepper, for the selected printing only.
//   a1/b1  nothing of this printing stashed -> one quiet "Stash copies" text
//          button (no stashes yet -> the New stash form, else the rows);
//   a2     New stash: Name + Description, Create stash / Cancel; Create goes
//          straight to the rows with the new stash in them, nothing moved;
//   b2..e1 the rows: Vault first (a number only, red at 0 when every copy is
//          stashed), then every stash with a small -/+ that saves on click
//          (useStashEditor: coalesced, serialized, rolled back on failure);
//          + New stash; Done collapses the rows (no Cancel);
//   c1     read only: "Stashes" + Edit, one row per stash holding it, with
//          the playset chip (green at the card's playset size).
// e2 (0 owned), f1 (shared) and f2 (signed out) draw nothing: the caller
// only mounts this when `editor.available`.

export function BoxIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M4 8h16v11H4z" />
      <path d="M9 4h6v4H9z" />
    </svg>
  );
}

export function PencilIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M4 20h4L19 9l-4-4L4 16z" />
    </svg>
  );
}

/** The New stash form's fields, shared by desktop and the phone sheet. */
export function StashFormFields({
  idPrefix,
  name,
  description,
  onName,
  onDescription,
  nameError,
  className,
}: {
  idPrefix: string;
  name: string;
  description: string;
  onName: (v: string) => void;
  onDescription: (v: string) => void;
  nameError: string | null;
  className: string;
}) {
  const errId = `${idPrefix}-name-error`;
  return (
    <>
      <label className={`${className}__field`}>
        <span className={`${className}__label`}>Name</span>
        <input
          className={`${className}__input`}
          type="text"
          value={name}
          maxLength={NAME_MAX}
          autoFocus
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? errId : undefined}
          onChange={(e) => onName(e.target.value)}
        />
        {nameError ? (
          <span className={`${className}__error`} id={errId} role="alert">
            {nameError}
          </span>
        ) : null}
      </label>
      <label className={`${className}__field`}>
        <span className={`${className}__label`}>Description</span>
        <textarea
          className={`${className}__textarea`}
          value={description}
          maxLength={DESCRIPTION_MAX}
          placeholder="Where it lives, what it’s for"
          onChange={(e) => onDescription(e.target.value)}
        />
      </label>
    </>
  );
}

export function playsetChipClass(qty: number, playsetSize: number): string {
  return "playset-chip" + (qty >= playsetSize ? " playset-chip--complete" : "");
}

export function CardPopupStashes({
  editor,
  playsetSize,
  printingLabel,
}: {
  editor: StashEditor;
  /** The card's playset size (leaders / bases 1, others 3). */
  playsetSize: number;
  /** For the steppers' accessible names. */
  printingLabel: string;
}) {
  if (editor.mode === "create") return <CreateForm editor={editor} />;
  if (editor.mode === "edit") return <EditRows editor={editor} printingLabel={printingLabel} />;
  if (editor.holding.length === 0) {
    return (
      <button
        type="button"
        className="cp-stash__quiet"
        onClick={editor.open}
        data-tour="card-stash-copies"
        data-tour-place="right"
      >
        <BoxIcon />
        Stash copies
      </button>
    );
  }
  return (
    <div
      className="cp-stash__list"
      aria-label="Stashes"
      data-tour="card-stash-list"
      data-tour-place="right"
    >
      <div className="cp-stash__listhead">
        <span className="cp-stash__heading">Stashes</span>
        <button type="button" className="cp-stash__quiet cp-stash__edit" onClick={editor.edit}>
          <PencilIcon />
          Edit
        </button>
      </div>
      <div className="cp-stash__scroll">
        {editor.holding.map(({ stash, qty }) => (
          <div key={stash.id} className="cp-stash__readrow">
            <span className="cp-stash__name">{stash.name}</span>
            <span className={playsetChipClass(qty, playsetSize)}>{qty}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreateForm({ editor }: { editor: StashEditor }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const ready = name.trim().length > 0 && !editor.busy;
  return (
    <form
      data-tour-busy=""
      className="cp-stash__create"
      aria-label="New stash"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void editor.submitCreate(name, description);
      }}
    >
      <span className="cp-stash__title">New stash</span>
      <StashFormFields
        idPrefix="cp-stash"
        className="cp-stash"
        name={name}
        description={description}
        onName={(v) => {
          setName(v);
          if (editor.nameError) editor.clearNameError();
        }}
        onDescription={setDescription}
        nameError={editor.nameError}
      />
      <div className="cp-stash__actions">
        <SWUButton
          active={ready}
          ariaDisabled={!ready}
          onClick={() => {
            if (ready) void editor.submitCreate(name, description);
          }}
        >
          Create stash
        </SWUButton>
        <button type="button" className="cp-stash__text" onClick={editor.cancelCreate}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditRows({ editor, printingLabel }: { editor: StashEditor; printingLabel: string }) {
  const { vault } = editor;
  return (
    <div className="cp-stash__rows" aria-label="Stash copies" data-tour-busy="">
      <div className="cp-stash__row">
        <span className="cp-stash__name cp-stash__name--vault">Vault</span>
        <span
          className={
            "cp-stash__vault" +
            (vault > 0 ? " cp-stash__num--on" : "") +
            (editor.vaultEmpty ? " cp-stash__vault--empty" : "")
          }
          aria-label={`Vault ${vault}`}
        >
          {vault}
        </span>
      </div>
      {/* Only the stash rows scroll (owner 2026-11-08, 50 stashes): the
          card image, the Vault row, "New stash" and Done stay put. */}
      <div className="cp-stash__scroll">
        {editor.rows(printingLabel).map((r) => (
          <div key={r.stash.id} className="cp-stash__row" data-stash={r.stash.id}>
            <span className="cp-stash__name">{r.stash.name}</span>
            <span className="cp-stash__stepper">
              <button
                type="button"
                className="cp-stash__step"
                aria-disabled={r.canDec ? undefined : true}
                aria-label={r.decLabel}
                onClick={() => r.canDec && editor.dec(r.stash.id)}
              >
                −
              </button>
              <span className={"cp-stash__num" + (r.qty > 0 ? " cp-stash__num--on" : "")}>
                {r.qty}
              </span>
              <button
                type="button"
                className="cp-stash__step"
                aria-disabled={r.canInc ? undefined : true}
                aria-label={r.incLabel}
                onClick={() => r.canInc && editor.inc(r.stash.id)}
              >
                +
              </button>
            </span>
          </div>
        ))}
      </div>
      <button type="button" className="cp-stash__text cp-stash__new" onClick={editor.newStash}>
        <span className="cp-stash__plus" aria-hidden="true">
          +
        </span>
        New stash
      </button>
      {editor.saveError ? (
        <p className="cp-stash__saveerror" role="alert">
          {editor.saveError}
        </p>
      ) : null}
      {/* Every -/+ saves on its own (useStashEditor); Done only collapses
          the rows. No Cancel. */}
      <div className="cp-stash__foot">
        <SWUButton onClick={editor.done}>Done</SWUButton>
      </div>
    </div>
  );
}
