from sqlalchemy.orm import Session

from app.models.set_model import CardSet


def get_all_sets(db: Session) -> list[CardSet]:
    return db.query(CardSet).order_by(CardSet.release_date, CardSet.id).all()


def get_set_by_code(db: Session, code: str) -> CardSet | None:
    return db.query(CardSet).filter(CardSet.code == code).first()
