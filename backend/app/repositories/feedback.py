from sqlalchemy import text
from sqlalchemy.orm import Session


def insert_feedback(
    db: Session,
    *,
    message: str,
    contact_ok: bool,
    contact_email: str | None,
    tenant_id: int | None,
    commit_sha: str | None,
) -> None:
    """A plain INSERT with no RETURNING clause -- deliberate, not an
    oversight. Migration 0027's feedback_select_own_tenant SELECT policy
    only ever makes a row visible when tenant_id equals the caller's own
    current tenant -- an anonymous insert's tenant_id is NULL, which that
    policy never matches (by design: it exists solely so purge_tenant's
    DELETE can locate a tenant's own rows, not to back a read endpoint).
    RETURNING acts like an implicit SELECT of the just-inserted row, so
    `INSERT ... RETURNING` against an anonymous row would raise the exact
    same "new row violates row-level security policy" error as a WITH
    CHECK failure, even though the INSERT's own WITH CHECK passes cleanly
    on its own (confirmed empirically while building this migration).
    Skipping RETURNING here sidesteps that asymmetry entirely rather than
    special-casing anonymous vs. consented inserts -- nothing here needs
    the DB-assigned id/created_at back; app/services/feedback.py times the
    GitHub notification off its own now() instead of the row's server-
    assigned created_at."""
    db.execute(
        text(
            "INSERT INTO feedback "
            "(message, contact_ok, contact_email, tenant_id, commit_sha) "
            "VALUES (:message, :contact_ok, :contact_email, :tenant_id, :commit_sha)"
        ),
        {
            "message": message,
            "contact_ok": contact_ok,
            "contact_email": contact_email,
            "tenant_id": tenant_id,
            "commit_sha": commit_sha,
        },
    )
    db.commit()
