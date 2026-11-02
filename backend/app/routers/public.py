"""Tenant-less public bulk reads (`/api/public/*`).

GET /api/public/cards is the public card pages' generator input (design
note CardPages 2026-11-02 section 3). It runs on get_catalog_db, so its bytes
cannot depend on the caller (http_cache.py invariant), and it is the same
data anyone can already read card by card. Cache-Control carries only the
CDN tier (`s-maxage`), not a browser `max-age`: the generator must read
current data, and the CDN copy is purged on every Hosting deploy."""

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.database import get_catalog_db
from app.schemas.public_catalog_schema import PublicCatalogResponse
from app.services import cards as card_service

PUBLIC_CATALOG_CACHE_CONTROL = "public, s-maxage=3600"

router = APIRouter(prefix="/api/public", tags=["public"])


@router.get("/cards", response_model=PublicCatalogResponse)
def get_public_cards(response: Response, db: Session = Depends(get_catalog_db)):
    response.headers["Cache-Control"] = PUBLIC_CATALOG_CACHE_CONTROL
    return card_service.get_public_catalog(db)
