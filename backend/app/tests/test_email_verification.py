"""
BL-16: email verification gate on inventory mutations.

Decision (SWU_Backlog.md, 2026-06-20, Open Question D): verification is
enforced via sendEmailVerification() on the frontend plus a backend
require_verified_email dependency gating inventory mutations only. Reads,
catalog endpoints, and DELETE /api/account (BL-87) are deliberately never
gated -- see the module docstring on app.auth.require_verified_email for the
full rationale (an unverified user must still be able to delete their own
account).

Two groups of tests:
- TestVerifyFirebaseTokenEmailVerifiedClaim / TestRequireVerifiedEmailUnit:
  pure unit tests, no DB required -- exercise verify_firebase_token's
  email_verified extraction (incl. the "claim entirely absent" case) and
  require_verified_email's 403 behavior directly, without going through
  FastAPI's dependency-injection machinery.
- TestInventoryMutationGateIntegration / TestUngatedRoutesIntegration:
  integration tests through make_client's dependency-override identity
  (email_verified as its third element), exercising the gate as actually
  wired onto the increment/decrement routes. Matches the pattern
  test_inventory_api.py and test_account_deletion.py already use.

Run inside the backend container:
    docker compose exec backend pytest app/tests/test_email_verification.py -v
"""

import os

import pytest
from fastapi import HTTPException


class TestVerifyFirebaseTokenEmailVerifiedClaim:
    """No DB required -- mocks firebase_admin.auth.verify_id_token directly
    so verify_firebase_token's email_verified extraction can be exercised
    without a real Firebase Admin app or a real ID token."""

    def _patch_decoded_token(self, monkeypatch, decoded: dict):
        import app.auth as auth_module

        monkeypatch.setattr(auth_module, "_get_firebase_app", lambda: object())
        monkeypatch.setattr(
            auth_module.auth,
            "verify_id_token",
            lambda token, app=None: decoded,
        )

    def test_true_claim_passes_through(self, monkeypatch):
        from app.auth import verify_firebase_token

        self._patch_decoded_token(
            monkeypatch,
            {"uid": "u1", "email": "a@b.com", "email_verified": True},
        )
        assert verify_firebase_token("Bearer faketoken") == ("u1", "a@b.com", True)

    def test_false_claim_passes_through(self, monkeypatch):
        from app.auth import verify_firebase_token

        self._patch_decoded_token(
            monkeypatch,
            {"uid": "u1", "email": "a@b.com", "email_verified": False},
        )
        _, _, email_verified = verify_firebase_token("Bearer faketoken")
        assert email_verified is False

    def test_absent_claim_treated_as_unverified(self, monkeypatch):
        """The core BL-16 default-safe behavior: a decoded token with no
        email_verified key at all (not just an explicit False) must never be
        treated as verified."""
        from app.auth import verify_firebase_token

        self._patch_decoded_token(monkeypatch, {"uid": "u1", "email": "a@b.com"})
        _, _, email_verified = verify_firebase_token("Bearer faketoken")
        assert email_verified is False


class TestRequireVerifiedEmailUnit:
    """Drives the dependency function directly (no FastAPI wiring) -- the
    quickest way to pin its 403 + machine-readable-detail contract."""

    def test_raises_403_email_not_verified_when_false(self):
        from app.auth import require_verified_email

        with pytest.raises(HTTPException) as exc_info:
            require_verified_email(identity=("u1", "a@b.com", False))
        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == "email_not_verified"

    def test_passes_silently_when_true(self):
        from app.auth import require_verified_email

        assert require_verified_email(identity=("u1", "a@b.com", True)) is None


