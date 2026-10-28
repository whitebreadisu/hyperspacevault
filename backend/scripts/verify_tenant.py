"""BL-279 WS-3 W3-05: ensure the verification identities exist in Firebase Auth.

Usage (Application Default Credentials; the caller is the owner/orchestrator):

    python scripts/verify_tenant.py --env dev [--dry-run] [--purge-j1]
    python scripts/verify_tenant.py --env prod

Passwords come from environment variables only and are never printed:
VERIFY_PASSWORD (tenant A), VERIFY_B_PASSWORD (dev tenant B) and
VERIFY_UNVERIFIED_PASSWORD (dev unverified identity). A missing variable for a
required identity exits 2 naming the variable.

Per identity: absent -> create; present -> update the password and
email_verified to the listed value (so a rerun rotates the password).
--purge-j1 (dev only) deletes users whose email starts with
``jeremy.braden+hsv-j1-`` and that were created more than one hour ago (the
J1 sign-up journey leaves these behind when it fails before deleting itself).

The module imports without network: the Admin SDK app is initialised inside
``main()``.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import dataclass
from typing import Sequence

import firebase_admin
from firebase_admin import auth, credentials

PROJECTS = {"dev": "swu-dev-jbapps", "prod": "swu-prod"}
J1_EMAIL_PREFIX = "jeremy.braden+hsv-j1-"
J1_MAX_AGE_SECONDS = 3600


@dataclass(frozen=True)
class Identity:
    role: str
    email: str
    env_name: str
    email_verified: bool


IDENTITIES: dict[str, list[Identity]] = {
    "dev": [
        Identity(
            "A", "jeremy.braden+hsv-verify-dev@gmail.com", "VERIFY_PASSWORD", True
        ),
        Identity(
            "B",
            "jeremy.braden+hsv-verify-dev-b@gmail.com",
            "VERIFY_B_PASSWORD",
            True,
        ),
        Identity(
            "unverified",
            "jeremy.braden+hsv-verify-dev-unverified@gmail.com",
            "VERIFY_UNVERIFIED_PASSWORD",
            False,
        ),
    ],
    "prod": [
        Identity(
            "A", "jeremy.braden+hsv-verify-prod@gmail.com", "VERIFY_PASSWORD", True
        ),
    ],
}


def ensure_identity(
    identity: Identity, password: str, dry_run: bool
) -> tuple[str, str]:
    """Create or update one identity. Returns (uid, status) where status is
    created | updated | unchanged. Never logs the password."""
    try:
        user = auth.get_user_by_email(identity.email)
    except auth.UserNotFoundError:
        if dry_run:
            return "-", "created"
        created = auth.create_user(
            email=identity.email,
            password=password,
            email_verified=identity.email_verified,
            disabled=False,
        )
        return created.uid, "created"

    if dry_run:
        # Only the password could differ when the flags already match.
        drifted = bool(user.email_verified) != identity.email_verified or user.disabled
        return user.uid, "updated" if drifted else "unchanged"
    auth.update_user(
        user.uid,
        password=password,
        email_verified=identity.email_verified,
        disabled=False,
    )
    return user.uid, "updated"


def purge_j1(now_seconds: float, dry_run: bool = False) -> int:
    """Delete J1 sign-up users older than one hour. Returns the count."""
    cutoff_ms = (now_seconds - J1_MAX_AGE_SECONDS) * 1000
    count = 0
    for user in auth.list_users().iterate_all():
        email = (user.email or "").lower()
        if not email.startswith(J1_EMAIL_PREFIX):
            continue
        created_ms = user.user_metadata.creation_timestamp
        if created_ms is None or created_ms >= cutoff_ms:
            continue
        if not dry_run:
            auth.delete_user(user.uid)
        count += 1
    return count


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument("--env", choices=sorted(PROJECTS), required=True)
    parser.add_argument("--purge-j1", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    if args.purge_j1 and args.env != "dev":
        print("--purge-j1 is dev only", file=sys.stderr)
        return 2

    identities = IDENTITIES[args.env]
    for identity in identities:
        if not os.environ.get(identity.env_name):
            print(
                f"missing environment variable {identity.env_name}",
                file=sys.stderr,
            )
            return 2

    firebase_admin.initialize_app(
        credentials.ApplicationDefault(), {"projectId": PROJECTS[args.env]}
    )

    for identity in identities:
        uid, status = ensure_identity(
            identity, os.environ[identity.env_name], args.dry_run
        )
        print(f"{identity.role} {identity.email} {uid} {status}")

    if args.purge_j1:
        print(f"purged j1 users: {purge_j1(time.time(), args.dry_run)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
