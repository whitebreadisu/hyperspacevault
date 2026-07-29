"""BL-137: integration tests for POST /api/deck-check.

Covers: SET_NUM resolution against whatever catalog THIS test DB actually
has -- CI's trimmed fixture catalog (conftest.seed_minimal_catalog, 6
synthetic SOR cards) or the full ~9k-variant local dev catalog -- via
deck payloads built dynamically from real base_cards rows
(dynamic_deck_ids), so the resolution/unrecognized/empty-inventory
contract tests pass in both environments; the two REAL live-captured
fixture decks (SWUBase + sw-unlimited-db.com, Definition_DeckCheck_2026-
07-16.md / BL110_Deck_Format_Research_2026-07-13.md §2a) are additionally
exercised end-to-end, full-catalog-only (precondition-guarded, skips
rather than fails against a trimmed catalog); the named sideboard-
subtraction acceptance case end-to-end; finish-agnostic ("foils-only")
ownership; cost math (standard/fallback/cheapest/unpriced) against an
isolated priced fixture (mirrors test_pricing_api.py's pattern); typed
errors for bad URLs/JSON (network mocked, matching test_feedback_api.py's
github_notify style); tenant isolation; auth-only (not verified-email
gated) posture; empty inventory is not an error.

Run inside the backend container:
    docker compose exec backend pytest app/tests/test_deck_check_api.py -v
"""

import os
from datetime import date

import pytest
from sqlalchemy import text

from app.repositories.pricing import upsert_latest_price
from app.services import deck_fetch

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
)

SET_CODE = "DC1"
TODAY = date(2026, 7, 16)

# The two live-captured fixture decks (BL-137 build, 2026-07-16) -- one
# polite fetch each against the real public APIs, verbatim.
SWUBASE_FIXTURE_DECK = {
    "metadata": {"name": "Han Solo Starter Deck", "author": "silva367"},
    "deck": [
        {"id": "JTL_215", "count": 2},
        {"id": "SHD_095", "count": 3},
        {"id": "JTL_103", "count": 3},
        {"id": "TWI_114", "count": 1},
        {"id": "JTL_196", "count": 3},
        {"id": "SOR_192", "count": 2},
        {"id": "SOR_204", "count": 2},
        {"id": "TWI_110", "count": 1},
        {"id": "JTL_097", "count": 2},
        {"id": "JTL_093", "count": 1},
        {"id": "JTL_245", "count": 2},
        {"id": "JTL_210", "count": 1},
        {"id": "JTL_096", "count": 2},
        {"id": "SHD_195", "count": 3},
        {"id": "JTL_249", "count": 3},
        {"id": "SOR_097", "count": 1},
        {"id": "JTL_124", "count": 2},
        {"id": "SOR_222", "count": 3},
        {"id": "JTL_217", "count": 1},
        {"id": "JTL_235", "count": 1},
        {"id": "JTL_200", "count": 3},
        {"id": "TWI_191", "count": 3},
        {"id": "JTL_209", "count": 1},
        {"id": "JTL_208", "count": 3},
        {"id": "SOR_217", "count": 1},
    ],
    "sideboard": [],
    "leader": {"id": "JTL_017", "count": 1},
    "base": {"id": "SOR_024", "count": 1},
}

SW_UNLIMITED_DB_FIXTURE_DECK = {
    "metadata": {"name": "karabast"},
    "leader": {"id": "SOR_008", "count": 1},
    "base": {"id": "SOR_024", "count": 1},
    "deck": [
        {"unit": "Unit", "id": "SOR_097", "count": 2},
        {"unit": "Unit", "id": "SOR_115", "count": 2},
        {"unit": "Unit", "id": "SOR_095", "count": 3},
        {"unit": "Unit", "id": "SOR_188", "count": 3},
        {"unit": "Unit", "id": "SOR_098", "count": 3},
        {"unit": "Unit", "id": "SOR_192", "count": 3},
        {"unit": "Unit", "id": "SOR_105", "count": 2},
        {"unit": "Unit", "id": "SOR_047", "count": 3},
        {"unit": "Unit", "id": "SOR_096", "count": 2},
        {"unit": "Unit", "id": "SOR_142", "count": 3},
        {"unit": "Unit", "id": "SOR_146", "count": 3},
        {"unit": "Unit", "id": "SOR_237", "count": 3},
        {"unit": "Unit", "id": "SOR_099", "count": 2},
        {"unit": "Unit", "id": "SOR_050", "count": 3},
        {"unit": "Event", "id": "SOR_106", "count": 2},
        {"unit": "Event", "id": "SOR_107", "count": 3},
        {"unit": "Event", "id": "SOR_151", "count": 2},
        {"unit": "Event", "id": "SOR_103", "count": 2},
        {"unit": "Event", "id": "SOR_126", "count": 2},
        {"unit": "Event", "id": "SOR_200", "count": 2},
    ],
}


def _all_deck_ids(deck: dict) -> list[str]:
    ids = [deck["leader"]["id"], deck["base"]["id"]]
    ids += [c["id"] for c in deck.get("deck", [])]
    ids += [c["id"] for c in deck.get("sideboard", [])]
    return ids


def _first_missing_pair(db, ids: list[str]) -> str | None:
    """Returns the first SET_NUM id (from a raw deck payload) that has no
    matching non-token base_cards row in THIS test DB, or None if every id
    resolves -- the precondition guard for the full-catalog-only tests
    below. CI's trimmed fixture catalog (conftest.seed_minimal_catalog:
    6 synthetic SOR cards only, numbers 9001-9006) will never satisfy a
    real live-captured deck's ids (JTL_017, SHD_095, ...), so those tests
    must SKIP against it rather than fail."""
    for raw_id in ids:
        set_code, _, number = raw_id.partition("_")
        if not number.isdigit():
            return raw_id
        row = db.execute(
            text(
                "SELECT 1 FROM base_cards bc JOIN sets s ON s.id = bc.set_id "
                "WHERE s.code = :code AND bc.base_card_number = :number "
                "AND bc.is_token = false"
            ),
            {"code": set_code, "number": str(int(number))},
        ).first()
        if row is None:
            return raw_id
    return None


