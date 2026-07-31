"""Integration tests for POST /api/feedback (BL-126, issue #289).

Covers: anonymous vs. signed-in submission, the consent semantics that
decide whether identity linkage is stored at all (owner decision #3 --
the key regression is "signed-in WITHOUT consent stores nothing
identity-shaped"), the honeypot, the length/email 422s, the per-IP rate
limit, and the best-effort GitHub notification (mocked -- both the success
and failure paths must still leave the DB write and the 201 intact).

Run inside the backend container:
    docker compose exec backend pytest app/tests/test_feedback_api.py -v
"""

import os

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.services import github_notify

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
)


@pytest.fixture
def anon_client():
    """No dependency overrides -- exercises the real get_optional_db /
    get_optional_identity code paths exactly like an anonymous browser
    request (no Authorization header at all), mirroring
    test_catalog_anonymous_reads.py's anon_client fixture."""
    from app.main import app

    return TestClient(app)


def _feedback_row(db, message: str):
    db.rollback()
    return db.execute(
        text(
            "SELECT id, tenant_id, contact_ok, contact_email, commit_sha "
            "FROM feedback WHERE message = :message"
        ),
        {"message": message},
    ).first()


def _cleanup_feedback(db, message: str) -> None:
    db.rollback()
    db.execute(
        text("DELETE FROM feedback WHERE message = :message"), {"message": message}
    )
    db.commit()


class TestConsentSemantics:
    def test_anonymous_submit_stores_row_with_no_identity(self, anon_client, db):
        message = "BL-126 test: anonymous submit"
        try:
            response = anon_client.post(
                "/api/feedback", json={"message": message, "contact_ok": False}
            )
            assert response.status_code == 201

            row = _feedback_row(db, message)
            assert row is not None
            assert row.tenant_id is None
            assert row.contact_email is None
            assert row.contact_ok is False
        finally:
            _cleanup_feedback(db, message)

    def test_signed_in_without_consent_stores_no_uid_tenant_or_email(self, client, db):
        """THE key regression (owner decision #3): a signed-in caller who
        declines contact must produce a row indistinguishable, on identity
        grounds, from an anonymous one -- no tenant_id, no email -- even
        though the request carried a verified Firebase token and get_db
        resolved a real tenant for it."""
        message = "BL-126 test: signed-in no consent"
        try:
            response = client.post(
                "/api/feedback", json={"message": message, "contact_ok": False}
            )
            assert response.status_code == 201

            row = _feedback_row(db, message)
            assert row is not None
            assert row.tenant_id is None
            assert row.contact_email is None
        finally:
            _cleanup_feedback(db, message)

    def test_signed_in_with_consent_stores_email_and_tenant(self, client, db):
        message = "BL-126 test: signed-in with consent"
        try:
            response = client.post(
                "/api/feedback",
                json={
                    "message": message,
                    "contact_ok": True,
                    "contact_email": "bl126-consent@example.com",
                },
            )
            assert response.status_code == 201

            row = _feedback_row(db, message)
            assert row is not None
            assert row.tenant_id == 1  # DEFAULT_TEST_UID resolves to tenant #1
            assert row.contact_email == "bl126-consent@example.com"
            assert row.contact_ok is True
        finally:
            _cleanup_feedback(db, message)

    def test_anonymous_with_consent_stores_email_but_no_tenant(self, anon_client, db):
        """An anonymous caller has no tenant to attach even if they opt
        into contact -- only the email is stored."""
        message = "BL-126 test: anonymous with consent"
        try:
            response = anon_client.post(
                "/api/feedback",
                json={
                    "message": message,
                    "contact_ok": True,
                    "contact_email": "bl126-anon-consent@example.com",
                },
            )
            assert response.status_code == 201

            row = _feedback_row(db, message)
            assert row is not None
            assert row.tenant_id is None
            assert row.contact_email == "bl126-anon-consent@example.com"
        finally:
            _cleanup_feedback(db, message)


