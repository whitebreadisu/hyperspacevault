from sqlalchemy.orm import Session

from app.repositories import sets as set_repo
from app.schemas.set_schema import SetResponse


def get_all_sets(db: Session) -> list[SetResponse]:
    sets = set_repo.get_all_sets(db)
    return [SetResponse.model_validate(s) for s in sets]


def get_set_by_code(db: Session, code: str) -> SetResponse | None:
    s = set_repo.get_set_by_code(db, code.upper())
    if s is None:
        return None
    return SetResponse.model_validate(s)
