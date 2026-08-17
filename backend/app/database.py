import os
from typing import Optional

from fastapi import Depends, Request
from sqlalchemy import Connection, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.auth import get_current_identity, get_optional_identity

DATABASE_URL = os.environ["DATABASE_URL"]
APP_DATABASE_URL = os.environ["APP_DATABASE_URL"]

# Pool caps (BL-150 W0 / audit A5-06): SQLAlchemy's defaults (pool_size=5,
# max_overflow=10) put a worst case of 30 connections per Cloud Run instance
# across these two engines -- 90 at prod maxScale 3, against Cloud SQL
# db-f1-micro's max_connections=25: a hard "remaining connection slots are
# reserved" outage on the first real scale-out. Caps below bound an instance
# at 8 (admin 1+1, app 3+3), so 3 instances = 24 <= 25, with headroom to
# spare once prod moves to db-g1-small (max_connections=50, decision D4 in
# planning/Definition_Steadying_2026-07-24.md). The pricing jobs share this
# module in their own container (up to 8 more during the nightly sync
# window) -- acceptable overlap, revisit only if the tier decision changes.

# Migration-running admin connection (swu_user). Used by ingestion scripts
# (bootstrap/catalog ingestion) which need write access to the catalog
# tables that swu_app can only read. Not on the request path: minimal pool.
engine = create_engine(DATABASE_URL, pool_size=1, max_overflow=1)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Request-serving connection (swu_app) -- the RLS-aware role from P4 stage 2.
app_engine = create_engine(APP_DATABASE_URL, pool_size=3, max_overflow=3)
AppSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=app_engine)


def _open_authenticated_session(
    request: Request, firebase_uid: str, email: str
) -> tuple[Session, Connection]:
    """Open a swu_app session scoped to firebase_uid's tenant (auto-
    provisioning a brand-new tenant the first time a firebase_uid is seen --
    "one user, one tenant"). Shared by get_db (always-authenticated routes)
    and get_optional_db's authenticated branch (BL-56 base-cards).

    app.current_firebase_uid is set first so the users RLS policy
    (migration 0021) can find -- or, for a first-ever request, create --
    this identity's own users row.

    THE SESSION IS BOUND TO ONE DEDICATED POOLED CONNECTION for the whole
    request (returned alongside it; the dependency closes both). A plain
    sessionmaker(bind=engine) session releases its connection back to the
    pool at every commit()/rollback() and lazily checks out another --
    possibly different -- connection for the next statement, so the
    connection-scoped GUCs set below would silently vanish mid-request the
    moment any repository commit()s and the pool hands back a connection
    last used by a tenant-less catalog request (GUC ''). That is not
    hypothetical: found live in dev 2026-07-13, PUT /api/settings/limits
    500'd (`invalid input syntax for type integer: ""`) reading
    current_setting('app.current_tenant_id') after replace_overrides'
    mid-request commit, while serial API calls passed by pool luck.
    Binding pins every transaction of the request to the same connection,
    so set_config(..., false) genuinely holds for the request's lifetime
    (a plain SET LOCAL would still revert after the first commit).

    P6 stage 1: tenant_id is also stashed on request.state so the request
    logging middleware (app/middleware.py) can include it in the structured
    log line for this request.
    """
    conn = app_engine.connect()
    db = AppSessionLocal(bind=conn)
    db.execute(
        text("SELECT set_config('app.current_firebase_uid', :uid, false)"),
        {"uid": firebase_uid},
    )

    row = db.execute(
        text("SELECT tenant_id FROM users WHERE firebase_uid = :uid"),
        {"uid": firebase_uid},
    ).first()

    if row is None:
        new_tenant_id = db.execute(
            text("INSERT INTO tenants (name) VALUES (:name) RETURNING id"),
            {"name": f"{email}'s Tenant"},
        ).scalar()
        inserted = db.execute(
            text(
                "INSERT INTO users (firebase_uid, tenant_id, email) "
                "VALUES (:uid, :tenant_id, :email) "
                "ON CONFLICT (firebase_uid) DO NOTHING "
                "RETURNING tenant_id"
            ),
            {"uid": firebase_uid, "tenant_id": new_tenant_id, "email": email},
        ).first()
        if inserted is not None:
            tenant_id = inserted.tenant_id
        else:
            # Lost a race with a concurrent first request for this uid --
            # new_tenant_id would be an orphaned row (nothing in users
            # references it, since the winner's row points at its own
            # tenant). BL-135: delete it here, in the same transaction,
            # before commit -- the loser already knows it lost, so there's
            # no reason to leave the row behind for a cleanup job that
            # doesn't exist. Then fall through to the winner's tenant.
            db.execute(
                text("DELETE FROM tenants WHERE id = :tenant_id"),
                {"tenant_id": new_tenant_id},
            )
            tenant_id = db.execute(
                text("SELECT tenant_id FROM users WHERE firebase_uid = :uid"),
                {"uid": firebase_uid},
            ).scalar()
        db.commit()
    else:
        tenant_id = row.tenant_id

    db.execute(
        text("SELECT set_config('app.current_tenant_id', :tenant_id, false)"),
        {"tenant_id": str(tenant_id)},
    )
    request.state.tenant_id = tenant_id
    return db, conn


