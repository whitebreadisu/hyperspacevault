"""GET /api/public/cards (card-pages release): the card-page generator's
input document. Contract: frontend/src/public/publicCatalog.ts.

Two layers. The first class stubs the repository reads, so it needs no
database and pins the shape, headers, price source and build sha. The
second class (needs DATABASE_URL) runs the real queries against the seeded
catalog: tokens excluded, counts, a fixed query count, and that the price
comes from variant_latest_prices without touching variant_prices.
"""

import os
import re
from datetime import date
from types import SimpleNamespace as NS

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, text

from app.database import get_catalog_db
from app.main import app
from app.repositories import cards as card_repo
from app.repositories import pricing as pricing_repo
from app.routers.public import PUBLIC_CATALOG_CACHE_CONTROL

# publicCatalog.ts: PublicCatalog / PublicSet / PublicCard / PublicVariant
# (VariantDetail minus quantity).
CATALOG_KEYS = {"build_sha", "sets", "counts", "cards"}
SET_KEYS = {"code", "name", "is_base_set", "release_date"}
CARD_KEYS = {
    "id",
    "set_code",
    "set_name",
    "base_card_number",
    "name",
    "subtitle",
    "type",
    "type2",
    "double_sided",
    "rarity",
    "cost",
    "power",
    "hp",
    "arena",
    "is_unique",
    "front_text",
    "back_text",
    "epic_action",
    "artist",
    "is_token",
    "aspects",
    "keywords",
    "traits",
    "variants",
}
VARIANT_KEYS = {
    "variant_id",
    "variant_type",
    "finish",
    "channel",
    "stamped",
    "source_set_code",
    "source_set_name",
    "card_number",
    "front_image_url",
    "back_image_url",
    "front_images",
    "back_images",
    "stamp_group",
    "price",
}


def _all_keys(value) -> set[str]:
    """Every dict key anywhere in a JSON value."""
    found: set[str] = set()
    if isinstance(value, dict):
        for k, v in value.items():
            found.add(k)
            found |= _all_keys(v)
    elif isinstance(value, list):
        for item in value:
            found |= _all_keys(item)
    return found


def _stub_rows() -> card_repo.PublicCatalogRows:
    base = NS(
        id=7,
        base_card_number="5",
        name="Stub Card",
        subtitle=None,
        type="Unit",
        type2=None,
        double_sided=False,
        rarity="Common",
        cost=2,
        power=3,
        hp=4,
        arena="Ground",
        is_unique=False,
        front_text="Text",
        back_text=None,
        epic_action=None,
        artist="A. Artist",
        is_token=False,
        set_code="SOR",
        set_name="Spark of Rebellion",
    )
    variants = [
        NS(
            id=70,
            base_card_id=7,
            variant_type="Standard",
            source_set_code="SOR",
            source_set_name="Spark of Rebellion",
            card_number="5",
            front_image_url=None,
            back_image_url=None,
            stamp_group=None,
        ),
        NS(
            id=71,
            base_card_id=7,
            variant_type="Hyperspace",
            source_set_code="SOR",
            source_set_name="Spark of Rebellion",
            card_number="305",
            front_image_url=(
                "https://cdn.starwarsunlimited.com/card_00305_EN_Stub_aaaaaaaaaa.png"
            ),
            back_image_url=None,
            stamp_group=None,
        ),
    ]
    return card_repo.PublicCatalogRows(
        set_rows=[
            NS(
                code="SOR",
                name="Spark of Rebellion",
                is_base_set=True,
                release_date=date(2024, 3, 8),
            )
        ],
        count_rows=[("SOR", 1)],
        base_rows=[base],
        aspect_rows=[(7, "Vigilance")],
        keyword_rows=[(7, "Sentinel")],
        trait_rows=[(7, "Rebel")],
        variant_rows=variants,
    )


@pytest.fixture
def stubbed_client(monkeypatch):
    monkeypatch.setattr(card_repo, "get_public_catalog_rows", lambda db: _stub_rows())
    monkeypatch.setattr(card_repo, "begin_read_snapshot", lambda db: None)
    monkeypatch.setattr(
        pricing_repo,
        "get_latest_prices",
        lambda db, variant_ids=None: {
            70: NS(market=1.5, low=1.0, as_of=date(2026, 11, 1))
        },
    )
    app.dependency_overrides[get_catalog_db] = lambda: object()
    yield TestClient(app)
    app.dependency_overrides.pop(get_catalog_db, None)


