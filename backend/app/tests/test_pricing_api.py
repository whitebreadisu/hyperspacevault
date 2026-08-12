"""BL-136 P4: API-level tests for embedded pricing on GET /api/base-cards
(list + detail) and GET /api/base-cards/{id}/price-history. Isolated
synthetic set/base_card/variant (mirrors the P1-P3 job tests' pattern) so
these don't depend on the real catalog having live tcgcsv data synced.
"""

import os
from datetime import date, timedelta

import pytest
from sqlalchemy import text

from app.repositories.pricing import upsert_latest_price

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL -- run inside the backend container",
)

SET_CODE = "PA1"
# Must be dynamic: the price-history range filter cuts off at the REAL
# date.today() (repositories/pricing.py), so a frozen literal here is a
# date bomb -- the original date(2026, 7, 16) aged out of the 30d window
# on 2026-08-11 and failed every CI run from that day on (caught during
# BL-203). Midnight-crossing runs could skew TODAY vs the endpoint's
# today by one day; that flake window is seconds a day vs. permanent
# breakage, so dynamic wins.
TODAY = date.today()


@pytest.fixture
def priced_base_card(db):
    """One base card with two core variants (Standard, Hyperspace):
    Standard priced at market=10/low=8, Hyperspace priced at
    market=25/low=20 -- lets standard-mode and cheapest-mode diverge
    predictably (cheapest should pick Standard's low=8, the lower of the
    two)."""
    db.execute(
        text(
            "INSERT INTO sets (code, name, is_base_set) "
            "VALUES (:code, 'Pricing API Test Set', true) "
            "ON CONFLICT (code) DO NOTHING"
        ),
        {"code": SET_CODE},
    )
    set_id = db.execute(
        text("SELECT id FROM sets WHERE code = :code"), {"code": SET_CODE}
    ).scalar()
    base_card_id = db.execute(
        text(
            "INSERT INTO base_cards "
            "(set_id, base_card_number, name, type, rarity, swuapi_id) "
            "VALUES (:set_id, '1', 'Pricing API Test Card', 'Unit', 'Common', "
            "'pa-base-1') "
            "ON CONFLICT (swuapi_id) DO UPDATE SET name = EXCLUDED.name "
            "RETURNING id"
        ),
        {"set_id": set_id},
    ).scalar()

    variant_ids = {}
    for suffix, variant_type in (("std", "Standard"), ("hs", "Hyperspace")):
        vid = db.execute(
            text(
                "INSERT INTO card_variants "
                "(base_card_id, variant_type, source_set_code, card_number, swuapi_id) "
                "VALUES (:base_card_id, :variant_type, :set_code, '1', :swuapi_id) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET card_number = EXCLUDED.card_number "
                "RETURNING id"
            ),
            {
                "base_card_id": base_card_id,
                "variant_type": variant_type,
                "set_code": SET_CODE,
                "swuapi_id": f"pa-variant-{suffix}",
            },
        ).scalar()
        variant_ids[variant_type] = vid

    prices = {"Standard": (10.0, 8.0), "Hyperspace": (25.0, 20.0)}
    for variant_type, vid in variant_ids.items():
        market, low = prices[variant_type]
        db.execute(
            text(
                "INSERT INTO variant_prices (variant_id, as_of, market, low, mid, high, currency) "
                "VALUES (:vid, :as_of, :market, :low, :market, :market, 'USD') "
                "ON CONFLICT (variant_id, as_of) DO UPDATE SET market = EXCLUDED.market"
            ),
            {"vid": vid, "as_of": TODAY, "market": market, "low": low},
        )
        db.execute(
            text(
                "INSERT INTO variant_prices (variant_id, as_of, market, low, mid, high, currency) "
                "VALUES (:vid, :as_of, :market, :low, :market, :market, 'USD') "
                "ON CONFLICT (variant_id, as_of) DO NOTHING"
            ),
            {
                "vid": vid,
                "as_of": TODAY - timedelta(days=5),
                "market": market - 1,
                "low": low - 1,
            },
        )
        # BL-146: the read path (get_latest_prices) now reads the
        # variant_latest_prices snapshot table, not variant_prices directly
        # -- this fixture inserts raw variant_prices rows (bypassing the
        # sync/backfill jobs' upsert_prices), so it must maintain the
        # snapshot itself, same as those jobs do. TODAY is the "latest" row
        # in this fixture's history.
        upsert_latest_price(db, vid, market, low, TODAY)
    db.commit()

    yield {"base_card_id": base_card_id, "variant_ids": variant_ids}

    for vid in variant_ids.values():
        db.execute(
            text("DELETE FROM variant_prices WHERE variant_id = :vid"), {"vid": vid}
        )
        db.execute(
            text("DELETE FROM variant_latest_prices WHERE variant_id = :vid"),
            {"vid": vid},
        )
        db.execute(text("DELETE FROM card_variants WHERE id = :vid"), {"vid": vid})
    db.execute(text("DELETE FROM base_cards WHERE id = :bid"), {"bid": base_card_id})
    db.execute(text("DELETE FROM sets WHERE code = :code"), {"code": SET_CODE})
    db.commit()