class TestHoneypotAndValidation:
    def test_honeypot_returns_success_but_stores_nothing(self, anon_client, db):
        message = "BL-126 test: honeypot bot"
        response = anon_client.post(
            "/api/feedback",
            json={
                "message": message,
                "contact_ok": False,
                "website": "http://spam.example",
            },
        )
        # Never tips off a bot that it was caught -- identical success shape.
        assert response.status_code == 201

        row = _feedback_row(db, message)
        assert row is None

    def test_message_length_cap_returns_422(self, anon_client):
        response = anon_client.post(
            "/api/feedback", json={"message": "x" * 5001, "contact_ok": False}
        )
        assert response.status_code == 422

    def test_missing_email_with_consent_returns_422(self, anon_client):
        response = anon_client.post(
            "/api/feedback", json={"message": "needs an email", "contact_ok": True}
        )
        assert response.status_code == 422

    def test_malformed_email_with_consent_returns_422(self, anon_client):
        response = anon_client.post(
            "/api/feedback",
            json={
                "message": "bad email format",
                "contact_ok": True,
                "contact_email": "not-an-email",
            },
        )
        assert response.status_code == 422

    def test_blank_message_returns_422(self, anon_client):
        response = anon_client.post(
            "/api/feedback", json={"message": "   ", "contact_ok": False}
        )
        assert response.status_code == 422


class TestRateLimit:
    def test_rate_limit_triggers_after_max_submissions(self, anon_client, db):
        from app.rate_limit import MAX_SUBMISSIONS_PER_WINDOW

        messages = [
            f"BL-126 rate limit test {i}" for i in range(MAX_SUBMISSIONS_PER_WINDOW)
        ]
        try:
            for message in messages:
                response = anon_client.post(
                    "/api/feedback", json={"message": message, "contact_ok": False}
                )
                assert response.status_code == 201

            limited = anon_client.post(
                "/api/feedback",
                json={
                    "message": "BL-126 rate limit test overflow",
                    "contact_ok": False,
                },
            )
            assert limited.status_code == 429

            overflow_row = _feedback_row(db, "BL-126 rate limit test overflow")
            assert overflow_row is None
        finally:
            for message in messages:
                _cleanup_feedback(db, message)


class _FakeResponse:
    def raise_for_status(self) -> None:
        return None


class _FakeSuccessClient:
    def __init__(self, *args, **kwargs):
        self.calls: list[dict] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def post(self, url, headers=None, json=None):
        self.calls.append({"url": url, "headers": headers, "json": json})
        return _FakeResponse()


class _FakeFailingClient:
    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def post(self, url, headers=None, json=None):
        raise httpx.ConnectError("simulated network failure")


