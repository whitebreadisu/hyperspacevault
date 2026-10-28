"""BL-279 WS-3 W3-05: scripts/verify_tenant.py with firebase_admin.auth mocked.

No network and no database: the script is loaded by path (backend/scripts is
not a package) and its ``auth`` module reference is replaced by a fake.
"""

import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "verify_tenant.py"
_spec = importlib.util.spec_from_file_location("verify_tenant", _SCRIPT)
assert _spec is not None and _spec.loader is not None
vt = importlib.util.module_from_spec(_spec)
sys.modules["verify_tenant"] = vt
_spec.loader.exec_module(vt)

NOW = 1_800_000_000.0


class _NotFound(Exception):
    pass


def _user(uid, email, verified=True, disabled=False, created_seconds=None):
    ts = None if created_seconds is None else int(created_seconds * 1000)
    return SimpleNamespace(
        uid=uid,
        email=email,
        email_verified=verified,
        disabled=disabled,
        user_metadata=SimpleNamespace(creation_timestamp=ts),
    )


@pytest.fixture
def fake_auth(monkeypatch):
    fake = MagicMock()
    fake.UserNotFoundError = _NotFound
    monkeypatch.setattr(vt, "auth", fake)
    return fake


@pytest.fixture
def no_init(monkeypatch):
    init = MagicMock()
    monkeypatch.setattr(vt.firebase_admin, "initialize_app", init)
    monkeypatch.setattr(vt.credentials, "ApplicationDefault", MagicMock())
    return init


def test_absent_identity_is_created(fake_auth):
    fake_auth.get_user_by_email.side_effect = _NotFound()
    fake_auth.create_user.return_value = SimpleNamespace(uid="u1")
    ident = vt.IDENTITIES["dev"][0]
    assert vt.ensure_identity(ident, "pw", False) == ("u1", "created")
    fake_auth.create_user.assert_called_once_with(
        email=ident.email, password="pw", email_verified=True, disabled=False
    )
    fake_auth.update_user.assert_not_called()


def test_present_identity_is_updated_not_created(fake_auth):
    ident = vt.IDENTITIES["dev"][0]
    fake_auth.get_user_by_email.return_value = _user("u2", ident.email)
    assert vt.ensure_identity(ident, "pw", False) == ("u2", "updated")
    fake_auth.update_user.assert_called_once_with(
        "u2", password="pw", email_verified=True, disabled=False
    )
    fake_auth.create_user.assert_not_called()


def test_unverified_identity_is_created_unverified(fake_auth):
    fake_auth.get_user_by_email.side_effect = _NotFound()
    fake_auth.create_user.return_value = SimpleNamespace(uid="u3")
    ident = next(i for i in vt.IDENTITIES["dev"] if i.role == "unverified")
    vt.ensure_identity(ident, "pw", False)
    assert fake_auth.create_user.call_args.kwargs["email_verified"] is False


def test_dry_run_writes_nothing(fake_auth):
    ident = vt.IDENTITIES["dev"][0]
    fake_auth.get_user_by_email.return_value = _user("u2", ident.email)
    assert vt.ensure_identity(ident, "pw", True) == ("u2", "unchanged")
    fake_auth.get_user_by_email.return_value = _user("u2", ident.email, verified=False)
    assert vt.ensure_identity(ident, "pw", True) == ("u2", "updated")
    fake_auth.get_user_by_email.side_effect = _NotFound()
    assert vt.ensure_identity(ident, "pw", True) == ("-", "created")
    fake_auth.create_user.assert_not_called()
    fake_auth.update_user.assert_not_called()


def _list(users):
    return SimpleNamespace(iterate_all=lambda: iter(users))


def test_purge_j1_age_boundary(fake_auth):
    prefix = vt.J1_EMAIL_PREFIX
    fake_auth.list_users.return_value = _list(
        [
            _user("young", prefix + "a@gmail.com", created_seconds=NOW - 59 * 60),
            _user("old", prefix + "b@gmail.com", created_seconds=NOW - 61 * 60),
            _user("other", "someone@gmail.com", created_seconds=NOW - 86400),
            _user("verify", vt.IDENTITIES["dev"][0].email, created_seconds=NOW - 86400),
        ]
    )
    assert vt.purge_j1(NOW) == 1
    fake_auth.delete_user.assert_called_once_with("old")