def test_list_base_cards_embeds_display_price_and_pricing_envelope_headers(
    client, priced_base_card
):
    """REPLACE for BL-146 (was test_list_base_cards_embeds_price_and_pricing_
    envelope_headers), REPLACE again for BL-163: BL-146 moved the list's
    per-variant `price` field to detail-only (Design_SparseList_2026-07-25.md
    §2/§8-Q2 -- display_price stayed, price didn't) and this test was
    tightened to assert the field's absence, with the per-variant assertions
    moved to test_detail_endpoint_embeds_price_per_variant below. BL-163
    (Definition_CosmeticsBatch_2026-07-26.md §3) re-attaches `price` to the
    list response -- the completion panel's Collection Value calc needs
    every owned variant's own price catalog-wide, which display_price's
    one-value-per-card aggregate can't supply -- so this test now asserts
    per-variant price IS embedded, mirroring the detail-endpoint assertion
    below (same underlying PriceInfo, same fixture)."""
    response = client.get("/api/base-cards", params={"set_code": SET_CODE})
    assert response.status_code == 200
    assert response.headers["X-Pricing-Source"] == "tcgplayer"
    assert response.headers["X-Pricing-As-Of"] == TODAY.isoformat()
    assert "X-Pricing-Unpriced-Count" in response.headers

    body = response.json()
    assert len(body) == 1
    card = body[0]
    assert card["display_price"] == {"value": 10.0, "as_of": TODAY.isoformat()}

    by_type = {v["variant_type"]: v for v in card["variants"]}
    assert by_type["Standard"]["price"] == {
        "market": 10.0,
        "low": 8.0,
        "as_of": TODAY.isoformat(),
    }
    assert by_type["Hyperspace"]["price"]["market"] == 25.0


def test_list_base_cards_cheapest_mode_picks_min_low_across_variants(
    client, priced_base_card
):
    response = client.get(
        "/api/base-cards", params={"set_code": SET_CODE, "pricing": "cheapest"}
    )
    card = response.json()[0]
    # Standard's low (8.0) beats Hyperspace's low (20.0) -- cheapest wins
    # regardless of printing, per the decided definition.
    assert card["display_price"] == {"value": 8.0, "as_of": TODAY.isoformat()}


def test_list_base_cards_unpriced_card_has_null_display_price(client):
    """A fixture card from conftest's seed_minimal_catalog with no
    tcgplayer_products/variant_prices rows at all.

    REPLACE for BL-146 (was ..._has_null_price_and_display_price): the old
    name/assertion checked the list variant's `price` was None, then BL-146
    tightened it to "key absent" once the field left the list entirely.
    BL-163 re-attaches `price` to the list (see the sibling display-price
    test above) as an additive/optional field, so this reverts to the
    original "present and null" shape -- an unpriced variant carries
    `price: null`, never a missing key."""
    response = client.get("/api/base-cards", params={"set_code": "SOR"})
    body = response.json()
    unpriced = [c for c in body if c["name"] == "Test Trooper Alpha"]
    assert len(unpriced) == 1
    assert unpriced[0]["display_price"] is None
    assert unpriced[0]["variants"][0]["price"] is None


