from sqlalchemy.orm import Session

from app.repositories import account as account_repo


def delete_account(db: Session) -> None:
    """BL-87: purge the authenticated caller's own tenant -- all Postgres
    data, in one transaction. Thin pass-through today (no business rules
    beyond the repository's ordering/idempotency), kept as its own service
    function so the router stays a pure HTTP adapter, matching the
    router -> service -> repository split every other slice (inventory,
    cards, sets) already uses."""
    account_repo.purge_tenant(db)