def _open_catalog_session() -> tuple[Session, Connection]:
    """Open a swu_app session with no tenant or identity -- BL-56 / ADR-0008.

    AppSessionLocal connections come from a pool (app_engine), and
    _open_authenticated_session sets app.current_firebase_uid /
    app.current_tenant_id with set_config's third argument false, which
    means those GUCs persist for the life of the *connection*, not just the
    request -- a connection handed back that some prior authenticated
    request used would still carry that request's tenant. Explicitly
    clearing both GUCs to '' here closes that leak regardless of connection
    history. The revised tenant_isolation / user_self_access RLS policies
    (migration 0023) treat an unset *or* empty-string tenant/identity
    identically: zero rows.

    Bound to a dedicated connection like _open_authenticated_session (same
    mid-request pool-swap hazard, same two-object lifecycle).
    """
    conn = app_engine.connect()
    db = AppSessionLocal(bind=conn)
    db.execute(text("SELECT set_config('app.current_tenant_id', '', false)"))
    db.execute(text("SELECT set_config('app.current_firebase_uid', '', false)"))
    return db, conn


def get_db(
    request: Request,
    identity: tuple[str, str, bool] = Depends(get_current_identity),
):
    """FastAPI dependency: a swu_app session scoped to the caller's tenant.

    Every route declaring Depends(get_db) is authenticated -- get_db's own
    signature transitively resolves get_current_identity first, which
    raises 401 on a missing/invalid token before this body ever runs
    (SWU_Platform_Spec.md §1.3). Use get_catalog_db for public catalog
    reads and get_optional_db for the base-cards optional-auth endpoint --
    never make identity optional here.

    identity's third element (email_verified, BL-16) is deliberately
    unused here -- get_db authenticates and resolves a tenant, it doesn't
    gate on verification. Routes that need the stronger check add
    Depends(require_verified_email) alongside this one; since both hang
    off get_current_identity, the token is still only verified once per
    request.
    """
    firebase_uid, email, _ = identity
    db, conn = _open_authenticated_session(request, firebase_uid, email)
    try:
        yield db
    finally:
        db.close()
        conn.close()


def get_catalog_db(request: Request):
    """FastAPI dependency: a tenant-less swu_app session for the fully
    public catalog reads (BL-56 / ADR-0008) -- GET /api/sets,
    /api/sets/{code}, and the catalog reference endpoints (the original
    GET /api/cards* routes were retired in BL-102). No Authorization header
    is required, inspected, or verified. RLS is the fail-safe: the
    tenant_isolation / user_self_access policies (migration 0023) return
    zero inventory/users rows for a session with no tenant/identity GUC
    set, so even if a future change accidentally joined inventory onto
    these read paths, nothing tenant-scoped would leak.
    """
    db, conn = _open_catalog_session()
    request.state.tenant_id = None
    try:
        yield db
    finally:
        db.close()
        conn.close()