class TestPublicCardsShape:
    def test_matches_the_contract_keys(self, stubbed_client):
        body = stubbed_client.get("/api/public/cards").json()
        assert set(body) == CATALOG_KEYS
        assert set(body["sets"][0]) == SET_KEYS
        assert body["sets"][0]["release_date"] == "2024-03-08"
        assert body["counts"] == {"SOR": 1}
        card = body["cards"][0]
        assert set(card) == CARD_KEYS
        assert card["aspects"] == ["Vigilance"]
        assert card["keywords"] == ["Sentinel"]
        assert card["traits"] == ["Rebel"]
        assert card["is_token"] is False
        for variant in card["variants"]:
            assert set(variant) == VARIANT_KEYS

    def test_no_quantity_anywhere(self, stubbed_client):
        body = stubbed_client.get("/api/public/cards").json()
        assert "quantity" not in _all_keys(body)

    def test_price_comes_from_the_latest_price_table(self, stubbed_client):
        body = stubbed_client.get("/api/public/cards").json()
        variants = body["cards"][0]["variants"]
        assert variants[0]["price"] == {
            "market": 1.5,
            "low": 1.0,
            "as_of": "2026-11-01",
        }
        assert variants[1]["price"] is None  # unpriced stays null
        # renditions are derived exactly as the detail route derives them
        assert variants[1]["front_images"]["w320"].endswith("_320.webp")
        assert variants[0]["front_images"] is None

    def test_build_sha_from_env(self, stubbed_client, monkeypatch):
        monkeypatch.setenv("COMMIT_SHA", "abc123def")
        body = stubbed_client.get("/api/public/cards").json()
        assert body["build_sha"] == "abc123def"

    def test_build_sha_defaults_to_local(self, stubbed_client, monkeypatch):
        monkeypatch.delenv("COMMIT_SHA", raising=False)
        body = stubbed_client.get("/api/public/cards").json()
        assert body["build_sha"] == "local"

    def test_cache_control_is_cdn_only_public(self, stubbed_client):
        response = stubbed_client.get("/api/public/cards")
        assert response.headers["cache-control"] == "public, s-maxage=3600"
        assert PUBLIC_CATALOG_CACHE_CONTROL == "public, s-maxage=3600"

    def test_needs_no_tenant_or_token(self, stubbed_client):
        # No Authorization header and no identity override: tenant-less.
        assert stubbed_client.get("/api/public/cards").status_code == 200


@pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL -- run inside the backend container",
)
class TestPublicCardsAgainstDatabase:
    @pytest.fixture
    def token_and_price(self, db):
        """A SOR token base card (must NOT appear) and a latest price on a
        seeded variant."""
        sor_id = db.execute(text("SELECT id FROM sets WHERE code='SOR'")).scalar()
        db.execute(
            text(
                "INSERT INTO base_cards (set_id, base_card_number, name, type, "
                "rarity, swuapi_id, is_token) VALUES (:s, '9990', "
                "'Public Test Token', 'Token Unit', 'Common', 'pub-test-token', "
                "true) ON CONFLICT (swuapi_id) DO UPDATE SET is_token = true"
            ),
            {"s": sor_id},
        )
        variant_id = db.execute(
            text("SELECT id FROM card_variants WHERE swuapi_id='test-v0001'")
        ).scalar()
        # Clear any price an earlier test left, so the upsert starts from none.
        db.execute(
            text("DELETE FROM variant_latest_prices WHERE variant_id=:v"),
            {"v": variant_id},
        )
        pricing_repo.upsert_latest_price(db, variant_id, 12.34, 10.0, date(2026, 11, 1))
        db.commit()
        yield variant_id
        db.execute(
            text("DELETE FROM variant_latest_prices WHERE variant_id=:v"),
            {"v": variant_id},
        )
        db.execute(text("DELETE FROM base_cards WHERE swuapi_id='pub-test-token'"))
        db.commit()

    def test_needs_no_tenant_or_token(self, token_and_price, monkeypatch):
        # A plain TestClient: no dependency overrides, no Authorization
        # header, no identity -- the route must work as an anonymous caller.
        monkeypatch.setattr(app, "dependency_overrides", {})
        response = TestClient(app).get("/api/public/cards")
        assert response.status_code == 200
        assert "Authorization" not in response.request.headers

    def test_cards_are_in_set_then_number_order(self, client, token_and_price):
        cards = client.get("/api/public/cards").json()["cards"]
        keys = [
            (
                c["set_code"],
                int(c["base_card_number"])
                if c["base_card_number"].isdigit()
                else 10**6,
            )
            for c in cards
        ]
        assert keys == sorted(keys)

    def test_tokens_excluded_and_counts_match(self, client, token_and_price):
        body = client.get("/api/public/cards").json()
        names = {c["name"] for c in body["cards"]}
        assert "Public Test Token" not in names
        assert "Test Leader Alpha" in names
        assert all(c["is_token"] is False for c in body["cards"])
        sor_cards = [c for c in body["cards"] if c["set_code"] == "SOR"]
        assert body["counts"]["SOR"] == len(sor_cards)
        assert "quantity" not in _all_keys(body)

    def test_price_read_from_latest_table_only(self, client, token_and_price):
        from app.database import app_engine

        statements: list[str] = []

        def _capture(conn, cursor, statement, *args):
            statements.append(statement)

        event.listen(app_engine, "before_cursor_execute", _capture)
        try:
            body = client.get("/api/public/cards").json()
        finally:
            event.remove(app_engine, "before_cursor_execute", _capture)

        leader = next(c for c in body["cards"] if c["name"] == "Test Leader Alpha")
        assert leader["variants"][0]["price"] == {
            "market": 12.34,
            "low": 10.0,
            "as_of": "2026-11-01",
        }
        assert not any(re.search(r"\bvariant_prices\b", s) for s in statements)

    def test_query_count_is_fixed(self, client, token_and_price):
        """Exactly 11 statements: two set_config calls (catalog session
        setup), SET TRANSACTION (the snapshot), then eight data SELECTs
        (sets, counts, base cards, aspects, keywords, traits, variants,
        latest prices). An N+1 would scale with the card count."""
        from app.database import app_engine

        count = 0

        def _count(*args, **kwargs):
            nonlocal count
            count += 1

        event.listen(app_engine, "before_cursor_execute", _count)
        try:
            response = client.get("/api/public/cards")
        finally:
            event.remove(app_engine, "before_cursor_execute", _count)
        assert response.status_code == 200
        assert len(response.json()["cards"]) >= 6
        assert count == 11
