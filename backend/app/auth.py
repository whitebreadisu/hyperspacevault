import time
from typing import Optional

import firebase_admin
from fastapi import Depends, Header, HTTPException
from firebase_admin import auth, credentials, exceptions

_firebase_app: Optional[firebase_admin.App] = None

# BL-88: Firebase's standard "sensitive operation" recency window -- a
# token's auth_time claim must be within this many seconds of "now" to
# satisfy require_recent_auth.
RECENT_AUTH_WINDOW_SECONDS = 5 * 60


def _get_firebase_app() -> firebase_admin.App:
    """Lazily initialize the Firebase Admin app using Application Default
    Credentials. On Cloud Run this is the runtime service account's identity
    automatically -- no Secret Manager entry needed. Never called during
    tests, which override get_current_identity directly."""
    global _firebase_app
    if _firebase_app is None:
        _firebase_app = firebase_admin.initialize_app(credentials.ApplicationDefault())
    return _firebase_app


def _decode_token(authorization: Optional[str]) -> dict:
    """Verify a 'Bearer <Firebase ID token>' Authorization header and
    return the raw decoded claims dict.

    Raises HTTPException(401) if the header is missing or the token
    doesn't verify. Shared by verify_firebase_token (which projects it down
    to the (uid, email, email_verified) tuple most routes use) and
    require_recent_auth (BL-88, which needs the raw `auth_time` claim that
    tuple doesn't carry) so both keep one definition of "missing/invalid
    Authorization header" and "invalid or expired token".
    """
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401, detail="Missing or invalid Authorization header"
        )

    token = authorization.removeprefix("Bearer ")
    try:
        return auth.verify_id_token(token, app=_get_firebase_app())
    except (ValueError, exceptions.FirebaseError):
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def verify_firebase_token(authorization: Optional[str]) -> tuple[str, str, bool]:
    """Verify a 'Bearer <Firebase ID token>' Authorization header.

    Returns (firebase_uid, email, email_verified). Raises HTTPException(401)
    if the header is missing or the token doesn't verify. email_verified
    (BL-16) comes straight off the decoded token's `email_verified` claim --
    absent is treated as False (unverified), never as True.
    """
    decoded = _decode_token(authorization)
    return (
        decoded["uid"],
        decoded.get("email", ""),
        bool(decoded.get("email_verified", False)),
    )


def get_current_identity(
    authorization: Optional[str] = Header(default=None),
) -> tuple[str, str, bool]:
    """FastAPI dependency: the verified (firebase_uid, email, email_verified)
    of the caller.

    Tests override this dependency via app.dependency_overrides, so the real
    Firebase Admin app is never initialized outside a deployment.
    """
    return verify_firebase_token(authorization)


def get_optional_identity(
    authorization: Optional[str] = Header(default=None),
) -> Optional[tuple[str, str, bool]]:
    """FastAPI dependency: like get_current_identity, but a *missing*
    Authorization header resolves to None (anonymous) instead of raising
    401.

    BL-56 / ADR-0008: GET /api/base-cards/{id} is optional-auth, not
    strictly tenant-less -- an authenticated caller must still see real
    per-tenant quantities, so it can't hang off the same dependency as the
    fully public /api/cards and /api/sets reads.

    A *present but invalid/expired* token still raises 401 via
    verify_firebase_token -- only a missing header downgrades to anonymous;
    a bad token is never silently treated as "no token".

    Tests override this dependency via app.dependency_overrides, exactly
    like get_current_identity.
    """
    if authorization is None:
        return None
    return verify_firebase_token(authorization)


def require_verified_email(
    identity: tuple[str, str, bool] = Depends(get_current_identity),
) -> None:
    """FastAPI dependency: gates a route on the caller's Firebase-verified
    email (BL-16 -- decided 2026-06-20, implemented at v1.0).

    Depends on get_current_identity rather than re-decoding the token, so a
    route that also depends on get_db (which itself depends on
    get_current_identity) still only verifies the token once per request --
    FastAPI caches a dependency's result per callable for the life of the
    request and reuses it across every dependent that asks for it.

    Rejects with 403, not 401: the caller IS authenticated (the token
    verified fine); they just haven't confirmed their email yet. The detail
    is a machine-readable string ("email_not_verified") rather than prose,
    so the frontend can map it to the verify-email banner instead of
    treating it as a generic auth failure. A missing/absent email_verified
    claim is treated as unverified (verify_firebase_token already defaults
    it to False), never as an implicit pass.

    Scope (BL-16, as widened by BL-54 S1's P9): applied to the inventory-
    mutating routes (increment/decrement) AND, since BL-54, to
    GET /api/inventory/export -- the import/export definition package's P9
    decision gates "the whole surface" (import and export together), not
    just mutations, so export carries this dependency despite being a read.
    Still never applied to other reads, catalog endpoints, or
    DELETE /api/account -- an unverified user must still be able to browse
    and delete their own account, since gating account deletion would
    strand it.
    """
    _, _, email_verified = identity
    if not email_verified:
        raise HTTPException(status_code=403, detail="email_not_verified")


def require_recent_auth(
    authorization: Optional[str] = Header(default=None),
) -> None:
    """FastAPI dependency: gates a destructive route on the caller having
    reauthenticated within the last RECENT_AUTH_WINDOW_SECONDS (BL-88) --
    Firebase's standard "sensitive operation" window, matching the
    password/Google reauth DeleteAccountModal already performs client-side
    before calling DELETE /api/account. Without this, a stolen-but-valid ID
    token could hit the purge endpoint directly, skipping that client-side
    gate entirely -- see BL-88's backlog entry (spawned from BL-87's
    security review) for the full threat-model writeup.

    Independently re-decodes the token via _decode_token rather than
    depending on get_current_identity: that dependency's (uid, email,
    email_verified) tuple shape is relied on across the whole app, and
    widening it to also carry auth_time is out of this item's scope.
    verify_id_token is a local JWT/JWKS check, not a network round trip, so
    a route that also depends on get_db (itself -> get_current_identity)
    paying for a second decode of the same token is cheap -- correctness
    of the recency check matters more here than shaving one local decode.

    A missing `auth_time` claim is treated as stale, never as an implicit
    pass -- the same default-safe posture verify_firebase_token already
    applies to a missing `email_verified` claim.

    Rejects with 401, not 403: the caller isn't unauthorized, their
    credential is just too old for this operation -- same status family as
    every other token-freshness failure in this module. The detail is a
    machine-readable dict, {"code": "recent-auth-required"}, distinct from
    the plain-string details verify_firebase_token uses for missing/invalid
    tokens, so the frontend can tell "please reauthenticate" apart from a
    genuine auth failure and prompt the existing reauth flow instead of
    just failing.
    """
    decoded = _decode_token(authorization)
    auth_time = decoded.get("auth_time")
    if auth_time is None or (time.time() - auth_time) > RECENT_AUTH_WINDOW_SECONDS:
        raise HTTPException(status_code=401, detail={"code": "recent-auth-required"})