@pytest.fixture
def dynamic_deck_ids(db):
    """SET_NUM ids built from real base_cards rows that exist in THIS test
    DB, whatever catalog it happens to have -- CI's trimmed fixture
    catalog (conftest.seed_minimal_catalog's 6 synthetic SOR cards) or the
    full ~9k-variant local dev catalog. This is what makes the resolution-
    contract tests below (0-unrecognized, unrecognized-filtering, empty-
    inventory) pass in BOTH environments instead of asserting against
    hardcoded real card ids that only exist in the full catalog."""
    leader = db.execute(
        text(
            "SELECT s.code AS code, bc.base_card_number AS number FROM base_cards bc "
            "JOIN sets s ON s.id = bc.set_id "
            "WHERE bc.type = 'Leader' AND bc.is_token = false "
            "ORDER BY bc.id LIMIT 1"
        )
    ).first()
    base = db.execute(
        text(
            "SELECT s.code AS code, bc.base_card_number AS number FROM base_cards bc "
            "JOIN sets s ON s.id = bc.set_id "
            "WHERE bc.type = 'Base' AND bc.is_token = false "
            "ORDER BY bc.id LIMIT 1"
        )
    ).first()
    units = db.execute(
        text(
            "SELECT s.code AS code, bc.base_card_number AS number FROM base_cards bc "
            "JOIN sets s ON s.id = bc.set_id "
            "WHERE bc.type NOT IN ('Leader', 'Base') AND bc.is_token = false "
            "ORDER BY bc.id LIMIT 2"
        )
    ).all()
    assert leader is not None, (
        "test DB has no Leader base_card -- seed_minimal_catalog missing?"
    )
    assert base is not None, (
        "test DB has no Base base_card -- seed_minimal_catalog missing?"
    )
    assert len(units) >= 2, "test DB needs at least 2 non-Leader/Base base_cards"

    def _set_num(row) -> str:
        return f"{row.code}_{row.number}"

    return {
        "leader_id": _set_num(leader),
        "base_id": _set_num(base),
        "unit_ids": [_set_num(r) for r in units],
    }


class TestLiveFixtureResolution:
    """Resolution-contract tests: must pass against ANY catalog this test
    DB happens to have -- CI's trimmed 6-card fixture catalog, or the full
    ~9k-variant local dev catalog. Deck payloads are built from real
    base_cards rows queried at test time (dynamic_deck_ids), never
    hardcoded ids, so these are portable by construction. The REAL live-
    captured SWUBase/sw-unlimited-db fixture decks (full byte-for-byte
    payloads, one polite live fetch each) are exercised separately,
    full-catalog-only, in TestLiveFixtureResolutionFullCatalogOnly below."""

    def test_dynamic_catalog_deck_resolves_zero_unrecognized(
        self, client, dynamic_deck_ids
    ):
        deck_json = {
            "metadata": {"name": "dynamic catalog test deck"},
            "leader": {"id": dynamic_deck_ids["leader_id"], "count": 1},
            "base": {"id": dynamic_deck_ids["base_id"], "count": 1},
            "deck": [{"id": uid, "count": 1} for uid in dynamic_deck_ids["unit_ids"]],
        }
        response = client.post("/api/deck-check", json={"deck_json": deck_json})
        assert response.status_code == 200
        body = response.json()
        assert body["unrecognized"] == []
        assert body["deck"]["source"] == "pasted"
        assert (
            body["deck"]["leader"]["base_card_number"]
            == dynamic_deck_ids["leader_id"].split("_", 1)[1]
        )
        assert (
            body["deck"]["base"]["base_card_number"]
            == dynamic_deck_ids["base_id"].split("_", 1)[1]
        )
        # main_count excludes leader/base -- sum of the "deck" array only.
        assert body["deck"]["main_count"] == len(dynamic_deck_ids["unit_ids"])
        assert body["deck"]["side_count"] == 0

    def test_synthetic_future_set_id_lands_in_unrecognized(
        self, client, dynamic_deck_ids
    ):
        """A made-up set code must never mis-resolve to a real card --
        Definition_DeckCheck §8's 'synthetic future-set id' case."""
        deck_json = {
            "metadata": {"name": "unrecognized test"},
            "leader": {"id": dynamic_deck_ids["leader_id"], "count": 1},
            "base": {"id": dynamic_deck_ids["base_id"], "count": 1},
            "deck": [
                {"id": dynamic_deck_ids["unit_ids"][0], "count": 2},
                {"id": "ZZZ_999", "count": 3},
            ],
        }
        response = client.post("/api/deck-check", json={"deck_json": deck_json})
        assert response.status_code == 200
        body = response.json()
        assert body["unrecognized"] == [{"id": "ZZZ_999", "count": 3}]


