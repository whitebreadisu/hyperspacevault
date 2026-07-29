"""BL-24: shared per-tenant inventory-limit vocabulary and resolution.

Keeps the type_category/limit_bucket vocabulary and code-default values in
one place so services/inventory.py (enforcement, POST increment) and
services/settings.py (the GET/PUT /api/settings/limits matrix) can't drift
apart. limit_bucket itself (finish-or-channel derivation) lives in
app/ingestion/swuapi_classify.py -- see that module's ALL_LIMIT_BUCKETS for
the canonical bucket vocabulary.

type_category's two literal values ("singleton"/"standard") are mirrored in
app/schemas/settings_schema.py's TypeCategory Literal type; that schema
deliberately does not import this module (schemas stay leaf modules with no
service-layer dependency), so keep the two in sync by hand if this ever
changes.

BL-35 adds the cap_mode ("hard"/"soft") enforcement-mode vocabulary here
for the same drift-prevention reason -- inventory.py's increment_card reads
effective_cap_mode to decide whether an at/over-limit increment blocks or
commits-and-flags, and settings.py's GET/PUT round-trips it alongside the
limits matrix. cap_mode's two literal values are likewise mirrored in
app/schemas/settings_schema.py's CapMode Literal type.
"""

from sqlalchemy.orm import Session

from app.repositories import tenant_card_limits as tenant_card_limits_repo
from app.repositories import tenant_settings as tenant_settings_repo

TYPE_CATEGORY_SINGLETON = "singleton"
TYPE_CATEGORY_STANDARD = "standard"
ALL_TYPE_CATEGORIES = (TYPE_CATEGORY_SINGLETON, TYPE_CATEGORY_STANDARD)

# BL-24 design: Leader/Base are "singleton" (each variant capped at 1 by
# default); everything else is "standard" (each variant capped at 3 by
# default). Ported from services/inventory.py's pre-BL-24 SINGLETON_TYPES.
SINGLETON_BASE_CARD_TYPES = frozenset({"Leader", "Base"})

# Code defaults (BL-24 design): NOT provisioned as tenant_card_limits rows
# -- a tenant with no override row for a (category, bucket) cell gets these.
DEFAULT_LIMITS = {
    TYPE_CATEGORY_SINGLETON: 1,
    TYPE_CATEGORY_STANDARD: 3,
}


def type_category(base_card_type: str) -> str:
    """ "singleton" for Leader/Base, "standard" for everything else."""
    return (
        TYPE_CATEGORY_SINGLETON
        if base_card_type in SINGLETON_BASE_CARD_TYPES
        else TYPE_CATEGORY_STANDARD
    )


def effective_limit(db: Session, category: str, bucket: str) -> int | None:
    """The tenant's effective max_quantity for (category, bucket): the
    override row's value if one exists (which may itself be None, meaning
    the tenant explicitly configured "no limit"), else the code default.
    A return value of None always means unlimited."""
    override = tenant_card_limits_repo.get_override(db, category, bucket)
    if override is not None:
        return override.max_quantity
    return DEFAULT_LIMITS[category]


# BL-35: the two cap_mode values -- "hard" (default) blocks an at/over-limit
# increment; "soft" commits it and flags the response over_limit=True. The
# 999 QUANTITY_CEILING (services/inventory.py) blocks unconditionally in
# both modes -- cap_mode only governs the effective-limit check.
CAP_MODE_HARD = "hard"
CAP_MODE_SOFT = "soft"
ALL_CAP_MODES = (CAP_MODE_HARD, CAP_MODE_SOFT)


def effective_cap_mode(db: Session) -> str:
    """This tenant's cap_mode ("hard" or "soft"), defaulting to "hard" when
    no tenant_settings row exists yet -- rows are created lazily (see
    set_cap_mode / repositories/tenant_settings.py)."""
    return tenant_settings_repo.get_cap_mode(db)


def set_cap_mode(db: Session, cap_mode: str) -> None:
    """Persists a cap_mode change (upserts the tenant_settings row)."""
    tenant_settings_repo.set_cap_mode(db, cap_mode)
