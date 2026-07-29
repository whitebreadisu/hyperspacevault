import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.http_cache import tenant_no_store
from app.rate_limit import check_tenant_rate_limit
from app.schemas.deck_check_schema import DeckCheckRequest, DeckCheckResponse
from app.services import deck_check as deck_check_service
from app.services.deck_fetch import FetchFailedError, UnsupportedUrlError
from app.services.deck_parse import InvalidDeckJsonError

# BL-53 (revised scope, A4-13): per-tenant call budget -- deck-check's SSRF
# hygiene is strong (deck_fetch.py: host allowlist, no redirects, 10s
# timeout, ~1 MB streamed cap) but an authed caller can still script
# repeated outbound fetches against the two allowlisted providers, or
# repeated deck_json resolves, as amplification. Same in-memory
# per-instance caveat as app/rate_limit.py's feedback limiter.
DECK_CHECK_RATE_LIMIT_CALLS = 60
DECK_CHECK_RATE_LIMIT_WINDOW_SECONDS = 60 * 60

# BL-53/A4-13: deck_json has no structural size limit of its own (it's a
# free-form dict, DeckCheckRequest.deck_json: dict) -- only Cloud Run's own
# ~32 MB request-body ceiling bounded it before this. Rejected before any
# parse/resolve work (deck_parse.py / deck_check_service.check_deck).
MAX_DECK_JSON_BYTES = 1024 * 1024

# BL-137: auth-only, not verified-email-gated -- deck check MUTATES NOTHING
# (it only reads the caller's own inventory via RLS), so
# require_verified_email (which gates inventory quantity changes, and since
# BL-54 S1 also GET /api/inventory/export -- see auth.py's docstring)
# doesn't apply here, matching CLAUDE.md's decided posture. Every response is
# per-tenant (the buildability numbers depend on the caller's own
# inventory), so tenant_no_store applies router-wide like app/routers/
# inventory.py.
router = APIRouter(
    prefix="/api/deck-check",
    tags=["deck-check"],
    dependencies=[Depends(tenant_no_store)],
)


def _typed_error(status_code: int, error: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code, detail={"error": error, "message": message}
    )


@router.post("", response_model=DeckCheckResponse)
def deck_check(
    request: Request,
    body: DeckCheckRequest,
    mode: Literal["standard", "cheapest"] = Query(
        "standard",
        description=(
            "Cost mode (Definition_DeckCheck_2026-07-16.md §5): 'standard' "
            "(default) prices each missing card at its Standard printing's "
            "market price (falling back to the cheapest priced printing's "
            "market when the Standard printing itself is unpriced); "
            "'cheapest' prices at min(low) across all priced printings."
        ),
    ),
    db: Session = Depends(get_db),
):
    """Definition_DeckCheck_2026-07-16.md §6. Body carries exactly one of
    `url` (server-side fetch against the swubase.com/sw-unlimited-db.com
    allowlist) or `deck_json` (the de facto paste-JSON shape) -- never
    both, never neither. An empty inventory is NOT an error: every card
    simply comes back missing, per the decided policy."""
    # BL-53 (revised scope, A4-13): tenant rate limit first, before any
    # validation/parse/fetch work -- same "before the DB write"/least-work
    # placement as the feedback limiter and the import route above.
    # request.state.tenant_id is stamped by the get_db dependency, already
    # resolved by the time this body runs.
    retry_after = check_tenant_rate_limit(
        "deck_check",
        request.state.tenant_id,
        max_calls=DECK_CHECK_RATE_LIMIT_CALLS,
        window_seconds=DECK_CHECK_RATE_LIMIT_WINDOW_SECONDS,
    )
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limited",
                "message": "Too many deck-check requests -- please try again later",
            },
            headers={"Retry-After": str(retry_after)},
        )

    # `is not None`, not truthiness -- an empty dict deck_json={} is still
    # "provided" (and will separately fail deck_parse's structural checks),
    # so it must count toward the XOR, not be treated as "absent".
    url_provided = body.url is not None
    deck_json_provided = body.deck_json is not None
    if url_provided == deck_json_provided:
        raise _typed_error(
            422,
            "invalid_deck_json",
            "exactly one of 'url' or 'deck_json' must be provided",
        )

    # BL-53/A4-13: body-size cap on deck_json, before parse/resolve work
    # (deck_parse's structural checks and deck_check_service.check_deck's
    # DB resolution both come after this). Measured on the re-serialized
    # dict rather than the original request bytes -- FastAPI/pydantic
    # already decoded the whole body into `body.deck_json` by the time this
    # handler runs (a normal JSON request body isn't streamed), so this is
    # a defensive cap on the parsed shape, not a true streaming guard like
    # the import endpoint's file read -- but it still stops an oversized
    # deck_json from ever reaching deck_parse/check_deck.
    if deck_json_provided:
        deck_json_size = len(json.dumps(body.deck_json).encode("utf-8"))
        if deck_json_size > MAX_DECK_JSON_BYTES:
            raise _typed_error(
                422,
                "deck_json_too_large",
                f"deck_json exceeds the {MAX_DECK_JSON_BYTES}-byte cap",
            )

    try:
        return deck_check_service.check_deck(
            db, url=body.url, deck_json=body.deck_json, mode=mode
        )
    except UnsupportedUrlError as exc:
        raise _typed_error(
            422,
            "unsupported_url",
            f"{exc} -- paste the deck's JSON instead (see the paste-JSON option).",
        ) from exc
    except FetchFailedError as exc:
        raise _typed_error(502, "fetch_failed", str(exc)) from exc
    except InvalidDeckJsonError as exc:
        raise _typed_error(422, "invalid_deck_json", exc.reason) from exc
