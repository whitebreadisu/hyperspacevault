"""Client-address resolution (app/forwarded.py): the four paths measured on
dev 2026-10-28, forged-header cases, the ranges-file fallback, and the
limiter integration."""

import json
import logging

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy import text

from app import forwarded
from app.forwarded import (
    ForwardedClientMiddleware,
    load_google_networks,
    resolve_client,
    resolve_client_ip,
)
from app.rate_limit import client_ip_key

# Addresses seen as the Hosting origin fetcher on dev (inside goog.json,
# outside cloud.json) and an ordinary client address.
GOOGLE_FETCHER = "74.125.215.140"
REAL = "198.51.100.7"
HOSTING = "swu-dev-jbapps.web.app"


def test_ranges_file_loads_and_contains_the_measured_fetchers():
    nets = load_google_networks()
    assert nets
    for ip in ("74.125.215.140", "64.233.172.167", "192.178.15.8"):
        assert forwarded._in_google_ranges(ip, nets)
    assert not forwarded._in_google_ranges("203.0.113.9", nets)


def test_direct_no_header_value_is_the_single_entry():
    assert resolve_client_ip(REAL, "", "10.0.0.1") == REAL


def test_direct_forged_leading_entry_is_ignored():
    # measured: caller sent 203.0.113.9, the front end appended the real client
    assert resolve_client_ip(f"203.0.113.9, {REAL}", "", "10.0.0.1") == REAL
    assert resolve_client_ip("6.6.6.6, 1.2.3.4", None, None) == "1.2.3.4"


def test_hosting_path_takes_second_from_right():
    chain = f"{REAL}, {GOOGLE_FETCHER}"
    assert resolve_client_ip(chain, HOSTING, "10.0.0.1") == REAL
    # host header is matched case-insensitively
    assert resolve_client_ip(chain, HOSTING.upper(), "10.0.0.1") == REAL


def test_hosting_path_is_not_fooled_by_a_forged_leading_entry():
    # Hosting replaces the header, so a longer chain is not expected, but the
    # position from the right still holds.
    chain = f"6.6.6.6, {REAL}, {GOOGLE_FETCHER}"
    assert resolve_client_ip(chain, HOSTING, "10.0.0.1") == REAL


def test_direct_request_forging_the_host_header_still_gets_the_rightmost():
    # attacker on the direct path: forged host, two entries, real client right
    chain = f"6.6.6.6, {REAL}"
    assert resolve_client_ip(chain, HOSTING, "10.0.0.1") == REAL


def test_hosting_host_with_a_single_entry_chain_returns_it():
    assert resolve_client_ip(GOOGLE_FETCHER, HOSTING, None) == GOOGLE_FETCHER


def test_google_fetcher_without_the_hosting_host_is_not_unwrapped():
    chain = f"{REAL}, {GOOGLE_FETCHER}"
    assert resolve_client_ip(chain, "evil.example", None) == GOOGLE_FETCHER
    assert resolve_client_ip(chain, "", None) == GOOGLE_FETCHER


def test_ipv6_entries_pass_through_for_the_64_grouping():
    v6 = "2001:db8:abcd:12:1:2:3:4"
    assert resolve_client_ip(f"6.6.6.6, {v6}", "", None) == v6
    assert client_ip_key(v6) == "2001:db8:abcd:12::/64"
    assert resolve_client_ip(f"{v6}, {GOOGLE_FETCHER}", HOSTING, None) == v6


def test_no_header_falls_back_to_the_peer():
    assert resolve_client_ip(None, None, "10.0.0.1") == "10.0.0.1"
    assert resolve_client_ip("", "", "10.0.0.1") == "10.0.0.1"
    assert resolve_client_ip(" , ", "", None) is None


def test_hosting_hosts_env_override(monkeypatch):
    monkeypatch.setenv("HOSTING_FORWARDED_HOSTS", "other.example")
    chain = f"{REAL}, {GOOGLE_FETCHER}"
    assert resolve_client_ip(chain, "other.example", None) == REAL
    assert resolve_client_ip(chain, HOSTING, None) == GOOGLE_FETCHER


def test_missing_ranges_file_falls_back_to_the_host_check_and_warns(tmp_path, caplog):
    with caplog.at_level(logging.WARNING, logger="app.forwarded"):
        assert load_google_networks(tmp_path / "absent.json") is None
    assert "weaker mode" in caplog.text
    chain = f"{REAL}, {GOOGLE_FETCHER}"
    assert resolve_client_ip(chain, HOSTING, None, google_networks=None) == REAL
    # weaker mode: a non-Google rightmost entry is unwrapped when the host matches
    assert (
        resolve_client_ip(f"6.6.6.6, {REAL}", HOSTING, None, google_networks=None)
        == "6.6.6.6"
    )
    # without the host header the rightmost still wins
    assert resolve_client_ip(chain, "", None, google_networks=None) == GOOGLE_FETCHER


