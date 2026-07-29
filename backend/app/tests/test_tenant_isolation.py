"""
P4 Stage 4: tenant isolation test suite.

A second tenant ("Tenant Two") and inventory rows for cards tenant #1
already tracks are created for the duration of this module, then removed.
Proves RLS isolation holds even for "naive," unfiltered queries -- the
exact shape app/repositories/inventory.py's upsert_increment/
upsert_decrement use -- because the database itself, not application code,
refuses to return another tenant's rows.

Integration tests -- require DATABASE_URL and APP_DATABASE_URL (standard
inside the backend container).
"""

import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
)

SEEDED_QUANTITY = 2

TENANT_TWO_UID = "test-tenant-two-user"
TENANT_TWO_EMAIL = "tenant-two@example.com"


@pytest.fixture(scope="module")
def app_db():
    """SQLAlchemy session connected as swu_app -- the role tenant_isolation actually applies to."""
    engine = create_engine(os.environ["APP_DATABASE_URL"])
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(scope="module")
def tenant_two(db):
    """Create a second tenant with its own rows for cards tenant #1 already
    tracks, then remove everything afterward. Setup/teardown use the
    swu_user (admin) connection, which bypasses RLS regardless of which
    tenant is "current" -- the same property test_row_level_security.py's
    test_swu_user_bypasses_rls documents.

    The two variants are chosen from distinct (set, base_card_number)
    groups and excluding Leader/Base, so seeding tenant #2's rows at
    SEEDED_QUANTITY can't trip app/services/inventory.py's
    singleton/playset "blocked" rules during the increment test below.
    """
    tenant_id = db.execute(
        text("INSERT INTO tenants (name) VALUES ('Tenant Two') RETURNING id")
    ).scalar()
    db.execute(
        text(
            "INSERT INTO users (firebase_uid, tenant_id, email) "
            "VALUES (:uid, :tenant_id, :email)"
        ),
        {"uid": TENANT_TWO_UID, "tenant_id": tenant_id, "email": TENANT_TWO_EMAIL},
    )
    db.commit()

    try:
        rows = db.execute(
            text(
                """
                SELECT DISTINCT ON (bc.set_id, bc.base_card_number)
                       i.variant_id, i.quantity
                FROM inventory i
                JOIN card_variants cv ON cv.id = i.variant_id
                JOIN base_cards bc ON bc.id = cv.base_card_id
                WHERE i.tenant_id = 1 AND bc.type NOT IN ('Leader', 'Base')
                ORDER BY bc.set_id, bc.base_card_number, i.variant_id
                LIMIT 2
                """
            )
        ).all()
        assert len(rows) == 2, "expected at least 2 eligible tenant #1 inventory rows"

        card_ids = [r[0] for r in rows]
        tenant_one_quantities = {r[0]: r[1] for r in rows}

        for variant_id in card_ids:
            db.execute(
                text(
                    "INSERT INTO inventory (tenant_id, variant_id, quantity) "
                    "VALUES (:tenant_id, :variant_id, :quantity)"
                ),
                {
                    "tenant_id": tenant_id,
                    "variant_id": variant_id,
                    "quantity": SEEDED_QUANTITY,
                },
            )
        db.commit()

        yield {
            "tenant_id": tenant_id,
            "card_ids": card_ids,
            "tenant_one_quantities": tenant_one_quantities,
        }
    finally:
        db.rollback()
        db.execute(
            text("DELETE FROM inventory WHERE tenant_id = :tenant_id"),
            {"tenant_id": tenant_id},
        )
        db.execute(
            text("DELETE FROM users WHERE firebase_uid = :uid"), {"uid": TENANT_TWO_UID}
        )
        db.execute(
            text("DELETE FROM tenants WHERE id = :tenant_id"), {"tenant_id": tenant_id}
        )
        db.commit()


