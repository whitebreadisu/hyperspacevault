"""BL-271 phase B2: the Platform Spec's route registry is machine-checked.

NOTE: ci.yml classifies SWU_Platform_Spec.md as code (not docs-only),
so a spec-only PR still runs this test; keep that carve-out if the spec moves.

SWU_Platform_Spec.md section 1.3 carries a table under the heading
"Route registry (machine-checked)" with one row per FastAPI route: method,
path, session dependency, extra gates, and the BL id that added it.  This
test introspects the real app (no database, no network -- only the
dependency graph FastAPI already built at import time) and asserts the
table and the app agree.  A route that exists but is not in the table, a
table row for a route that no longer exists, or a row whose recorded auth
posture differs from the code all fail CI.

Why: an unauthenticated /api/relay/* route lived 7 weeks without a line in
the spec because nothing compared the spec to the app.

To fix a failure: paste the row the message prints into the table (or
delete the stale row), and if the message says "unknown dependency", add
the callable's name to the matching set below -- deliberately, after
deciding whether it is a session dependency, a gate, or neutral.
"""

from pathlib import Path

from fastapi.routing import APIRoute

from app.main import app

# --- The dependency classifier (the "known set") -------------------------

# Exactly zero or one of these per route -> the "session" column.
SESSION_DEPS = {"get_db", "get_catalog_db", "get_optional_db", "get_shared_db"}
# Zero or more -> the "extra gates" column.
GATE_DEPS = {"require_verified_email", "require_recent_auth"}
# Known and deliberately not recorded: identity resolution is reached
# transitively through get_db / get_optional_db / the gates; the cache
# header helpers and the images bucket handle do not change who may call.
NEUTRAL_DEPS = {
    "get_current_identity",
    "get_optional_identity",
    "catalog_cache",
    "tenant_no_store",
    "get_images_bucket",
}

HEADING = "#### Route registry (machine-checked)"
# FastAPI's built-in docs/schema routes are plain Starlette routes (not
# APIRoute).  They are the ONLY routes allowed to bypass the registry; any
# other non-API route (a future app.mount, a WebSocket route) fails loudly
# instead of being skipped in silence.
UNCHECKED_PATHS = {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}


def _spec_path() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "specification_documents" / "SWU_Platform_Spec.md"
        if candidate.is_file():
            return candidate
    raise AssertionError(
        "SWU_Platform_Spec.md not found above " + str(here) + "; the route "
        "registry test locates the spec by walking up to the repo root."
    )


def _walk(dependant, out: set) -> None:
    for sub in dependant.dependencies:
        # A class instance or functools.partial has no __name__; fall back to
        # repr so the failure reads "unknown dependency", not AttributeError.
        out.add(getattr(sub.call, "__name__", repr(sub.call)))
        _walk(sub, out)


def _iter_routes(routes):
    """Yield (methods, path, dependant) for every API route.

    Newer FastAPI includes routers lazily (an _IncludedRouter wrapper that
    exposes effective_route_contexts()); older versions flatten them into
    APIRoute objects.  Support both so a FastAPI bump does not silently
    drop routes from the check.
    """
    for route in routes:
        if isinstance(route, APIRoute):
            yield route.methods, route.path, route.dependant
        elif hasattr(route, "effective_route_contexts"):
            for ctx in route.effective_route_contexts():
                yield ctx.methods, ctx.path, ctx.dependant
        else:
            path = getattr(route, "path", repr(route))
            assert path in UNCHECKED_PATHS, (
                f"route {path} ({type(route).__name__}) is neither an APIRoute "
                "nor an included router, so the registry cannot check it -- "
                "either register its auth posture another way or add it to "
                "UNCHECKED_PATHS deliberately"
            )


def _introspect() -> dict:
    """{(METHOD, path): (session, gates)} from the live app."""
    found: dict = {}
    for methods, path, dependant in _iter_routes(app.routes):
        names: set = set()
        _walk(dependant, names)
        unknown = names - SESSION_DEPS - GATE_DEPS - NEUTRAL_DEPS
        assert not unknown, (
            f"unknown dependency {sorted(unknown)} on route "
            f"{'/'.join(sorted(methods))} {path} -- "
            "register it in the test's classifier (SESSION_DEPS / GATE_DEPS "
            "/ NEUTRAL_DEPS in test_route_registry.py) and in the Platform "
            "Spec section 1.3 route registry"
        )
        sessions = sorted(names & SESSION_DEPS)
        assert len(sessions) <= 1, (
            f"route {path} has more than one session dependency {sessions}; "
            "the registry records exactly one"
        )
        session = sessions[0] if sessions else "none"
        gates = ",".join(sorted(names & GATE_DEPS)) or "none"
        for method in methods:
            if method in ("HEAD", "OPTIONS"):
                continue
            found[(method, path)] = (session, gates)
    return found


def _parse_registry() -> dict:
    """{(METHOD, path): (session, gates, since)} from the spec table."""
    text = _spec_path().read_text(encoding="utf-8")
    assert HEADING in text, f"heading {HEADING!r} missing from the Platform Spec"
    section = text.split(HEADING, 1)[1]
    rows: dict = {}
    started = False
    for line in section.splitlines():
        if not line.startswith("|"):
            if started:
                break
            continue
        started = True
        cells = [c.strip().strip("`") for c in line.strip().strip("|").split("|")]
        if cells[0] in ("Method", "") or set(cells[0]) <= {"-", ":"}:
            continue
        assert len(cells) == 5, f"registry row needs 5 columns: {line}"
        method, path, session, gates, since = cells
        assert (method, path) not in rows, f"duplicate registry row: {line}"
        rows[(method, path)] = (session, gates, since)
    return rows


def _row(method: str, path: str, session: str, gates: str, since: str = "BL-?") -> str:
    return f"| {method} | `{path}` | {session} | {gates} | {since} |"


def test_registry_matches_app():
    actual = _introspect()
    registry = _parse_registry()
    assert registry, "the Platform Spec route registry table is empty"

    problems = []
    for key in sorted(set(actual) - set(registry), key=lambda k: (k[1], k[0])):
        problems.append(
            f"route {key[0]} {key[1]} exists in the app but is NOT in the "
            "Platform Spec route registry. Paste this row into section 1.3 "
            "(fill in the BL id):\n  " + _row(*key, *actual[key])
        )
    for key in sorted(set(registry) - set(actual), key=lambda k: (k[1], k[0])):
        problems.append(
            f"registry row {key[0]} {key[1]} has no matching route in the "
            "app -- delete the stale row from Platform Spec section 1.3"
        )
    for key in sorted(set(actual) & set(registry), key=lambda k: (k[1], k[0])):
        session, gates = actual[key]
        r_session, r_gates, since = registry[key]
        if (session, gates) != (r_session, r_gates):
            problems.append(
                f"route {key[0]} {key[1]} auth posture differs. Registry "
                f"says session={r_session} gates={r_gates}; the code has "
                f"session={session} gates={gates}. Correct row:\n  "
                + _row(*key, session, gates, since)
            )
        if not since or since == "BL-?":
            problems.append(f"registry row {key[0]} {key[1]} has no 'since' value")
    assert not problems, "\n" + "\n".join(problems)
