# ADR-0008: Anonymous catalog reads via a tenant-less RLS-safe session

## Status
Accepted — 2026-07-05

> **Amended 2026-07-10 (BL-101, catalog/quantity split):** the base-cards **list** route
> left the optional-auth (`get_optional_db`) family — its per-variant `quantity` moved to
> the auth-gated `GET /api/inventory/quantities`, making the list strictly tenant-less
> (`get_catalog_db`) and publicly CDN-cacheable like `/api/cards`/`/api/sets`. A
> present-but-invalid token is now *ignored* on the list (like the other pure catalog
> reads), no longer `401`d. Everything below about optional-auth and per-variant
> `quantity` still holds for the **detail** route (`GET /api/base-cards/{id}`), which
> remains this ADR's `get_optional_db` consumer.
>
> **Amended again same day (BL-102):** `GET /api/cards`/`/api/cards/{id}` — half of this
> ADR's original anonymous-read surface — were retired outright (runtime-dead since
> BL-56/BL-44; the app fetches `/api/base-cards`). The decision's architecture
> (`get_catalog_db` / tenant-less RLS-safe sessions) is unchanged; its surviving
> consumers are `/api/sets*` and the base-cards list.

## Context
BL-56 unifies the Catalog and Inventory tabs into one **Cards** list and makes the
catalog **publicly readable** — an anonymous visitor browses the full card list and
opens card details, with inventory affordances present but inert as a signup teaser
(`SWU_Application_Spec.md` §5.5).

Today there is no anonymous path at any layer. Every `/api/*` route declares
`Depends(get_db)`, and `get_db` (`app/database.py`) depends on `get_current_identity`
(`app/auth.py`), which raises `HTTPException(401)` on a missing or invalid Firebase
token. So `get_db` does three things at once: **verify the token**, **resolve/auto-provision
the tenant**, and **open a `swu_app` (RLS-enforced) session**. The invariant the platform
leans on (Platform Spec §1.3) is "a route is authenticated *iff* it takes `get_db`."

The catalog tables (`sets`, `base_cards`, `card_variants`, and the join tables) are
**shared reference data, not tenant-scoped** — `swu_app` already has blanket `SELECT`
on them and no RLS policy filters them by tenant. Only `inventory` and `users` are
tenant-scoped. So the data is *already* safe to read without a tenant; the obstacle is
purely that the only way to get a session also demands a verified identity.

Alternatives considered:
- **Keep everything auth-gated (no public catalog).** Rejected — it defeats BL-56's
  public-catalog/conversion goal, which is the point of the unification.
- **Make identity optional inside `get_db`** (allow a missing token → no tenant). Rejected —
  it muddies the "`get_db` ⇒ authenticated" invariant §1.3 depends on, and forces the
  auto-provisioning branch to reason about "no identity," risking accidental exposure if a
  future mutation route inherits the now-optional dependency.
- **A separate public read service / second API.** Rejected — over-engineering for a solo
  project; same database, same SQLAlchemy models. A second dependency is vastly cheaper.
- **Duplicate catalog into a public, RLS-free table or role.** Rejected — the catalog is
  already non-tenant data readable by `swu_app`; duplication buys nothing and adds a sync
  burden.

## Decision
Add a **second FastAPI dependency** — a tenant-less catalog session (`get_catalog_db`) —
that opens a `swu_app` session and sets **no** `app.current_firebase_uid` and **no**
`app.current_tenant_id` (verifying no token). Use it on the fully public catalog **read**
endpoints: `GET /api/cards`, `GET /api/cards/{variant_id}`, `GET /api/sets`, and
`GET /api/sets/{set_code}`. Leave `get_db` unchanged for `/api/inventory` and every
mutation.

**Build-time refinement (Slice 1): `GET /api/base-cards/{id}` needed a third shape, not
the tenant-less one.** Unlike the other catalog reads, base-cards returns a per-variant
`quantity` sourced from `inventory` (SWU_Application_Spec.md §12) — a strictly tenant-less
session would show `quantity: 0` even to a signed-in caller who owns the card, which is a
regression, not a teaser. The endpoint needs **optional auth**: a real tenant (and real
quantities) when a valid bearer token is present, a tenant-less session (quantity 0) when
no `Authorization` header is sent, and still a `401` for a *present but invalid/expired*
token — a bad token must never be silently downgraded to anonymous. This is a third
dependency, `get_optional_db` (backed by `get_optional_identity` in `app/auth.py`, the
optional-token counterpart to `get_current_identity`), not a variant of `get_catalog_db`.
`get_catalog_db` stays strictly tenant-less, used only by the two endpoints that carry no
tenant-scoped data at all.

