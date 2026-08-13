import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  listShares,
  createShare,
  renameShare,
  rotateShare,
  revokeShare,
  ShareApiError,
} from "../../api/shares";
import type { ShareRecord } from "../../api/shares";
import { useModalDismiss } from "../../hooks/useModalDismiss";
import "../auth/AuthModal.css";
import "./ShareManageModal.css";

const NAME_MAX_LENGTH = 30;

interface Props {
  onClose: () => void;
}

function shareUrl(token: string): string {
  return `${window.location.origin}/shared/${token}`;
}

/** BL-205 (§19.1): owner-side share management, reached from the Vault
 * header's share affordance (CardsPage). Reuses AuthModal.css's `.auth-*`
 * classes for the overlay/card/form/field/button grain (same reuse
 * ChangePasswordModal/DeleteAccountModal already make) rather than forking
 * new ones -- only the link/copy row below needs a couple of new classes
 * (ShareManageModal.css). "At most one active share per scope target"
 * (§19.1) means this modal only ever has ONE of two shapes: the empty
 * create-form state, or the single active share's management panel --
 * never a list. */
export function ShareManageModal({ onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [share, setShare] = useState<ShareRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"rotate" | "revoke" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  useModalDismiss(onClose, { enabled: !submitting });

  useEffect(() => {
    let cancelled = false;
    listShares()
      .then((rows) => {
        if (cancelled) return;
        // §19.1: at most one ACTIVE share per scope target -- a revoked row
        // (or a future non-"inventory" scope, BL-206/BL-209) is not the one
        // this modal manages.
        const active = rows.find((s) => s.scope === "inventory" && !s.revoked) ?? null;
        setShare(active);
        setName(active?.name ?? "");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError("Couldn't load your share. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setActionError(null);
    setSubmitting(true);
    try {
      const created = await createShare(trimmed);
      setShare(created);
      setName(created.name);
    } catch (err) {
      setActionError(
        err instanceof ShareApiError
          ? err.message
          : "Something went wrong creating your share. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRename(e: FormEvent) {
    e.preventDefault();
    if (!share) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    setActionError(null);
    setSubmitting(true);
    try {
      const updated = await renameShare(share.id, trimmed);
      setShare(updated);
      setName(updated.name);
      setRenaming(false);
    } catch {
      setActionError("Something went wrong renaming your share. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRotate() {
    if (!share) return;
    setActionError(null);
    setSubmitting(true);
    try {
      const rotated = await rotateShare(share.id);
      setShare(rotated);
      setConfirmAction(null);
    } catch {
      setActionError("Something went wrong rotating your share link. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke() {
    if (!share) return;
    setActionError(null);
    setSubmitting(true);
    try {
      await revokeShare(share.id);
      setShare(null);
      setName("");
      setConfirmAction(null);
    } catch {
      setActionError("Something went wrong revoking your share. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(shareUrl(share.token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setActionError("Couldn't copy the link -- select and copy it manually.");
    }
  }

  return (
    <div className="auth-modal-overlay modal-overlay" onClick={submitting ? undefined : onClose}>
      <div
        className="auth-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Share Your Vault"
        onClick={(e) => e.stopPropagation()}
      >
        {!submitting && (
          <button type="button" className="auth-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}

        <h2 className="auth-card__subtitle">Share Your Vault</h2>

        {loading && <p className="auth-success">Loading…</p>}

        {!loading && loadError && <p className="auth-error">{loadError}</p>}

        {/* Empty state -- no active share yet. */}
        {!loading && !loadError && !share && (
          <form className="auth-form" onSubmit={handleCreate}>
            <p className="auth-success">
              Create a secret link that lets anyone with it view your Vault at full fidelity --
              read-only, no account needed.
            </p>
            <label className="auth-field">
              <span className="auth-field__label">Share Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={NAME_MAX_LENGTH}
                placeholder="e.g. Bobs big vault"
                autoComplete="off"
                disabled={submitting}
                required
              />
            </label>

            {actionError && <p className="auth-error">{actionError}</p>}

            <div className="auth-modal-actions">
              <button type="button" className="auth-cancel" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className="auth-submit" disabled={submitting || !name.trim()}>
                {submitting ? "Please wait…" : "Create Share"}
              </button>
            </div>
          </form>
        )}

        {/* Active-share management panel. */}
        {!loading && !loadError && share && confirmAction === null && (
          <div className="auth-form">
            {renaming ? (
              <form className="auth-form" onSubmit={handleRename}>
                <label className="auth-field">
                  <span className="auth-field__label">Share Name</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={NAME_MAX_LENGTH}
                    autoComplete="off"
                    disabled={submitting}
                    required
                  />
                </label>
                <div className="auth-modal-actions">
                  <button
                    type="button"
                    className="auth-cancel"
                    onClick={() => {
                      setName(share.name);
                      setRenaming(false);
                    }}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="auth-submit"
                    disabled={submitting || !name.trim()}
                  >
                    {submitting ? "Please wait…" : "Save Name"}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p className="share-modal__name">
                  {share.name}
                  <button
                    type="button"
                    className="share-modal__rename-link"
                    onClick={() => setRenaming(true)}
                  >
                    Rename
                  </button>
                </p>

                <div className="share-modal__link-row">
                  <input
                    className="share-modal__link-input"
                    type="text"
                    readOnly
                    value={shareUrl(share.token)}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button type="button" className="auth-submit" onClick={handleCopy}>
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>

                <p className="share-modal__hint">
                  Anyone with this link can view your Vault -- cards, quantities, prices, and value
                  -- read-only. No account needed on their end.
                </p>

                <div className="auth-modal-actions">
                  <button
                    type="button"
                    className="auth-cancel"
                    onClick={() => setConfirmAction("rotate")}
                    disabled={submitting}
                  >
                    Rotate Link
                  </button>
                  <button
                    type="button"
                    className="auth-danger-submit"
                    onClick={() => setConfirmAction("revoke")}
                    disabled={submitting}
                  >
                    Revoke
                  </button>
                </div>
              </>
            )}

            {actionError && <p className="auth-error">{actionError}</p>}
          </div>
        )}

        {/* Rotate confirm -- §19.1: "this kills the old link" (owner-facing
            confirm wording is the deliverable's explicit requirement). */}
        {!loading && share && confirmAction === "rotate" && (
          <div className="auth-form">
            <p className="auth-danger-warning">
              Rotating creates a new link and immediately breaks the old one -- anyone still using
              it loses access. This cannot be undone.
            </p>
            {actionError && <p className="auth-error">{actionError}</p>}
            <div className="auth-modal-actions">
              <button
                type="button"
                className="auth-cancel"
                onClick={() => setConfirmAction(null)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="auth-danger-submit"
                onClick={handleRotate}
                disabled={submitting}
              >
                {submitting ? "Please wait…" : "Rotate Link"}
              </button>
            </div>
          </div>
        )}

        {/* Revoke confirm. */}
        {!loading && share && confirmAction === "revoke" && (
          <div className="auth-form">
            <p className="auth-danger-warning">
              Revoking immediately breaks the link -- anyone still using it loses access right away.
              This cannot be undone.
            </p>
            {actionError && <p className="auth-error">{actionError}</p>}
            <div className="auth-modal-actions">
              <button
                type="button"
                className="auth-cancel"
                onClick={() => setConfirmAction(null)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="auth-danger-submit"
                onClick={handleRevoke}
                disabled={submitting}
              >
                {submitting ? "Please wait…" : "Revoke"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