@pytest.fixture
def tenant_two_client(make_client, tenant_two):
    """A TestClient authenticated as tenant #2's user. Function-scoped (via
    conftest's make_client) so its dependency_overrides entry can't be
    clobbered by another test's client/make_client teardown -- the override
    dict is shared global state on the app singleton. Depending on
    tenant_two ensures its users row exists before get_db() resolves this
    identity."""
    return make_client(TENANT_TWO_UID, TENANT_TWO_EMAIL)


def test_naive_query_as_tenant_two_excludes_tenant_one_rows(app_db, tenant_two):
    """The exact unfiltered shape upsert_increment/upsert_decrement use
    (SELECT ... FROM inventory with no WHERE tenant_id) -- run as tenant
    #2 -- returns only tenant #2's rows, even though tenant #1 has rows
    for the very same card_ids."""
    app_db.execute(
        text("SET LOCAL app.current_tenant_id = :tid"),
        {"tid": str(tenant_two["tenant_id"])},
    )
    rows = app_db.execute(
        text("SELECT tenant_id, variant_id, quantity FROM inventory")
    ).all()
    app_db.rollback()

    assert len(rows) == len(tenant_two["card_ids"])
    assert {r[0] for r in rows} == {tenant_two["tenant_id"]}
    assert {r[1] for r in rows} == set(tenant_two["card_ids"])
    assert all(r[2] == SEEDED_QUANTITY for r in rows)


def test_naive_query_as_tenant_one_excludes_tenant_two_rows(app_db, tenant_two):
    """Same naive query, run as tenant #1 -- tenant #2's rows for these
    card_ids never appear, even though they exist in the table."""
    app_db.execute(text("SET LOCAL app.current_tenant_id = '1'"))
    rows = app_db.execute(
        text(
            "SELECT variant_id, tenant_id, quantity FROM inventory WHERE variant_id = ANY(:card_ids)"
        ),
        {"card_ids": tenant_two["card_ids"]},
    ).all()
    app_db.rollback()

    assert len(rows) == len(tenant_two["card_ids"])
    for card_id, tenant_id, quantity in rows:
        assert tenant_id == 1
        assert quantity == tenant_two["tenant_one_quantities"][card_id]


# BL-102: the two API-level checks below PORTED from GET /api/inventory
# (retired) to conftest.merged_inventory (catalog + /quantities merge) --
# same per-tenant visibility assertions, against the surviving endpoints.


def test_api_tenant_two_sees_its_own_quantities(tenant_two_client, tenant_two):
    from .conftest import merged_inventory

    records = merged_inventory(tenant_two_client)
    by_card_id = {r["id"]: r["quantity"] for r in records}
    for card_id in tenant_two["card_ids"]:
        assert by_card_id[card_id] == SEEDED_QUANTITY


def test_api_tenant_one_unaffected_by_tenant_two_rows(client, tenant_two):
    from .conftest import merged_inventory

    records = merged_inventory(client)
    by_card_id = {r["id"]: r["quantity"] for r in records}
    for card_id, expected in tenant_two["tenant_one_quantities"].items():
        assert by_card_id[card_id] == expected


TENANT_THREE_UID = "test-tenant-three-user"
TENANT_THREE_EMAIL = "tenant-three@example.com"


@pytest.fixture
def tenant_three(db):
    """A brand-new tenant with zero inventory rows -- the exact state of a
    freshly auto-provisioned account. Regression coverage for
    upsert_increment/upsert_decrement's INSERT path: a fresh tenant's first
    increment for any card has no existing row to UPDATE, so it must INSERT
    with tenant_id set explicitly rather than relying on inventory.tenant_id's
    server_default of 1 (which the tenant_isolation policy's implicit WITH
    CHECK rejects for any tenant other than #1)."""
    tenant_id = db.execute(
        text("INSERT INTO tenants (name) VALUES ('Tenant Three') RETURNING id")
    ).scalar()
    db.execute(
        text(
            "INSERT INTO users (firebase_uid, tenant_id, email) "
            "VALUES (:uid, :tenant_id, :email)"
        ),
        {"uid": TENANT_THREE_UID, "tenant_id": tenant_id, "email": TENANT_THREE_EMAIL},
    )
    db.commit()

    try:
        yield {"tenant_id": tenant_id}
    finally:
        db.rollback()
        db.execute(
            text("DELETE FROM inventory WHERE tenant_id = :tenant_id"),
            {"tenant_id": tenant_id},
        )
        db.execute(
            text("DELETE FROM users WHERE firebase_uid = :uid"),
            {"uid": TENANT_THREE_UID},
        )
        db.execute(
            text("DELETE FROM tenants WHERE id = :tenant_id"), {"tenant_id": tenant_id}
        )
        db.commit()


