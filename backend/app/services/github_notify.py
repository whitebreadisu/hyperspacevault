"""Best-effort GitHub-issue notification for a feedback submission,
created AFTER the feedback DB write already committed -- a failure here
must never turn a persisted submission into an error response. Every
failure mode (missing/placeholder token, network error, GitHub 4xx/5xx) is
caught here and logged, never re-raised; the PAT and the exception detail
never leave this module. Only the production environment notifies; every
other ENVIRONMENT value (and an unset one) skips the notification while the
submission still succeeds. See app/services/feedback.py's submit_feedback,
the only caller.
"""

import logging
import os

import httpx

logger = logging.getLogger("app.feedback")

GITHUB_API_BASE = "https://api.github.com"

# A private repo created by hand outside Terraform; the env var
# (terraform/modules/app/cloud_run.tf) overrides this default per
# environment, and every environment points at the same single repo.
DEFAULT_FEEDBACK_REPO = "whitebreadisu/swu-feedback"

# terraform/modules/app/secrets.tf provisions a placeholder secret version
# so Cloud Run can deploy before the real PAT is added out-of-band (see
# that file's comments) -- treating the placeholder as "no token
# configured" means a fresh environment's feedback submissions still
# succeed (DB write + best-effort notification skip) instead of every
# submission spending a network round trip on a request GitHub will always
# reject.
_PLACEHOLDER_TOKEN = "PLACEHOLDER_ROTATE_ME"

# Terraform sets ENVIRONMENT per environment (terraform/modules/app/cloud_run.tf):
# "production" on prod, "development" on dev. Only the production value
# notifies, so a new or misconfigured environment fails closed.
_NOTIFYING_ENVIRONMENT = "production"
_ENVIRONMENT_LABELS = {"production": "prod", "development": "dev"}

_TITLE_MAX_LENGTH = 60
_REQUEST_TIMEOUT_SECONDS = 10.0


def _issue_title(message: str) -> str:
    stripped = " ".join(message.strip().split())
    if len(stripped) <= _TITLE_MAX_LENGTH:
        return stripped or "(no message)"
    return stripped[: _TITLE_MAX_LENGTH - 1].rstrip() + "…"


def _environment_label() -> str:
    raw = os.environ.get("ENVIRONMENT")
    if not raw:
        return "unknown"
    return _ENVIRONMENT_LABELS.get(raw, raw)


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
        f"Environment: {_environment_label()}",
        f"Commit: {commit_sha or 'unknown'}",
        f"Submitted: {created_at}",
    ]
    # contact_email is only ever non-None here when consent was given
    # (submit_feedback applies the consent rule before calling notify) --
    # included verbatim, never inferred.
    if contact_email:
        lines.append(f"Contact: {contact_email}")
    # @mention the repo owner so the notification email rides GitHub's
    # Participating channel: Watching-class emails (bot-authored issue
    # creation alone) do not reliably deliver even with Watching->Email set,
    # while a mention-class email does. The owner handle is derived from the
    # configured repo (owner/name), so it needs no extra configuration
    # (App Spec §5.9).
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
    FEEDBACK_GITHUB_REPO); the notification is skipped, with no network
    call, unless ENVIRONMENT is "production"."""
    if os.environ.get("ENVIRONMENT") != _NOTIFYING_ENVIRONMENT:
        logger.info(
            "feedback github notification skipped: environment is not production"
        )
        return

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
    except Exception:  # noqa: BLE001 -- best-effort by design (App Spec §12)
        logger.warning("feedback github notification failed", exc_info=True)
