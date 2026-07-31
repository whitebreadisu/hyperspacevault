"""BL-126 owner decisions #1/#2: best-effort GitHub-issue notification for
a feedback submission, created AFTER the feedback DB write already
committed -- a failure here must never turn a persisted submission into an
error response. Every failure mode (missing/placeholder token, network
error, GitHub 4xx/5xx) is caught here and logged, never re-raised; the PAT
and the exception detail never leave this module. See
app/services/feedback.py's submit_feedback, the only caller.
"""

import logging
import os

import httpx

logger = logging.getLogger("app.feedback")

GITHUB_API_BASE = "https://api.github.com"

# Owner decision (issue #289): Jeremy creates this private repo manually;
# the env var (terraform/modules/app/cloud_run.tf) overrides this default
# per environment, but every environment is expected to point at the same
# single private repo for now.
DEFAULT_FEEDBACK_REPO = "whitebreadisu/swu-feedback"

# terraform/modules/app/secrets.tf provisions a placeholder secret version
# so Cloud Run can deploy before Jeremy adds the real PAT out-of-band (see
# that file's docstring) -- treating the placeholder as "no token
# configured" means a fresh environment's feedback submissions still
# succeed (DB write + best-effort notification skip) instead of every
# submission spending a network round trip on a request GitHub will always
# reject.
_PLACEHOLDER_TOKEN = "PLACEHOLDER_ROTATE_ME"

_TITLE_MAX_LENGTH = 60
_REQUEST_TIMEOUT_SECONDS = 10.0


def _issue_title(message: str) -> str:
    stripped = " ".join(message.strip().split())
    if len(stripped) <= _TITLE_MAX_LENGTH:
        return stripped or "(no message)"
    return stripped[: _TITLE_MAX_LENGTH - 1].rstrip() + "…"


def _issue_body(
    message: str,
    commit_sha: str | None,
    created_at: str,
    contact_email: str | None,
    repo: str,
) -> str:
    lines = [
        message,
        "",
        "---",
        f"Commit: {commit_sha or 'unknown'}",
        f"Submitted: {created_at}",
    ]
    # contact_email is only ever non-None here when consent was given (the
    # service layer has already applied decision #3 before calling this
    # function) -- included verbatim, never inferred.
    if contact_email:
        lines.append(f"Contact: {contact_email}")
    # BL-128: @mention the repo owner so the notification email rides the
    # Participating channel. Watching-class emails (bot-authored issue
    # creation alone) were verified NOT delivering on 2026-07-31 despite
    # the owner's Watching->Email setting; a mention-class email delivered
    # within minutes in the same test. The owner handle is derived from the
    # already-configured repo (owner/name), so no new configuration.
    owner = repo.split("/", 1)[0]
    if owner:
        lines.append(f"cc @{owner}")
    return "\n".join(lines)


def notify(
    *,
    message: str,
    commit_sha: str | None,
    created_at: str,
    contact_email: str | None,
) -> None:
    """Creates one GitHub issue for this submission. Always returns None;
    never raises. token/repo come from env (FEEDBACK_GITHUB_PAT /
    FEEDBACK_GITHUB_REPO)."""
    token = os.environ.get("FEEDBACK_GITHUB_PAT")
    repo = os.environ.get("FEEDBACK_GITHUB_REPO") or DEFAULT_FEEDBACK_REPO

    if not token or token == _PLACEHOLDER_TOKEN:
        logger.info("feedback github notification skipped: no PAT configured")
        return

    try:
        with httpx.Client(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
            response = client.post(
                f"{GITHUB_API_BASE}/repos/{repo}/issues",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/vnd.github+json",
                },
                json={
                    "title": _issue_title(message),
                    "body": _issue_body(
                        message, commit_sha, created_at, contact_email, repo
                    ),
                },
            )
            response.raise_for_status()
    except Exception:  # noqa: BLE001 -- best-effort by design (decision #1/#2)
        logger.warning("feedback github notification failed", exc_info=True)
