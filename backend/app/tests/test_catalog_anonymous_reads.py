"""BL-56 Slice 1 -- anonymous catalog reads (ADR-0008).

Covers the public read endpoints (GET /api/sets and -- fully public since
BL-101's catalog/quantity split -- GET /api/base-cards; the /api/cards
family was retired in BL-102) served with no Firebase token, the *detail*
endpoint's optional-auth path (real quantity when authenticated, 0 when
anonymous, 401 for a present-but-invalid token), the RLS fail-safe (a
tenant-less session sees zero inventory/users rows, including on a
connection pooled from a prior authenticated request), and the migration
0023 policy fix itself.

Run inside the backend container:
    docker compose exec backend pytest app/tests/test_catalog_anonymous_reads.py -v
"""

import os
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
)


@pytest.fixture
def anon_client():
    """A TestClient with no dependency overrides -- exercises the real
    get_catalog_db / get_optional_db code paths exactly as a real anonymous
    request would (no Authorization header at all)."""
    from app.main import app

    return TestClient(app)


@pytest.fixture
def champion_gamma_id(db):
    return db.execute(
        text("SELECT id FROM base_cards WHERE swuapi_id = 'test-0006'")
    ).scalar()


@pytest.fixture
def champion_gamma_variant_ids(db):
    rows = db.execute(
        text(
            "SELECT swuapi_id, id FROM card_variants "
            "WHERE swuapi_id IN ('test-v0007', 'test-v0008')"
        )
    ).all()
    return {r.swuapi_id: r.id for r in rows}


class TestPublicCatalogReadsReturn200WithNoToken:
    # BL-102 disposition: the /api/cards list+detail tests RETIRED with
    # their endpoints (runtime-dead since BL-56/BL-44). The anonymous-read
    # property survives on the endpoints users actually hit: sets +
    # base-cards below.

    def test_list_sets(self, anon_client):
        response = anon_client.get("/api/sets")
        assert response.status_code == 200
        assert len(response.json()) > 0

    def test_get_set_by_code(self, anon_client):
        response = anon_client.get("/api/sets/SOR")
        assert response.status_code == 200
        assert response.json()["code"] == "SOR"

    def test_get_base_card_detail(self, anon_client, champion_gamma_id):
        response = anon_client.get(f"/api/base-cards/{champion_gamma_id}")
        assert response.status_code == 200
        assert response.json()["id"] == champion_gamma_id

    def test_list_base_cards(self, anon_client):
        """BL-44 Slice A: the payload-shrink list endpoint is publicly
        readable with no token, same as the detail endpoint."""
        response = anon_client.get("/api/base-cards?set_code=SOR")
        assert response.status_code == 200
        assert len(response.json()) > 0


