import os
from dataclasses import dataclass

from fastapi import Depends, Request
from sqlalchemy import Connection, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.auth import get_current_identity, get_optional_identity
from app.db_url import sa_url

DATABASE_URL = os.environ["DATABASE_URL"]
APP_DATABASE_URL = os.environ["APP_DATABASE_URL"]

# Pool caps: SQLAlchemy's defaults (pool_size=5, max_overflow=10) put a
# worst case of 30 connections per Cloud Run instance across these two
# engines -- 90 at prod's max_instance_count of 3, far past Cloud SQL's
# max_connections (25 on db-f1-micro, 50 on db-g1-small; see the
# sql_max_connections description in terraform/modules/app/variables.tf): a
# hard "remaining connection slots are reserved" outage
# on the first real scale-out. The caps below bound an instance at 8 (admin
# 1+1, app 3+3), so 3 instances = 24, under even db-f1-micro's 25. The
# pricing jobs share this module in their own container (up to 8 more
# during the nightly sync window), which prod's db-g1-small absorbs.

# pool_pre_ping: idle pooled connections get dropped upstream of Postgres on
# the Cloud Run -> Cloud SQL path (the DB itself stays healthy), and without
# a checkout-time liveness check each dead connection surfaces as exactly
# one user-facing 500 ("server closed the connection unexpectedly"). The
# per-checkout SELECT 1 turns a stale checkout into a transparent reconnect
# instead.

# Migration-running admin connection (swu_user). Used by ingestion scripts
# (bootstrap/catalog ingestion) which need write access to the catalog
# tables that swu_app can only read. Not on the request path: minimal pool.
engine = create_engine(
    sa_url(DATABASE_URL), pool_size=1, max_overflow=1, pool_pre_ping=True
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Request-serving connection (swu_app) -- the RLS-aware role.
app_engine = create_engine(
    sa_url(APP_DATABASE_URL), pool_size=3, max_overflow=3, pool_pre_ping=True
)
AppSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=app_engine)


def _open_authenticated_session(
    request: Request, firebase_uid: str, email: str
) -> tuple[Session, Connection]:
    """Open a swu_app session scoped to firebase_uid's tenant (auto-
    provisioning a brand-new tenant the first time a firebase_uid is seen --
    "one user, one tenant"). Shared by get_db (always-authenticated routes)
    and get_optional_db's authenticated branch (the base-cards detail).

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
    last used by a tenant-less catalog request (GUC ''). For example, PUT
    /api/settings/limits reads current_setting('app.current_tenant_id') after
    replace_overrides' mid-request commit; on a swapped connection that read fails with
    `invalid input syntax for type integer: ""`, and serial calls only pass by pool
    luck. Binding pins every transaction of the request to the same connection, so
    set_config(..., false) genuinely holds for the request's lifetime (a plain SET LOCAL
    would still revert after the first commit).

    tenant_id is also stashed on request.state so the request
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
            # tenant). Delete it here, in the same transaction,
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
    """Open a swu_app session with no tenant or identity -- ADR-0008.

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
    (Platform Spec §1.3). Use get_catalog_db for public catalog
    reads and get_optional_db for the base-cards optional-auth endpoint --
    never make identity optional here.

    identity's third element (email_verified) is deliberately
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
    public catalog reads (ADR-0008) -- GET /api/sets, /api/sets/{code},
    the GET /api/base-cards list and price history, and
    GET /api/catalog/reference.csv. No Authorization header
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
    """FastAPI dependency: a share-token-scoped session for the
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

    That tenant scope is the owner's WHOLE tenant, whatever the share's
    scope. Routes never depend on this directly: they take one of the
    scope gates below (get_shared_inventory_db, get_shared_stash), which
    decide what the token may read inside the tenant.

    Per-IP rate limiting runs BEFORE any DB work (the cheap-tier
    sliding-window limiter in app/rate_limit.py, 300 calls per hour; the
    key is the client IP -- an IPv6 address collapsed to its /64
    (`client_ip_key`) -- not a tenant, with the same per-instance caveats).
    request.client is the
    address ForwardedClientMiddleware resolved from X-Forwarded-For
    (app/forwarded.py), so this keys on the real viewer on both the Hosting
    and the direct path, whatever leading entries the caller forged.
    """
    from app.rate_limit import check_tenant_rate_limit, client_ip_key

    client_ip = client_ip_key(request.client.host if request.client else None)
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
            text(
                "SELECT id, tenant_id, scope, target_id, name FROM shares "
                "WHERE token = :token"
            ),
            {"token": token},
        ).first()
        db.execute(text("SELECT set_config('app.share_token', '', false)"))
        if row is None:
            raise shared_not_found()
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


def shared_not_found():
    """The one 404 every dead share link gets: unknown, revoked, wrong
    scope for the route, or a stash that no longer exists all answer with
    this exact status and body (App Spec §19.1)."""
    from fastapi import HTTPException

    return HTTPException(status_code=404, detail="Not found")


# The scope choke point. get_shared_db scopes the session to the share
# owner's WHOLE tenant (RLS isolates tenants, not stashes), so what a token
# may read inside that tenant is decided here, in app code. Every
# /api/shared route depends on exactly one of the two gates below and never
# on get_shared_db directly (test_shared_scope.py asserts it).


def get_shared_inventory_db(
    request: Request, db: Session = Depends(get_shared_db)
) -> Session:
    """The vault-share gate: the session for an 'inventory'-scope token,
    404 (the same 404 as an unknown token) for any other scope, so a stash
    token can never read the vault routes."""
    if request.state.share.scope != "inventory":
        raise shared_not_found()
    return db


@dataclass(frozen=True)
class SharedStash:
    """What a stash-share route may use: the owner-tenant session, the ONE
    stash the share names (its id taken from the share row, never the
    request; its current name and description), and the share's name."""

    db: Session
    stash_id: int
    stash_name: str
    stash_description: str | None
    share_name: str


def get_shared_stash(
    request: Request, db: Session = Depends(get_shared_db)
) -> SharedStash:
    """The stash-share gate: a 'stash'-scope token whose stash still exists,
    else the same 404 as an unknown token. Deleting a stash revokes its
    share in the same transaction; the existence check here is the second
    line for a share row that somehow outlives its stash.

    The existence check and the route's row read share one REPEATABLE READ
    snapshot (a fresh read-only transaction begun here; the session GUCs
    are connection-level and survive the commit), so a stash deleted in
    between cannot answer with its name over an empty row list."""
    share = request.state.share
    if share.scope != "stash" or share.target_id is None:
        raise shared_not_found()
    db.commit()
    db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
    stash = db.execute(
        text("SELECT id, name, description FROM stashes WHERE id = :id"),
        {"id": share.target_id},
    ).first()
    if stash is None:
        raise shared_not_found()
    return SharedStash(
        db=db,
        stash_id=int(stash.id),
        stash_name=stash.name,
        stash_description=stash.description,
        share_name=share.name,
    )


def get_optional_db(
    request: Request,
    identity: tuple[str, str, bool] | None = Depends(get_optional_identity),
):
    """FastAPI dependency: optional-auth session for GET /api/base-cards/{id}
    (ADR-0008). Unlike the fully public catalog
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