def test_purge_j1_dry_run_deletes_nothing(fake_auth):
    fake_auth.list_users.return_value = _list(
        [_user("old", vt.J1_EMAIL_PREFIX + "b@gmail.com", created_seconds=NOW - 7200)]
    )
    assert vt.purge_j1(NOW, dry_run=True) == 1
    fake_auth.delete_user.assert_not_called()


def test_prod_refuses_purge(fake_auth, no_init, monkeypatch, capsys):
    monkeypatch.setenv("VERIFY_PASSWORD", "x")
    assert vt.main(["--env", "prod", "--purge-j1"]) == 2
    assert "dev only" in capsys.readouterr().err
    no_init.assert_not_called()


def test_prod_refuses_purge_only(fake_auth, no_init, capsys):
    assert vt.main(["--env", "prod", "--purge-only"]) == 2
    assert "dev only" in capsys.readouterr().err
    no_init.assert_not_called()
    fake_auth.list_users.assert_not_called()


def test_purge_only_needs_no_passwords_and_touches_no_identity(
    fake_auth, no_init, monkeypatch, capsys
):
    for name in ("VERIFY_PASSWORD", "VERIFY_B_PASSWORD", "VERIFY_UNVERIFIED_PASSWORD"):
        monkeypatch.delenv(name, raising=False)
    fake_auth.list_users.return_value = _list(
        [
            _user("old", vt.J1_EMAIL_PREFIX + "b@gmail.com", created_seconds=1),
            _user("verify", vt.IDENTITIES["dev"][0].email, created_seconds=1),
        ]
    )
    assert vt.main(["--env", "dev", "--purge-only"]) == 0
    assert capsys.readouterr().out.strip() == "purged j1 users: 1"
    fake_auth.delete_user.assert_called_once_with("old")
    fake_auth.get_user_by_email.assert_not_called()
    fake_auth.create_user.assert_not_called()
    fake_auth.update_user.assert_not_called()
    assert no_init.call_args.args[1] == {"projectId": "swu-dev-jbapps"}


def test_purge_only_dry_run_deletes_nothing(fake_auth, no_init, monkeypatch):
    monkeypatch.delenv("VERIFY_PASSWORD", raising=False)
    fake_auth.list_users.return_value = _list(
        [_user("old", vt.J1_EMAIL_PREFIX + "b@gmail.com", created_seconds=1)]
    )
    assert vt.main(["--env", "dev", "--purge-only", "--dry-run"]) == 0
    fake_auth.delete_user.assert_not_called()


def test_missing_env_name_exits_2(no_init, monkeypatch, capsys):
    monkeypatch.setenv("VERIFY_PASSWORD", "x")
    monkeypatch.delenv("VERIFY_B_PASSWORD", raising=False)
    monkeypatch.setenv("VERIFY_UNVERIFIED_PASSWORD", "x")
    assert vt.main(["--env", "dev"]) == 2
    assert "VERIFY_B_PASSWORD" in capsys.readouterr().err
    no_init.assert_not_called()


def test_main_prints_one_line_per_identity_without_password(
    fake_auth, no_init, monkeypatch, capsys
):
    monkeypatch.setenv("VERIFY_PASSWORD", "not-a-real-secret")
    fake_auth.get_user_by_email.side_effect = _NotFound()
    fake_auth.create_user.return_value = SimpleNamespace(uid="uid-prod")
    assert vt.main(["--env", "prod"]) == 0
    out = capsys.readouterr().out
    assert out.strip() == "A jeremy.braden+hsv-verify-prod@gmail.com uid-prod created"
    assert "not-a-real-secret" not in out
    assert no_init.call_args.args[1] == {"projectId": "swu-prod"}
