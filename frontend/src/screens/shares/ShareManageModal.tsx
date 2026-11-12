import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  createShare,
  renameShare,
  rotateShare,
  revokeShare,
  ShareApiError,
} from "../../api/shares";
import type { ShareRecord } from "../../api/shares";
import { ApiError } from "../../api/errors";
import { stashShareUrl } from "../../api/sharedView";
import { useModalDismiss } from "../../hooks/useModalDismiss";
import { capture } from "../../analytics/analytics";
import { useShareLinksContext } from "../../shares/ShareLinksContext";
import type { LinkTarget, OwnerLink } from "../../shares/ShareLinksContext";
import { useStashes } from "../../stashes/StashContext";
import { useStashMeta } from "../../stashes/useStashMeta";
import { MetaErrorLine, StashNameFields } from "../stashes/StashModals";
import "../auth/AuthModal.css";
import "./ShareManageModal.css";

const NAME_MAX_LENGTH = 30;
const COPIED_MS = 2000;
const LOAD_FAILED = "Couldn't load your share. Please try again.";

interface Props {
  onClose: () => void;
  /** Open on this stash's link (create mode when it has none); absent = the
   * vault link. */
  stashId?: number;
}

/** A link's URL: the vault link at /shared/<token>, a stash link at
 * /shared/stash/<token> (the viewer's route). */
function linkUrl(share: ShareRecord): string {
  if (share.scope === "stash") return stashShareUrl(share.token);
  return `${window.location.origin}/shared/${share.token}`;
}

/** What a viewer of the link sees, in the create text and the link note. */
function sees(stash: string | null): string {
  return stash == null
    ? "your Vault — cards, quantities, prices and value"
    : `${stash} — its name, description, cards, counts, prices and value`;
}

export const SHARE_COPY = {
  title: (stash: string | null) => (stash == null ? "Share your Vault" : `Share ${stash}`),
  create: (stash: string | null) =>
    `Create a secret link that lets anyone with it view ${sees(stash)}. Read-only, no account needed.`,
  note: (stash: string | null) =>
    `Anyone with this link can see ${sees(stash)}. Read-only, no account needed.` +
    (stash == null ? " Stashes stay private." : " Your Vault and other stashes stay private."),
  prefilled: "Filled in from your Vault link.",
  /** A second create for a stash that already has a link (409). */
  stashHasLink: "This stash already has a share link.",
  stashGone: "This stash no longer exists.",
  /** New link or Revoke on a link revoked elsewhere (404). */
  alreadyRevoked: "This link was already revoked.",
  fixed: "The share name can’t be changed later.",
  rotate:
    "A new link replaces this one. The old link stops working at once — anyone still using it loses access. This cannot be undone.",
  revoke: (stash: string | null) =>
    `Revoking breaks the link at once — anyone still using it loses access. ${stash ?? "Your Vault"} itself is not changed. This cannot be undone.`,
} as const;

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/** "Your links · N": every live link, the shown one marked SHOWING; a row
 * swaps the window to its link in place, its Copy copies that link. */
function LinksList({
  links,
  target,
  copiedId,
  onShow,
  onCopy,
}: {
  links: OwnerLink[];
  target: LinkTarget;
  copiedId: number | null;
  onShow: (t: LinkTarget) => void;
  onCopy: (l: OwnerLink) => void;
}) {
  return (
    <section className="share-links" aria-label="Your links">
      <h3 className="share-links__head">Your links · {links.length}</h3>
      <ul className="share-links__list">
        {links.map((l) =>
          l.target === target ? (
            <li
              key={l.share.id}
              className="share-links__row share-links__row--on"
              aria-current="true"
            >
              <span className="share-links__name">{l.label}</span>
              <span className="share-links__showing">Showing</span>
            </li>
          ) : (
            <li key={l.share.id} className="share-links__row">
              <button
                type="button"
                className="share-links__open"
                onClick={() => onShow(l.target)}
                aria-label={`Show the ${l.label} link`}
              >
                <span className="share-links__name">{l.label}</span>
              </button>
              <button
                type="button"
                className="share-links__copy"
                onClick={() => onCopy(l)}
                aria-label={`Copy the ${l.label} link`}
              >
                {copiedId === l.share.id ? "Copied!" : "Copy"}
              </button>
              <span className="share-links__chev">
                <Chevron />
              </span>
            </li>
          )
        )}
      </ul>
    </section>
  );
}

