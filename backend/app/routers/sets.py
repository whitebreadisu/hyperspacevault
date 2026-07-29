from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_catalog_db
from app.http_cache import catalog_cache
from app.schemas.set_schema import SetResponse
from app.services import sets as set_service

# RR-3 (issue #129): tenant-less catalog reads are safely CDN-cacheable.
router = APIRouter(
    prefix="/api/sets", tags=["sets"], dependencies=[Depends(catalog_cache)]
)


# BL-56 / ADR-0008: publicly readable -- sets carries no tenant data.
@router.get("", response_model=list[SetResponse])
def list_sets(db: Session = Depends(get_catalog_db)):
    return set_service.get_all_sets(db)


@router.get("/{set_code}", response_model=SetResponse)
def get_set(set_code: str, db: Session = Depends(get_catalog_db)):
    result = set_service.get_set_by_code(db, set_code)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Set '{set_code}' not found")
    return result