class TestGithubNotification:
    def test_notification_success_still_stores_row_and_returns_201(
        self, anon_client, db, monkeypatch
    ):
        monkeypatch.setenv("FEEDBACK_GITHUB_PAT", "test-token")
        monkeypatch.setenv("FEEDBACK_GITHUB_REPO", "whitebreadisu/swu-feedback")
        fake_client_holder: dict = {}

        def _fake_client_factory(*args, **kwargs):
            fake = _FakeSuccessClient()
            fake_client_holder["instance"] = fake
            return fake

        monkeypatch.setattr(github_notify.httpx, "Client", _fake_client_factory)

        message = "BL-126 test: notification success"
        try:
            response = anon_client.post(
                "/api/feedback", json={"message": message, "contact_ok": False}
            )
            assert response.status_code == 201
            assert _feedback_row(db, message) is not None

            calls = fake_client_holder["instance"].calls
            assert len(calls) == 1
            assert calls[0]["url"].endswith("/repos/whitebreadisu/swu-feedback/issues")
            assert calls[0]["headers"]["Authorization"] == "Bearer test-token"
            assert message in calls[0]["json"]["body"]
            # BL-128: the body @mentions the repo owner so the notification
            # email rides the Participating channel (Watching-class emails
            # verified not delivering, 2026-07-31).
            assert calls[0]["json"]["body"].endswith("cc @whitebreadisu")
        finally:
            _cleanup_feedback(db, message)

    def test_notification_failure_still_returns_201_and_stores_row(
        self, anon_client, db, monkeypatch
    ):
        """The DB write already committed by the time the notification is
        attempted (decision #1) -- a network failure/4xx/5xx from GitHub
        must never surface as anything other than a normal success
        response, and the row must still be there."""
        monkeypatch.setenv("FEEDBACK_GITHUB_PAT", "test-token")
        monkeypatch.setattr(github_notify.httpx, "Client", _FakeFailingClient)

        message = "BL-126 test: notification failure"
        try:
            response = anon_client.post(
                "/api/feedback", json={"message": message, "contact_ok": False}
            )
            assert response.status_code == 201
            assert response.json() == {"status": "ok"}

            row = _feedback_row(db, message)
            assert row is not None
        finally:
            _cleanup_feedback(db, message)

    def test_missing_pat_skips_notification_without_error(
        self, anon_client, db, monkeypatch
    ):
        monkeypatch.delenv("FEEDBACK_GITHUB_PAT", raising=False)

        message = "BL-126 test: no pat configured"
        try:
            response = anon_client.post(
                "/api/feedback", json={"message": message, "contact_ok": False}
            )
            assert response.status_code == 201
            assert _feedback_row(db, message) is not None
        finally:
            _cleanup_feedback(db, message)

    def test_placeholder_pat_skips_notification_without_error(
        self, anon_client, db, monkeypatch
    ):
        monkeypatch.setenv("FEEDBACK_GITHUB_PAT", "PLACEHOLDER_ROTATE_ME")

        message = "BL-126 test: placeholder pat"
        try:
            response = anon_client.post(
                "/api/feedback", json={"message": message, "contact_ok": False}
            )
            assert response.status_code == 201
            assert _feedback_row(db, message) is not None
        finally:
            _cleanup_feedback(db, message)


class TestGrants:
    def test_swu_app_has_select_insert_delete_grant_on_feedback(self, db):
        rows = db.execute(
            text(
                "SELECT privilege_type FROM information_schema.role_table_grants "
                "WHERE grantee = 'swu_app' AND table_name = 'feedback'"
            )
        ).all()
        privileges = {r[0] for r in rows}
        assert "SELECT" in privileges
        assert "INSERT" in privileges
        assert "DELETE" in privileges
        # SELECT is real but narrow: migration 0027's
        # feedback_select_own_tenant policy only ever exposes a caller's
        # own tenant's rows (never anonymous ones, never another tenant's)
        # -- it exists to make purge_tenant's DELETE able to locate rows
        # at all (a PostgreSQL RLS requirement, not a read endpoint's
        # need). No UPDATE policy exists at all. See migration 0027's
        # docstring and TestConsentSemantics above for the RLS-enforced
        # behavior itself.


class TestRlsNeverExposesAnonymousRows:
    def test_swu_app_session_cannot_select_anonymous_feedback(self, anon_client, db):
        """Belt-and-suspenders on the claim in migration 0027's docstring:
        feedback_select_own_tenant's predicate excludes tenant_id IS NULL
        unconditionally, so no session -- anonymous or authenticated --
        can ever SELECT an anonymous feedback row, confirmed directly
        against the RLS-scoped connection rather than through an endpoint
        (no endpoint exposes reads at all)."""
        from app.database import _open_catalog_session

        message = "BL-126 test: RLS select probe"
        try:
            response = anon_client.post(
                "/api/feedback", json={"message": message, "contact_ok": False}
            )
            assert response.status_code == 201

            probe_db, probe_conn = _open_catalog_session()
            try:
                row = probe_db.execute(
                    text("SELECT id FROM feedback WHERE message = :message"),
                    {"message": message},
                ).first()
                assert row is None
            finally:
                probe_db.rollback()
                probe_db.close()
                probe_conn.close()
        finally:
            _cleanup_feedback(db, message)