def test_unparsable_ranges_file_is_treated_as_missing(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"prefixes": ["not-a-cidr"]}))
    assert load_google_networks(bad) is None


def _echo_app():
    app = FastAPI()

    @app.get("/who")
    def who(request: Request):
        return {"host": request.client.host, "scheme": request.url.scheme}

    app.add_middleware(ForwardedClientMiddleware)
    return TestClient(app)


def test_middleware_sets_scope_client_and_scheme():
    client = _echo_app()
    body = client.get(
        "/who",
        headers={
            "X-Forwarded-For": f"6.6.6.6, {REAL}",
            "X-Forwarded-Proto": "https",
        },
    ).json()
    assert body == {"host": REAL, "scheme": "https"}


def test_middleware_without_headers_leaves_the_peer():
    body = _echo_app().get("/who").json()
    assert body["host"] == "testclient"


def test_middleware_hosting_path():
    body = (
        _echo_app()
        .get(
            "/who",
            headers={
                "X-Forwarded-For": f"{REAL}, {GOOGLE_FETCHER}",
                "X-Forwarded-Host": HOSTING,
            },
        )
        .json()
    )
    assert body["host"] == REAL


def test_feedback_limiter_ignores_forged_leading_entries():
    """The sixth POST from one real client is 429 even though every request
    carries a different forged leading X-Forwarded-For entry (the limiter,
    the relay stamp and client_ip_key read request.client.host unchanged)."""
    from app.database import SessionLocal
    from app.main import app
    from app.rate_limit import MAX_SUBMISSIONS_PER_WINDOW

    client = TestClient(app)
    prefix = "BL-273 forged-xff limiter test"
    statuses = []
    try:
        for n in range(MAX_SUBMISSIONS_PER_WINDOW + 1):
            r = client.post(
                "/api/feedback",
                json={"message": f"{prefix} {n}", "contact_ok": False},
                headers={"X-Forwarded-For": f"203.0.113.{n + 1}, {REAL}"},
            )
            statuses.append(r.status_code)
    finally:
        s = SessionLocal()
        s.execute(
            text("DELETE FROM feedback WHERE message LIKE :p"), {"p": prefix + "%"}
        )
        s.commit()
        s.close()
    assert statuses[:-1] == [201] * MAX_SUBMISSIONS_PER_WINDOW
    assert statuses[-1] == 429


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("HOSTING_FORWARDED_HOSTS", raising=False)


@pytest.mark.parametrize(
    "host", ["swu-dev-jbapps.firebaseapp.com", "swu-prod.firebaseapp.com"]
)
def test_firebaseapp_aliases_are_hosting_hosts(host):
    chain = f"{REAL}, {GOOGLE_FETCHER}"
    assert resolve_client_ip(chain, host, None) == REAL


def test_unrecognised_hop_is_flagged_when_host_matches_but_address_is_not_google():
    # stale-ranges case: Hosting host, a rightmost address outside the ranges
    ip, flagged = resolve_client("6.6.6.6, 203.0.113.50", HOSTING, None)
    assert (ip, flagged) == ("203.0.113.50", True)
    # recognised hop, no host, and the weaker mode do not flag
    assert resolve_client(f"{REAL}, {GOOGLE_FETCHER}", HOSTING, None) == (REAL, False)
    assert resolve_client(f"{REAL}, {GOOGLE_FETCHER}", "", None)[1] is False
    assert (
        resolve_client("6.6.6.6, 203.0.113.50", HOSTING, None, google_networks=None)[1]
        is False
    )


def test_unrecognised_hop_reaches_the_request_log(caplog):
    from starlette.middleware.base import BaseHTTPMiddleware

    from app.middleware import log_requests

    app = FastAPI()

    @app.get("/x")
    def x():
        return {}

    app.add_middleware(BaseHTTPMiddleware, dispatch=log_requests)
    app.add_middleware(ForwardedClientMiddleware)
    client = TestClient(app)
    with caplog.at_level(logging.INFO, logger="app.request"):
        client.get(
            "/x",
            headers={
                "X-Forwarded-For": "6.6.6.6, 203.0.113.50",
                "X-Forwarded-Host": HOSTING,
            },
        )
        client.get(
            "/x",
            headers={
                "X-Forwarded-For": f"{REAL}, {GOOGLE_FETCHER}",
                "X-Forwarded-Host": HOSTING,
            },
        )
    first, second = [r for r in caplog.records if r.name == "app.request"]
    assert first.forwarded_unrecognised_hop is True
    assert not hasattr(second, "forwarded_unrecognised_hop")
    assert "203.0.113.50" not in json.dumps(
        {k: v for k, v in vars(first).items() if k.startswith("forwarded")}
    )