class TestLiveFixtureResolutionFullCatalogOnly:
    """The two REAL live-captured fixture decks (SWUBase deck
    e36c459f-b77b-42ad-90c8-8d64932abd1e, sw-unlimited-db.com deck id
    77465) resolved end-to-end against whatever catalog this test DB
    actually has. CI's trimmed catalog does not contain these real
    JTL/SHD/TWI/SOR card numbers, so these tests SKIP (never fail) when
    the precondition isn't met -- verified locally against the full
    catalog (2313 base_cards / 9068 variants, 2026-07-16): both resolve
    with 0 unrecognized. The catalog-size-independent version of this
    contract is TestLiveFixtureResolution above, which runs everywhere."""

    def test_swubase_fixture_deck_zero_unrecognized_full_catalog(self, client, db):
        missing = _first_missing_pair(db, _all_deck_ids(SWUBASE_FIXTURE_DECK))
        if missing is not None:
            pytest.skip(f"full local catalog only -- {missing!r} not in this test DB")
        response = client.post(
            "/api/deck-check", json={"deck_json": SWUBASE_FIXTURE_DECK}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["unrecognized"] == []
        assert body["deck"]["source"] == "pasted"
        assert body["deck"]["name"] == "Han Solo Starter Deck"
        assert body["deck"]["leader"]["base_card_number"] == "17"
        assert body["deck"]["base"]["base_card_number"] == "24"
        assert body["deck"]["main_count"] == sum(
            c["count"] for c in SWUBASE_FIXTURE_DECK["deck"]
        )
        assert body["deck"]["side_count"] == 0

    def test_sw_unlimited_db_fixture_deck_zero_unrecognized_full_catalog(
        self, client, db
    ):
        missing = _first_missing_pair(db, _all_deck_ids(SW_UNLIMITED_DB_FIXTURE_DECK))
        if missing is not None:
            pytest.skip(f"full local catalog only -- {missing!r} not in this test DB")
        response = client.post(
            "/api/deck-check", json={"deck_json": SW_UNLIMITED_DB_FIXTURE_DECK}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["unrecognized"] == []
        assert body["deck"]["leader"]["base_card_number"] == "8"
        assert body["deck"]["main_count"] == sum(
            c["count"] for c in SW_UNLIMITED_DB_FIXTURE_DECK["deck"]
        )


class TestTypedErrors:
    def test_neither_url_nor_deck_json_is_invalid_deck_json(self, client):
        response = client.post("/api/deck-check", json={})
        assert response.status_code == 422
        assert response.json()["detail"]["error"] == "invalid_deck_json"

    def test_both_url_and_deck_json_is_invalid_deck_json(self, client):
        response = client.post(
            "/api/deck-check",
            json={"url": "https://swubase.com/api/deck/x/json", "deck_json": {}},
        )
        assert response.status_code == 422
        assert response.json()["detail"]["error"] == "invalid_deck_json"

    def test_malformed_deck_json_structure(self, client):
        response = client.post(
            "/api/deck-check", json={"deck_json": {"leader": {"id": "JTL_017"}}}
        )
        assert response.status_code == 422
        assert response.json()["detail"]["error"] == "invalid_deck_json"

    def test_non_allowlisted_url_is_unsupported_url(self, client):
        response = client.post(
            "/api/deck-check", json={"url": "https://swudb.com/decks/top-deck"}
        )
        assert response.status_code == 422
        assert response.json()["detail"]["error"] == "unsupported_url"
        assert "paste" in response.json()["detail"]["message"].lower()

    def test_fetch_failure_is_fetch_failed(self, client, monkeypatch):
        class _RaisingClient:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def stream(self, method, url):
                raise deck_fetch.httpx.ConnectError("simulated network failure")

        monkeypatch.setattr(deck_fetch.httpx, "Client", lambda **kw: _RaisingClient())
        response = client.post(
            "/api/deck-check",
            json={
                "url": "https://swubase.com/api/deck/e36c459f-b77b-42ad-90c8-8d64932abd1e/json"
            },
        )
        assert response.status_code == 502
        assert response.json()["detail"]["error"] == "fetch_failed"

    def test_url_path_success_through_router(
        self, client, monkeypatch, dynamic_deck_ids
    ):
        """Confirms the URL-fetch path (not just paste-JSON) reaches the
        real resolver end-to-end, with the network call itself mocked. The
        mocked response body is built from real base_cards rows in THIS
        test DB (dynamic_deck_ids), not the hardcoded live fixture, so
        this passes against both CI's trimmed catalog and the full local
        catalog -- the URL-routing behavior under test doesn't depend on
        which specific cards are in the payload."""
        import json as jsonlib

        deck_payload = {
            "metadata": {"name": "url path test deck"},
            "leader": {"id": dynamic_deck_ids["leader_id"], "count": 1},
            "base": {"id": dynamic_deck_ids["base_id"], "count": 1},
            "deck": [{"id": uid, "count": 1} for uid in dynamic_deck_ids["unit_ids"]],
        }
        body_bytes = jsonlib.dumps(deck_payload).encode()

        class _FakeResponse:
            status_code = 200

            def iter_bytes(self):
                yield body_bytes

        class _FakeStream:
            def __enter__(self):
                return _FakeResponse()

            def __exit__(self, *exc):
                return False

        class _FakeClient:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def stream(self, method, url):
                return _FakeStream()

        monkeypatch.setattr(deck_fetch.httpx, "Client", lambda **kw: _FakeClient())
        response = client.post(
            "/api/deck-check",
            json={
                "url": "https://sw-unlimited-db.com/umbraco/api/deckapi/get?id=77465"
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["unrecognized"] == []
        assert body["deck"]["source"] == "sw-unlimited-db"


class TestAuthOnlyRequired:
    def test_anonymous_request_is_rejected(self):
        """Definition_DeckCheck's decided policy is "auth-only" -- no bare
        TestClient(app) request (no Authorization header, no dependency
        override) should ever reach the service layer."""
        from fastapi.testclient import TestClient

        from app.main import app

        anon_client = TestClient(app)
        response = anon_client.post(
            "/api/deck-check",
            json={
                "deck_json": {
                    "leader": {"id": "JTL_017", "count": 1},
                    "base": {"id": "SOR_024", "count": 1},
                    "deck": [{"id": "SOR_097", "count": 1}],
                }
            },
        )
        assert response.status_code == 401


class TestAuthOnlyNotVerifiedEmailGated:
    def test_unverified_email_caller_still_succeeds(self, make_client):
        """Deck check mutates nothing, so require_verified_email must NOT
        gate it -- only get_db (auth-only) applies, per CLAUDE.md's decided
        posture recorded in the build brief."""
        unverified_client = make_client(
            uid="test-deckcheck-unverified",
            email="unverified@example.com",
            email_verified=False,
        )
        response = unverified_client.post(
            "/api/deck-check",
            json={
                "deck_json": {
                    "leader": {"id": "JTL_017", "count": 1},
                    "base": {"id": "SOR_024", "count": 1},
                    "deck": [{"id": "SOR_097", "count": 1}],
                }
            },
        )
        assert response.status_code == 200


class TestEmptyInventoryIsNotAnError:
    def test_brand_new_tenant_zero_inventory_returns_200_everything_missing(
        self, make_client, db, dynamic_deck_ids
    ):
        uid, email = "test-deckcheck-empty-tenant", "deckcheck-empty@example.com"
        try:
            fresh_client = make_client(uid=uid, email=email)
            deck_json = {
                "leader": {"id": dynamic_deck_ids["leader_id"], "count": 1},
                "base": {"id": dynamic_deck_ids["base_id"], "count": 1},
                "deck": [{"id": dynamic_deck_ids["unit_ids"][0], "count": 1}],
            }
            response = fresh_client.post(
                "/api/deck-check", json={"deck_json": deck_json}
            )
            assert response.status_code == 200
            body = response.json()
            # Confirms the deck itself DID resolve (a brand-new tenant with
            # 0 inventory is a different condition than "these cards don't
            # exist in the catalog" -- this is the exact vacuous-pass this
            # test must not fall into).
            assert body["unrecognized"] == []
            assert body["scopes"]["main"]["buildable"] is False
            assert len(body["scopes"]["main"]["missing"]) == 3  # leader+base+1 card
        finally:
            from .conftest import delete_provisioned_identity

            delete_provisioned_identity(db, uid)


# --- Isolated fixture catalog for deterministic ownership/cost math -------


@pytest.fixture
def deck_check_catalog(db):
    """A small isolated set (DC1) with cards purpose-built for the
    diff/cost math tests below -- mirrors test_pricing_api.py's
    priced_base_card fixture pattern (own set code, explicit cleanup)."""
    db.execute(
        text(
            "INSERT INTO sets (code, name, is_base_set) "
            "VALUES (:code, 'Deck Check Test Set', true) "
            "ON CONFLICT (code) DO NOTHING"
        ),
        {"code": SET_CODE},
    )
    set_id = db.execute(
        text("SELECT id FROM sets WHERE code = :code"), {"code": SET_CODE}
    ).scalar()

    base_cards = [
        # (swuapi_id, number, name, subtitle, type). The priced card carries a
        # subtitle so the cart-URL "Name - Subtitle" join (TCGplayer's product
        # naming, e.g. "Han Solo - Hibernation Sick") is exercised end-to-end.
        ("dc1-base-leader", "1", "DC1 Test Leader", None, "Leader"),
        ("dc1-base-base", "2", "DC1 Test Base", None, "Base"),
        ("dc1-base-x", "3", "DC1 Sideboard Test Card", None, "Unit"),
        ("dc1-base-y", "4", "DC1 Foil Owner Test Card", None, "Unit"),
        ("dc1-base-priced", "5", "DC1 Priced Test Card", "Test Subtitle", "Unit"),
        ("dc1-base-fallback", "6", "DC1 Fallback Test Card", None, "Unit"),
        ("dc1-base-unpriced", "7", "DC1 Unpriced Test Card", None, "Unit"),
    ]
    base_card_ids = {}
    for swuapi_id, number, name, subtitle, type_ in base_cards:
        row = db.execute(
            text(
                "INSERT INTO base_cards "
                "(set_id, base_card_number, name, subtitle, type, rarity, swuapi_id) "
                "VALUES (:set_id, :number, :name, :subtitle, :type, 'Common', :swuapi_id) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET "
                "name = EXCLUDED.name, subtitle = EXCLUDED.subtitle "
                "RETURNING id"
            ),
            {
                "set_id": set_id,
                "number": number,
                "name": name,
                "subtitle": subtitle,
                "type": type_,
                "swuapi_id": swuapi_id,
            },
        ).first()
        base_card_ids[swuapi_id] = row.id

    variants = [
        # (swuapi_id, base_swuapi_id, card_number, variant_type)
        ("dc1-var-leader-std", "dc1-base-leader", "1", "Standard"),
        ("dc1-var-base-std", "dc1-base-base", "2", "Standard"),
        ("dc1-var-x-std", "dc1-base-x", "3", "Standard"),
        ("dc1-var-y-std", "dc1-base-y", "4", "Standard"),
        ("dc1-var-y-foil", "dc1-base-y", "104", "Foil"),
        ("dc1-var-priced-std", "dc1-base-priced", "5", "Standard"),
        ("dc1-var-priced-hs", "dc1-base-priced", "105", "Hyperspace"),
        ("dc1-var-fallback-std", "dc1-base-fallback", "6", "Standard"),
        ("dc1-var-fallback-hs", "dc1-base-fallback", "106", "Hyperspace"),
        ("dc1-var-unpriced-std", "dc1-base-unpriced", "7", "Standard"),
    ]
    variant_ids = {}
    for swuapi_id, base_swuapi_id, card_number, variant_type in variants:
        row = db.execute(
            text(
                "INSERT INTO card_variants "
                "(base_card_id, variant_type, source_set_code, card_number, swuapi_id) "
                "VALUES (:base_card_id, :variant_type, :set_code, :card_number, :swuapi_id) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET card_number = EXCLUDED.card_number "
                "RETURNING id"
            ),
            {
                "base_card_id": base_card_ids[base_swuapi_id],
                "variant_type": variant_type,
                "set_code": SET_CODE,
                "card_number": card_number,
                "swuapi_id": swuapi_id,
            },
        ).first()
        variant_ids[swuapi_id] = row.id

    # Pricing: priced card's Standard=5.0/4.0, Hyperspace=2.0/1.0 (cheapest
    # mode should pick Hyperspace's low=1.0); fallback card's Standard is
    # UNPRICED, Hyperspace=7.5/6.0 (standard mode must fall back to 7.5,
    # flagged price_basis="fallback"); unpriced card has no price row at all.
    prices = {
        "dc1-var-priced-std": (5.0, 4.0),
        "dc1-var-priced-hs": (2.0, 1.0),
        "dc1-var-fallback-hs": (7.5, 6.0),
    }
    for swuapi_id, (market, low) in prices.items():
        vid = variant_ids[swuapi_id]
        db.execute(
            text(
                "INSERT INTO variant_prices (variant_id, as_of, market, low, mid, high, currency) "
                "VALUES (:vid, :as_of, :market, :low, :market, :market, 'USD') "
                "ON CONFLICT (variant_id, as_of) DO UPDATE SET market = EXCLUDED.market"
            ),
            {
                "vid": vid,
                "as_of": TODAY,
                "market": market,
                "low": low,
            },
        )
        # BL-146: get_variant_type_prices (via pricing_repo.get_latest_prices)
        # now reads variant_latest_prices, not variant_prices directly -- this
        # fixture inserts raw variant_prices rows (bypassing the sync/backfill
        # jobs' upsert_prices), so it must maintain the snapshot itself.
        upsert_latest_price(db, vid, market, low, TODAY)
    db.commit()

    yield {"base_card_ids": base_card_ids, "variant_ids": variant_ids}

    db.rollback()
    for vid in variant_ids.values():
        db.execute(
            text("DELETE FROM variant_prices WHERE variant_id = :vid"), {"vid": vid}
        )
        db.execute(
            text("DELETE FROM variant_latest_prices WHERE variant_id = :vid"),
            {"vid": vid},
        )
        db.execute(text("DELETE FROM inventory WHERE variant_id = :vid"), {"vid": vid})
        db.execute(text("DELETE FROM card_variants WHERE id = :vid"), {"vid": vid})
    for bid in base_card_ids.values():
        db.execute(text("DELETE FROM base_cards WHERE id = :bid"), {"bid": bid})
    db.execute(text("DELETE FROM sets WHERE code = :code"), {"code": SET_CODE})
    db.commit()


@pytest.fixture
def deck_check_tenant(db, deck_check_catalog):
    """A dedicated tenant with precisely controlled inventory for the
    diff/cost math tests -- avoids any interference with tenant #1's
    shared seed data (conftest.seed_minimal_catalog) or other test
    modules."""
    uid, email = "test-deckcheck-tenant", "deckcheck-tenant@example.com"
    tenant_id = db.execute(
        text(
            "INSERT INTO tenants (name) VALUES ('Deck Check Test Tenant') RETURNING id"
        )
    ).scalar()
    db.execute(
        text(
            "INSERT INTO users (firebase_uid, tenant_id, email) "
            "VALUES (:uid, :tenant_id, :email)"
        ),
        {"uid": uid, "tenant_id": tenant_id, "email": email},
    )
    db.commit()

    variant_ids = deck_check_catalog["variant_ids"]
    quantities = {
        "dc1-var-leader-std": 1,
        "dc1-var-base-std": 1,
        "dc1-var-x-std": 2,  # sideboard-subtraction: main needs 2, side needs 1
        "dc1-var-y-std": 0,
        "dc1-var-y-foil": 1,  # foils-only ownership
        # priced/fallback/unpriced cards: 0 owned, all missing
    }
    for swuapi_id, qty in quantities.items():
        db.execute(
            text(
                "INSERT INTO inventory (tenant_id, variant_id, quantity) "
                "VALUES (:tenant_id, :variant_id, :quantity)"
            ),
            {
                "tenant_id": tenant_id,
                "variant_id": variant_ids[swuapi_id],
                "quantity": qty,
            },
        )
    db.commit()

    yield {"uid": uid, "email": email, "tenant_id": tenant_id}

    db.rollback()
    db.execute(text("DELETE FROM inventory WHERE tenant_id = :tid"), {"tid": tenant_id})
    db.execute(text("DELETE FROM users WHERE firebase_uid = :uid"), {"uid": uid})
    db.execute(text("DELETE FROM tenants WHERE id = :tid"), {"tid": tenant_id})
    db.commit()


def _deck_check_client(make_client, deck_check_tenant):
    return make_client(uid=deck_check_tenant["uid"], email=deck_check_tenant["email"])


class TestSideboardSubtractionAndOwnership:
    def test_named_sideboard_subtraction_case_end_to_end(
        self, make_client, deck_check_catalog, deck_check_tenant
    ):
        """Definition_DeckCheck §4's required acceptance case, exercised
        through the full API: deck runs 2 main + 1 side of card X, tenant
        owns 2 -> main buildable, side NOT (missing 1), together NOT."""
        tenant_client = _deck_check_client(make_client, deck_check_tenant)
        deck_json = {
            "leader": {"id": "DC1_1", "count": 1},
            "base": {"id": "DC1_2", "count": 1},
            "deck": [{"id": "DC1_3", "count": 2}],
            "sideboard": [{"id": "DC1_3", "count": 1}],
        }
        response = tenant_client.post("/api/deck-check", json={"deck_json": deck_json})
        assert response.status_code == 200
        body = response.json()
        assert body["unrecognized"] == []

        assert body["scopes"]["main"]["buildable"] is True
        assert body["scopes"]["main"]["missing"] == []

        assert body["scopes"]["side"]["buildable"] is False
        side_missing = body["scopes"]["side"]["missing"]
        assert len(side_missing) == 1
        assert side_missing[0]["need"] == 1
        assert side_missing[0]["have"] == 0
        assert side_missing[0]["card"]["name"] == "DC1 Sideboard Test Card"

        assert body["scopes"]["together"]["buildable"] is False

    def test_foils_only_ownership_still_buildable(
        self, make_client, deck_check_catalog, deck_check_tenant
    ):
        """Definition_DeckCheck §4/§8: ownership is finish-agnostic -- the
        tenant owns 0 Standard + 1 Foil of card Y, needs 1 in main ->
        still buildable."""
        tenant_client = _deck_check_client(make_client, deck_check_tenant)
        deck_json = {
            "leader": {"id": "DC1_1", "count": 1},
            "base": {"id": "DC1_2", "count": 1},
            "deck": [{"id": "DC1_4", "count": 1}],
        }
        response = tenant_client.post("/api/deck-check", json={"deck_json": deck_json})
        assert response.status_code == 200
        body = response.json()
        assert body["scopes"]["main"]["buildable"] is True
        assert body["scopes"]["main"]["missing"] == []


class TestCostMath:
    def test_standard_mode_prices_missing_cards_with_fallback_and_unpriced(
        self, make_client, deck_check_catalog, deck_check_tenant
    ):
        tenant_client = _deck_check_client(make_client, deck_check_tenant)
        deck_json = {
            "leader": {"id": "DC1_1", "count": 1},
            "base": {"id": "DC1_2", "count": 1},
            "deck": [
                {"id": "DC1_5", "count": 1},  # priced (Standard=5.0)
                {"id": "DC1_6", "count": 1},  # fallback (Standard unpriced, HS=7.5)
                {"id": "DC1_7", "count": 1},  # fully unpriced
            ],
        }
        response = tenant_client.post(
            "/api/deck-check",
            json={"deck_json": deck_json},
            params={"mode": "standard"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["pricing"]["mode"] == "standard"
        assert body["pricing"]["source"] == "tcgplayer"

        missing_by_name = {
            m["card"]["name"]: m for m in body["scopes"]["main"]["missing"]
        }
        priced = missing_by_name["DC1 Priced Test Card"]
        assert priced["unit_price"] == 5.0
        assert priced["price_basis"] == "standard"
        assert priced["subtotal"] == 5.0

        fallback = missing_by_name["DC1 Fallback Test Card"]
        assert fallback["unit_price"] == 7.5
        assert fallback["price_basis"] == "fallback"
        assert fallback["subtotal"] == 7.5

        unpriced = missing_by_name["DC1 Unpriced Test Card"]
        assert unpriced["unit_price"] is None
        assert unpriced["price_basis"] is None
        assert unpriced["subtotal"] is None

        # leader/base are owned (quantity 1 each, deck_check_tenant fixture)
        # so only the 3 explicit deck cards contribute; the fully-unpriced
        # card is excluded from the total per Definition_DeckCheck §5.
        assert body["scopes"]["main"]["missing_total"] == pytest.approx(5.0 + 7.5)
        assert body["scopes"]["main"]["unpriced_count"] == 1
        assert body["scopes"]["main"]["cart_url"] is not None
        assert body["scopes"]["main"]["cart_url"].startswith(
            "https://www.tcgplayer.com/massentry?"
        )
        # Subtitled cards must join name and subtitle with " - " (TCGplayer's
        # product naming) or Mass Entry finds nothing (owner repro 2026-07-21:
        # "2 Han Solo [LAW]" resolved nothing; "2 Han Solo - Hibernation Sick
        # [LAW]" required). quote_plus form: spaces -> '+', '-' literal.
        assert (
            "DC1+Priced+Test+Card+-+Test+Subtitle" in body["scopes"]["main"]["cart_url"]
        )

    def test_cheapest_mode_picks_min_low_across_printings(
        self, make_client, deck_check_catalog, deck_check_tenant
    ):
        tenant_client = _deck_check_client(make_client, deck_check_tenant)
        deck_json = {
            "leader": {"id": "DC1_1", "count": 1},
            "base": {"id": "DC1_2", "count": 1},
            "deck": [{"id": "DC1_5", "count": 1}],
        }
        response = tenant_client.post(
            "/api/deck-check",
            json={"deck_json": deck_json},
            params={"mode": "cheapest"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["pricing"]["mode"] == "cheapest"
        missing = body["scopes"]["main"]["missing"]
        priced = next(m for m in missing if m["card"]["name"] == "DC1 Priced Test Card")
        # Hyperspace's low (1.0) undercuts Standard's low (4.0).
        assert priced["unit_price"] == 1.0
        assert priced["price_basis"] == "cheapest"


class TestFullCardListAndDeckValue:
    """BL-142: the ALL CARDS full-list extension + per-scope market value.
    All three tests exercise `scopes.*.all_cards` / `deck_value` /
    `unpriced_value_count` against the same isolated DC1 fixture the cost-
    math tests above use."""

    def test_deck_value_includes_owned_and_missing_cards_unpriced_excluded(
        self, db, make_client, deck_check_catalog, deck_check_tenant
    ):
        # Top up the priced card so it's FULLY owned in this deck (the
        # shared fixture leaves it at 0) -- the point of this test is that
        # deck_value must count an already-owned card's value too, unlike
        # missing_total which never sees a fully-owned card at all.
        variant_ids = deck_check_catalog["variant_ids"]
        db.execute(
            text(
                "INSERT INTO inventory (tenant_id, variant_id, quantity) "
                "VALUES (:tenant_id, :variant_id, :quantity)"
            ),
            {
                "tenant_id": deck_check_tenant["tenant_id"],
                "variant_id": variant_ids["dc1-var-priced-std"],
                "quantity": 2,
            },
        )
        db.commit()

        tenant_client = _deck_check_client(make_client, deck_check_tenant)
        deck_json = {
            "leader": {"id": "DC1_1", "count": 1},
            "base": {"id": "DC1_2", "count": 1},
            "deck": [
                {"id": "DC1_5", "count": 2},  # priced, now fully owned (2/2)
                {"id": "DC1_6", "count": 1},  # fallback, missing (HS=7.5)
                {"id": "DC1_7", "count": 1},  # fully unpriced, missing
            ],
        }
        response = tenant_client.post(
            "/api/deck-check",
            json={"deck_json": deck_json},
            params={"mode": "standard"},
        )
        assert response.status_code == 200
        body = response.json()
        main = body["scopes"]["main"]

        # DC1_5 is fully owned -> absent from `missing`, present in `all_cards`.
        missing_names = {m["card"]["name"] for m in main["missing"]}
        assert "DC1 Priced Test Card" not in missing_names
        assert "DC1 Fallback Test Card" in missing_names
        assert "DC1 Unpriced Test Card" in missing_names

        all_by_name = {c["card"]["name"]: c for c in main["all_cards"]}
        priced_row = all_by_name["DC1 Priced Test Card"]
        assert priced_row["need"] == 2
        assert priced_row["have"] == 2
        assert priced_row["unit_price"] == 5.0
        assert priced_row["price_basis"] == "standard"
        assert priced_row["line_value"] == pytest.approx(10.0)  # 2 * 5.0

        # deck_value = the COMPLETE list's value regardless of ownership:
        # leader (1, unpriced) + base (1, unpriced) + priced (2 * 5.0 =
        # 10.0) + fallback (1 * 7.5 = 7.5) + unpriced card (excluded).
        # Leader/base carry no price rows in this fixture, so they land in
        # unpriced_value_count alongside the fully-unpriced card.
        assert main["deck_value"] == pytest.approx(10.0 + 7.5)
        assert main["unpriced_value_count"] == 3  # leader + base + DC1_7

        # missing_total is unaffected by the now-owned card -- only the
        # fallback card is still missing (DC1_5 no longer missing at all).
        assert main["missing_total"] == pytest.approx(7.5)

    def test_all_cards_is_a_strict_superset_of_missing_with_matching_fields(
        self, make_client, deck_check_catalog, deck_check_tenant
    ):
        """Every card in `missing` must also appear in `all_cards` with the
        identical need/have/unit_price/price_basis -- the full list is a
        superset, never a re-derivation with different math."""
        tenant_client = _deck_check_client(make_client, deck_check_tenant)
        deck_json = {
            "leader": {"id": "DC1_1", "count": 1},
            "base": {"id": "DC1_2", "count": 1},
            "deck": [{"id": "DC1_5", "count": 1}],
        }
        response = tenant_client.post(
            "/api/deck-check",
            json={"deck_json": deck_json},
            params={"mode": "standard"},
        )
        body = response.json()
        main = body["scopes"]["main"]
        all_by_name = {c["card"]["name"]: c for c in main["all_cards"]}
        for m in main["missing"]:
            row = all_by_name[m["card"]["name"]]
            assert row["need"] == m["need"]
            assert row["have"] == m["have"]
            assert row["unit_price"] == m["unit_price"]
            assert row["price_basis"] == m["price_basis"]
        # Leader/base are fully owned (and unpriced) -- present in
        # all_cards, absent from missing.
        assert len(main["all_cards"]) == 3  # leader + base + priced card
        assert len(main["missing"]) == 1  # only the priced card is missing

    def test_mode_consistency_cheapest_deck_value_matches_missing_cost_basis(
        self, make_client, deck_check_catalog, deck_check_tenant
    ):
        """The definition package doesn't settle whether deck VALUE should
        respect the standard|cheapest mode param; this build applies the
        same mode semantics to deck_value as to missing-cost (flagged in
        the PR description) -- so cheapest mode's deck_value for a missing
        card must use the same min(low)-across-printings price as its
        missing subtotal, never silently reverting to standard-mode
        pricing."""
        tenant_client = _deck_check_client(make_client, deck_check_tenant)
        deck_json = {
            "leader": {"id": "DC1_1", "count": 1},
            "base": {"id": "DC1_2", "count": 1},
            "deck": [{"id": "DC1_5", "count": 1}],
        }
        response = tenant_client.post(
            "/api/deck-check",
            json={"deck_json": deck_json},
            params={"mode": "cheapest"},
        )
        body = response.json()
        main = body["scopes"]["main"]
        priced_row = next(
            c for c in main["all_cards"] if c["card"]["name"] == "DC1 Priced Test Card"
        )
        assert priced_row["unit_price"] == 1.0  # HS low=1.0 undercuts Standard low=4.0
        assert priced_row["price_basis"] == "cheapest"
        assert priced_row["line_value"] == pytest.approx(1.0)
        # deck_value must reflect the SAME cheapest price, not silently
        # revert to the standard-mode market price (5.0) -- that would make
        # deck_value disagree with all_cards and missing_total alike.
        assert main["deck_value"] == pytest.approx(1.0)
        assert main["missing_total"] == pytest.approx(1.0)


DECK_CHECK_ISOLATION_DECK_JSON = {
    "leader": {"id": "DC1_1", "count": 1},
    "base": {"id": "DC1_2", "count": 1},
    "deck": [{"id": "DC1_3", "count": 2}],
}


class TestTenantIsolation:
    """Split into separate test functions rather than one test juggling two
    authenticated clients -- conftest.make_client's override lives on the
    shared `app.dependency_overrides` dict, so a second make_client() call
    within the same test silently reassigns which identity EVERY
    TestClient built from that fixture instance authenticates as (the same
    pitfall test_tenant_isolation.py avoids by never mixing `client` and
    `tenant_two_client` calls within one test body). Two single-client
    tests plus a direct RLS-level repository check below together prove
    the same "never sees another tenant's inventory" property without
    relying on cross-client call ordering."""

    def test_tenant_with_inventory_is_buildable(
        self, make_client, deck_check_catalog, deck_check_tenant
    ):
        tenant_client = _deck_check_client(make_client, deck_check_tenant)
        response = tenant_client.post(
            "/api/deck-check", json={"deck_json": DECK_CHECK_ISOLATION_DECK_JSON}
        )
        assert response.status_code == 200
        assert response.json()["scopes"]["main"]["buildable"] is True

    def test_brand_new_tenant_with_no_inventory_is_not_buildable(
        self, make_client, db, deck_check_catalog
    ):
        """Same deck, same card ids as the test above -- a tenant with no
        inventory rows for these variants at all must see them all
        missing, never inheriting another tenant's owned quantities."""
        uid_b, email_b = "test-deckcheck-tenant-b", "deckcheck-tenant-b@example.com"
        try:
            client_b = make_client(uid=uid_b, email=email_b)
            response = client_b.post(
                "/api/deck-check", json={"deck_json": DECK_CHECK_ISOLATION_DECK_JSON}
            )
            assert response.status_code == 200
            assert response.json()["scopes"]["main"]["buildable"] is False
            assert len(response.json()["scopes"]["main"]["missing"]) == 3
        finally:
            from .conftest import delete_provisioned_identity

            delete_provisioned_identity(db, uid_b)

    def test_rls_get_owned_quantities_is_scoped_per_tenant(
        self, db, deck_check_catalog, deck_check_tenant
    ):
        """Direct repository-level proof (mirrors test_tenant_isolation.py's
        app_db/SET LOCAL pattern): the exact query
        app.repositories.deck_check.get_owned_quantities issues, run as
        deck_check_tenant, returns ONLY that tenant's quantity for card X
        -- never tenant #1's or any other tenant's rows for the same
        base_card_id, even though this is the same "naive" unfiltered
        query shape (no explicit tenant_id filter in the SQL)."""
        import os

        from sqlalchemy import create_engine
        from sqlalchemy import text as sa_text
        from sqlalchemy.orm import sessionmaker

        from app.repositories import deck_check as deck_check_repo

        engine = create_engine(os.environ["APP_DATABASE_URL"])
        Session = sessionmaker(bind=engine)
        app_db = Session()
        try:
            base_card_id_x = deck_check_catalog["base_card_ids"]["dc1-base-x"]

            app_db.execute(
                sa_text("SET LOCAL app.current_tenant_id = :tid"),
                {"tid": str(deck_check_tenant["tenant_id"])},
            )
            owned = deck_check_repo.get_owned_quantities(app_db, [base_card_id_x])
            app_db.rollback()
            assert owned.get(base_card_id_x) == 2  # deck_check_tenant's seeded qty

            app_db.execute(sa_text("SET LOCAL app.current_tenant_id = '1'"))
            owned_tenant_one = deck_check_repo.get_owned_quantities(
                app_db, [base_card_id_x]
            )
            app_db.rollback()
            # Tenant #1 never inserted an inventory row for this isolated
            # fixture card -- absent from the dict, not a leaked 2.
            assert base_card_id_x not in owned_tenant_one
        finally:
            app_db.close()


# ---------------------------------------------------------------------------
# BL-53 (revised scope, A4-13): per-tenant rate limit + deck_json body cap.
# ---------------------------------------------------------------------------


class TestRateLimit:
    def test_limit_trips_after_max_calls_and_carries_retry_after(self, client):
        """Body content doesn't matter for tripping the limiter -- it's
        checked before the url/deck_json XOR validation (same "before any
        work" placement as the feedback limiter), so an otherwise-invalid
        empty body still consumes a call slot on every attempt up to the
        cap."""
        from app.routers.deck_check import DECK_CHECK_RATE_LIMIT_CALLS

        for _ in range(DECK_CHECK_RATE_LIMIT_CALLS):
            resp = client.post("/api/deck-check", json={})
            assert resp.status_code == 422  # invalid_deck_json, not limited yet

        limited = client.post("/api/deck-check", json={})
        assert limited.status_code == 429
        assert limited.json()["detail"]["error"] == "rate_limited"
        retry_after = int(limited.headers["Retry-After"])
        assert retry_after > 0

    def test_rate_limit_is_scoped_per_tenant(self, make_client, db):
        """Mirrors test_inventory_import_api.py::TestRateLimit's tenant-
        isolation check -- tenant A exhausting deck-check's budget must
        never limit tenant B, since check_tenant_rate_limit keys on
        request.state.tenant_id.

        make_client(...) overrides get_current_identity on the shared
        `app` object, live at call time rather than construction time --
        tenant A's client is fully exhausted (built AND used) before
        tenant B's client is even constructed, so the two never
        interleave and silently swap identities out from under each
        other."""
        from app.routers.deck_check import DECK_CHECK_RATE_LIMIT_CALLS

        from .conftest import delete_provisioned_identity

        uid_a, uid_b = "bl53-deckcheck-tenant-a", "bl53-deckcheck-tenant-b"
        try:
            client_a = make_client(uid=uid_a, email="a@example.com")
            for _ in range(DECK_CHECK_RATE_LIMIT_CALLS):
                resp = client_a.post("/api/deck-check", json={})
                assert resp.status_code == 422

            exhausted = client_a.post("/api/deck-check", json={})
            assert exhausted.status_code == 429

            client_b = make_client(uid=uid_b, email="b@example.com")
            still_fine = client_b.post("/api/deck-check", json={})
            assert still_fine.status_code == 422  # reaches validation, not limited
        finally:
            delete_provisioned_identity(db, uid_a)
            delete_provisioned_identity(db, uid_b)


class TestDeckJsonSizeCap:
    def test_oversized_deck_json_returns_422_before_parse(self, client):
        from app.routers.deck_check import MAX_DECK_JSON_BYTES

        # A single oversized field is enough to blow the cap without
        # needing a structurally valid deck shape -- confirms the cap is
        # checked before deck_parse's structural validation runs (an
        # invalid-but-under-cap deck_json gets invalid_deck_json instead,
        # exercised by TestTypedErrors.test_malformed_deck_json_structure).
        deck_json = {"padding": "x" * (MAX_DECK_JSON_BYTES + 1)}
        response = client.post("/api/deck-check", json={"deck_json": deck_json})
        assert response.status_code == 422
        assert response.json()["detail"]["error"] == "deck_json_too_large"

    def test_deck_json_under_the_cap_is_not_rejected_by_the_size_check(
        self, client, dynamic_deck_ids
    ):
        """A normal-sized, structurally valid deck_json must sail past the
        size cap unaffected -- this is the existing resolution test's
        payload shape, just re-asserted here to pin the cap's threshold
        doesn't false-positive on real traffic."""
        deck_json = {
            "metadata": {"name": "size cap regression deck"},
            "leader": {"id": dynamic_deck_ids["leader_id"], "count": 1},
            "base": {"id": dynamic_deck_ids["base_id"], "count": 1},
            "deck": [{"id": uid, "count": 1} for uid in dynamic_deck_ids["unit_ids"]],
        }
        response = client.post("/api/deck-check", json={"deck_json": deck_json})
        assert response.status_code == 200