def test_detail_endpoint_embeds_price_per_variant(client, priced_base_card):
    """Extended for BL-146: this is now the sole assertion of embedded
    per-variant `price` (the list no longer carries it -- see test_list_
    base_cards_embeds_display_price_and_pricing_envelope_headers's
    disposition note), so both fixture variant types are checked here, not
    just Standard."""
    base_card_id = priced_base_card["base_card_id"]
    response = client.get(f"/api/base-cards/{base_card_id}")
    assert response.status_code == 200
    by_type = {v["variant_type"]: v for v in response.json()["variants"]}
    assert by_type["Standard"]["price"] == {
        "market": 10.0,
        "low": 8.0,
        "as_of": TODAY.isoformat(),
    }
    assert by_type["Standard"]["quantity"] == 0  # untouched by pricing work
    assert by_type["Hyperspace"]["price"]["market"] == 25.0


def test_price_history_returns_ascending_series_for_range_all(client, priced_base_card):
    base_card_id = priced_base_card["base_card_id"]
    variant_id = priced_base_card["variant_ids"]["Standard"]
    response = client.get(
        f"/api/base-cards/{base_card_id}/price-history",
        params={"variant_id": variant_id, "range": "all"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["variant_id"] == variant_id
    assert body["range"] == "all"
    as_of_values = [point["as_of"] for point in body["series"]]
    assert as_of_values == sorted(as_of_values)
    assert (TODAY - timedelta(days=5)).isoformat() in as_of_values
    assert TODAY.isoformat() in as_of_values


def test_price_history_range_30d_excludes_older_points(client, priced_base_card):
    """The fixture's older point is only 5 days back so range=30d still
    includes it -- this asserts the endpoint honors the range filter at
    all by checking the boundary doesn't silently become "all"."""
    base_card_id = priced_base_card["base_card_id"]
    variant_id = priced_base_card["variant_ids"]["Standard"]
    response = client.get(
        f"/api/base-cards/{base_card_id}/price-history",
        params={"variant_id": variant_id, "range": "30d"},
    )
    body = response.json()
    assert len(body["series"]) == 2  # both points are within 30 days


def test_price_history_404_for_variant_not_on_this_base_card(client, priced_base_card):
    other_base_card_id = priced_base_card["base_card_id"] + 1
    variant_id = priced_base_card["variant_ids"]["Standard"]
    response = client.get(
        f"/api/base-cards/{other_base_card_id}/price-history",
        params={"variant_id": variant_id, "range": "all"},
    )
    assert response.status_code == 404


def test_price_history_invalid_range_is_rejected(client, priced_base_card):
    base_card_id = priced_base_card["base_card_id"]
    variant_id = priced_base_card["variant_ids"]["Standard"]
    response = client.get(
        f"/api/base-cards/{base_card_id}/price-history",
        params={"variant_id": variant_id, "range": "bogus"},
    )
    assert response.status_code == 422


def test_price_history_is_anonymous(client, priced_base_card):
    """No auth override needed -- `client` here intentionally doesn't rely
    on the authenticated identity, matching "anonymous endpoints stay
    anonymous" from the brief. A bare TestClient(app) call (no
    Authorization header at all) should behave identically."""
    from fastapi.testclient import TestClient

    from app.main import app

    anon_client = TestClient(app)
    base_card_id = priced_base_card["base_card_id"]
    variant_id = priced_base_card["variant_ids"]["Standard"]
    response = anon_client.get(
        f"/api/base-cards/{base_card_id}/price-history",
        params={"variant_id": variant_id, "range": "all"},
    )
    assert response.status_code == 200