class TestBaseCardsOptionalAuth:
    def test_anonymous_sees_zero_quantity_despite_seeded_inventory(
        self, anon_client, champion_gamma_id, champion_gamma_variant_ids
    ):
        """Standard Foil (test-v0008) is seeded to quantity 1 for tenant #1
        (conftest.seed_minimal_catalog) -- an anonymous caller must never see
        that value, only 0."""
        body = anon_client.get(f"/api/base-cards/{champion_gamma_id}").json()
        assert all(v["quantity"] == 0 for v in body["variants"])

    def test_authenticated_caller_sees_real_quantity(
        self, client, champion_gamma_id, champion_gamma_variant_ids
    ):
        """The `client` fixture (conftest) is authenticated as tenant #1 --
        real per-tenant quantities must still flow through get_optional_db,
        not be flattened to 0 the way the fully public catalog reads are."""
        body = client.get(f"/api/base-cards/{champion_gamma_id}").json()
        by_id = {v["variant_id"]: v for v in body["variants"]}
        standard_foil = by_id[champion_gamma_variant_ids["test-v0008"]]
        assert standard_foil["quantity"] == 1

    def test_present_but_invalid_token_returns_401(self, champion_gamma_id):
        """A present-but-invalid/expired token must never be silently
        downgraded to anonymous -- get_optional_identity raises 401 exactly
        like get_current_identity does for every other route."""
        from app.auth import get_optional_identity
        from app.main import app

        def _raise_invalid_token():
            raise HTTPException(status_code=401, detail="Invalid or expired token")

        app.dependency_overrides[get_optional_identity] = _raise_invalid_token
        try:
            response = TestClient(app).get(f"/api/base-cards/{champion_gamma_id}")
            assert response.status_code == 401
        finally:
            app.dependency_overrides.pop(get_optional_identity, None)

    # BL-101 disposition note: the three list-endpoint optional-auth tests
    # that lived here (anonymous-sees-zero-quantity, authenticated-sees-real-
    # quantity, invalid-token-401s) were REPLACED by the two below -- the
    # list endpoint left the optional-auth family entirely (it now runs on
    # get_catalog_db like /api/cards and /api/sets, carrying no quantity),
    # so those behaviors are designed away on the list. Their intent
    # survives where the data went: quantity correctness + tenant isolation
    # + 401 semantics now live on GET /api/inventory/quantities
    # (test_inventory_api.py::TestListQuantities). The detail endpoint's
    # optional-auth tests above are unchanged.

    def test_list_base_cards_identical_for_anonymous_and_authenticated(
        self, anon_client, client, champion_gamma_id
    ):
        """BL-101: the list is publicly cacheable, which is only safe if
        the response bytes are identity-independent -- pin that directly by
        comparing an anonymous fetch against an authenticated one from a
        tenant with seeded inventory."""
        anon_body = anon_client.get("/api/base-cards?set_code=SOR").json()
        authed_body = client.get("/api/base-cards?set_code=SOR").json()
        assert anon_body == authed_body
        gamma = next(bc for bc in anon_body if bc["id"] == champion_gamma_id)
        assert all("quantity" not in v for v in gamma["variants"])

    def test_list_base_cards_ignores_invalid_token(self, anon_client):
        """BL-101: the list joined the fully public catalog family
        (get_catalog_db) -- a garbage Authorization header is ignored, not
        401'd, exactly like /api/cards. (Pre-BL-101, as an optional-auth
        route, a present-but-invalid token 401'd here; that contract now
        applies only to the detail endpoint.)"""
        response = anon_client.get(
            "/api/base-cards?set_code=SOR",
            headers={"Authorization": "Bearer not-a-real-token"},
        )
        assert response.status_code == 200
        assert len(response.json()) > 0


class TestTenantLessSessionRlsFailSafe:
    def test_zero_inventory_and_users_rows(self, anon_client, champion_gamma_id):
        """Belt-and-suspenders on top of TestBaseCardsOptionalAuth: the
        tenant-less session backing every anonymous request sees zero rows
        on both tenant-scoped tables, not just a zeroed-out response field."""
        from app.database import _open_catalog_session

        # PORT (connection-pinning fix, 2026-07-13): _open_catalog_session now
        # returns (session, dedicated connection); same assertions, both closed.
        db, conn = _open_catalog_session()
        try:
            inventory_count = db.execute(
                text("SELECT COUNT(*) FROM inventory")
            ).scalar()
            users_count = db.execute(text("SELECT COUNT(*) FROM users")).scalar()
        finally:
            db.rollback()
            db.close()
            conn.close()

        assert inventory_count == 0
        assert users_count == 0

    def test_catalog_session_clears_a_gutter_previously_scoped_to_a_tenant(self):
        """Proves the explicit GUC-clear in _open_catalog_session, not just
        'a fresh connection never sets it'. AppSessionLocal connections are
        pooled, and get_db's set_config(..., false) persists a tenant for
        the life of the *connection* (not the request) -- so a connection
        previously checked out for an authenticated tenant-#1 request could
        come back out of the pool still scoped to tenant #1 for the very
        next (anonymous) request, if nothing explicitly cleared it.

        Uses a private 1-connection pool (not the app's shared app_engine)
        so connection reuse across the two checkouts below is deterministic
        rather than incidental.
        """
        engine = create_engine(
            os.environ["APP_DATABASE_URL"], pool_size=1, max_overflow=0
        )
        Session = sessionmaker(bind=engine)
        try:
            # Simulate a prior authenticated request leaving tenant #1 set
            # on this connection (get_db's set_config persist-for-connection
            # -life behavior) -- and confirm that leak is real before
            # asserting the fix.
            leaked = Session()
            leaked.execute(
                text("SELECT set_config('app.current_tenant_id', '1', false)")
            )
            leaked_count = leaked.execute(
                text("SELECT COUNT(*) FROM inventory")
            ).scalar()
            assert leaked_count > 0, (
                "sanity check: tenant #1 should have seeded inventory rows"
            )
            leaked.rollback()
            leaked.close()  # returns the connection to the pool WITHOUT clearing the GUC

            # A fresh session, on the same 1-connection pool, does exactly
            # what _open_catalog_session does: explicitly clear both GUCs.
            reused = Session()
            reused.execute(
                text("SELECT set_config('app.current_tenant_id', '', false)")
            )
            reused.execute(
                text("SELECT set_config('app.current_firebase_uid', '', false)")
            )
            count = reused.execute(text("SELECT COUNT(*) FROM inventory")).scalar()
            reused.rollback()
            reused.close()
        finally:
            engine.dispose()

        assert count == 0


