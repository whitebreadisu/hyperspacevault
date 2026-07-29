from sqlalchemy import text
from sqlalchemy.orm import Session


def _current_tenant_id(db: Session) -> int:
    """Mirrors repositories/inventory.py's helper of the same name: reads
    the tenant_id app/database.py's get_db already stamped onto this
    session's connection via set_config('app.current_tenant_id', ...) --
    never a request parameter."""
    return db.execute(
        text("SELECT current_setting('app.current_tenant_id')::integer")
    ).scalar()


def purge_tenant(db: Session) -> None:
    """Permanently delete every row belonging to the caller's own tenant,
    in FK-safe order (inventory / limit overrides / settings -> users ->
    tenants), inside one transaction -- a single commit() at the end means
    a failure partway through leaves nothing committed (db.close()'s
    implicit rollback on an uncommitted session undoes any of the DELETEs
    that already ran).

    Every tenant-referencing table must be purged here BEFORE the tenants
    row -- their FKs have no ON DELETE CASCADE, so a missed table turns
    DELETE /api/account into a 500 for any tenant with rows in it. That is
    not hypothetical: BL-24/BL-35 added tenant_card_limits and
    tenant_settings without extending this purge, and live dev
    verification of the limits arc (2026-07-13) hit exactly that FK 500.
    When adding a tenant-owned table, add its DELETE here and extend
    test_delete_account_purges_limits_and_settings.

    BL-126 (#244 purge_tenant rule): feedback rows are consulted here too,
    but only the identity-linked ones actually exist to purge -- a
    signed-in submitter who gave contact consent has tenant_id set to
    their own tenant; every other feedback row (anonymous submitters, and
    signed-in submitters who declined consent) has tenant_id NULL and this
    filtered DELETE never touches it, by design (migration 0027's
    feedback_purge_delete RLS policy enforces the same "never touch a NULL
    tenant_id row" shape independently, as a backstop -- see its
    docstring).

    Every statement filters explicitly by tenant_id/id (BL-87): RLS
    (migrations 0018 tenant_isolation on inventory, 0021 user_self_access
    on users, 0025/0026 tenant_isolation on tenant_card_limits/
    tenant_settings) is a backstop that happens to agree with these
    filters for swu_app, not the mechanism relied on to scope the deletion
    -- tenants itself carries no RLS at all (see migration 0024's
    docstring for why), so for that table the explicit
    `WHERE id = :tenant_id` is the *only* scoping in play.

    Idempotent: a tenant with nothing left to delete (already purged)
    matches zero rows in each DELETE and this still commits cleanly --
    "zero rows affected" is success, not an error.
    """
    tenant_id = _current_tenant_id(db)

    db.execute(
        text("DELETE FROM inventory WHERE tenant_id = :tenant_id"),
        {"tenant_id": tenant_id},
    )
    db.execute(
        text("DELETE FROM tenant_card_limits WHERE tenant_id = :tenant_id"),
        {"tenant_id": tenant_id},
    )
    db.execute(
        text("DELETE FROM tenant_settings WHERE tenant_id = :tenant_id"),
        {"tenant_id": tenant_id},
    )
    db.execute(
        text("DELETE FROM feedback WHERE tenant_id = :tenant_id"),
        {"tenant_id": tenant_id},
    )
    db.execute(
        text("DELETE FROM users WHERE tenant_id = :tenant_id"),
        {"tenant_id": tenant_id},
    )
    db.execute(
        text("DELETE FROM tenants WHERE id = :tenant_id"),
        {"tenant_id": tenant_id},
    )
    db.commit()
