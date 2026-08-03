from typing import Literal

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)
from sqlalchemy.orm import Session

from app.auth import require_verified_email
from app.database import get_db
from app.http_cache import TENANT_CACHE_CONTROL, tenant_no_store
from app.rate_limit import check_tenant_rate_limit
from app.schemas.inventory_import_schema import ImportReport
from app.schemas.inventory_schema import (
    DecrementResponse,
    IncrementResponse,
    VariantQuantityResponse,
)
from app.services import inventory as inventory_service
from app.services import inventory_import as inventory_import_service
from app.services import inventory_io, swudb_import, swunlimiteddb_import

# BL-54 S2 (§7.2/P11): upload limits on the raw file, checked before any
# parsing -- 10 MB / 20,000 rows. Full catalog is ~9,057 variants; no real
# collection approaches either bound.
IMPORT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024
IMPORT_MAX_ROWS = 20_000

# BL-53 (revised scope, A4-13/A4-04): per-tenant call budget on the import
# endpoint -- a verified-but-abusive caller can otherwise script unlimited
# dry_run calls, each doing a full DB resolve of up to IMPORT_MAX_ROWS
# rows, as a cheap amplification DoS. Same in-memory per-instance caveat as
# app/rate_limit.py's feedback limiter (module docstring there).
IMPORT_RATE_LIMIT_CALLS = 30
IMPORT_RATE_LIMIT_WINDOW_SECONDS = 60 * 60

# BL-53/A4-03: bounded-chunk read size for _read_capped below -- arbitrary
# but small relative to IMPORT_MAX_UPLOAD_BYTES, just needs to keep the
# "how far past the cap could we overshoot before noticing" bound small.
_IMPORT_READ_CHUNK_BYTES = 1024 * 1024

# BL-101: tenant_no_store router-wide -- every response here is per-tenant.
# (Previously this router carried no Cache-Control at all, contradicting
# http_cache.py's stated invariant; safe because Firebase Hosting only
# CDN-caches responses that opt in, but the header should hold explicitly.)
router = APIRouter(
    prefix="/api/inventory",
    tags=["inventory"],
    dependencies=[Depends(tenant_no_store)],
)


# BL-102: GET /api/inventory (the heavy CardResponse+quantity list) retired
# -- runtime-dead since BL-56; BL-101's lean /quantities below is its
# designed replacement. Increment/decrement mutations are unaffected.


# BL-101 catalog/quantity split: the per-tenant half. The Cards list now
# fetches the publicly cached catalog (GET /api/base-cards) plus this sparse
# quantities list, and merges client-side -- every variant_id absent here is
# quantity 0. Auth-required via get_db (like list_inventory, reads stay
# ungated by email verification -- BL-16 gates mutations only).
@router.get("/quantities", response_model=list[VariantQuantityResponse])
def list_quantities(db: Session = Depends(get_db)):
    return inventory_service.get_quantities(db)


