from sqlalchemy.orm import Session

from app.repositories import account as account_repo


def delete_account(db: Session) -> None:
    """Purge the authenticated caller's own tenant -- all Postgres data, in
    one transaction. A thin pass-through (no business rules beyond the
    repository's ordering/idempotency), kept as its own service function so
    the router stays a pure HTTP adapter, matching the
    router -> service -> repository split the other modules (inventory,
    cards, sets) use."""
    account_repo.purge_tenant(db)
