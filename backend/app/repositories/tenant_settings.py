from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.tenant_settings import TenantSettings

# BL-35: what a tenant with no tenant_settings row resolves to -- rows are
# created lazily (see set_cap_mode), never provisioned alongside the tenant.
DEFAULT_CAP_MODE = "hard"


def _current_tenant_id(db: Session) -> int:
    """Mirrors repositories/tenant_card_limits.py's helper of the same
    name: reads the tenant_id app/database.py's get_db already stamped
    onto this session's connection via set_config('app.current_tenant_id',
    ...) -- never a request parameter."""
    return db.execute(
        text("SELECT current_setting('app.current_tenant_id')::integer")
    ).scalar()


def get_cap_mode(db: Session) -> str:
    """This tenant's cap_mode, or DEFAULT_CAP_MODE if no row exists yet.
    RLS already scopes tenant_settings to the caller's tenant; the explicit
    tenant_id filter here matches the explicit-filter-plus-RLS-backstop
    discipline the rest of this codebase's tenant-scoped repositories use
    (see repositories/tenant_card_limits.py's get_override)."""
    tenant_id = _current_tenant_id(db)
    row = db.query(TenantSettings).filter(TenantSettings.tenant_id == tenant_id).first()
    return row.cap_mode if row is not None else DEFAULT_CAP_MODE


def set_cap_mode(db: Session, cap_mode: str) -> None:
    """Upserts this tenant's cap_mode row -- the first change lazily
    creates the row (no provisioning step exists elsewhere), later changes
    update it in place."""
    tenant_id = _current_tenant_id(db)
    db.execute(
        text(
            "INSERT INTO tenant_settings (tenant_id, cap_mode) "
            "VALUES (:tenant_id, :cap_mode) "
            "ON CONFLICT (tenant_id) DO UPDATE SET "
            "cap_mode = EXCLUDED.cap_mode, updated_at = NOW()"
        ),
        {"tenant_id": tenant_id, "cap_mode": cap_mode},
    )
    db.commit()
