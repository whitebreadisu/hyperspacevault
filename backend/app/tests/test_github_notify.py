"""Unit tests for the feedback GitHub notification's per-environment
switch and issue body. No database: the HTTP client is replaced.
"""

import pytest

from app.services import github_notify


class _RecordingClient:
    instances: list["_RecordingClient"] = []

    def __init__(self, *args, **kwargs):
        self.calls: list[dict] = []
        _RecordingClient.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def post(self, url, headers=None, json=None):
        self.calls.append({"url": url, "json": json})

        class _Response:
            def raise_for_status(self):
                return None

        return _Response()


def _notify():
    github_notify.notify(
        message="hello",
        commit_sha="abc123",
        created_at="2026-11-01T00:00:00Z",
        contact_email=None,
    )


@pytest.fixture(autouse=True)
def _client(monkeypatch):
    _RecordingClient.instances = []
    monkeypatch.setattr(github_notify.httpx, "Client", _RecordingClient)
    monkeypatch.setenv("FEEDBACK_GITHUB_PAT", "test-token")


@pytest.mark.parametrize("environment", ["development", "staging", ""])
def test_non_production_environment_makes_no_http_call(monkeypatch, environment):
    monkeypatch.setenv("ENVIRONMENT", environment)
    _notify()
    assert _RecordingClient.instances == []


def test_unset_environment_makes_no_http_call(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    _notify()
    assert _RecordingClient.instances == []


def test_production_creates_issue_with_environment_line(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    _notify()
    (client,) = _RecordingClient.instances
    (call,) = client.calls
    lines = call["json"]["body"].splitlines()
    assert "Environment: prod" in lines
    assert lines.index("Environment: prod") < lines.index("Commit: abc123")


def test_environment_label_names(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "development")
    assert github_notify._environment_label() == "dev"
    monkeypatch.setenv("ENVIRONMENT", "production")
    assert github_notify._environment_label() == "prod"
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    assert github_notify._environment_label() == "unknown"