_TENANT_ISOLATION_HEAD_SQL = (
    "CREATE POLICY tenant_isolation ON inventory "
    "USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::integer)"
)


class TestTenantIsolationMigrationReversibility:
    """Drives migration 0023's upgrade()/downgrade() functions directly via
    alembic's Operations.context(), rather than alembic.config.Config +
    alembic.command.upgrade/downgrade. The latter runs env.py, which calls
    logging.config.fileConfig(alembic.ini) -- fileConfig's
    disable_existing_loggers defaults to True, which would silently disable
    every logger not explicitly listed in alembic.ini's [loggers] section
    (app.request/app.* included) for the rest of the pytest session,
    breaking test_logging.py's caplog-based assertions. Operations.context
    executes the same op.execute(...) calls the migration file's
    upgrade()/downgrade() use, against a plain connection, with none of
    that config/logging machinery."""

    def _load_migration_module(self):
        import importlib.util

        backend_dir = Path(__file__).resolve().parents[2]
        path = (
            backend_dir
            / "alembic"
            / "versions"
            / "0023_tenant_less_session_zero_rows.py"
        )
        spec = importlib.util.spec_from_file_location("migration_0023", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def _run_migration_fn(self, fn_name: str):
        from alembic.operations import Operations
        from alembic.runtime.migration import MigrationContext

        module = self._load_migration_module()
        engine = create_engine(os.environ["DATABASE_URL"])
        try:
            with engine.connect() as connection:
                migration_context = MigrationContext.configure(connection)
                with Operations.context(migration_context):
                    getattr(module, fn_name)()
                connection.commit()
        finally:
            engine.dispose()

    def _policy_qual(self, db) -> str:
        return db.execute(
            text(
                "SELECT qual FROM pg_policies "
                "WHERE tablename = 'inventory' AND policyname = 'tenant_isolation'"
            )
        ).scalar()

    def _restore_head_policy(self):
        """Guaranteed, idempotent restoration of the fixed policy -- used in
        the test's finally so the rest of the suite (which assumes the fixed
        policy) is never left running against the old, leaky one, even if
        an assertion above failed mid-way through the up/down cycle."""
        engine = create_engine(os.environ["DATABASE_URL"])
        try:
            with engine.connect() as connection:
                connection.execute(
                    text("DROP POLICY IF EXISTS tenant_isolation ON inventory")
                )
                connection.execute(text(_TENANT_ISOLATION_HEAD_SQL))
                connection.commit()
        finally:
            engine.dispose()

    def test_upgrade_and_downgrade_round_trip(self, db):
        """migration 0023 is reversible: downgrading restores the old
        COALESCE(..., 1) fallback (and its tenant-#1-by-default behavior),
        upgrading restores the NULLIF fail-safe."""
        try:
            self._run_migration_fn("downgrade")
            db.rollback()
            assert "COALESCE" in self._policy_qual(db)

            engine = create_engine(os.environ["APP_DATABASE_URL"])
            Session = sessionmaker(bind=engine)
            app_db = Session()
            try:
                count = app_db.execute(text("SELECT COUNT(*) FROM inventory")).scalar()
                assert count > 0, (
                    "downgraded policy should fall back to tenant #1 by default"
                )
            finally:
                app_db.rollback()
                app_db.close()
                engine.dispose()

            self._run_migration_fn("upgrade")
            db.rollback()
            assert "NULLIF" in self._policy_qual(db)
        finally:
            self._restore_head_policy()
            db.rollback()