RLS is the fail-safe for all three dependencies. Because the same `swu_app` role serves
`get_db`, `get_catalog_db`, and `get_optional_db`'s anonymous branch, the tenant-scoped
tables must return **zero rows** under a no-tenant session. That requires revising the
`tenant_isolation` policy's `COALESCE(current_setting('app.current_tenant_id', true)::integer, 1)`
fallback (migration 0018), which today would default a tenant-less session to **tenant 1** —
leaking tenant 1's inventory. The fix (migration 0023) makes an unset **or explicitly
cleared** tenant match **no** rows instead of tenant 1 — the "explicitly cleared" half
matters because `AppSessionLocal` connections are pooled and `get_db`'s `set_config(...,
false)` persists a tenant for the life of the *connection*, not the request, so
`get_catalog_db`/`get_optional_db` explicitly clear both GUCs to `''` on every checkout
rather than relying on "a fresh connection never sets them."

## Consequences
- **+** Anonymous catalog browsing without weakening the auth guarantee on inventory or
  mutations. The public surface is exactly the small, explicit set of endpoints that opt
  into a catalog dependency.
- **+** Preserves the §1.3 mental model for authed routes; reuses existing models and the
  least-privilege `swu_app` role — no data duplication, no second service.
- **−** There are now **three** DB dependencies (`get_db`, `get_catalog_db`,
  `get_optional_db`), not two. A developer must consciously pick the right one: `get_db`
  for anything tenant-scoped and mutating, `get_catalog_db` for reads that carry no
  tenant data at all, `get_optional_db` for a read that carries tenant data but must
  still be reachable anonymously. Mitigation: `swu_app` grants `INSERT/UPDATE/DELETE`
  only on `inventory`, so a mutation accidentally hung off either read dependency fails
  on privileges anyway, and RLS still blocks cross-tenant reads regardless of which
  dependency a route uses.
  > **As-built update (2026-08-16, BL-205):** the count is now **four** — v1.4 added
  > `get_shared_db`, the token-scoped dependency behind the anonymous share-viewer
  > routes (`/api/shared/{token}*`). It resolves a secret share token to its owner's
  > tenant via an RLS policy on the `shares` table, then scopes the session exactly as
  > `get_db` would — the same "RLS is the enforcer" posture this ADR established,
  > extended to a credential that isn't a Firebase identity. The picking rule gains one
  > clause: `get_shared_db` is only ever used by the shared-viewer router.
- **−** The migration 0018 `COALESCE(…, 1)` fallback **must change**, with a regression test
  proving a tenant-less session sees **zero** `inventory`/`users` rows, including on a
  pooled connection previously scoped to a real tenant. This touches the RLS policy that
  ADR-0001 established — handled as a policy revision (migration 0023), not a new
  isolation model.
- **−** `GET /api/base-cards/{id}` returns `quantity: 0` for **anonymous** callers only (RLS
  yields no inventory rows for a tenant-less session) — an **authenticated** caller sees
  their real per-tenant quantity via `get_optional_db`'s resolved-tenant branch. The
  frontend must render `quantity: 0` as "not signed in" only when the caller is actually
  anonymous, never assume every 0 means "you own zero" or that every base-cards response
  is tenant-less.
- **−** `/api/cards`, `/api/sets`, and `/api/base-cards/{id}` become reachable without a
  token, enlarging the abuse surface and making API rate limiting (BL-53) more relevant
  for the catalog reads. `/api/base-cards/{id}` additionally still verifies a token when
  one is presented, so it retains the same 401-on-bad-token behavior as every authed route
  for that case.

Supersedes the BL-17 assumption that the catalog is reached only through the authenticated
app shell; realizes BL-17's long-planned "tenant-less catalog DB session (RLS fail-safe)."