class TestInventoryMutationGateIntegration:
    pytestmark = pytest.mark.skipif(
        "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
        reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
    )

    def test_increment_returns_403_for_unverified_caller(self, make_client, db):
        from .conftest import delete_provisioned_identity

        uid = "test-bl16-unverified-inc"
        unverified = make_client(uid, "bl16-unverified-inc@example.com", False)
        try:
            # any catalog variant id works -- the 403 fires before the body
            variant_id = unverified.get("/api/base-cards").json()[0]["variants"][0][
                "variant_id"
            ]

            response = unverified.post(f"/api/inventory/{variant_id}/increment")
            assert response.status_code == 403
            assert response.json()["detail"] == "email_not_verified"
        finally:
            delete_provisioned_identity(db, uid)

    def test_decrement_returns_403_for_unverified_caller(self, make_client, db):
        from .conftest import delete_provisioned_identity

        uid = "test-bl16-unverified-dec"
        unverified = make_client(uid, "bl16-unverified-dec@example.com", False)
        try:
            variant_id = unverified.get("/api/base-cards").json()[0]["variants"][0][
                "variant_id"
            ]

            response = unverified.post(f"/api/inventory/{variant_id}/decrement")
            assert response.status_code == 403
            assert response.json()["detail"] == "email_not_verified"
        finally:
            delete_provisioned_identity(db, uid)

    def test_increment_succeeds_for_verified_caller(self, client):
        """The `client` fixture (conftest) defaults email_verified=True --
        this is the regression guard that the gate doesn't accidentally
        block the caller it's supposed to let through."""
        from .conftest import merged_inventory

        records = merged_inventory(client)
        zero_card = next(r for r in records if r["quantity"] == 0)
        variant_id = zero_card["id"]

        response = client.post(f"/api/inventory/{variant_id}/increment")
        assert response.status_code == 200
        assert response.json()["quantity"] == zero_card["quantity"] + 1

        client.post(f"/api/inventory/{variant_id}/decrement")  # restore

    def test_decrement_succeeds_for_verified_caller(self, make_client, db):
        from .conftest import delete_provisioned_identity

        uid = "test-bl16-verified-dec"
        verified = make_client(uid, "bl16-verified-dec@example.com", True)
        try:
            variant_id = verified.get("/api/base-cards").json()[0]["variants"][0][
                "variant_id"
            ]
            verified.post(f"/api/inventory/{variant_id}/increment")

            response = verified.post(f"/api/inventory/{variant_id}/decrement")
            assert response.status_code == 200
            assert response.json()["quantity"] == 0
        finally:
            delete_provisioned_identity(db, uid)


class TestUngatedRoutesIntegration:
    """BL-16 scope boundary: verification status must never affect reads or
    DELETE /api/account, only the two mutation routes above."""

    pytestmark = pytest.mark.skipif(
        "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
        reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
    )

    def test_list_quantities_unaffected_by_verification_status(self, make_client, db):
        """PORTED for BL-102: GET /api/inventory retired; the ungated
        authenticated-read property now lives on its replacement,
        GET /api/inventory/quantities (BL-101)."""
        from .conftest import delete_provisioned_identity

        uid = "test-bl16-unverified-read"
        unverified = make_client(uid, "bl16-unverified-read@example.com", False)
        try:
            response = unverified.get("/api/inventory/quantities")
            assert response.status_code == 200
            assert isinstance(response.json(), list)
        finally:
            delete_provisioned_identity(db, uid)

    def test_delete_account_unaffected_by_verification_status(self, make_client, db):
        """An unverified caller must still be able to delete their own
        account -- gating this would strand it (see require_verified_email's
        docstring / the DELETE /api/account router comment)."""
        from sqlalchemy import text

        # BL-88: DELETE /api/account also carries require_recent_auth, which
        # independently re-decodes the raw Authorization header rather than
        # going through make_client's get_current_identity override -- this
        # test isn't exercising that gate (see test_account_deletion.py's
        # TestRequireRecentAuth* classes for that), so bypass it the same
        # way make_client bypasses the real Firebase decode.
        from app.auth import require_recent_auth
        from app.main import app as fastapi_app

        uid, email = "test-bl16-unverified-delete", "bl16-unverified-delete@example.com"
        unverified = make_client(uid, email, False)
        # Auto-provisions this uid's tenant on first authenticated call.
        unverified.get("/api/inventory/quantities")

        fastapi_app.dependency_overrides[require_recent_auth] = lambda: None
        try:
            response = unverified.delete("/api/account")
        finally:
            fastapi_app.dependency_overrides.pop(require_recent_auth, None)
        assert response.status_code == 204

        db.rollback()
        leftover = db.execute(
            text("SELECT COUNT(*) FROM users WHERE firebase_uid = :uid"),
            {"uid": uid},
        ).scalar()
        assert leftover == 0
