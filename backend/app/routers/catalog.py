from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.database import get_catalog_db
from app.http_cache import CATALOG_CACHE_CONTROL
from app.services import catalog as catalog_service

# BL-54 S1 (§6/§7.4): a new router rather than folding into base_cards.py
# or sets.py -- distinct prefix/tag, and its own thing conceptually (a
# downloadable reference file, not a JSON catalog read).
router = APIRouter(prefix="/api/catalog", tags=["catalog"])


# BL-56 / ADR-0008: publicly readable, tenant-less (get_catalog_db) --
# carries no per-tenant data, same exposure class as GET /api/sets.
#
# Cache-Control is set explicitly here rather than via the shared
# http_cache.catalog_cache dependency: that dependency mutates a
# FastAPI-injected `response` object whose headers only get merged into the
# final response when the handler returns plain data for FastAPI to wrap --
# a handler that returns its own Response instance directly (required here,
# for Content-Disposition + a non-JSON media type) is used as-is, with no
# header merge from any Depends(). See app/routers/inventory.py's export
# route for the same note.
@router.get("/reference.csv")
def get_catalog_reference(db: Session = Depends(get_catalog_db)):
    content, filename = catalog_service.get_reference_csv(db)
    return Response(
        content=content,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": CATALOG_CACHE_CONTROL,
        },
    )
