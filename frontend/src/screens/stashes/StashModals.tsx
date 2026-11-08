import { useCallback, useState } from "react";
import { SWUButton } from "../../components/SWUButton";
import { useModalDismiss } from "../../hooks/useModalDismiss";
import type { Stash } from "../../api/stashes";
import { DESCRIPTION_MAX, NAME_MAX } from "../../stashes/useStashMeta";
import type { MetaError, StashMeta } from "../../stashes/useStashMeta";
import { STASH_COPY } from "../../stashes/stashContents";
import "../../stashes/stashFields.css";
import "../auth/AuthModal.css";

// The Stashes page's two desktop modals, on the transactional family's own
// classes (AuthModal.css: `auth-modal-card` with its blue top bar, X
// top-right, `auth-card__subtitle` heading; the delete confirm is
// DeleteAccountModal's `auth-danger-warning` + `auth-cancel` /
// `auth-danger-submit` pair). Design 1b B2 and E3.

/** Name (/40) and Description (/280) with counters; a duplicate name turns
 * the name field red with the inline error + recommendation (E2). */
export function StashNameFields({
  idPrefix,
  name,
  description,
  onName,
  onDescription,
  error,
  autoFocus = true,
  big = false,
}: {
  idPrefix: string;
  name: string;
  description: string;
  onName: (v: string) => void;
  onDescription: (v: string) => void;
  error: MetaError | null;
  autoFocus?: boolean;
  /** The in-place edit's larger name field (E1). */
  big?: boolean;
}) {
  const nameErr = error?.field === "name" ? error : null;
  const errId = `${idPrefix}-name-error`;
  return (
    <>
      <label className="sp-field">
        <span className="sp-field__label">Name</span>
        <span
          className={
            "sp-field__box" +
            (nameErr ? " sp-field__box--error" : "") +
            (big ? " sp-field__box--big" : "")
          }
        >
          <input
            className="sp-field__input"
            type="text"
            value={name}
            maxLength={NAME_MAX}
            autoFocus={autoFocus}
            aria-invalid={nameErr ? true : undefined}
            aria-describedby={nameErr ? errId : undefined}
            onChange={(e) => onName(e.target.value)}
          />
          <span className="sp-field__count" aria-hidden="true">
            {name.length}/{NAME_MAX}
          </span>
        </span>
        {nameErr ? (
          <span className="sp-field__error" id={errId} role="alert">
            {nameErr.what} <span className="sp-field__hint">{nameErr.hint}</span>
          </span>
        ) : null}
      </label>
      <label className="sp-field">
        <span className="sp-field__label">
          Description <span className="sp-field__opt">· optional</span>
        </span>
        <span className="sp-field__box sp-field__box--area">
          <textarea
            className="sp-field__textarea"
            value={description}
            maxLength={DESCRIPTION_MAX}
            placeholder="Where it lives, what it’s for"
            onChange={(e) => onDescription(e.target.value)}
          />
          <span className="sp-field__count" aria-hidden="true">
            {description.length}/{DESCRIPTION_MAX}
          </span>
        </span>
      </label>
    </>
  );
}

export function MetaErrorLine({ error }: { error: MetaError | null }) {
  if (!error || error.field === "name") return null;
  return (
    <p className="sp-error" role="alert">
      {error.what} <span className="sp-error__hint">{error.hint}</span>
    </p>
  );
}

export function CreateStashModal({
  meta,
  onClose,
  onCreated,
}: {
  meta: StashMeta;
  onClose: () => void;
  onCreated: (stash: Stash) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const close = useCallback(() => {
    if (!meta.busy) {
      meta.clearError();
      onClose();
    }
  }, [meta, onClose]);
  useModalDismiss(close);
  const ready = meta.canSubmit(name);
  const submit = async () => {
    if (!ready) return;
    const s = await meta.create(name, description);
    if (s) onCreated(s);
  };
  return (
    <div className="auth-modal-overlay modal-overlay sp-scrim" onClick={close}>
      <div
        className="auth-modal-card sp-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sp-create-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="auth-modal-close" onClick={close} aria-label="Close">
          ×
        </button>
        <h2 className="auth-card__subtitle sp-modal__title" id="sp-create-title">
          New stash
        </h2>
        <form
          className="sp-modal__form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <StashNameFields
            idPrefix="sp-create"
            name={name}
            description={description}
            onName={(v) => {
              setName(v);
              if (meta.error) meta.clearError();
            }}
            onDescription={setDescription}
            error={meta.error}
          />
          <MetaErrorLine error={meta.error} />
          <div className="sp-modal__actions">
            <button type="button" className="sp-textbtn" onClick={close}>
              Cancel
            </button>
            <SWUButton size="sm" active={ready} ariaDisabled={!ready} onClick={() => void submit()}>
              Create stash
            </SWUButton>
          </div>
        </form>
      </div>
    </div>
  );
}

export function DeleteStashModal({
  stash,
  meta,
  onClose,
  onDeleted,
}: {
  stash: Stash;
  meta: StashMeta;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const close = useCallback(() => {
    if (!meta.busy) {
      meta.clearError();
      onClose();
    }
  }, [meta, onClose]);
  useModalDismiss(close);
  return (
    <div className="auth-modal-overlay modal-overlay sp-scrim" onClick={close}>
      <div
        className="auth-modal-card sp-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sp-del-title"
        aria-describedby="sp-del-body"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="auth-modal-close" onClick={close} aria-label="Close">
          ×
        </button>
        <h2 className="auth-card__subtitle sp-modal__title" id="sp-del-title">
          Delete {stash.name}?
        </h2>
        <div id="sp-del-body" className="sp-modal__body">
          <p className="auth-danger-warning sp-modal__lead">
            {STASH_COPY.deleteLead(stash.copies)}
          </p>
          <p className="auth-danger-warning">{STASH_COPY.deleteFine}</p>
        </div>
        <MetaErrorLine error={meta.error} />
        <div className="auth-modal-actions">
          <button type="button" className="auth-cancel" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="auth-danger-submit"
            aria-disabled={meta.busy || undefined}
            onClick={async () => {
              if (meta.busy) return;
              if (await meta.remove(stash.id)) onDeleted();
            }}
          >
            Delete stash
          </button>
        </div>
      </div>
    </div>
  );
}