# BL-16: the two mutating routes below carry require_verified_email in
# addition to get_db -- reads (list_inventory above) stay ungated. Both
# dependencies resolve from the same get_current_identity call (FastAPI's
# per-request dependency cache), so the token is verified exactly once.
@router.post(
    "/{variant_id}/increment",
    response_model=IncrementResponse,
    dependencies=[Depends(require_verified_email)],
)
def increment_card(variant_id: int, db: Session = Depends(get_db)):
    result = inventory_service.increment_card(db, variant_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Card {variant_id} not found")
    return result


@router.post(
    "/{variant_id}/decrement",
    response_model=DecrementResponse,
    dependencies=[Depends(require_verified_email)],
)
def decrement_card(variant_id: int, db: Session = Depends(get_db)):
    result = inventory_service.decrement_card(db, variant_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Card {variant_id} not found")
    return result


def _looks_like_swudb_header(text: str) -> bool:
    """BL-185: peeks at the file's first line only -- cheap, and the only
    thing that can distinguish a SWUDB export from a canonical CSV, since
    both are ordinary comma-separated text with no meta line. Column-name
    match, order-agnostic (set membership, not position)."""
    if not text.strip():
        return False
    first_line = text.lstrip().splitlines()[0]
    columns = {c.strip() for c in first_line.split(",")}
    return swudb_import.REQUIRED_COLUMNS.issubset(columns)


# BL-186: the ZIP local-file-header signature every XLSX file starts with
# (XLSX is a ZIP container of XML parts) -- cheap, reliable magic-byte
# sniff that works even when the filename is missing/generic (e.g. a
# browser upload named "upload" with no extension), same posture as
# _looks_like_swudb_header's text-based sniff below.
_XLSX_MAGIC = b"PK\x03\x04"


def _looks_like_xlsx(filename: str | None, raw: bytes) -> bool:
    """BL-186: filename OR magic prefix -- checked against RAW BYTES only,
    never the decoded text (§8.2/definition doc scope: XLSX is binary: an
    upload this format never reaches inventory_io._decode/utf-8-sig at
    all, unlike every other branch this router recognizes)."""
    lowered = (filename or "").lower()
    return lowered.endswith(".xlsx") or raw.startswith(_XLSX_MAGIC)


def _detect_import_format(filename: str | None, text: str) -> str:
    """§8.2's file picker accepts .json/.csv/.xlsx -- trust the extension
    when present (case-insensitively) for JSON (SWUDB has no JSON export,
    so ".json" is unambiguous); a ".csv" file could be either canonical or
    SWUDB (same extension, indistinguishable by name alone), so BL-185's
    SWUDB header sniff runs BEFORE the ".csv" extension short-circuit,
    not after. Anything left unrecognized by extension falls back to
    content sniffing: a canonical `swu-inv/1` JSON document is always a
    top-level object, so a file starting with '{' is JSON, otherwise it's
    treated as canonical CSV (which does its own recognizability check and
    refuses what it doesn't understand).

    BL-186: XLSX detection does NOT live here -- it runs on the RAW BYTES
    before this function is ever called (see the router body), specifically
    so a binary XLSX upload never reaches the `raw.decode("utf-8-sig", ...)`
    call this function's `text` parameter presupposes already succeeded.
    This function's own contract (text in, format name out) is otherwise
    unchanged."""
    lowered = (filename or "").lower()
    if lowered.endswith(".json"):
        return "json"
    if _looks_like_swudb_header(text):
        return "swudb"
    if lowered.endswith(".csv"):
        return "csv"
    return "json" if text.lstrip().startswith("{") else "csv"


def _read_capped(upload: UploadFile, max_bytes: int) -> bytes:
    """BL-53/A4-03: reads the upload in bounded chunks, stopping as soon as
    the body exceeds max_bytes rather than buffering the WHOLE file first
    and checking its length afterward -- for an oversized upload this holds
    at most max_bytes + one chunk in memory before the caller rejects it,
    instead of the full (possibly much larger, up to Cloud Run's own ~32 MB
    request-body ceiling) body. A file at or under the cap is read in full,
    identically to the old `file.file.read()` -- this only changes the
    over-cap behavior."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = upload.file.read(_IMPORT_READ_CHUNK_BYTES)
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
        if total > max_bytes:
            break
    return b"".join(chunks)


# BL-54 S2 (§7.2): stateless two-call design -- `dry_run` parses/resolves/
# computes and returns the report; `commit` re-runs the identical
# computation (same compute_import call, see services/inventory_import.py's
# module docstring) and applies it in one transaction. Gated by
# require_verified_email like export (P9 -- the whole import/export surface
# shares one auth gate).
@router.post(
    "/import",
    response_model=ImportReport,
    response_model_exclude_none=True,
    dependencies=[Depends(require_verified_email)],
)
def import_inventory(
    request: Request,
    file: UploadFile = File(...),
    mode: Literal["merge_add", "replace", "replace_all"] = Form(...),
    cap_handling: Literal["add_above", "trim"] = Form(...),
    stage: Literal["dry_run", "commit"] = Form(...),
    db: Session = Depends(get_db),
):
    # BL-53 (revised scope, A4-13/A4-04): tenant rate limit checked first,
    # before reading the upload at all -- mirrors the feedback limiter's
    # "before the DB write" placement (app/routers/feedback.py) so a
    # limited caller's request does the least possible work. tenant_id
    # comes from request.state, stamped by the get_db dependency above
    # (already resolved by the time this function body runs -- FastAPI
    # resolves all Depends() before calling the endpoint), never from
    # anything client-supplied.
    retry_after = check_tenant_rate_limit(
        "inventory_import",
        request.state.tenant_id,
        max_calls=IMPORT_RATE_LIMIT_CALLS,
        window_seconds=IMPORT_RATE_LIMIT_WINDOW_SECONDS,
    )
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limited",
                "message": "Too many import requests -- please try again later",
            },
            headers={"Retry-After": str(retry_after)},
        )

    # BL-53/A4-03: bounded-chunk read (see _read_capped) instead of an
    # unbounded file.file.read() followed by a length check -- an oversized
    # upload is never fully buffered before being rejected.
    raw = _read_capped(file, IMPORT_MAX_UPLOAD_BYTES)
    if len(raw) > IMPORT_MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=422, detail="file_too_large")

    # BL-186: XLSX detection runs on the RAW BYTES, before any text decode
    # is attempted -- an XLSX upload is a ZIP container (binary), and
    # `raw.decode("utf-8-sig", errors="replace")` below would silently
    # mangle it into garbage text (errors="replace" never raises, so a
    # binary file wouldn't even surface as a decode failure -- it would
    # just corrupt the SWUDB-header/JSON-brace sniffs that come next).
    # xlsx short-circuits to its own format name here, skipping the decode
    # entirely; every other branch is unchanged.
    if _looks_like_xlsx(file.filename, raw):
        fmt = "xlsx"
        text = ""  # never consulted by the xlsx branch below
    else:
        text = raw.decode("utf-8-sig", errors="replace")
        fmt = _detect_import_format(file.filename, text)

    # BL-53/A4-03 (single parse): the JSON body used to be fully parsed
    # twice per request -- once here (via a since-removed _raw_row_count
    # helper) just to count `cards`, then again inside inventory_io.
    # parse_json to actually build the rows -- two full json.loads calls
    # and object graphs for every import. Now there's exactly one parse
    # call for either format; the >IMPORT_MAX_ROWS gate below runs on the
    # single parse's own row count instead of a separate pre-parse count.
    # Trade-off, deliberately accepted: the row-count rejection moves from
    # before parsing to after it, so a pathologically huge file still pays
    # for one full parse before being rejected -- but that parse is bounded
    # by IMPORT_MAX_UPLOAD_BYTES (already enforced above), so the worst
    # case is the same order of magnitude of work the old pre-check parse
    # already did, not a new unbounded cost. It also means the cap now
    # applies to the post-duplicate-merge row count (parse_json/parse_csv
    # sum duplicate identities before returning, inventory_io.py's
    # _merge_duplicates) rather than the raw pre-merge count -- a file with
    # heavy duplicate rows that merges under the cap is now accepted where
    # it previously wasn't; that's a closer match to the real resolution
    # cost (which only ever sees the merged rows) than the old raw count
    # was, not a regression.
    try:
        if fmt == "json":
            parse_result = inventory_io.parse_json(raw)
        elif fmt == "swudb":
            # BL-185: the only OTHER branch that needs `db` -- SWUDB rows
            # are resolved against card_variants at parse time (see
            # swudb_import.py's module docstring for why that can't wait
            # for compute_import's own resolution step below).
            parse_result = swudb_import.parse_swudb_csv(raw, db)
        elif fmt == "xlsx":
            # BL-186: sw-unlimited-db's XLSX export -- same "resolve at
            # parse time" posture as SWUDB (see swunlimiteddb_import.py's
            # module docstring), reading `raw` directly as bytes (never
            # `text`, which is empty/unused for this branch).
            parse_result = swunlimiteddb_import.parse_swunlimiteddb_xlsx(raw, db)
        else:
            parse_result = inventory_io.parse_csv(raw)
    except (
        inventory_io.UnsupportedFormatVersionError,
        inventory_io.UnparseableFileError,
    ) as exc:
        raise HTTPException(status_code=422, detail=exc.reason) from exc

    if len(parse_result.rows) > IMPORT_MAX_ROWS:
        raise HTTPException(status_code=422, detail="too_many_rows")

    report, plan = inventory_import_service.compute_import(
        db,
        parse_result.rows,
        parse_result.notes,
        mode=mode,
        cap_handling=cap_handling,
        stage=stage,
    )

    if stage == "commit":
        inventory_import_service.apply_write_plan(db, plan)
        db.commit()
        report.committed = True

    return report


# BL-54 S1 (§7.1/§9): gated by require_verified_email like the mutating
# routes above (P9 -- export is part of the same auth-gated surface as
# import), unlike the ungated reads above it (BL-16 historically gated
# mutations only; the import/export definition package's P9 explicitly
# widens that to "the whole surface", so this route is a deliberate
# exception to the "reads stay ungated" comment above).
#
# Returns a Response built directly (not response_model) -- FastAPI does
# NOT merge headers set by a router-level Depends (tenant_no_store) onto a
# handler-returned Response instance (only onto a response it builds itself
# from returned data), so Cache-Control is set explicitly here rather than
# relied on from the router-level dependency.
@router.get(
    "/export",
    dependencies=[Depends(require_verified_email)],
)
def export_inventory(
    format: Literal["json", "csv"] = Query("json"),
    db: Session = Depends(get_db),
):
    content, filename, media_type = inventory_service.export_inventory(db, format)
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": TENANT_CACHE_CONTROL,
        },
    )
