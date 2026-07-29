from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.tenant_card_limit import TenantCardLimit


def _current_tenant_id(db: Session) -> int:
    """Mirrors repositories/inventory.py's and repositories/account.py's
    helper of the same name: reads the tenant_id app/database.py's get_db
    already stamped onto this session's connection via
    set_config('app.current_tenant_id', ...) -- never a request parameter."""
    return db.execute(
        text("SELECT current_setting('app.current_tenant_id')::integer")
    ).scalar()


def get_overrides(db: Session) -> dict[tuple[str, str], int | None]:
    """This tenant's override rows, keyed by (type_category, limit_bucket)
    -> max_quantity (None means the tenant explicitly set "no limit" for
    that cell). RLS already scopes tenant_card_limits to the caller's
    tenant; the explicit tenant_id filter here matches the
    explicit-filter-plus-RLS-backstop discipline the rest of this
    codebase's tenant-scoped repositories use (see
    repositories/account.py's purge_tenant)."""
    tenant_id = _current_tenant_id(db)
    rows = (
        db.query(TenantCardLimit).filter(TenantCardLimit.tenant_id == tenant_id).all()
    )
    return {(r.type_category, r.limit_bucket): r.max_quantity for r in rows}


def get_override(
    db: Session, type_category: str, limit_bucket: str
) -> TenantCardLimit | None:
    """The tenant's override row for one (type_category, limit_bucket)
    cell, or None if the tenant has no override for it (the code default
    applies)."""
    tenant_id = _current_tenant_id(db)
    return (
        db.query(TenantCardLimit)
        .filter(
            TenantCardLimit.tenant_id == tenant_id,
            TenantCardLimit.type_category == type_category,
            TenantCardLimit.limit_bucket == limit_bucket,
        )
        .first()
    )


def replace_overrides(
    db: Session, overrides: list[tuple[str, str, int | None]]
) -> None:
    """PUT /api/settings/limits semantics: full replacement. Deletes this
    tenant's existing override rows and inserts the given set, in one
    transaction -- a caller that PUTs an empty list resets the tenant back
    to all code defaults."""
    tenant_id = _current_tenant_id(db)
    db.execute(
        text("DELETE FROM tenant_card_limits WHERE tenant_id = :tenant_id"),
        {"tenant_id": tenant_id},
    )
    for type_category, limit_bucket, max_quantity in overrides:
        db.add(
            TenantCardLimit(
                tenant_id=tenant_id,
                type_category=type_category,
                limit_bucket=limit_bucket,
                max_quantity=max_quantity,
            )
        )
    db.commit()
