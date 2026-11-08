import { useState } from "react";
import { SWUButton } from "../../components/SWUButton";
import type { Stash } from "../../api/stashes";
import { MetaErrorLine, StashNameFields } from "../../screens/stashes/StashModals";
import type { StashMeta } from "../../stashes/useStashMeta";
import { Sheet, useSheetClose } from "../Sheet";

// The phone Stashes page's sheets (design 1d A2 and the create / delete
// sheets, the synced Sheet): Edit stash (Name /40, Description /280, footer
// red DELETE STASH left · Save), New stash (Cancel · Create stash) and the
// delete confirm, with the desktop copy.

function EditFoot({
  meta,
  ready,
  onSave,
  onDelete,
}: {
  meta: StashMeta;
  ready: boolean;
  onSave: () => Promise<boolean>;
  onDelete: () => void;
}) {
  const close = useSheetClose();
  return (
    <div className="m-stashsheet__foot">
      <button type="button" className="m-stashsheet__danger" onClick={onDelete}>
        Delete stash
      </button>
      <SWUButton
        size="touch"
        active={ready}
        ariaDisabled={!ready}
        onClick={async () => {
          if (!ready || meta.busy) return;
          if (await onSave()) close();
        }}
      >
        Save
      </SWUButton>
    </div>
  );
}

export function EditStashSheet({
  stash,
  meta,
  onClose,
  onDelete,
}: {
  stash: Stash;
  meta: StashMeta;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(stash.name);
  const [description, setDescription] = useState(stash.description ?? "");
  const ready = meta.canSubmit(name);
  return (
    <Sheet
      title="Edit stash"
      labelId="m-stash-edit-title"
      className="m-stashsheet"
      onClose={() => {
        meta.clearError();
        onClose();
      }}
      footer={
        <EditFoot
          meta={meta}
          ready={ready}
          onSave={() => meta.save(stash.id, name, description)}
          onDelete={onDelete}
        />
      }
    >
      <form
        className="m-stashsheet__form"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <StashNameFields
          idPrefix="m-stash-edit"
          name={name}
          description={description}
          onName={(v) => {
            setName(v);
            if (meta.error) meta.clearError();
          }}
          onDescription={setDescription}
          error={meta.error}
          autoFocus={false}
        />
        <MetaErrorLine error={meta.error} />
      </form>
    </Sheet>
  );
}

function CreateFoot({
  meta,
  ready,
  onCreate,
}: {
  meta: StashMeta;
  ready: boolean;
  onCreate: () => Promise<boolean>;
}) {
  const close = useSheetClose();
  return (
    <div className="m-stashsheet__foot">
      <button type="button" className="m-stashsheet__text" onClick={close}>
        Cancel
      </button>
      <SWUButton
        size="touch"
        active={ready}
        ariaDisabled={!ready}
        onClick={async () => {
          if (!ready || meta.busy) return;
          if (await onCreate()) close();
        }}
      >
        Create stash
      </SWUButton>
    </div>
  );
}

export function CreateStashSheet({
  meta,
  onClose,
  onCreated,
}: {
  meta: StashMeta;
  onClose: () => void;
  onCreated?: (s: Stash) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const ready = meta.canSubmit(name);
  return (
    <Sheet
      title="New stash"
      labelId="m-stash-new-title"
      className="m-stashsheet"
      onClose={() => {
        meta.clearError();
        onClose();
      }}
      footer={
        <CreateFoot
          meta={meta}
          ready={ready}
          onCreate={async () => {
            const s = await meta.create(name, description);
            if (s) onCreated?.(s);
            return s != null;
          }}
        />
      }
    >
      <form className="m-stashsheet__form" onSubmit={(e) => e.preventDefault()}>
        <StashNameFields
          idPrefix="m-stash-new"
          name={name}
          description={description}
          onName={(v) => {
            setName(v);
            if (meta.error) meta.clearError();
          }}
          onDescription={setDescription}
          error={meta.error}
          autoFocus={false}
        />
        <MetaErrorLine error={meta.error} />
      </form>
    </Sheet>
  );
}

function DeleteFoot({ meta, onDelete }: { meta: StashMeta; onDelete: () => Promise<boolean> }) {
  const close = useSheetClose();
  return (
    <div className="m-stashsheet__foot">
      <button type="button" className="m-stashsheet__text" onClick={close}>
        Cancel
      </button>
      <button
        type="button"
        className="m-stashsheet__destroy"
        aria-disabled={meta.busy || undefined}
        onClick={async () => {
          if (meta.busy) return;
          if (await onDelete()) close();
        }}
      >
        Delete stash
      </button>
    </div>
  );
}

export function DeleteStashSheet({
  stash,
  meta,
  onClose,
  onDeleted,
}: {
  stash: Stash;
  meta: StashMeta;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  return (
    <Sheet
      title={`Delete ${stash.name}?`}
      labelId="m-stash-del-title"
      className="m-stashsheet"
      onClose={() => {
        meta.clearError();
        onClose();
      }}
      footer={
        <DeleteFoot
          meta={meta}
          onDelete={async () => {
            const ok = await meta.remove(stash.id);
            if (ok) onDeleted?.();
            return ok;
          }}
        />
      }
    >
      <div className="m-stashsheet__body">
        <p className="m-stashsheet__lead">
          Its {stash.copies} {stash.copies === 1 ? "copy goes" : "copies go"} back to your Vault.
        </p>
        <p className="m-stashsheet__fine">
          You still own every copy. Only the stash and its name and description are deleted.
        </p>
        <MetaErrorLine error={meta.error} />
      </div>
    </Sheet>
  );
}