@pytest.fixture
def tenant_three_client(make_client, tenant_three):
    return make_client(TENANT_THREE_UID, TENANT_THREE_EMAIL)


def test_increment_for_brand_new_tenant_creates_own_row(
    tenant_three_client, tenant_three, db
):
    """Reproduces the P5 stage 4 bug: a freshly auto-provisioned tenant
    (zero inventory rows) increments a card for the first time."""
    variant_id = db.execute(
        text(
            """
            SELECT cv.id FROM card_variants cv
            JOIN base_cards bc ON bc.id = cv.base_card_id
            WHERE bc.type NOT IN ('Leader', 'Base')
            ORDER BY cv.id
            LIMIT 1
            """
        )
    ).scalar()

    response = tenant_three_client.post(f"/api/inventory/{variant_id}/increment")
    assert response.status_code == 200
    assert response.json()["quantity"] == 1

    row = db.execute(
        text(
            "SELECT tenant_id, quantity FROM inventory WHERE tenant_id = :tenant_id AND variant_id = :variant_id"
        ),
        {"tenant_id": tenant_three["tenant_id"], "variant_id": variant_id},
    ).first()
    assert row is not None
    assert row.tenant_id == tenant_three["tenant_id"]
    assert row.quantity == 1


def test_increment_for_tenant_two_does_not_affect_tenant_one(
    tenant_two_client, tenant_two, db
):
    """The 'two people, two inventories' proof: incrementing tenant #2's
    row for a card -- via the same naive repository code tenant #1 uses --
    leaves tenant #1's row for that same card_id untouched."""
    card_id = tenant_two["card_ids"][0]

    response = tenant_two_client.post(f"/api/inventory/{card_id}/increment")
    assert response.status_code == 200
    assert response.json()["quantity"] == SEEDED_QUANTITY + 1

    tenant_one_quantity = db.execute(
        text(
            "SELECT quantity FROM inventory WHERE tenant_id = 1 AND variant_id = :card_id"
        ),
        {"card_id": card_id},
    ).scalar()
    assert tenant_one_quantity == tenant_two["tenant_one_quantities"][card_id]

    # restore tenant #2's row to its fixture-seeded quantity
    response = tenant_two_client.post(f"/api/inventory/{card_id}/decrement")
    assert response.json()["quantity"] == SEEDED_QUANTITY


def test_cards_catalog_is_identical_across_tenants(client, tenant_two_client):
    """The catalog is shared reference data, not per-tenant. Guards against
    a future change (e.g. an over-eager join with inventory) accidentally
    scoping it -- not hypothetical for this endpoint: the base-cards list
    carried per-tenant quantities until BL-101 split them out, so this pin
    matters most exactly here.

    PORTED for BL-102 from GET /api/cards (retired) to GET /api/base-cards,
    the catalog list users actually fetch."""
    tenant_one_cards = client.get("/api/base-cards").json()
    tenant_two_cards = tenant_two_client.get("/api/base-cards").json()
    assert tenant_one_cards == tenant_two_cards
    assert len(tenant_one_cards) > 0


def test_sets_catalog_is_identical_across_tenants(client, tenant_two_client):
    """Same guarantee as above, for /api/sets."""
    tenant_one_sets = client.get("/api/sets").json()
    tenant_two_sets = tenant_two_client.get("/api/sets").json()
    assert tenant_one_sets == tenant_two_sets
    assert len(tenant_one_sets) > 0