/** The share window (App Spec §19.1, owner screens): one window for the vault
 * link and every stash link, opened from Collection's Share and the phone's
 * More → Sharing (the vault link) and from a stash's own Share (desktop stash
 * head, phone status row). Reuses AuthModal.css's transactional family
 * (`.auth-*`: card with the blue top bar, X, title, fields, Cancel / submit /
 * danger pair, warning copy) -- only the name row, the link row, the hint and
 * the links list have classes of their own (ShareManageModal.css).
 *
 * Per link it has three shapes: Create (no live link: the create form), Link
 * (the live link: name row, link + Copy, note, New link / Revoke, and "Your
 * links" when the owner has more than one) and Confirm (New link or Revoke,
 * replacing the body). A stash link's share name is fixed at creation, so its
 * name row offers Rename stash (the stash's own name, the Stashes page's
 * rules); the vault link keeps Rename (its share name). The links come from
 * the owner-links source (ShareLinksContext), which every write updates. */
export function ShareManageModal({ onClose, stashId }: Props) {
  const links = useShareLinksContext();
  const stashCtx = useStashes();
  const meta = useStashMeta();
  const [target, setTarget] = useState<LinkTarget>(stashId ?? "vault");
  // A line that outlives a shape change (the stash went away under a create).
  const [notice, setNotice] = useState<string | null>(null);

  // Every open reads the links afresh (another device may have changed them).
  const { reload } = links;
  useEffect(() => {
    void reload();
  }, [reload]);

  const stash = target === "vault" ? null : (stashCtx.stashes.find((s) => s.id === target) ?? null);
  // A stash that is not (or no longer) the caller's -- an unknown id in the
  // route, a stash deleted meanwhile: the window shows the vault link.
  // The stash list failed to load: the stash can't be named, so the same.
  if (target !== "vault" && (stashCtx.ready ? !stash : stashCtx.failed)) setTarget("vault");
  const share: ShareRecord | null =
    target === "vault" ? links.vault : links.forStash(target as number);
  const stashName =
    target === "vault"
      ? null
      : (stash?.name ?? links.links.find((l) => l.target === target)?.label ?? "");

  const [name, setName] = useState("");
  const [prefilled, setPrefilled] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [stashDraft, setStashDraft] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"rotate" | "revoke" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  // Where focus goes after a shape change: Rename stash after its edit ends,
  // the title after a links-list swap, the share-name field after a revoke.
  const [focusTo, setFocusTo] = useState<"rename" | "title" | "name" | null>(null);
  const renameRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focusTo) return;
    const el =
      focusTo === "rename"
        ? renameRef.current
        : focusTo === "title"
          ? titleRef.current
          : nameRef.current;
    if (el) {
      el.focus();
      setFocusTo(null);
    }
  }, [focusTo, target, links.ready, stashDraft, renaming]);

  // A new link shown (another target, a create, a revoke, the first read):
  // the window starts that link's shape afresh. A stash's create field is
  // filled in from the vault link's share name when there is one.
  const shapeKey = `${target}|${share ? share.id : "create"}|${links.ready ? 1 : 0}`;
  const [seenKey, setSeenKey] = useState<string | null>(null);
  if (seenKey !== shapeKey) {
    setSeenKey(shapeKey);
    const fill = share ? share.name : target === "vault" ? "" : (links.vault?.name ?? "");
    setName(fill);
    setPrefilled(!share && target !== "vault" && fill !== "");
    setRenaming(false);
    setStashDraft(null);
    setConfirmAction(null);
    setActionError(null);
    setCopied(false);
  }

  const busy = submitting || meta.busy;
  // Escape ends an in-place rename first; the next Escape closes the window.
  const escape = () => {
    if (stashDraft != null) {
      meta.clearError();
      setStashDraft(null);
      setFocusTo("rename");
    } else if (renaming) {
      setRenaming(false);
      setFocusTo("rename");
    } else onClose();
  };
  useModalDismiss(escape, { enabled: !busy });

  const showTarget = (t: LinkTarget) => {
    setNotice(null);
    setTarget(t);
    setFocusTo("title");
  };

  const later = (fn: () => void) => {
    timers.current.push(window.setTimeout(fn, COPIED_MS));
  };

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setActionError(null);
    setNotice(null);
    setSubmitting(true);
    const session = links.session();
    try {
      const created = await createShare(
        trimmed,
        target === "vault" ? undefined : (target as number)
      );
      links.put(created, session);
      void links.refresh(session);
      capture("share_created", { what: target === "vault" ? "vault" : "stash" });
    } catch (err) {
      const code = err instanceof ShareApiError ? err.code : "unknown";
      if (code === "stash_not_found") {
        // Deleted elsewhere: re-read both lists; the window falls back to the
        // vault link and says why.
        setNotice(SHARE_COPY.stashGone);
        void stashCtx.refresh();
        void links.refresh(session);
      } else if (code === "active_share_exists") {
        // A link made elsewhere: re-read, and the window shows it -- the
        // notice outlives that shape change.
        setNotice(target === "vault" ? (err as Error).message : SHARE_COPY.stashHasLink);
        void links.refresh(session);
      } else {
        setActionError("Something went wrong creating your share. Please try again.");
      }
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
    const session = links.session();
    try {
      const updated = await renameShare(share.id, trimmed);
      links.put(updated, session);
      setName(updated.name);
      setRenaming(false);
      setFocusTo("rename");
    } catch {
      setActionError("Something went wrong renaming your share. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStashRename(e: FormEvent) {
    e.preventDefault();
    if (!stash || stashDraft == null || !meta.canSubmit(stashDraft)) return;
    // useStashMeta.save: the Stashes page's rules and copy (duplicate name
    // inline on the field), then the stash list and the links re-read.
    if (await meta.save(stash.id, stashDraft, stash.description ?? "")) {
      setStashDraft(null);
      setFocusTo("rename");
    }
  }

  async function handleRotate() {
    if (!share) return;
    setActionError(null);
    setNotice(null);
    setSubmitting(true);
    const session = links.session();
    try {
      const rotated = await rotateShare(share.id);
      links.put(rotated, session);
      void links.refresh(session);
      setConfirmAction(null);
    } catch (err) {
      // Revoked elsewhere (404): say so; the re-read turns the window to
      // Create and the notice stays. Anything else: the error, and re-read.
      if (err instanceof ApiError && err.status === 404) setNotice(SHARE_COPY.alreadyRevoked);
      else setActionError("Something went wrong making a new link. Please try again.");
      void links.refresh(session);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke() {
    if (!share) return;
    setActionError(null);
    setNotice(null);
    setSubmitting(true);
    const session = links.session();
    try {
      await revokeShare(share.id);
      // The window returns to Create for the same target, on the name field.
      links.drop(share.id, session);
      void links.refresh(session);
      setFocusTo("name");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotice(SHARE_COPY.alreadyRevoked);
      else setActionError("Something went wrong revoking your share. Please try again.");
      void links.refresh(session);
    } finally {
      setSubmitting(false);
    }
  }

  async function copyText(link: ShareRecord): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(linkUrl(link));
      return true;
    } catch {
      setActionError("Couldn't copy the link -- select and copy it manually.");
      return false;
    }
  }

  async function handleCopy() {
    if (!share) return;
    if (await copyText(share)) {
      setCopied(true);
      later(() => setCopied(false));
    }
  }

  async function handleListCopy(l: OwnerLink) {
    if (await copyText(l.share)) {
      setCopiedId(l.share.id);
      later(() => setCopiedId((c) => (c === l.share.id ? null : c)));
    }
  }

  const close = busy ? undefined : onClose;
  const title = SHARE_COPY.title(stashName);
  const loading =
    (!links.ready && !links.failed) || (target !== "vault" && !stashCtx.ready && !stashCtx.failed);
  const showList =
    share != null &&
    confirmAction === null &&
    !renaming &&
    stashDraft == null &&
    links.links.length > 1;

  return (
    <div className="auth-modal-overlay modal-overlay" onClick={close}>
      <div
        className="auth-modal-card share-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        {!busy && (
          <button type="button" className="auth-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}

        <h2 className="auth-card__subtitle share-modal__title" ref={titleRef} tabIndex={-1}>
          {title}
        </h2>

        {notice && <p className="auth-error">{notice}</p>}

        {loading && <p className="auth-success">Loading…</p>}

        {links.failed && (
          <p className="auth-error">
            {LOAD_FAILED}{" "}
            <button
              type="button"
              className="share-modal__rename-link"
              onClick={() => void reload()}
            >
              Try again
            </button>
          </p>
        )}

        {/* Create -- no live link for this target yet. */}
        {links.ready && !loading && !share && (
          <form className="auth-form" onSubmit={handleCreate}>
            <p className="auth-success share-modal__lead">{SHARE_COPY.create(stashName)}</p>
            <div className="auth-field">
              <span className="share-modal__labelrow">
                <label className="auth-field__label" htmlFor="share-modal-name">
                  Share name
                </label>
                <span className="share-modal__count" aria-hidden="true">
                  {name.length}/{NAME_MAX_LENGTH}
                </span>
              </span>
              <input
                ref={nameRef}
                id="share-modal-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={NAME_MAX_LENGTH}
                placeholder="e.g. Bobs big vault"
                autoComplete="off"
                disabled={submitting}
                required
              />
            </div>
            {stashName != null ? (
              <p className="share-modal__hint">
                {prefilled ? `${SHARE_COPY.prefilled} ` : null}
                {name.trim() ? (
                  <>
                    Viewers see{" "}
                    <span className="share-modal__hint-strong">
                      {name.trim()} · {stashName}
                    </span>
                    .{" "}
                  </>
                ) : null}
                {SHARE_COPY.fixed}
              </p>
            ) : null}

            {actionError && <p className="auth-error">{actionError}</p>}

            <div className="auth-modal-actions">
              <button type="button" className="auth-cancel" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className="auth-submit" disabled={submitting || !name.trim()}>
                {submitting ? "Please wait…" : "Create share"}
              </button>
            </div>
          </form>
        )}

        {/* Link -- the live link for this target. */}
        {links.ready && !loading && share && confirmAction === null && (
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
                      setFocusTo("rename");
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
            ) : stashDraft != null && stash ? (
              <form className="auth-form share-modal__stashform" onSubmit={handleStashRename}>
                <StashNameFields
                  idPrefix="share-stash"
                  name={stashDraft}
                  description=""
                  onName={(v) => {
                    setStashDraft(v);
                    if (meta.error) meta.clearError();
                  }}
                  onDescription={() => {}}
                  error={meta.error}
                  nameOnly
                />
                <MetaErrorLine error={meta.error} />
                <div className="auth-modal-actions">
                  <button
                    type="button"
                    className="auth-cancel"
                    onClick={() => {
                      meta.clearError();
                      setStashDraft(null);
                      setFocusTo("rename");
                    }}
                    disabled={meta.busy}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="auth-submit"
                    disabled={!meta.canSubmit(stashDraft)}
                  >
                    {meta.busy ? "Please wait…" : "Save"}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p className="share-modal__name">
                  <span className="share-modal__names">
                    <span className="share-modal__sharename">{share.name}</span>
                    {stashName != null ? (
                      <span className="share-modal__stashname">· {stashName}</span>
                    ) : null}
                  </span>
                  {stashName == null ? (
                    <button
                      ref={renameRef}
                      type="button"
                      className="share-modal__rename-link"
                      onClick={() => setRenaming(true)}
                    >
                      Rename
                    </button>
                  ) : stash ? (
                    <button
                      ref={renameRef}
                      type="button"
                      className="share-modal__rename-link"
                      onClick={() => {
                        meta.clearError();
                        setStashDraft(stash.name);
                      }}
                    >
                      Rename stash
                    </button>
                  ) : null}
                </p>

                <div className="share-modal__link-row">
                  <input
                    className="share-modal__link-input"
                    type="text"
                    readOnly
                    aria-label="Share link"
                    value={linkUrl(share)}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button type="button" className="auth-submit" onClick={handleCopy}>
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>

                <p className="share-modal__hint">{SHARE_COPY.note(stashName)}</p>

                <div className="auth-modal-actions">
                  <button
                    type="button"
                    className="auth-cancel"
                    onClick={() => setConfirmAction("rotate")}
                    disabled={submitting}
                  >
                    New link
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

            {showList ? (
              <LinksList
                links={links.links}
                target={target}
                copiedId={copiedId}
                onShow={showTarget}
                onCopy={(l) => void handleListCopy(l)}
              />
            ) : null}
          </div>
        )}

        {/* Confirm -- New link kills the old link at once (POST
            /api/shares/{id}/rotate), Revoke kills it for good; both say so. */}
        {links.ready && !loading && share && confirmAction !== null && (
          <div className="auth-form">
            <p className="auth-danger-warning">
              {confirmAction === "rotate" ? SHARE_COPY.rotate : SHARE_COPY.revoke(stashName)}
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
                onClick={confirmAction === "rotate" ? handleRotate : handleRevoke}
                disabled={submitting}
              >
                {submitting ? "Please wait…" : confirmAction === "rotate" ? "New link" : "Revoke"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
