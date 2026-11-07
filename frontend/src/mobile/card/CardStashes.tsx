import { useEffect, useState } from "react";
import type { Stash } from "../../api/stashes";
import { SWUButton } from "../../components/SWUButton";
import {
  BoxIcon,
  PencilIcon,
  StashFormFields,
  playsetChipClass,
} from "../../screens/cards/CardPopupStashes";
import type { StashEditor } from "../../stashes/useStashEditor";
import { MIcon } from "../icons";
import { Sheet, useSheetClose } from "../Sheet";

// Phone 1e "Stash sheet" (claude_design/design_handoff_card_stash
// README). Desktop 1a's rows and behaviour in the shared bottom Sheet:
//   - StashPlateBlock: under the owned plate (expanded art), 280 px wide --
//     a 44 px "Stash copies" button when nothing of the printing is stashed,
//     else the read-only list (Stashes + Edit, one 40 px row per stash
//     holding it, playset chip);
//   - StashPinned: the same list kept under the collapsed art row, part of
//     the fixed region (cardDetailModel stashGeom sizes both);
//   - StashSheet: New stash mode (a2) and rows mode (b2..e1); the X, the
//     scrim, Escape or a drag down = Cancel; 44 px targets throughout.

export interface StashHolding {
  stash: Stash;
  qty: number;
}

function StashList({
  holding,
  playsetSize,
  onEdit,
}: {
  holding: StashHolding[];
  playsetSize: number;
  onEdit?: () => void;
}) {
  return (
    <div className="m-stash__list" aria-label="Stashes">
      <div className="m-stash__head">
        <span className="m-stash__heading">Stashes</span>
        <button type="button" className="m-stash__textbtn m-stash__edit" onClick={onEdit}>
          <PencilIcon size={14} />
          Edit
        </button>
      </div>
      {holding.map(({ stash, qty }) => (
        <div key={stash.id} className="m-stash__readrow">
          <span className="m-stash__name">{stash.name}</span>
          <span className={playsetChipClass(qty, playsetSize)}>{qty}</span>
        </div>
      ))}
    </div>
  );
}

export function StashPlateBlock({
  holding,
  playsetSize,
  onOpen,
  onEdit,
}: {
  holding: StashHolding[];
  playsetSize: number;
  onOpen?: () => void;
  onEdit?: () => void;
}) {
  if (holding.length === 0) {
    return (
      <button type="button" className="m-stash__entry" onClick={onOpen}>
        <BoxIcon size={16} />
        <span className="m-stash__entrylabel">Stash copies</span>
        <MIcon name="fwd" size={16} />
      </button>
    );
  }
  return <StashList holding={holding} playsetSize={playsetSize} onEdit={onEdit} />;
}

export function StashPinned({
  holding,
  playsetSize,
  onEdit,
  collapsed,
}: {
  holding: StashHolding[];
  playsetSize: number;
  onEdit?: () => void;
  collapsed: boolean;
}) {
  if (holding.length === 0) return null;
  return (
    <div className="m-dreg3__pinned" aria-hidden={collapsed ? undefined : true}>
      <StashList holding={holding} playsetSize={playsetSize} onEdit={onEdit} />
    </div>
  );
}

/** The sheet: shown while `open`; `onClosed` runs after its leave motion. */
export function StashSheet({
  editor,
  sub,
  printingLabel,
  onClosed,
}: {
  editor: StashEditor;
  /** "<Finish> · SOR 005 · 3 owned". */
  sub: string;
  printingLabel: string;
  onClosed: () => void;
}) {
  const create = editor.mode === "create";
  // The New stash form's text, held here: the body and the pinned foot are
  // separate subtrees of the Sheet.
  const [form, setFormState] = useState({ name: "", description: "" });
  const resetForm = () => setFormState({ name: "", description: "" });
  return (
    <Sheet
      title={create ? "New stash" : "Stash copies"}
      sub={create ? undefined : sub}
      labelId="m-stash-title"
      className="m-sheet-layer--stash"
      onClose={onClosed}
      locked={editor.busy}
      footer={
        create ? (
          <CreateFoot editor={editor} form={form} resetForm={resetForm} />
        ) : (
          <RowsFoot editor={editor} />
        )
      }
    >
      {create ? (
        <CreateBody editor={editor} form={form} setForm={setFormState} />
      ) : (
        <RowsBody editor={editor} printingLabel={printingLabel} onNew={resetForm} />
      )}
    </Sheet>
  );
}

interface FormText {
  name: string;
  description: string;
}