def get_shared_db(token: str, request: Request):
    """FastAPI dependency: a share-token-scoped session for the BL-205
    viewer-mode reads (App Spec §19.1) -- GET /api/shared/{token}[/...].
    No Authorization header is required, inspected, or verified: the
    unguessable token IS the credential.

    Resolution runs entirely on the RLS rails: the session starts
    tenant-less (same GUC-clearing as _open_catalog_session), sets
    app.share_token to the presented value, and SELECTs shares -- only the
    shares_token_select policy (migration 0030) can make a row visible to
    this session, and it matches nothing for an unknown or revoked token.
    Invalid and revoked are deliberately indistinguishable (404, §19.1
    security posture). Only after that lookup succeeds is
    app.current_tenant_id set to the share's owner tenant, so every
    downstream repository read (quantities, limits) is scoped exactly as
    if the owner were reading -- and app.share_token is cleared again so
    the share row itself stops being visible past resolution.

    Per-IP rate limiting runs BEFORE any DB work (cheap-tier reuse of the
    BL-53 sliding-window limiter; the key is the client IP, not a tenant
    -- same per-instance caveats). request.client reflects
    X-Forwarded-For via uvicorn's proxy-headers middleware, so this keys
    on the real viewer behind the Firebase Hosting proxy.
    """
    from app.rate_limit import check_tenant_rate_limit

    client_ip = request.client.host if request.client else "unknown"
    retry_after = check_tenant_rate_limit(
        "shared_read", client_ip, max_calls=300, window_seconds=3600
    )
    if retry_after is not None:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=429,
            detail="Too many requests",
            headers={"Retry-After": str(retry_after)},
        )

    db, conn = _open_catalog_session()
    try:
        db.execute(
            text("SELECT set_config('app.share_token', :token, false)"),
            {"token": token},
        )
        row = db.execute(
            text("SELECT id, tenant_id, scope, name FROM shares WHERE token = :token"),
            {"token": token},
        ).first()
        db.execute(text("SELECT set_config('app.share_token', '', false)"))
        if row is None:
            from fastapi import HTTPException

            raise HTTPException(status_code=404, detail="Not found")
        db.execute(
            text("SELECT set_config('app.current_tenant_id', :tenant_id, false)"),
            {"tenant_id": str(row.tenant_id)},
        )
        request.state.tenant_id = None  # never log a share read as the owner
        request.state.share = row
        yield db
    finally:
        db.close()
        conn.close()


def get_optional_db(
    request: Request,
    identity: Optional[tuple[str, str, bool]] = Depends(get_optional_identity),
):
    """FastAPI dependency: optional-auth session for GET /api/base-cards/{id}
    (BL-56 / ADR-0008 build-time refinement). Unlike the fully public catalog
    reads, base-cards returns a per-variant `quantity` sourced from
    `inventory`, so an authenticated caller must still see their real
    tenant-scoped quantities -- a strictly tenant-less session would
    silently show 0 even to a signed-in owner.

    - Authorization header absent -> identity is None -> tenant-less
      catalog session (get_optional_identity never raises for this case) ->
      quantity 0 for every variant, via RLS.
    - Authorization header present and valid -> identity resolved exactly
      like get_db -> real per-tenant quantities.
    - Authorization header present but invalid/expired -> get_optional_identity
      (via verify_firebase_token) raises 401 before this body runs -- a bad
      token is never silently downgraded to anonymous.
    """
    if identity is None:
        db, conn = _open_catalog_session()
        request.state.tenant_id = None
    else:
        firebase_uid, email, _ = identity
        db, conn = _open_authenticated_session(request, firebase_uid, email)
    try:
        yield db
    finally:
        db.close()
        conn.close()