function CreateBody({
  editor,
  form,
  setForm,
}: {
  editor: StashEditor;
  form: FormText;
  setForm: (f: FormText) => void;
}) {
  const { name, description } = form;
  return (
    <form
      className="m-stash__create"
      aria-label="New stash"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && !editor.busy) void editor.submitCreate(name, description);
      }}
    >
      <StashFormFields
        idPrefix="m-stash"
        className="m-stash"
        name={name}
        description={description}
        onName={(v) => {
          setForm({ name: v, description });
          if (editor.nameError) editor.clearNameError();
        }}
        onDescription={(v) => setForm({ name, description: v })}
        nameError={editor.nameError}
      />
    </form>
  );
}

function CreateFoot({
  editor,
  form,
  resetForm,
}: {
  editor: StashEditor;
  form: FormText;
  resetForm: () => void;
}) {
  const { name, description } = form;
  const close = useSheetClose();
  const ready = name.trim().length > 0 && !editor.busy;
  return (
    <div className="m-stash__foot">
      <button
        type="button"
        className="m-stash__textbtn"
        onClick={() => {
          resetForm();
          if (editor.returnTo === "edit") editor.cancelCreate();
          else close();
        }}
      >
        Cancel
      </button>
      <SWUButton
        size="touch"
        active={ready}
        ariaDisabled={!ready}
        onClick={async () => {
          if (!ready) return;
          if (await editor.submitCreate(name, description)) resetForm();
        }}
      >
        Create stash
      </SWUButton>
    </div>
  );
}

function RowsBody({
  editor,
  printingLabel,
  onNew,
}: {
  editor: StashEditor;
  printingLabel: string;
  onNew: () => void;
}) {
  // While the sheet sinks after Done the editor is back in read mode: its
  // rows then carry the saved split rather than an emptied draft.
  const vault = editor.vault;
  return (
    <div className="m-stash__rows" aria-label="Stash copies">
      <div className="m-stash__row">
        <span className="m-stash__name m-stash__name--vault">Vault</span>
        <span
          className={
            "m-stash__vault" +
            (vault > 0 ? " m-stash__num--on" : "") +
            (editor.vaultEmpty ? " m-stash__vault--empty" : "")
          }
          aria-label={`Vault ${vault}`}
        >
          {vault}
        </span>
      </div>
      {editor.rows(printingLabel).map((r) => (
        <div key={r.stash.id} className="m-stash__row" data-stash={r.stash.id}>
          <span className="m-stash__name">{r.stash.name}</span>
          <span className="m-stepper">
            <button
              type="button"
              className="m-step"
              aria-disabled={r.canDec ? undefined : true}
              aria-label={r.decLabel}
              onClick={() => r.canDec && editor.dec(r.stash.id)}
            >
              −
            </button>
            <span className={"m-step__qty" + (r.qty > 0 ? " m-step__qty--on" : "")}>{r.qty}</span>
            <button
              type="button"
              className="m-step"
              aria-disabled={r.canInc ? undefined : true}
              aria-label={r.incLabel}
              onClick={() => r.canInc && editor.inc(r.stash.id)}
            >
              +
            </button>
          </span>
        </div>
      ))}
      <button
        type="button"
        className="m-stash__textbtn m-stash__new"
        onClick={() => {
          onNew();
          editor.newStash();
        }}
      >
        <span className="m-stash__plus" aria-hidden="true">
          +
        </span>
        New stash
      </button>
      {editor.saveError ? (
        <p className="m-stash__saveerror" role="alert">
          {editor.saveError}
        </p>
      ) : null}
    </div>
  );
}

function RowsFoot({ editor }: { editor: StashEditor }) {
  const close = useSheetClose();
  // Done closes the sheet once the save is through. The Sheet is `locked`
  // while busy and reads that in an effect of its own, so the close waits
  // for the render that unlocks it (a timer after this effect, which runs
  // before the Sheet's).
  const [closeAfterSave, setCloseAfterSave] = useState(false);
  useEffect(() => {
    if (!closeAfterSave || editor.busy) return undefined;
    const t = setTimeout(close, 0);
    return () => clearTimeout(t);
  }, [closeAfterSave, editor.busy, close]);
  return (
    <div className="m-stash__foot">
      <button type="button" className="m-stash__textbtn" onClick={close}>
        Cancel
      </button>
      <SWUButton
        size="touch"
        active={!editor.busy}
        ariaDisabled={editor.busy}
        onClick={async () => {
          if (editor.busy) return;
          if (await editor.done()) setCloseAfterSave(true);
        }}
      >
        Done
      </SWUButton>
    </div>
  );
}
