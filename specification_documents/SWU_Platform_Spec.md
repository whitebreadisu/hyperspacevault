# SWU Platform Spec — As-Built Platform Reference

**Version 1.0 | Created 2026-06-14**

---

## Purpose & How to Use This Document

`SWU_ClaudeCode_Spec.md` is the application spec: data model, API, frontend UI. It explicitly put cloud hosting, CI/CD, and multi-tenancy out of scope for V1.

This document is its platform-side peer. It describes **how the deployed system actually works today** — authentication and multi-tenancy, the CI/CD pipeline, the Terraform-managed GCP infrastructure, observability, and the current security posture — with file/line references precise enough that a reviewer (human or AI) can verify each claim against the code without re-deriving it.

**Relationship to other documents:**

| Document | Role |
|---|---|
| `SWU_ClaudeCode_Spec.md` | Application spec — data model, API, frontend UI (V1) |
| **`SWU_Platform_Spec.md`** (this document) | As-built platform reference — auth/tenancy, CI/CD, infrastructure, observability, security |
| `SWU_Platform_Roadmap.md` | Phase-by-phase history and status tracker (P1-P7). Slimmed per `SWU_Backlog.md` BL-2 once this document existed — read it for *when and why* a decision was made; read this document for *how it works now*. |
| `SWU_Platform_Security_Review.md` | Full OWASP Top 10 + secrets/network walkthrough (P7 Stage 4). Section 5 below is a condensed summary that cross-references it. |
| `learning_guide/SWU_Learning_Guide.md` | Teaching-oriented companion — deeper "why," external resources, concept explanations. This document is the terse reference; the learning guide is the narrative. |
| `SWU_Backlog.md` | Open tech-debt/follow-up items, including several referenced from this document (BL-8, BL-9). |

**Design Rationale sections.** Several sections below include an inline "Design Rationale" subsection — a condensed decision record (selected option, alternatives considered, what tipped it) for choices that shaped the as-built system. These were migrated from `SWU_Platform_Roadmap.md`'s "Open Decisions" log and `SWU_Learning_Guide.md`'s "Selection & Comparison" sections (per `SWU_Backlog.md` Open Question B, resolved 2026-06-14 as "inline, not a separate ADR folder"). The roadmap/learning guide retain the full narrative treatment for anyone who wants the teaching version; these are the condensed, durable record.

---

## 1. Auth & Tenancy Architecture

### 1.1 Overview

Most `/api/*` routes require `Authorization: Bearer <Firebase ID token>`. A single FastAPI dependency, `get_db`, both verifies that token and establishes the caller's tenant context for PostgreSQL Row-Level Security (RLS) — every such router gets both for free by declaring `Depends(get_db)`. The exception is the public catalog reads (below).

> **As-built exception — BL-56 (anonymous catalog reads, shipped to prod 2026-07-05).** The unified Cards view (`SWU_Application_Spec.md` §5.5) makes the catalog readable by anonymous visitors. Catalog reads run on **two additional dependencies** alongside `get_db`: **`get_catalog_db`** (strictly tenant-less — `GET /api/sets`, and `GET /api/base-cards` *list* since BL-101's catalog/quantity split removed `quantity` from it) opens a `swu_app` session that verifies no token and sets no tenant; **`get_optional_db`** (optional-auth — `GET /api/base-cards/{id}` detail only) resolves a real tenant when a valid token is present (real per-tenant `quantity`) and runs tenant-less otherwise (`quantity: 0`), still returning `401` for a *present-but-invalid* token. The Cards list's per-tenant quantities come from the auth-gated `GET /api/inventory/quantities` (BL-101), merged client-side. *(BL-102, 2026-07-10: the `GET /api/cards*` family and the heavy `GET /api/inventory` list — runtime-dead since BL-56/BL-44 — were retired outright.)* All `/api/inventory` routes and every mutation stay on `get_db` (auth-gated). RLS is the fail-safe: **migration 0023** replaced the `tenant_isolation` policy's `COALESCE(current_setting('app.current_tenant_id', true)::integer, 1)` fallback (which would have leaked tenant 1's inventory to a no-tenant session) with a `NULLIF(current_setting('app.current_tenant_id', true), '')::integer` form, so an unset **or** explicitly-cleared tenant matches **zero** rows; `get_catalog_db`/`get_optional_db` clear both session GUCs to `''` on every checkout because `swu_app` connections are pooled. Rationale + rejected alternatives: [ADR-0008](../docs/decisions/0008-anonymous-catalog-reads.md). *Live in prod.*

> **As-built addition — BL-126 (user feedback, shipped 2026-07-14).** `POST /api/feedback` (`SWU_Application_Spec.md` §4.6/§5.9/§12) is a **third** consumer of `get_optional_db`, alongside `GET /api/base-cards/{id}`. Unlike that route, an anonymous caller here is not a degraded stand-in for a signed-in one — anonymous submission is a fully first-class, intentionally-supported case. The row-level consent semantics (whether `tenant_id`/email ever get attached) are enforced in `app/services/feedback.py`, not by this dependency — `get_optional_db` contributes only `request.state.tenant_id` (`None` for anonymous, the real tenant for a signed-in caller), exactly as it does for every other optional-auth route. The `feedback` table (migration `0027`) is this codebase's **first tenant-optional table** — every prior tenant-owned table assumes a real `tenant_id` — and accordingly departs from the single blanket `tenant_isolation` policy pattern below (§1.5) with three narrower, command-specific RLS policies. Full data-model and RLS detail lives in the App Spec (§4.6), which is the shape's actual home, the same way migrations 0025/0026's tenant-settings RLS is documented there and not duplicated here. *Live in prod.*

> **As-built addition — BL-16 (email verification, v1.0).** A verified `Authorization: Bearer <token>` is no longer sufficient on its own for the two inventory-**mutating** routes (`POST /api/inventory/{id}/increment`/`decrement`): they also declare `Depends(require_verified_email)` (`app/auth.py`), which reads the *same* resolved `get_current_identity` result (FastAPI's per-request dependency cache means the token is still verified exactly once) and rejects with **403** `{"detail": "email_not_verified"}` if the decoded token's `email_verified` claim is false or absent. Every other authenticated route — reads (`GET /api/inventory/quantities`; the heavy `GET /api/inventory` list was retired in BL-102), catalog endpoints, and `DELETE /api/account` (BL-87) — is deliberately **not** gated: an unverified user must still be able to browse, and must still be able to delete their own account (gating that would strand it). The frontend calls `sendEmailVerification()` after signup and shows a persistent, dismiss-proof `VerifyEmailBanner` (`frontend/src/components/VerifyEmailBanner.tsx`) whenever a signed-in user is unverified, with Resend and "I've verified" (forces `reload()` + `getIdToken(true)` so the backend sees the new claim) actions. *Live in prod; supersedes the "no verification required" interim trade-off `SWU_Backlog.md`'s BL-16 entry previously described.*
>
> **As-built addition — BL-54 S1 (inventory export, `require_verified_email` widened).** `GET /api/inventory/export?format=json|csv` also declares `Depends(require_verified_email)`, despite being a read — the import/export definition package's P9 decision is that verified email gates "the whole surface" (import and export together, `Definition_ImportExport_2026-07-22.md` §2/§7.1), not just mutations. This is the first read route carrying the gate; every other read (catalog, `GET /api/inventory/quantities`, deck check) remains ungated. `GET /api/catalog/reference.csv` (§6/§7.4) is unaffected — it's fully public/tenant-less like `GET /api/sets`, carrying no `require_verified_email` or even `get_db` at all. **`PUT /api/settings/limits` stays ungated by owner decision (Jeremy, 2026-07-23, settled):** the gate's boundary is **inventory data writes** (increment/decrement, import, export); account-scoped configuration and account self-service (`DELETE /api/account`) sit deliberately outside it. Rationale: settings are RLS-isolated to the caller's own tenant, bounded/validated, and inert until the account verifies (everything they influence is already gated) — a gate there would catch no failure class. Recorded here + at the route comment (`app/routers/settings.py`) so the question stops being re-flagged.
>
> **As-built addition — BL-116 (password reset) + BL-118 (Google sign-in), shipped to prod 2026-07-20.** Auth is no longer Email/Password-only, correcting §1.7.4 and §3.9 below. **BL-116** adds a self-service reset: `AuthModal.tsx`'s "forgot password" screen calls Firebase's `sendPasswordResetEmail`; no backend change (token verification stays provider-agnostic, §1.2). **BL-118** adds a second sign-in provider: `AuthModal.tsx` uses `GoogleAuthProvider` + `signInWithPopup` (with `signInWithRedirect` as a documented fallback), and `DeleteAccountModal.tsx` uses `reauthenticateWithPopup` so a Google-only user can still pass the BL-88 recent-auth gate before deleting their account or (where applicable) changing a password. **Collision policy:** [ADR-0016](../docs/decisions/0016-auth-provider-collision-auto-link.md) (Accepted 2026-07-20) — one account per email, resolved by Firebase's native auto-link rather than a manual linking UX: a Google sign-in matching an existing verified password account links alongside it; matching an unverified password account unlinks the password credential and verifies the account via Google. The reverse collision (Google-first user later tries to register with a password) is handled at error time (`auth/email-already-in-use`), since enumeration protection (`enableImprovedEmailPrivacy: true`) rules out pre-detection. Backend token validation is entirely unaffected by which provider issued the token — `verify_firebase_token` (§1.2) doesn't distinguish providers.
>
> **Terraform-vs-console drift (deliberate but previously undocumented).** The Google provider is **console-enabled, not Terraform-managed**: `terraform/modules/app/identity_platform.tf`'s `google_identity_platform_config.default` still declares only `sign_in.email { enabled = true }` (+ phone explicitly `enabled = false`, to prevent a perpetual plan diff) — no `sign_in.google` block exists. `terraform apply` neither knows about nor would revert the console-enabled Google provider (Identity Platform config outside the fields a resource declares is left alone), so this isn't a live drift risk, but it means the Terraform module map (Section 3.9) and the actual enabled-providers list diverge, and a future `terraform import`/refresh of this resource would not surface Google. This is exactly the class of gap the CLAUDE.md Documentation Drift rule targets — recorded here since the auth epic's own PRs never ran that sweep against this document.
>
> **As-built addition — BL-88 (server-side recent-auth check), shipped 2026-07-24.** `DELETE /api/account` (BL-87) previously trusted any valid Firebase ID token, however old — the password/Google reauth `DeleteAccountModal` performs before calling it was client-side UX only, not a server-enforced control. The route now also declares `Depends(require_recent_auth)` (§1.2 above, `app/auth.py:137-174`): the caller's decoded token must carry an `auth_time` claim within `RECENT_AUTH_WINDOW_SECONDS` (5 minutes) of the request, or the route rejects with `401 {"detail": {"code": "recent-auth-required"}}` **before** `account_service.delete_account(db)` runs — a stolen-but-valid, older-than-5-minutes ID token can no longer hit the purge endpoint directly and skip the password/Google gate. A **missing** `auth_time` claim is treated as stale, never as an implicit pass. The frontend's existing `DeleteAccountModal` reauth flow (password `reauthenticateWithCredential` or, since BL-118, `reauthenticateWithPopup` for Google-only users) already refreshes `auth_time` as a side effect, so it satisfies the new server check with no UX change. Deliberately **not** also gated on `require_verified_email` — recency and email verification are separate concerns, and an unverified user must still be able to delete their own account. *Merged to `main` 2026-07-24 (PR #432, ruff-format follow-up #434); deployed to dev via the standard merge pipeline. The last prod promote run predates this merge — not yet live in prod as of this revision.*

```
Request ──► Depends(get_db)                         [app/database.py:22]
              │
              ├──► Depends(get_current_identity)    [app/auth.py:39]  (resolved first, transitively)
              │       └──► verify_firebase_token(Authorization header)
              │               └──► firebase_admin.auth.verify_id_token(...)
              │       returns (firebase_uid, email)
              │
              ├──► set_config('app.current_firebase_uid', firebase_uid, false)
              ├──► look up / auto-provision users → tenants  (RLS: user_self_access)
              ├──► set_config('app.current_tenant_id', tenant_id, false)
              ├──► request.state.tenant_id = tenant_id   (consumed by logging middleware)
              └──► yield db   (swu_app session; RLS: tenant_isolation enforces inventory scoping)
```

### 1.2 Where the token is verified — `app/auth.py`

- `_get_firebase_app()` (`app/auth.py:10-18`) — lazily initializes the Firebase Admin SDK via `credentials.ApplicationDefault()`. On Cloud Run this resolves to the `backend-runtime` service account's identity automatically — no Secret Manager entry needed for this step.
- `verify_firebase_token(authorization)` (`app/auth.py:21-44`) — requires `Authorization: Bearer <token>`; calls `auth.verify_id_token(token, app=...)`, which validates signature (against Google's rotating public keys), expiry, issuer, and audience. Raises `HTTPException(401)` on any failure (missing header, wrong scheme, invalid/expired token). Returns `(firebase_uid, email, email_verified)` — the third element (BL-16) is the decoded token's `email_verified` claim, defaulted to `False` if the claim is absent, never treated as an implicit pass.
- `get_current_identity(authorization: Optional[str] = Header(default=None))` (`app/auth.py:47-56`) — the FastAPI dependency itself. Tests override this via `app.dependency_overrides`, so the real Firebase Admin app is never initialized outside a deployment.
- `require_verified_email(identity: tuple[str, str, bool] = Depends(get_current_identity))` (`app/auth.py:83-110`, BL-16, scope widened by BL-54 S1) — a second dependency that composes off `get_current_identity` rather than re-decoding the token, so a route declaring it alongside `Depends(get_db)` still only verifies the token once per request. Raises `HTTPException(403, detail="email_not_verified")` when the third (`email_verified`) element is falsy. Applied to the inventory-mutation routes and, since BL-54, `GET /api/inventory/export` — see the BL-16/BL-54 as-built notes above for the full scope boundary.
- `require_recent_auth(authorization: Optional[str] = Header(default=None))` (`app/auth.py:137-174`, BL-88) — gates a destructive route on the caller having reauthenticated within the last `RECENT_AUTH_WINDOW_SECONDS` (5 minutes, `app/auth.py:13`). Independently re-decodes the token via the shared `_decode_token` helper rather than depending on `get_current_identity`, because it needs the raw `auth_time` claim, which that dependency's `(uid, email, email_verified)` tuple doesn't carry — a route also declaring `Depends(get_db)` (→ `get_current_identity`) pays for a second local JWT decode of the same token, not a network round trip. A missing `auth_time` claim is treated as stale, never as an implicit pass — the same default-safe posture `verify_firebase_token` applies to a missing `email_verified` claim. Rejects with `HTTPException(401, detail={"code": "recent-auth-required"})` — a machine-readable dict distinct from `verify_firebase_token`'s plain-string details, so the frontend can tell "please reauthenticate" apart from a genuine auth failure. As of this writing, applied only to `DELETE /api/account` — see the BL-88 as-built note below for the full contract.

### 1.3 The `Depends` chain — how every route gets auth "for free"

This is the mechanism that an external review (ChatGPT, 2026-06-14) misread as missing. `app/database.py:22-25`:

```python
def get_db(
    request: Request,
    identity: tuple[str, str, bool] = Depends(get_current_identity),
):
```

`identity`'s default value is itself `Depends(get_current_identity)`. FastAPI's dependency resolution is **transitive**: when a router declares `Depends(get_db)`, FastAPI inspects `get_db`'s own signature, finds the nested `Depends(get_current_identity)`, and resolves it *first* — before `get_db`'s body runs at all. The router function never mentions `get_current_identity`; it doesn't need to.

Confirmed by grep, refreshed 2026-07-24 (`cards.py` retired BL-102; the original evidence snapshot cited it) — across the current `app/routers/`: **10** occurrences of `Depends(get_db)`, concentrated in `account.py` (2), `deck_check.py` (1), `inventory.py` (5), `settings.py` (2); 0 separate auth dependency declared anywhere at the router level. `base_cards.py`/`catalog.py`/`sets.py`/`feedback.py`/`images.py` deliberately run on the tenant-less/optional-auth dependencies (`get_catalog_db`/`get_optional_db`, Section 1.1) instead — the mechanism below is unchanged, only which routers exercise it.

**For a future reviewer:** if you're checking "is auth actually enforced on route X," the check is "does X declare `Depends(get_db)`?" — not "does X (or its router) mention auth/identity anywhere." The auth check is a side effect of acquiring a database session, by design (Section 1.6 explains why a *second*, RLS-scoped session is the right place for it). If you're checking "is route X also gated on a verified email (BL-16)," the check is "does X declare `dependencies=[Depends(require_verified_email)]`?" — as of this writing, `POST /api/inventory/{id}/increment`, `.../decrement`, and (BL-54 S1) `GET /api/inventory/export`.

### 1.4 `get_db` step by step — `app/database.py:22-89`

1. FastAPI resolves `identity = get_current_identity(...)` → `(firebase_uid, email, email_verified)`. If this raises `401`, `get_db`'s body never runs. (`get_db` itself never inspects `email_verified` — a route that needs the stronger check adds `Depends(require_verified_email)` alongside it, per the BL-16 as-built note above.)
2. Opens a session on `AppSessionLocal` (bound to `APP_DATABASE_URL`, the `swu_app` role — see 1.6).
3. `SELECT set_config('app.current_firebase_uid', :uid, false)` — session-scoped (third argument `false`; see Design Rationale 1.7.1).
4. `SELECT tenant_id FROM users WHERE firebase_uid = :uid` — the `users.user_self_access` RLS policy (migration 0021) means this query can only ever see the caller's own row, or zero rows.
5. **If no row** (first-ever request from this `firebase_uid`) — auto-provisioning:
   - `INSERT INTO tenants (name) VALUES (:email's Tenant) RETURNING id` → `new_tenant_id`
   - `INSERT INTO users (firebase_uid, tenant_id, email) VALUES (...) ON CONFLICT (firebase_uid) DO NOTHING RETURNING tenant_id`
   - If that insert returned a row, use its `tenant_id`. If not (lost a race with a concurrent first request for the same `firebase_uid`), `new_tenant_id` is now an orphaned `tenants` row, and the code re-selects the winning request's `tenant_id` from `users`.
   - `db.commit()`.
6. **If a row exists** — `tenant_id = row.tenant_id`.
7. `SELECT set_config('app.current_tenant_id', :tenant_id, false)` — session-scoped (Design Rationale 1.7.1).
8. `request.state.tenant_id = tenant_id` — read by the P6 logging middleware (`app/middleware.py`, Section 4.1) so every structured log line for this request carries the tenant.
9. `yield db` — the router's body runs here with a `swu_app` session that already has both session variables set. `finally: db.close()`.

### 1.5 Row-Level Security policies

| Migration | What it does |
|---|---|
| `0017_add_tenants_and_inventory_tenant_id` | Creates `tenants` (seeds "Default Tenant" as id 1). Adds `inventory.tenant_id` via relax → backfill (`UPDATE inventory SET tenant_id = 1`) → constrain (`NOT NULL DEFAULT 1`). Replaces `uq_inventory_card_id` with `uq_inventory_tenant_id_card_id (tenant_id, card_id)` — a future tenant can hold its own row for a card another tenant already tracks. |
| `0018_inventory_row_level_security` | `ALTER TABLE inventory ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`. Policy `tenant_isolation`: `USING (tenant_id = COALESCE(current_setting('app.current_tenant_id', true)::integer, 1))`. The `COALESCE … 1` fallback exists so the table doesn't return zero rows for any session that hasn't called `set_config` — at the time this migration landed, nothing did yet (Stage 3 was still ahead). |
| `0019_create_app_role` | Creates `swu_app` (`LOGIN`, `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, password from `APP_DB_PASSWORD` env var). Grants: `USAGE` on schema `public`; `SELECT` on all current tables + sequences; `INSERT, UPDATE, DELETE` on `inventory` only; default privileges so `swu_app` automatically gets `SELECT` on tables/sequences `swu_user` creates in *future* migrations. |
| `0020_add_users_table` | Creates `users` (`id`, `firebase_uid` unique, `tenant_id` FK → `tenants`, `email`, `created_at`). No RLS yet — table is unused until 0021. |
| `0021_users_rls_and_provisioning_grants` | `ALTER TABLE users ENABLE/FORCE ROW LEVEL SECURITY`. Policy `user_self_access`: `USING (firebase_uid = current_setting('app.current_firebase_uid', true))` — keyed on `firebase_uid`, not `tenant_id`, because `tenant_id` is *what this table is used to look up* (not yet known when the lookup runs). No `WITH CHECK` clause — the `USING` expression gates `INSERT` too. Grants `INSERT` on `users` to `swu_app`. **Revokes** `swu_app`'s blanket `SELECT` on `tenants` (from 0019) — once `tenants.name` holds human-readable, email-derived values, blanket `SELECT` would let any session read every other tenant's name. Grants `INSERT` on `tenants` plus `SELECT (id)` only — column-level, because Postgres checks column-level `SELECT` privilege even for `RETURNING id` on a row the same statement just inserted. |
| `0024_grant_account_deletion_to_swu_app` | BL-87 (permanent account deletion). Grants `DELETE` on `users` and on `tenants` to `swu_app` — both were previously write-only for `INSERT` (provisioning), so `DELETE /api/account`'s purge would otherwise fail with "permission denied" the moment it tried to delete either table. `users`' existing `user_self_access` policy (0021, no `FOR` clause) already covers `DELETE` — no new policy needed there. `tenants` deliberately gets **no** RLS policy: a `FOR DELETE`-only policy was considered and rejected, because PostgreSQL RLS is per-command — enabling RLS on `tenants` with only a `DELETE` policy would leave `SELECT`/`INSERT` with zero applicable policies, defaulting to deny-all and silently breaking the auto-provisioning `INSERT ... RETURNING id` from 0021. `tenants` relies solely on the application filtering `DELETE FROM tenants WHERE id = :tenant_id`, where `:tenant_id` is always read server-side from `app.current_tenant_id` (set by `get_db` from the verified Firebase token), never client-supplied. |

Net effect: `swu_app` can read the full `inventory`/`users`/`tenants`/catalog tables it's granted, and — as of 0024 — can also delete rows it owns from all three. RLS transparently filters `inventory` and `users` to the caller's own rows for every command including `DELETE`; `tenants` carries no RLS at all, so its `DELETE` (BL-87's account-purge endpoint) is scoped purely by the application's explicit `tenant_id` filter, sourced only from the verified token. `tenants` remains otherwise write-only-plus-id for `swu_app` (still no way to read another tenant's name).

### 1.6 The two-engine pattern

`app/database.py` defines two completely separate SQLAlchemy engines:

| | `engine` / `SessionLocal` | `app_engine` / `AppSessionLocal` |
|---|---|---|
| Env var | `DATABASE_URL` | `APP_DATABASE_URL` |
| Postgres role | `swu_user` (bootstrap superuser-derived; `BYPASSRLS`) | `swu_app` (least-privilege; `NOBYPASSRLS`) |
| Used by | Alembic (`alembic upgrade head`), ingestion scripts (`bootstrap_catalog` only — `apply_seed` was retired, see `SWU_Application_Spec.md` §13/ADR-0004; `apply_inventory_snapshot` was retired 2026-07-25, BL-93, replaced by §17 import/export) | `get_db()` — every request-serving connection |
| RLS applies? | No (bypassed) | Yes |

The migration-running role needs unrestricted write access to set up the schema and grants in the first place; the request-serving role is the one RLS policies actually constrain. Section 1.7.2 explains why this split exists at all.

### 1.7 Design Rationale

#### 1.7.1 Session-scoped `set_config` (third argument `false`), not `SET LOCAL`

**Selected:** `set_config('app.current_tenant_id', tenant_id, false)` — session-scoped, persists until the connection is returned to the pool.

P4 Stage 3's original framing assumed one transaction per request, with `SET LOCAL` (equivalent to `set_config(..., true)`, transaction-scoped) resetting the variable automatically at the end of each request. But `upsert_increment`/`upsert_decrement` call `db.commit()` then `db.refresh(inv)` — **two transactions per request**. `SET LOCAL` reverts at the first `COMMIT`, so the `refresh()` transaction would see `app.current_tenant_id` unset and silently fall back to tenant #1 via migration 0018's `COALESCE` bridge — the wrong tenant's data, with no error.

Session-scoped `set_config` is set once per `get_db()` call (step 7 above) and remains in effect for every transaction of the request, because each request's SQLAlchemy Session is **bound to one dedicated pooled `Connection` for the request's whole life** (`_open_authenticated_session` / `_open_catalog_session` return the pair; the dependency closes both).

**Corrected 2026-07-13.** This paragraph originally claimed the dependency `yield` alone kept one connection checked out per request — false: an engine-bound Session releases its connection to the pool at every `commit()` and lazily checks out another (possibly different) one for the next statement. Under concurrent traffic the pool interleaves, and a mid-request commit (e.g. `PUT /api/settings/limits`' `replace_overrides`) could be followed by a connection last used by a tenant-less catalog session — GUC `''` — producing a live 500 in dev (`invalid input syntax for type integer: ""`); serial traffic had passed for weeks by pool luck. The explicit connection binding above is the fix; regression coverage in `test_session_connection_pinning.py` deterministically reproduces the interleave. (Migration 0023's NULLIF policies meant the failure was a loud cast error rather than silent tenant-#1 fallback — the 0018-era `COALESCE` bridge would have made this a silent cross-tenant read.)

#### 1.7.2 `swu_app` role split from `swu_user`

**Selected:** a new, separate least-privilege role (`swu_app`, migration 0019) that RLS policies actually apply to; `swu_user` remains the migration-running admin.

P4 Stage 2 discovered that `swu_user` (`POSTGRES_USER` / Cloud SQL's bootstrap role) has `BYPASSRLS`, and `ALTER ROLE swu_user NOSUPERUSER`-equivalent attribute removal is refused outright for the bootstrap role — `FORCE ROW LEVEL SECURITY` alone is not sufficient, because table *owners* bypass RLS by default regardless of `FORCE`. There is no way to make `swu_user` RLS-constrained. `swu_app` is the only role the `tenant_isolation` and `user_self_access` policies are ever evaluated against.

This required adding `APP_DB_PASSWORD` as a Cloud Run env var (Section 3.7) so migration 0019's `CREATE ROLE swu_app WITH LOGIN PASSWORD '...'` has a password to use. **As of BL-8/RR-10 (§5.4 #2, PR #433, dev-live 2026-07-25)** this migration runs once per deploy in the discrete `migrate` Cloud Run Job, not on every container start.

#### 1.7.3 Tenant auto-provisioning — "one user, one tenant" (for now)

**Selected:** the first time a `firebase_uid` is seen, create a brand-new `tenants` row *and* a `users` row pointing at it, in the same request. Every user is the sole member of their own tenant.

This is the smallest model that satisfies P5's milestone literally — "two people, two inventories." The alternative (inviting a user to join an *existing* tenant — a household/team scenario) is a real possible future feature, but `users.tenant_id` is just a foreign key: "invite a teammate" becomes a change to provisioning *logic* (point a new user row at an existing tenant instead of creating one), not a schema migration. The current schema doesn't foreclose it.

#### 1.7.4 Auth provider selection — Firebase Authentication vs. Auth0 / Clerk / Supabase Auth

**Selected: Firebase Authentication** (the free tier of GCP Identity Platform), enabled via `google_identity_platform_config` (Section 3.9). **Originally Email/Password sign-in only; Google sign-in (BL-118) and password reset (BL-116) shipped 2026-07-20** — see the as-built addition in Section 1.1. This subsection's comparison table and rationale describe the *original* provider-selection decision (Firebase Auth vs. Auth0/Clerk/Supabase Auth as a platform, not a specific-provider choice) and remain accurate as a decision record; they were never a claim that only one sign-in method would ever be enabled within Firebase Auth.

| | **Firebase Auth (selected)** | Auth0 | Clerk | Supabase Auth |
|---|---|---|---|---|
| Cost at hobby scale | Free, no practical cap for email/password | Free to ~7,500 MAU, then per-MAU | Free to ~10,000 MAU, then per-MAU | Generous free tier, scoped to a Supabase project |
| GCP-native integration | Same Firebase project already used for Hosting (P2); Cloud Run verifies tokens via ADC, no new secret | None — separate vendor/dashboard/credentials | None | None — second database-adjacent vendor alongside Cloud SQL |
| Frontend DX (React) | Solid official SDK; build-your-own forms | Excellent docs, hosted login page | Best-in-class prebuilt `<SignIn>`/`<SignUp>` | Solid SDK, less-polished prebuilt UI |
| Portability off GCP | Lower — coupled to Firebase/GCP | High | High | Medium — coupled to Supabase |

**What tipped it:** zero new vendor/dashboard, reuse of the existing Firebase project, consistency with the GCP-first reasoning from P1. **Revisit if:** enterprise SSO (SAML/OIDC) is ever needed (Identity Platform's paid tier covers it without switching providers), or portability off GCP becomes a priority (Auth0/Clerk's "works anywhere" trait, with Clerk's prebuilt components cutting frontend rework).

---

## 2. CI/CD Pipeline

### 2.1 Overview

*(Rewritten as-built 2026-07-08 after the RR-6 CI hygiene series — the previous version of this section described the pre-BL-43 five-job pipeline. Corrected 2026-07-24 (BL-150 W1) — the diagram below still showed the pre-BL-131 gated `promote-prod` job and omitted `detect-changes` entirely; see §2.6 for the promotion mechanism the diagram now matches. Phase history: `SWU_Platform_Roadmap.md`; build-once/promote rationale: ADR-0007.)*

`.github/workflows/ci.yml` defines eight jobs in a build-once / promote model:

```
backend ──┐
frontend ─┴─► detect-changes ─► build-and-push ──┬─► check-risk-level ─► promote-prod-fast (risk:low)
             (main push,         (main only,      └─► deploy-dev
              skipped if          skipped if
              docs-only)          docs-only)

terraform-fmt — independent of the chain above; gates branch protection alongside backend/frontend (2.1 below), no downstream jobs depend on it
```

Prod promotion beyond the `risk:low` fast path is **not** a ci.yml job — it's the separate `promote-prod.yml` `workflow_dispatch` (§2.6, BL-131).

- **Triggers (RR-6/F27):** `push` is restricted to `main`; PRs run once via `pull_request`. A branch push without an open PR gets no CI.
- **Concurrency (RR-6/F28, supersedes BL-79's mechanism):** one group per ref; `cancel-in-progress` only for non-main refs. PR runs cancel superseded predecessors; **main runs queue and are never cancelled** — a cancel could kill `terraform apply` mid-change. GitHub holds at most one queued main run (older queued entries are cancelled, running ones never), so deploy chains serialize and at most one prod gate pends at a time. Verified live 2026-07-08 with a deliberate stacked-merge test (evidence on issue #131).
- `backend` / `frontend` / `terraform-fmt` gate branch protection on `main` (P3 Stage 4).
- **`detect-changes` (BL-78, PR #201).** Runs on every main push, needs `[backend, frontend]`. Diffs `HEAD^..HEAD`; if every changed file is under `specification_documents/`, `docs/`, `learning_guide/`, `claude_design/`, or is a root `*.md`/`LICENSE`, it sets `docs_only=true`. `build-and-push` (and everything that transitively needs it — `check-risk-level`, `deploy-dev`, `promote-prod-fast`) adds `needs.detect-changes.outputs.docs_only != 'true'` to its `if`, so a docs-only push to main skips the image build and both deploys entirely — the tests and `terraform-fmt` still run.
- **Docs-only trigger gate (BL-167, 2026-07-26).** Both triggers (`push` to main and `pull_request`) carry a `paths-ignore` list mirroring detect-changes' classification exactly — a docs-only push or PR now triggers **no workflow run at all** (zero billed minutes on the private repo), superseding the "tests still run" behavior above for the docs-only case. Mixed pushes still run the full pipeline. detect-changes is deliberately retained as belt-and-braces for deploy-skipping; the two lists must be kept in sync (cross-referencing comments sit on both).

### 2.2 `backend` job

- Spins up a `postgres` service container. Env vars: `DATABASE_URL`, `APP_DATABASE_URL`, `APP_DB_PASSWORD` (the CSV-era `CATALOG_SEED_PATH`/`INVENTORY_SNAPSHOT_PATH` vars and snapshot step were removed as dead config in RR-6/F5 — tests seed their own fixtures via conftest).
- Steps: checkout → `setup-python` (3.12, with `cache: pip` on `backend/requirements.txt`, RR-6/F29) → install deps → `ruff check` + `ruff format --check` → `alembic upgrade head` → `pytest --cov=app --cov-report=term-missing --cov-fail-under=75`.

### 2.3 `frontend` job

- `setup-node` (Node **22** — the 20 line went EOL 2026-04 and was bumped in RR-6 6/6, converging with the dev machine per BL-42/RR-5; npm cache on `frontend/package-lock.json`) → `npm ci` → eslint → prettier check → `npm run build` (tsc + vite) → `npx vitest run --coverage`.
- Coverage thresholds, `frontend/vite.config.ts:46-47` (corrected 2026-07-24 — previously documented as 75/75): `lines: 75`, **`statements: 74`**.

### 2.4 `build-and-push` job

- `needs: [backend, frontend]`; main pushes only.
- WIF auth as `terraform-ci@swu-prod.iam.gserviceaccount.com` (Section 3.3) + `gcloud auth configure-docker`.
- One multi-tag `docker/build-push-action` build (buildx, `cache-from/to: type=gha` — RR-6/F29) pushes the same image as `:${{ github.sha }}` to **both** Artifact Registries (`swu-prod` and `swu-dev-jbapps`). The cache is only ever written from main-scope runs (this job never runs on `pull_request`), so PR branches cannot poison it.

### 2.5 `check-risk-level` and `deploy-dev` jobs

- `check-risk-level` (BL-43 Stage 3; BL-96 guard added 2026-07-25): reads the merged PR's labels; `risk:low` selects the ungated fast promote path — but only after the **whole-build guard** also passes. The guard closes the BL-96 semantics gap (one PR's label used to decide a promotion whose unit of effect is the *entire* dev build): it walks `git rev-list prod-current..HEAD` (see §2.6 for the `prod-current` tag) and requires every unpromoted commit's PR to carry `risk:low`; any commit without that label — including commits with no PR at all, or a missing tag — **fails closed** and blocks the fast path with a run-log notice naming the blocking commits. The manual dispatch path is unaffected and remains the documented fallback. *What qualifies a PR for `risk:low` — the full risk taxonomy (L0–L3), classification criteria, and operating rules — is ADR-0017 (BL-98; Proposed, pending owner ratification).*
- `deploy-dev`: terraform validate + `apply` in `terraform/environments/dev` with the new image tag; reads `backend_url` + Firebase config from terraform outputs; builds and deploys the frontend to `swu-dev-jbapps` Hosting; then the **RR-1 post-deploy smoke check** — `curl --fail --retry` against `/health` and `GET /api/sets` (anonymous), failing the job on any non-200 or an empty sets array. A failed dev smoke blocks both promote paths via `needs:`.

### 2.6 Prod promotion: `promote-prod.yml` dispatch + `promote-prod-fast`

**Reworked 2026-07-15 (BL-131).** Through 2026-07-14 the human gate was a `promote-prod` job at the end of the main pipeline, held by the GitHub "production" environment's required-reviewers rule. The repo going private (2026-07-14) silently removed that rule — environment protection is Enterprise-only on private repos (verified empirically: the API re-add returns 422 on Pro). Promotion was reworked rather than paying Enterprise for one rule:

- **Human-gated path (default):** the main pipeline **ends at `deploy-dev`**. Promotion to prod is an explicit act — the `promote-prod.yml` workflow (`workflow_dispatch`, input: a commit SHA on main), run by Jeremy in the Actions UI or by Claude via `gh workflow run promote-prod.yml -f sha=<sha>` under the standing "promote it" rule. The workflow resolves the input to a full SHA, **rejects anything not on `main`**, checks out the promoted commit (terraform config + frontend + composite action all read from the promoted state, not main's tip), and reuses the composite action below. Build-once (ADR-0007) is preserved: the SHA's image already sits in prod AR from its main run; a never-built SHA (docs-only push) fails harmlessly at `terraform apply`. A dispatch always promotes a *stated* SHA, which structurally replaces the old stale-gate/newest-run-gate discipline. Dispatches serialize in their own `prod-promote` concurrency group; the job keeps `environment: production` purely for GitHub deployment history (the environment carries no protection anymore).
- **`risk:low` fast path (BL-43 Stage 3; BL-96 whole-build guard, 2026-07-25):** `promote-prod-fast` (`needs: [deploy-dev, check-risk-level]`) promotes in-pipeline with no human involvement, but now requires **both** `check-risk-level` outputs: the merged PR's own `risk:low` label *and* `build_clean` from the whole-build guard (§2.5) — a `risk:low` merge can no longer ship someone else's unpromoted gated work as a side effect (the 2026-07-10 near-miss).
- **`prod-current` tag (BL-96):** the promote composite action's final step force-moves the lightweight tag `prod-current` to the promoted SHA on every successful promote, from **both** callers — the guard's credential-free source of truth for "what is prod running". It moves only after the smoke test passes (a failed promote never advances it), and a dispatch of an older SHA legitimately moves it backwards, making newer commits count as unpromoted again. Both promote jobs carry `contents: write` for this push. Bootstrapped 2026-07-25 at `2b1e964` (verified against the live prod revision).
- Both callers share **one step definition**: the composite action `.github/actions/promote-prod/action.yml` (RR-6/F26). The action: WIF auth → terraform validate/apply prod → read outputs → frontend build (`VITE_FIREBASE_*` from terraform outputs) → Firebase Hosting deploy to `swu-prod` → RR-1 smoke check against the prod backend → `prod-current` tag update (BL-96).
- Deploy verification is the smoke check (RR-1): every deploy — dev or prod, dispatched or fast — must prove the app answers before its job goes green.

### 2.7 Design Rationale

#### 2.7.1 Workload Identity Federation (OIDC), not service account keys

**Selected (P1):** GitHub Actions authenticates to GCP via WIF — short-lived OIDC tokens, no long-lived JSON key files anywhere (not in git, not in GitHub secrets).

`terraform/environments/prod/wif.tf` creates pool `github-actions` / provider `github`, with `attribute_condition = "assertion.repository == 'whitebreadisu/SWU-Inventory-Manager'"` — belt-and-suspenders with the `principalSet://...attribute.repository/whitebreadisu/SWU-Inventory-Manager` binding on `terraform-ci` itself (Section 3.4). Only `terraform-ci` is WIF-bound; `backend-runtime` is only ever assumed by Cloud Run at runtime via Application Default Credentials, never by CI.

#### 2.7.2 CI coverage gate at 75%, not ratcheted toward 100%

**Selected (P7 Stage 3):** `--cov-fail-under=75` (backend) and `thresholds.lines: 75` / `thresholds.statements: 74` (frontend, `vite.config.ts:46-47`) — chosen as deliberate headroom *below* the actual coverage at the time (~79% backend, ~84.06% frontend).

The gate's purpose is to catch a *regression* (someone adds a large untested module and coverage drops materially), not to chase 100% line coverage as a goal in itself. Setting the threshold close to current coverage would make routine, well-tested small changes fail CI on minor fluctuations.

---

## 3. Terraform Module Map

### 3.1 Environments

| | `swu-prod` | `swu-sandbox` |
|---|---|---|
| Purpose | Persistent, minimal production environment | Ephemeral, non-gating exploration (VPCs, load balancers, etc.) |
| State bucket | `swu-prod-tfstate` | `swu-sandbox-tfstate` |
| Resources | Full stack (below) | P1-bootstrap only: baseline APIs, `terraform-ci` SA + a 7-role subset of prod's IAM list, WIF pool/provider/binding. No Cloud Run/SQL/Secrets/Firebase/Monitoring. |

All resource details below are `swu-prod` unless noted.

### 3.2 State backend

GCS backend, bucket `swu-prod-tfstate`, prefix `terraform/state`. The bucket itself was created by hand in P1, outside Terraform — `iam.tf` grants `terraform-ci` `roles/storage.admin` on it directly (bucket-scoped, not part of the project-level role list) because `terraform apply` itself needs `getIamPolicy`/`setIamPolicy` on the bucket holding its own state.

### 3.3 Workload Identity Federation

`wif.tf`:
- `google_iam_workload_identity_pool.github` — pool id `github-actions`.
- `google_iam_workload_identity_pool_provider.github` — provider id `github`, OIDC issuer `https://token.actions.githubusercontent.com`, attribute mapping `google.subject = assertion.sub`, `attribute.repository = assertion.repository`, `attribute_condition = "assertion.repository == 'whitebreadisu/SWU-Inventory-Manager'"`.
- `google_service_account_iam_member.terraform_ci_wif` — grants `roles/iam.workloadIdentityUser` on `terraform-ci` to `principalSet://iam.googleapis.com/projects/<project_number>/locations/global/workloadIdentityPools/github-actions/attribute.repository/whitebreadisu/SWU-Inventory-Manager`.

### 3.4 IAM

**Three service accounts, all created by Terraform** (corrected 2026-07-24, BL-150 W1 — this table previously said "two," missing the pricing infrastructure's invoker identity, §3.4a below):

**`terraform-ci`** (`iam.tf`) — CI's identity, WIF-bound (3.3). Project-level roles (`local.terraform_ci_roles`), each added incrementally with a "which phase needed this" comment:

| Role | Added for |
|---|---|
| `roles/serviceusage.serviceUsageAdmin` | enable new APIs for P2 |
| `roles/run.admin` | deploy/manage Cloud Run (P2) |
| `roles/cloudsql.admin` | provision/manage Cloud SQL (P2) |
| `roles/artifactregistry.admin` | manage the image repo (P2) |
| `roles/iam.serviceAccountAdmin` | create/manage `backend-runtime` (P2) |
| `roles/iam.serviceAccountUser` | attach `backend-runtime` to Cloud Run (P2) |
| `roles/resourcemanager.projectIamAdmin` | grant IAM bindings other resources need (e.g. `backend-runtime` → Cloud SQL Client) |
| `roles/secretmanager.admin` | grant `backend-runtime` access to secrets (P2 stage 3) |
| `roles/iam.workloadIdentityPoolViewer` | P3 stage 3 — `terraform apply` refreshes *all* state, including CI's own WIF pool |
| `roles/firebase.admin` | P5 stage 4 — manage `google_firebase_web_app` (supersedes an earlier `firebase.viewer`) |
| `roles/firebasehosting.admin` | P3 stage 4 — `frontend-deploy`'s `firebase deploy --only hosting` |
| `roles/firebaseauth.admin` | P5 stage 1 — manage Identity Platform config |
| `roles/monitoring.dashboardEditor` | P6 stage 2 — dashboards only (narrower than `monitoring.editor`) |
| `roles/monitoring.alertPolicyEditor`, `roles/monitoring.notificationChannelEditor` | P6 stage 3 — alert policy + notification channel only |
| `roles/monitoring.uptimeCheckConfigEditor` | RR-9 (2026-07-09) — create/update uptime checks; granted manually to avoid the apply racing IAM propagation, codified here |
| `roles/dns.admin` | BL-127 (run 29779065525, 2026-07-20) — manage the `hyperspacevault.com` Cloud DNS zone (§3.10). Prod-only: dev has no DNS zone |
| `roles/cloudscheduler.admin` | BL-139 (run 29796247156, 2026-07-21) — create/manage the daily price-sync Cloud Scheduler job (§3.4a) |

Plus `roles/storage.admin` on `swu-prod-tfstate` directly (3.2).

**`backend-runtime`** (`cloud_run.tf`) — Cloud Run's runtime identity, *not* WIF-bound (only ever assumed via ADC on Cloud Run):
- `roles/cloudsql.client` (project-level) — Cloud SQL Auth Proxy connectivity.
- `roles/secretmanager.secretAccessor` on each of `database-url`, `app-db-password`, `app-database-url` (per-secret `google_secret_manager_secret_iam_member`, Section 3.7) — not project-wide.

### 3.4a Pricing infrastructure (BL-136/BL-139)

`terraform/modules/app/pricing_jobs.tf` provisions the daily TCGplayer price sync as scheduled Cloud Run Jobs, applied in both dev and prod:

- **`google_cloud_run_v2_job.price_sync`** — `python -m app.jobs.price_sync`, runs `backend-runtime`'s image and identity, 600s timeout, no default args (watermark-gated and idempotent against tcgcsv.com's own `last-updated.txt`).
- **`google_cloud_run_v2_job.price_backfill`** — `python -m app.jobs.price_backfill`, same image/identity, 21600s (6h) timeout, 4 vCPU/4Gi memory (py7zr archive decompression is memory-hungry — 512Mi/2Gi both OOM-killed during live dev runs). Deliberately **not** wired to Cloud Scheduler — a one-time, manually-invoked, throttled history backfill, never an unattended recurring job.
- **`google_cloud_scheduler_job.price_sync_daily`** — triggers `price_sync` daily at 20:30 UTC via the Cloud Run Admin API's `:run` action.
- **`google_service_account.pricing_scheduler_invoker`** (`pricing-scheduler-invoker`) — the **third** service account (§3.4), dedicated to Cloud Scheduler's OIDC call into Cloud Run. Kept separate from `backend-runtime` so the invoke grant (`roles/run.invoker` on the `price_sync` job only) doesn't ride an identity that also holds `cloudsql.client` + secret access. Cloud Scheduler's own service agent additionally needs `roles/iam.serviceAccountTokenCreator` on this SA to mint tokens as it — a gotcha that surfaces as a permission-denied on token creation, not on the invoke itself, if missed.

### 3.5 Cloud Run

`google_cloud_run_v2_service.backend` (`cloud_run.tf`):

| Setting | Value |
|---|---|
| Name / region | `backend` / `us-central1` |
| Ingress | `INGRESS_TRAFFIC_ALL` (public) |
| Service account | `backend-runtime` |
| Image | `us-central1-docker.pkg.dev/swu-prod/backend/api:${var.backend_image_tag}` — `var.backend_image_tag` defaults to a hardcoded SHA (only matters for a local apply); CI's `deploy` job always overrides it with `-var="backend_image_tag=${{ github.sha }}"` |
| Container port | `8000` (matches the Dockerfile's `uvicorn --port 8000`) |
| Cloud SQL | `volumes` block mounts `google_sql_database_instance.main.connection_name` at `/cloudsql` (native Cloud Run Cloud SQL volume — the env-var DSNs use `?host=/cloudsql/<connection_name>`) |
| Resource limits | CPU/memory: none set — Cloud Run defaults apply. Instance count: capped, see below. |
| Max instances | `scaling { max_instance_count = var.max_instance_count }` — prod `3`, dev `1` (RR-2 / finding F14, see 4.6) |

**Env vars:**

| Name | Source |
|---|---|
| `DATABASE_URL` | `secret_key_ref` → `database-url`, version `latest` |
| `APP_DB_PASSWORD` | `secret_key_ref` → `app-db-password`, version `latest` |
| `APP_DATABASE_URL` | `secret_key_ref` → `app-database-url`, version `latest` |
| `ENVIRONMENT` | plain value `"production"` — drives `_api_docs_enabled()` (Section 5) |
| `COMMIT_SHA` | plain value `var.backend_image_tag` (BL-126) — already the deploying commit's `github.sha`, reused rather than adding new CI wiring; lets `POST /api/feedback` attach the deploying commit to a submission (server-side metadata only, `SWU_Application_Spec.md` §4.6). Unset in local/CI test runs. |
| `FEEDBACK_GITHUB_PAT` | `secret_key_ref` → `feedback-github-pat`, version `latest` (BL-126, §3.7) |
| `FEEDBACK_GITHUB_REPO` | plain value `var.feedback_github_repo` (BL-126) — defaults to `whitebreadisu/swu-feedback`; a `variables.tf` variable rather than hardcoded so a future environment could point elsewhere without a module change, though every environment is expected to share the one repo today |
| `CARD_IMAGES_BUCKET` | plain value `google_storage_bucket.card_images.name` (BL-76, `cloud_run.tf`) — added to this table 2026-07-24; full detail (bucket layout, renditions, serving) is §3.16, cross-referenced here so an env-var audit from this table alone doesn't under-count |

**Invoker:** `google_cloud_run_v2_service_iam_member.backend_public` grants `roles/run.invoker` to `allUsers`. The backend is reachable on the public internet with no IAM check; access control is enforced entirely in application code (Section 1, Section 5).

**As-built addition — BL-53 proxy-IP fix, shipped 2026-07-24.** Requests reach this service as Cloud Run's own front-end proxy → the app — `request.client.host` (Starlette's view of the TCP peer) resolves to that proxy, not the real end-user IP, unless something rewrites it from `X-Forwarded-For`. `app/main.py` now wires uvicorn's `ProxyHeadersMiddleware` (`trusted_hosts="*"`) as the outermost middleware to do exactly that — see §5.1's As-built note for the full rationale (including why `trusted_hosts="*"` is safe on this specific topology) and what it fixes (the BL-126 feedback rate limiter's per-IP key).

### 3.6 Cloud SQL

`google_sql_database_instance.main` (`database.tf`), name `swu-prod-pg`:

| Setting | Value |
|---|---|
| Engine | `POSTGRES_16` |
| Region | `us-central1` |
| Tier / edition | `db-f1-micro` / `ENTERPRISE` (dev). **Prod: `db-g1-small`** — see the D4 note below |
| Availability | `ZONAL` (single-zone, no HA failover) |
| Backups | enabled (default retention) + **point-in-time recovery** (RR-7/BL-21, 2026-07-08): `point_in_time_recovery_enabled = true`, `transaction_log_retention_days = 7` — continuous WAL archiving allows restoring to any minute within the last 7 days, not just last midnight |
| Networking | `ipv4_enabled = true`, **no `authorized_networks`** — public IP exists but nothing is allow-listed to reach it; Cloud Run connects via the Cloud SQL connector (IAM-authenticated, Unix socket), not over that path |
| Deletion protection | `true` |

`google_sql_database.inventory` — database `swu_inventory`. `google_sql_user.app` — user `swu_user`, password = `random_password.db_password`. (The RLS-scoped `swu_app` Postgres role is created out-of-band by Alembic migration 0019, not a Terraform resource — its password is the Terraform-managed `random_password.app_db_password`.)

**D4 — prod Cloud SQL tier (BL-150 owner decision, 2026-07-24 triage, `Definition_Steadying_2026-07-24.md` §2; merged 2026-07-25, PR #445).** A5-05 found prod's `db-f1-micro` memory pinned at a constant 100% utilization (including OS page cache) with only 25 `max_connections`. Decision: prod moves to **`db-g1-small`** (~3× memory, `max_connections` 25→50, ~+$18/mo) — set explicitly on prod's module call in `terraform/environments/prod/main.tf` rather than changing the module default, since dev deliberately stays on `db-f1-micro` (a real per-env difference, not a stale default). **State: merged to `main`/dev but NOT yet applied to the live prod instance** — the `sql_tier` change rides the owner-gated prod promote workflow, not an automatic dev deploy, and prod's Cloud SQL instance is still `db-f1-micro` as of this writing. Applying it is in-place (no instance recreation) but causes a brief instance restart. **Cross-reference:** the SQLAlchemy connection-pool caps merged the same night (admin engine 1+1, app engine 3+3 → worst case 8 connections/instance, 24 at prod's `max_instance_count = 3`) were sized to stay safe under `db-f1-micro`'s 25-connection ceiling *and* trivially safe once D4's `db-g1-small` move lands (50-connection ceiling) — see `backend/app/database.py` and BL-150 W0 (PR #425).

**Recovery objectives (RR-7).** Targets for user-data loss and downtime, set 2026-07-08: **RPO ≤ 1 hour** (PITR's WAL archiving makes the realistic recovery point minutes, but 1h is the commitment) and **RTO ≤ 4 hours** (manual restore: clone prod from a PITR timestamp via `gcloud sql instances clone --point-in-time`, verify row counts, repoint the app). These are honest solo-operator numbers — the constraint is operator availability, not tooling. **The restore drill that validates the procedure has not yet been performed** — it needs Jeremy present (prod data access) and is the open remainder of BL-21; the drill's measured commands and timing will land in the Operations Runbook (RR-8) when it happens.

### 3.7 Secret Manager

The first four secrets use `replication { auto {} }`, values from `random_password` (32 chars, no special characters) — never hand-set:

| Secret ID | Contents | `secretAccessor` |
|---|---|---|
| `db-password` | `swu_user` password (raw) | none directly — source for `database-url` |
| `database-url` | Full DSN: `postgresql://swu_user:<pw>@/swu_inventory?host=/cloudsql/<connection_name>` — used by `alembic upgrade head` | `backend-runtime` |
| `app-db-password` | `swu_app` password (raw) — read by migration 0019's `CREATE ROLE`, run once per deploy by the `migrate` Cloud Run Job (§5.4 #2, BL-8/RR-10) | `backend-runtime` |
| `app-database-url` | Full DSN: `postgresql://swu_app:<pw>@/swu_inventory?host=/cloudsql/<connection_name>` — used by `get_db()` | `backend-runtime` |
| `feedback-github-pat` | Fine-grained GitHub PAT (Issues read/write, scoped to the private `whitebreadisu/swu-feedback` repo only) — used by `app/services/github_notify.py`'s best-effort issue-per-submission notification (BL-126) | `backend-runtime` |

**`feedback-github-pat` breaks the pattern above — deliberately.** Unlike the four `random_password` secrets, its real value is **not Terraform-managed**: the owner creates the PAT by hand on GitHub (a manual prerequisite recorded on issue #289) and adds it as a secret version out-of-band via `gcloud secrets versions add`, so the token itself never enters Terraform state or a plan/apply diff. That leaves a bootstrapping gap — Cloud Run's env block (§3.5) reads this secret at `version = "latest"`, and (matching the existing DB secrets' own comment) a Cloud Run deploy fails outright if `versions/latest` doesn't resolve to *something*. `terraform/modules/app/secrets.tf` closes the gap with a `google_secret_manager_secret_version` resource holding the literal placeholder `PLACEHOLDER_ROTATE_ME`, `lifecycle { ignore_changes = [secret_data] }` so a later `terraform apply` never "fixes" a real token back to the placeholder. `app/services/github_notify.py` treats the placeholder value exactly like a missing token — the feedback submission still succeeds (DB write unaffected), the notification silently skips, never surfaced to the submitter as an error.

**Operational consequence — env-var secrets don't hot-reload.** Cloud Run resolves `secret_key_ref` values once, at container/instance start. Installing a new secret version (e.g. the owner adding the real `FEEDBACK_GITHUB_PAT` after the placeholder) has no effect on an already-running instance — it is picked up only the next time a fresh revision starts (a redeploy, or an explicit `gcloud run services update` that forces one). This applies to every secret in this table, not just `feedback-github-pat`; it was surfaced concretely by BL-126's rollout and is the reason §4.3's uptime-check finding below matters operationally, not just for cold starts.

### 3.8 Artifact Registry

`google_artifact_registry_repository.backend` — repo id `backend`, format `DOCKER`, location `us-central1`. Resulting path: `us-central1-docker.pkg.dev/swu-prod/backend/api:<tag>`.

### 3.9 Firebase & Identity Platform

- `google_firebase_project.default` (`firebase.tf`, `google-beta`) — enables Firebase on `swu-prod`. The Hosting *site* itself and its content are managed via the Firebase CLI (`frontend/firebase.json` + `firebase deploy`), not Terraform — same Terraform-for-infrastructure / CLI-for-content split as Artifact Registry (repo via Terraform) vs. image push (via `docker`).
- `google_firebase_web_app.default` — registers a Web App under `swu-prod`'s Firebase project (P5 stage 4 prerequisite — lets the deployed frontend use real Firebase Auth instead of the local emulator's `demo-swu` config).
- `data.google_firebase_web_app_config.default` — reads the Web App's `apiKey`/`authDomain`, exposed as Terraform outputs `firebase_web_app_api_key` / `firebase_web_app_auth_domain`, consumed by `ci.yml`'s `frontend-deploy` job (2.6).
- `google_identity_platform_config.default` (`identity_platform.tf`, `google-beta`) — `sign_in.email { enabled = true, password_required = true }` (phone explicitly declared `enabled = false` to match the API-returned default and avoid a perpetual plan diff). **This resource is the Terraform-managed *floor*, not the full enabled-provider list**: Google sign-in (BL-118, shipped 2026-07-20) is enabled directly in the Firebase console and has no corresponding Terraform block — see the as-built addition + terraform-vs-console drift note in Section 1.1. A `terraform plan` against this resource will not show Google either way (Identity Platform providers outside a resource's declared fields aren't diffed), so this isn't a live drift risk, but it means this section alone understates what's actually enabled.

### 3.10 Custom domain

`google_firebase_hosting_custom_domain.swu_subdomain` (`custom_domain.tf`) maps `swu.jeremybradenapps.com` to `swu-prod`'s Firebase Hosting site (`site_id = "swu-prod"`). `wait_dns_verification = false` so `terraform apply` doesn't block on DNS records that don't exist yet — `required_dns_updates` is exposed as an output for manual application to the **separate** `jeremy-portfolio` project's Cloud DNS zone (which is not managed by this Terraform configuration at all).

**BL-127 (added 2026-07-20) — `hyperspacevault.com`, a stand-alone app identity.** Unlike the subdomain above, this domain's DNS lives **in `swu-prod` itself** — decoupling the app from the portfolio infra is the point of this addition. `custom_domain.tf` also declares: `google_dns_managed_zone.hyperspacevault` (zone `hyperspacevault-com`, nameservers delegated at Namecheap); `google_firebase_hosting_custom_domain.hyperspacevault_www` (`www.hyperspacevault.com`, canonical) and `.hyperspacevault_apex` (`hyperspacevault.com`, 301-redirects to `www`); and the zone's own `google_dns_record_set` resources (apex A + TXT for Hosting/ownership verification, `www` CNAME to `swu-prod.web.app`, BL-94's DKIM CNAME pair + a monitoring-only DMARC TXT for `noreply@hyperspacevault.com` auth email). `swu.jeremybradenapps.com` is planned to become a permanent redirect to `www.hyperspacevault.com` in a later step, once `www` is confirmed serving.

The consumer-facing rename to **HyperspaceVault** rides the same change: `terraform/modules/app/firebase.tf`'s `google_firebase_web_app.default` now has `display_name = "HyperspaceVault"` (was the prior project name).

### 3.11 Frontend ↔ backend connection

`frontend/firebase.json`:

```json
"rewrites": [{ "source": "/api/**", "run": { "serviceId": "backend", "region": "us-central1" } }]
```

Firebase Hosting transparently proxies `/api/**` requests to the Cloud Run `backend` service. From the browser's perspective, `https://swu.jeremybradenapps.com/api/cards` and `https://swu-prod.web.app/api/cards` are **same-origin** requests — CORS is never invoked in production.

`app/main.py`'s CORS middleware (`allow_origins=["http://localhost:5173"]`) exists purely for local dev, where the Vite dev server (port 5173) talks directly to a locally-running backend on a different port. This is *not* a misconfiguration of the production path — see Section 5.

`frontend/src/api/authedFetch.ts` attaches `Authorization: Bearer <Firebase ID token>` (via `auth.currentUser?.getIdToken()`) to every `/api/*` call.

### 3.12 Outputs consumed by CI

| Output | Consumed by |
|---|---|
| `workload_identity_provider` | `google-github-actions/auth` step in every job (auth to GCP) |
| `firebase_web_app_api_key`, `firebase_web_app_auth_domain` | `frontend-deploy` job → `VITE_FIREBASE_*` build env vars |
| `project_id` | `frontend-deploy` job → `VITE_FIREBASE_PROJECT_ID`, `firebase deploy --project` |
| `backend_url`, `cloud_sql_connection_name`, `custom_domain_*`, `terraform_ci_service_account`, `backend_repository_url`, `enabled_apis` | Informational / not directly consumed by CI |

### 3.13 Design Rationale

#### 3.13.1 Hybrid environment model: persistent minimal `swu-prod` + ephemeral `swu-sandbox`

**Selected (P1, foundational):** one always-on, deliberately minimal production project, plus a separate project for exploring infrastructure patterns (VPCs, load balancers, multi-zone) that would be expensive or noisy to keep running permanently.

This gives a real, low-cost production app (the thing actually serving `swu.jeremybradenapps.com`) while still allowing hands-on access to patterns that don't belong in — and would inflate the cost/complexity of — the production environment. `swu-sandbox` deliberately has not tracked `swu-prod`'s P2-P7 additions; it remains at its P1-bootstrap state by design.

#### 3.13.2 Multi-tenancy: shared schema + Postgres RLS, not schema-per-tenant

**Selected (P1/P4, foundational):** one schema, shared tables, `tenant_id` columns + RLS policies (Section 1.5) — "real SaaS-grade isolation" enforced by the database itself, beneath the application layer.

Schema-per-tenant (or database-per-tenant) avoids needing RLS at all, but multiplies migration/connection-management operational overhead per tenant — and at this project's scale (auto-provisioned, one-tenant-per-user, Section 1.7.3), that overhead would grow linearly with signups for no isolation benefit RLS doesn't already provide. RLS works identically on local Postgres and Cloud SQL, so the same policies are exercised in CI (Section 2.2) as in production.

#### 3.13.3 Public Cloud Run ingress (`allUsers`) + app-layer auth

**Selected (P2, revisited at P7 Stage 4; access model updated by BL-56):** `ingress = INGRESS_TRAFFIC_ALL` with `roles/run.invoker = allUsers` — the backend URL is reachable by anyone, with access control enforced entirely at the application layer (Section 1: `get_db` for tenant-scoped/mutating routes, `get_catalog_db`/`get_optional_db` for the public catalog reads, all three backstopped by RLS).

This was originally adopted at P2 ("It's alive") before auth existed at all, and was *re-verified rather than removed* once P5 added Firebase Auth: P7 Stage 4 live-curl-confirmed `401` on every `/api/*` route without a valid token — true at the time, and still true for `/api/inventory` and every mutation today, but no longer true uniformly since BL-56 made the catalog reads anonymous (Section 1.1, [ADR-0008](../docs/decisions/0008-anonymous-catalog-reads.md)). This is a common, accepted pattern for services that perform their own authentication — an IAM-level restriction (e.g., requiring a Google-signed `Authorization` header at the Cloud Run layer) would be redundant with, not additive to, the app-layer check, and would complicate the Firebase-Hosting-rewrite path (3.11), which does not send Cloud-Run-IAM-compatible credentials.

### 3.14 CDN caching of public catalog reads (RR-3)

`app/http_cache.py` (issue #129) adds `Cache-Control` to the responses of the fully public catalog endpoints — `GET /api/sets`, `/api/sets/{code}` (router-level `dependencies=[Depends(catalog_cache)]` in `app/routers/sets.py`) and, since BL-101, the `GET /api/base-cards` list route (per-route, because its sibling detail route must stay no-store). *(RR-3's original poster children `GET /api/cards`/`/api/cards/{id}` were retired in BL-102 — runtime-dead since BL-56.)*

**Which routes, and why.** The eligibility line is DB dependency, not "looks public": routes on `get_catalog_db` (tenant-less by construction — Section 1) never vary by caller identity, so their bytes are safe to share across every visitor behind the CDN. **Since BL-101 (catalog/quantity split) that family includes `GET /api/base-cards` (list)** — the split removed the per-tenant `quantity` from the list response precisely so it could cross this line *by construction* and stop paying full generation on every Cards-tab open. `GET /api/base-cards/{id}` (detail) still runs on `get_optional_db` — its response carries a per-tenant `quantity` on every variant — so it keeps the opposite, explicit `Cache-Control: private, no-store` (`tenant_no_store`), unconditionally, even though an anonymous caller's response would look "safely" cacheable today. Everything under `/api/inventory` (always-authenticated, `get_db`) — including BL-101's `GET /api/inventory/quantities`, the per-tenant half of the split — now also carries the explicit `tenant_no_store` header router-wide.

**TTL split.** `public, max-age=300, s-maxage=3600` — a short 5-minute browser tier (a browser's own cache can't be purged remotely if it goes stale) and a longer 1-hour CDN (`s-maxage`) tier, because the CDN tier's staleness is bounded by deploys, not just its own TTL (below).

**Invalidation story.** Firebase Hosting only CDN-caches a Cloud Run rewrite's response when the response carries a `Cache-Control` header at all (the pre-RR-3 default routed every request to Cloud Run) — and Hosting purges its entire CDN cache on every `firebase deploy` (Section 2.6's `frontend-deploy` job), which is the de-facto invalidation path today: any deploy — frontend or a docs-only change that still runs the job — clears stale catalog responses. The gap is catalog *ingestion* (BL-29/BL-36) without an accompanying Hosting deploy: a newly-ingested set or card can sit behind a stale CDN entry for up to the `s-maxage` ceiling (≤1 hour). Accepted for now at this project's ingestion cadence; see `SWU_Backlog.md` BL-36 for the planned fix (trigger a targeted purge or redeploy as part of the sync design).

### 3.15 Response compression (gzip, BL-99)

`app/main.py` registers Starlette's `GZipMiddleware` (`minimum_size=500`) — responses at or above ~500 bytes are gzip-compressed whenever the caller sends `Accept-Encoding: gzip`, regardless of route or auth state. Transport-only: no route, response model, or `Cache-Control` header changes. Measured before this landed (prod, 2026-07-10): `GET /api/base-cards` returned 4,273,720 bytes (~4.27 MB) fully uncompressed, no `Content-Encoding` header, even when the client advertised `Accept-Encoding: gzip` — there was no compression anywhere in the path (FastAPI had no `GZipMiddleware`, and Firebase Hosting does not compress `/api/*` rewrite responses; that's the Cloud Run origin's job).

**Complementary to RR-3, not overlapping.** RR-3 (3.14) makes the tenant-less catalog reads CDN-cacheable, so a repeat visitor's browser or the edge often skips the round-trip to Cloud Run entirely. At the time BL-99 shipped, `/api/base-cards` — the endpoint the Cards list screen actually fetches — carried per-tenant quantities and was `private, no-store` (3.14's eligibility rule), so gzip was the only lever available to it; *(since BL-101 the list is catalog-only and joined the cached family, so it now benefits from both)*. gzip shrinks every response, cached or not, cacheable or not, typically ~85–90% for JSON of this shape. `Vary: accept-encoding` was already present on responses (Firebase-added), so the CDN was already primed to keep gzipped and identity variants separate once the backend started actually sending gzip.

**Middleware ordering (`app/main.py`).** `GZipMiddleware` is registered *before* `CORSMiddleware` and before the P6 `log_requests` middleware (4.1), which puts it innermost in Starlette's middleware stack — directly around the router, not around `log_requests`. This is required, not stylistic: `log_requests` runs via `app.middleware("http")(...)`, i.e. `BaseHTTPMiddleware`, whose `call_next()` replays a route's response as an ASGI stream (`more_body=True` on the first chunk) even for a small, single-shot `JSONResponse`. `GZipMiddleware`'s `minimum_size` gate only applies on the non-streaming code path — once `more_body` is `True` it unconditionally compresses, size be damned. Verified empirically while building BL-99: with GZip registered *after* `log_requests` (outermost), a 33-byte 404 body came back gzip-encoded; with GZip innermost (the shipped ordering), it sees each route's real single-shot response directly and `minimum_size` is honored correctly. `log_requests` itself is unaffected either way — it reads `response.status_code`, never the body.

### 3.16 Self-hosted card images (BL-76 / ADR-0012)

Card art is mirrored off the official SWU CDN into a **per-environment GCS bucket** and served **same-origin** through the existing Firebase-Hosting-rewrite → Cloud Run pattern (3.11). Decision rationale and rejected alternatives: [ADR-0012](../docs/decisions/0012-card-image-self-hosting.md) (including its dated amendment replacing additive path columns with read-time derivation — no migration, no seed regen).

**Storage (Terraform, `modules/app/card_images.tf`).** `google_storage_bucket` `"${project_id}-card-images"` (`swu-prod-card-images` / `swu-dev-jbapps-card-images`), uniform bucket-level access, **not publicly readable** — browsers never talk to GCS; the Cloud Run handler reads objects with its own runtime identity (`backend_runtime` SA, `roles/storage.objectViewer` on the bucket only). Objects are immutable by convention (a changed source image is a new filename, never an overwrite), so no lifecycle rules and no versioning. The bucket name reaches the backend as the `CARD_IMAGES_BUCKET` env var (`cloud_run.tf`); locally the var is unset and `/images/` requests fail server-side, degrading to the client-side `onError` hotlink fallback below — local dev needs no GCP credentials.

**Objects & renditions.** Three objects per source image, paths derived purely from the stored CDN URL (`app/services/image_paths.py` — zero I/O, importable on the request path): `cards/<stem>.png` (original) + `cards/<stem>_640.webp` / `cards/<stem>_320.webp` for `srcset`. Mirroring happens at ingestion (`app/ingestion/image_mirror.py`) with a rate-limited backfill script for existing catalogs (`backfill_card_images.py`; **throttle it** — the first prod run saturated the operator's uplink).

**Serving (`app/routers/images.py`).** `GET /images/cards/{filename}` — Hosting rewrites `/images/**` to the backend alongside `/api/**`. Anonymous by construction: no auth dependency, no tenant data; the response depends only on the filename, so it carries `Cache-Control: public, max-age=31536000, immutable` and satisfies 3.14's public-cache invariant the same way the base-cards list does. Filename parsing is strict (stem regex + known suffixes, no dots in stems → no traversal; malformed = 404, same as not-found). A bucket **miss** 307-redirects (`no-store`) to a best-effort reconstruction of the official CDN URL — correct for the dominant double-slash URL form (~29:1); the authoritative safety net is the frontend's one-shot `<img>` `onError` swap to the exact stored `front_image_url`/`back_image_url` (`frontend/src/utils/cardImages.ts`), deliberately keeping DB lookups off the image hot path.

**Prod state (backfill completed 2026-07-12, issue #204):** 8,759/8,759 real images mirrored, 0 real failures; bucket = 26,277 objects (exactly 3×); CDN edge primed (17,515/17,522; spot-check `X-Cache: HIT` @ 0.41s). Known cold-start caveat, as configured: the handler rides the backend service, nominally `min_instances = 0` — first image view after a genuine cold start pays ~10s. **Operational finding (BL-126, 2026-07-14, §4.3):** in observed practice the service rarely if ever actually reaches zero instances — the uptime check's aggregate ~40s ping cadence keeps at least one instance continuously warm at current traffic, so this cold start is largely theoretical today rather than a routine visitor experience; `min_instances` decision stays tracked as `SWU_Backlog.md` **BL-106** regardless, since the uptime check's warming effect is an observed side effect of a Google-managed schedule, not a guarantee this app controls.

---

## 4. Observability

### 4.1 Structured JSON logging

`app/logging_config.py`:
- `JSONFormatter` — formats every log record as one JSON line. Maps `record.levelname` → `severity` (the field Cloud Logging treats specially — see below). `_EXTRA_FIELDS = ("httpRequest", "tenant_id")` are promoted to top-level JSON keys when present. On `exc_info`, the traceback is appended to `message`.
- `configure_logging()` — installs a single JSON `StreamHandler` on stdout for the root logger; disables `uvicorn.access` (superseded by the middleware below); routes `uvicorn`/`uvicorn.error` through the same JSON handler.

`app/middleware.py`'s `log_requests` (registered in `app/main.py` via `app.middleware("http")(log_requests)`):
- Wraps every request. Logs one structured line per request with `httpRequest` (method, URL, status, latency) and `tenant_id` (from `request.state.tenant_id`, set by `get_db()` — Section 1.4 step 8).
- Severity escalates with status code: `error` (5xx), `warning` (4xx), `info` (2xx/3xx).
- On an unhandled exception, logs with `exc_info=True` and status 500 *before* re-raising — this is the entry Cloud Error Reporting (4.4) scans for.

`log_requests` is registered *outer* to `GZipMiddleware` (3.15, BL-99) in `app/main.py`'s middleware stack — a deliberate ordering, not an incidental one; see 3.15 for why the reverse order silently breaks gzip's `minimum_size` gate. The ordering has no effect on this middleware's own logging: it reads `response.status_code`, never the body, so a compressed response logs identically to an uncompressed one.

Cloud Run forwards all stdout/stderr to Cloud Logging automatically. The `severity`, `httpRequest`, and `message` keys are Cloud Logging "special fields" — promoted onto the `LogEntry` itself (not buried in `jsonPayload`), which is what makes them filterable/queryable and is what Stage 3's alert policy and Stage 4's Error Reporting both key off.

### 4.2 Cloud Monitoring dashboard

`google_monitoring_dashboard.backend` (`monitoring.tf`) — dashboard "Backend Overview", three tiles, all built from Cloud Run's built-in metrics (zero application code involved):

1. **Request Rate by Response Code** — `run.googleapis.com/request_count`, `ALIGN_RATE`/`REDUCE_SUM`, stacked area, grouped by `response_code_class`.
2. **Error Rate (5xx % of requests)** — Monitoring Query Language (MQL): ratio of 5xx request rate to total request rate × 100, line chart, y-axis `%`.
3. **Request Latency (p50/p95)** — `run.googleapis.com/request_latencies`, `ALIGN_PERCENTILE_50`/`ALIGN_PERCENTILE_95`, `REDUCE_MEAN`, two lines, y-axis `ms`.

### 4.3 Alerting

`monitoring.tf`:
- `google_monitoring_notification_channel.email` — "Jeremy (primary)", type `email`, address = `var.notification_email` (BL-171: operator-personal value, supplied via the repo's `NOTIFICATION_EMAIL` Actions variable as `TF_VAR_notification_email` — never tracked in the tree).
- `google_monitoring_alert_policy.high_5xx_rate` — "Elevated 5xx Error Rate". Filter: `resource.type="cloud_run_revision" AND resource.labels.service_name="backend" AND metric.type="run.googleapis.com/request_count" AND metric.label.response_code_class="5xx"`. `COMPARISON_GT 0`, `duration = 60s`, `ALIGN_RATE`/`REDUCE_SUM`. Fires on **any** 5xx sustained for 60 seconds. Documentation field points at the dashboard + `severity=ERROR` logs. Live-verified to fire within ~1-2 minutes of a real 500 (P7 Stage 4).
- `google_monitoring_uptime_check_config.backend_health` + `google_monitoring_alert_policy.uptime_failure` (RR-9, 2026-07-08) — an external probe of the backend's `/health` from Google's public checkers every 300s (`period = "300s"`, `monitoring.tf`), alerting to the email channel on sustained failure. This closes the gap the 5xx alert can't cover: "up but erroring" fires 5xxs; "down entirely" (crashed service, DNS/cert/misconfig) produces silence. **Target decision:** the direct Cloud Run `/health` URL, *not* the Hosting `/api/*` path — RR-3's CDN caching (`s-maxage=3600`) means the Hosting path can serve cached HITs long after the backend dies, masking exactly this failure mode. **Scope decision:** applied in the shared module, so both dev and prod are checked (dev doubles as the canary validating the resource shape; the cost of one dev-down email is accepted).

  **Operational finding (BL-126 rollout, 2026-07-14).** Although both environments run `min_instances = 0` (§3.5) — i.e. nominally scale-to-zero — the backend was observed **not actually reaching zero instances** in practice. `period = "300s"` is per Google checker location, but the check runs from multiple independent global locations simultaneously; in aggregate this lands a real `/health` request roughly every ~40s, frequently enough to keep at least one instance continuously warm at this project's traffic level. Two consequences worth recording: (1) it *corrects* the cold-start premise in §3.16 and `SWU_Backlog.md` BL-106 — the ~10s first-image cold start those describe is largely theoretical under this probing cadence, not something to plan a `min_instances = 1` fix around purely for that reason; BL-106 stays open because the checker's cadence/regions are Google-managed, not a contract this app controls. (2) it interacts with §3.7's secret-rotation note: because the instance rarely actually restarts on its own, a newly-added secret version (e.g. the real `FEEDBACK_GITHUB_PAT` replacing the placeholder) can sit unpicked-up for a long time unless a fresh revision is forced deliberately.
- `google_monitoring_alert_policy.high_p95_latency` (RR-9) — p95 request latency > 2s sustained 15 min (`ALIGN_PERCENTILE_95`, 300s windows). Deliberately generous: warm p95 runs well under 1s, so this only fires on real degradation (DB contention, pool exhaustion, cold-start loops), never on noise.

**BL-156 "alerting round 2" (re-landed PR #450, 2026-07-25** after #443's same-night revert; every condition below was validated by a real `alertPolicies.create` against dev before re-landing — #443 proved offline `terraform validate` is not evidence for monitoring resources):
- `google_monitoring_alert_policy.price_sync_job_failure` — "Price-Sync Job Failed or Silent", two conditions (policy-level `OR`): any `completed_task_attempt_count` with `result=failed`; and **silence** — trailing-24h `ALIGN_SUM` of `result=succeeded` attempts `COMPARISON_LT 1` with `evaluation_missing_data = ACTIVE`, sustained 2h. The silence condition is deliberately **not** `condition_absent`: the API caps absence durations at 23h30m, and any absence window shorter than the job's 24h cadence would false-page daily in the minutes before each 20:30Z run — the threshold-with-missing-data shape expresses "no success for a day plus 2h grace" inside the cap.
- `google_logging_metric.sql_backup_failure` + `google_monitoring_alert_policy.sql_backup_failure` — log-based metric on the Cloud Audit `system_event` entry `cloudsql.instances.automatedBackup` with `windowStatus != STATUS_SUCCEEDED` (no native backup metric exists — verified empty `metricDescriptors.list`); previously a completely silent, maximal-blast-radius failure. Creating the metric needs `roles/logging.configWriter` on `terraform-ci` (granted both envs + codified in `iam.tf`, the RR-9 play).
- Cloud SQL saturation, three policies: `sql_connections_saturation` (`num_backends` > 80% of `max_connections`, 5 min — the BL-146 pre-fix incident signature's early warning), `sql_memory_saturation` (`memory/components` **component=Usage** > 95%, 30 min — the only memory signal that genuinely excludes page cache; both `memory/utilization` *and* the `memory/usage`/`memory/quota` ratio pin at ~1.0 on small tiers, live-measured 2026-07-25), and `sql_cpu_saturation` (> 80%, 15 min vs. the ~9-10% A5-05 baseline).
- `google_monitoring_uptime_check_config.custom_domain` + `custom_domain_uptime_failure` (**prod only**, `environments/prod/monitoring.tf`) — external probe of `www.hyperspacevault.com` itself. Complements (not replaces) the module's `/health` check: that one deliberately bypasses the CDN, which also means DNS/TLS/Hosting failures on the real front door were invisible until this probe.

**Deployment state (2026-07-25):** live-verified in **both** environments via the Monitoring API — dev after the merge's apply (run 30165087449; 8 policies + log metric), prod after the same-day promote of `2b1e964` (run 30165617573, revision backend-00138-z9x; **9 policies** — the module's 8 plus the prod-only custom-domain probe — log metric and both uptime checks present). Import errors were audited (A5-07 #5) and are already covered by `high_5xx_rate`; no dedicated alert.

### 4.4 Error Reporting

`clouderrorreporting.googleapis.com` enabled via `google_project_service.p6`. No dedicated Terraform resource — error groups are derived automatically from the structured log entries 4.1 already produces (`severity=ERROR` + stack trace in `message`). Verified via a synthetic `events:report` call (P7 Stage 4); unhandled exceptions are grouped by exception type with first-seen/last-seen tracking.

### 4.5 Design Rationale

#### 4.5.1 Cloud Error Reporting vs. Sentry

**Selected: Cloud Error Reporting.**

| | **Cloud Error Reporting (selected)** | Sentry |
|---|---|---|
| Cost at hobby scale | Free, included with Cloud Logging/Cloud Run | Free to ~5K events/month, then per-event |
| Setup effort | Zero new accounts — reads existing structured logs (4.1) | New account, new SDK dependency, new DSN secret, separate dashboard |
| Error grouping / DX | Groups by exception type + top frame; links back to Cloud Logging. Functional, basic | Industry-leading grouping, release tracking, breadcrumbs, source context |
| Alerting | Same Cloud Monitoring alert policies as 4.3 — one system | Sentry's own separate alerting system |
| Portability off GCP | Low | High |

**What tipped it:** zero new account/SDK/secret, composes directly with 4.1's logging and 4.3's alerting — one "pane of glass." **Revisit if:** error volume/team size grows enough that *triage quality* ("which of these 200 similar errors is new") becomes the bottleneck — Sentry's SDK can run *alongside* continued Cloud Logging as a pure addition, not a migration.

#### 4.5.2 Alert threshold: "any 5xx for 60s," not a percentage

**Selected:** absolute condition (`COMPARISON_GT 0` on the 5xx request-rate metric), not a percentage-of-traffic ratio like the dashboard's error-rate tile.

At `swu-prod`'s current traffic volume, a percentage-based threshold (e.g., "5xx rate > 1% of total") would be statistically meaningless — a handful of total requests makes any percentage either 0% or a huge jump. "Any 5xx, sustained 60 seconds" is the threshold that's actually actionable at this scale; reuses the exact filter/aggregation from the dashboard's request-rate tile (4.2), narrowed to `response_code_class="5xx"`.

### 4.6 Cost Controls (RR-2 / finding F14)

Two independent guardrails against runaway billing, added together as RR-2. Both exist because A01/A04 (5.1) leave the catalog's `GET` endpoints intentionally anonymous (ADR-0008) — there is no per-caller auth to rate-limit against (BL-53 tracks that gap separately), so a request flood is a realistic abuse path. These guardrails bound the *cost* of that path rather than preventing the requests themselves.

**Cloud Run instance cap (Terraform-managed).** `google_cloud_run_v2_service.backend`'s `template.scaling.max_instance_count` (3.5) caps how far the backend can autoscale: prod `3`, dev `1`, set per-environment via module variable `max_instance_count` (`terraform/modules/app/variables.tf`; no module default — every caller must pass one explicitly so the tradeoff stays visible). Cloud Run's own default is ~80 concurrent requests per instance, so even 3 instances (~240 concurrent requests) vastly exceeds this app's realistic load while capping the worst case: a request flood can no longer scale the service out unboundedly and drive up compute cost. Dev is capped at 1 because it carries no real traffic and exists purely for infra iteration.

**Billing budget (deliberately *not* Terraform-managed).** A $50/month budget on the whole billing account (`0185EB-9EF63D-8C403D`), which covers both SWU projects (`swu-prod`, `swu-dev-jbapps`) and the separate `jeremy-portfolio` project, with alert thresholds at 50%/90%/100% of `CURRENT_SPEND`, notifying the billing account's admins (the owner's email). Created manually, 2026-07-08 ~02:40Z, with the owner's own credentials — **not** via `terraform-ci`, because that service account intentionally holds no billing-account IAM role (3.4/3.13); granting one purely to manage a single budget resource would expand the CI SA's blast radius (a compromised WIF-issued token could then read/alter billing config) for a benefit — one-time budget setup — that doesn't recur often enough to justify it. This mirrors the "keyless auth, minimal IAM surface" posture of 3.13.3/5.3: the CI SA's permissions track what CI actually needs to *do* repeatedly, not everything an admin could conceivably automate.

Reproduction procedure (idempotent create; re-run creates a duplicate budget, use `gcloud billing budgets list`/`update` to check first):

```
gcloud services enable billingbudgets.googleapis.com --project swu-sandbox   # one-time; quota project
gcloud billing budgets create --billing-account=0185EB-9EF63D-8C403D \
  --display-name="SWU monthly budget (RR-2)" --budget-amount=50USD \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
```

Verified via `gcloud billing budgets list` (2026-07-08).

---

## 5. Security Posture Summary

Full walkthrough: `SWU_Platform_Security_Review.md` (P7 Stage 4, dated 2026-06-14). This section is a condensed cross-reference — re-read the full review (and re-review it) when the auth/tenancy/infrastructure surface changes meaningfully.

### 5.1 OWASP Top 10 (2021) — status

| Category | Status |
|---|---|
| A01 Broken Access Control | Addressed — Section 1 of this document is the as-built reference; live-verified `401`s on every auth-gated `/api/*` route without/with-bad token. **As-built (BL-56, shipped 2026-07-05):** catalog *reads* are intentionally public via `get_catalog_db`/`get_optional_db` ([ADR-0008](../docs/decisions/0008-anonymous-catalog-reads.md)); the `401` guarantee scopes to `/api/inventory` + all mutations (plus a present-but-invalid token on the optional-auth reads), with RLS as the read fail-safe — **migration 0023** made the §1.5 `tenant_isolation` policy return zero `inventory`/`users` rows for a no-tenant session (no more `COALESCE(…, 1)` default into tenant 1). |
| A02 Cryptographic Failures | Addressed — HTTPS everywhere (Cloud Run + Firebase Hosting); secrets are 32-char `random_password`, never hand-set; no passwords stored (Firebase Auth) |
| A03 Injection | Addressed — all runtime SQL via SQLAlchemy `text()` with bound params; the only string-interpolated SQL (migration 0019's `CREATE ROLE`) uses a Terraform-generated secret, not user input, and runs once at migration time |
| A04 Insecure Design | Addressed. **As-built (BL-53, shipped 2026-07-24):** per-tenant rate limits now exist — `POST /api/inventory/import` (30/hr/tenant) and `POST /api/deck-check` (60/hr/tenant), 429 with a machine-readable `{"error": "rate_limited", ...}` detail and a computed `Retry-After` header. See the As-built note below the table for the full mechanism, scope, and what's still out (per-`/api/*`-route/edge-level limiting). |
| A05 Security Misconfiguration | Addressed — `/docs`/`/redoc`/`/openapi.json` disabled in production via `_api_docs_enabled()` (`ENVIRONMENT != "production"`, `app/main.py`) + `ENVIRONMENT=production` on Cloud Run (3.5); dev-only CORS config is not exercised in prod (3.11). **As-built (BL-157, shipped 2026-07-24):** app-layer security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Strict-Transport-Security`) now set on every `/api/**` and `/images/**` response — see the As-built note below the table. |
| A06 Vulnerable/Outdated Components | Addressed (Dependabot scanning live); **18-PR triage deferred** — `SWU_Backlog.md` BL-9. **RR-11 (2026-07-08):** Artifact Registry vulnerability scanning enabled (`containerscanning.googleapis.com`) — every pushed backend image is scanned on push + continuously re-checked; results in the AR console per digest; triage folds into the Dependabot cadence. The shipped image also runs as a non-root user and installs runtime deps only (test/lint tooling split to `requirements-dev.txt`, present only in CI and the compose `dev` image stage) |
| A07 Auth Failures | Addressed — Firebase Authentication owns credentials entirely; short-lived signed ID tokens, verified server-side |
| A08 Software/Data Integrity | Addressed — WIF/keyless CI auth (2.7.1), CI gates before deploy; **`enforce_admins: false`** on branch protection is an accepted single-developer trade-off |
| A09 Logging/Monitoring | Addressed — Section 4 (structured logging, dashboard, alerting, Error Reporting) |
| A10 SSRF | **Applicable, mitigated** — `POST /api/deck-check` (BL-137, merged 2026-07-16; prod 2026-07-22) server-fetches a client-supplied deck URL. `app/services/deck_fetch.py` enforces: a strict host allowlist (`swubase.com`/`www.swubase.com`, `sw-unlimited-db.com`/`www.sw-unlimited-db.com` — any other host raises before a network call is made); the fetch URL is always **rebuilt** from the allowlisted host + an id extracted from the pasted URL, never the pasted URL passed through verbatim; `httpx.Client(follow_redirects=False)` so a 3xx response is never chased on or off the allowlist; a 10s timeout and a streamed ~1MB response-size cap. `SWU_Application_Spec.md` §12/§5.11 documents the allowlist as the deliberate mitigation. |

> **As-built addition — BL-53 + BL-157 (request-surface hardening), shipped 2026-07-24 (PR #437).** A single wave addressed four audit findings (`analysis/BL150_Audit_Security_2026-07-24.md` A4-03/A4-11/A4-13/A4-14) together:
>
> - **Per-tenant rate limits (BL-53, A4-13/A4-04).** `app/rate_limit.py` gains `check_tenant_rate_limit(scope, tenant_id, *, max_calls, window_seconds)` — a tenant-keyed sibling of the existing BL-126 per-IP `is_rate_limited`, same in-memory/per-instance design and caveat (module docstring: resets on cold start, blind to traffic on other instances, no defense against a distributed attacker). Wired as **30/hr/tenant on `POST /api/inventory/import`** and **60/hr/tenant on `POST /api/deck-check`**, checked first in each handler — before any parse/fetch work — using `request.state.tenant_id` (server-resolved by `get_db`, never client-supplied). Over-budget calls get `429 {"error": "rate_limited", "message": "..."}` with a `Retry-After` header computed from the oldest in-window attempt (a tightening countdown, not a flat window). **Not covered:** a general per-`/api/*`-route or edge-level (Cloud Armor) limit — this wave is scoped to the two highest-risk endpoints the audit flagged, not a blanket control.
> - **`deck_json` body cap (BL-53, A4-13).** `DeckCheckRequest.deck_json` was a free-form dict bounded only by Cloud Run's ~32MB request ceiling. Now capped at **1MB** (measured on the re-serialized dict, checked before `deck_parse`/`check_deck` run) — `422 {"error": "deck_json_too_large", ...}`.
> - **Proxy-IP fix (BL-53, A4-11).** uvicorn's `ProxyHeadersMiddleware` (`trusted_hosts="*"`) is now the **outermost** app middleware (`app/main.py` — added last, which Starlette's `add_middleware` places outermost in the wrap order), correcting `request.client.host` from Cloud Run's `X-Forwarded-For` before any other middleware or the router sees it. `trusted_hosts="*"` is safe specifically because Cloud Run only accepts traffic from Google's own front-end/Firebase Hosting rewrite (§3.11) — no external client can connect directly and forge its own trusted-proxy header. This transparently fixes the BL-126 feedback limiter (`app/routers/feedback.py`, unchanged code, corrected input) which the audit found was likely keying on the proxy peer instead of the real client IP.
> - **Import stream guard + single parse (BL-53, A4-03; closes out BL-158's third sub-item).** `routers/inventory.py`'s new `_read_capped()` reads the upload in 1MB chunks and stops as soon as it exceeds `IMPORT_MAX_UPLOAD_BYTES`, instead of buffering the whole body before checking its length. The JSON body is now parsed **exactly once** (`inventory_io.parse_json`) — the old `_raw_row_count` pre-check (a second full `json.loads` just to count `cards`) is removed, and the `>20,000`-row gate now runs on the single parse's own (post-duplicate-merge) row count. Documented trade-off: the row-count rejection now happens after one bounded parse rather than before any parse — same order of magnitude of worst-case work, not a new unbounded cost — and a heavy-duplicate file that merges under the cap is now accepted where it previously wasn't (closer to the real resolution cost, not a regression).
> - **Security headers (BL-157, A4-14).** New `app/middleware.py:security_headers`, registered on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`. **Deliberately no CSP** — this backend serves JSON and a 307 redirect to the image CDN, no HTML surface on this origin to protect (the frontend's HTML is Firebase Hosting's separate static bundle, out of this backend's control). A live prod header capture (2026-07-25, pre-fix) confirmed HSTS was already present via the Firebase Hosting/Google Frontend layer in front of this service, but `nosniff`/`X-Frame-Options`/`Referrer-Policy` were absent on both `/api/**` and `/images/**` — this middleware guarantees all four regardless of what's in front of it.
> - **State as of this revision:** merged to `main`/dev (PR #437); the most recent prod promote run predates this merge — not yet live in prod.

### 5.2 Secrets (Secret Manager)

See Section 3.7 for the full table. The four database secrets are `random_password`-generated, `auto` replication, accessible only to `backend-runtime` (per-secret `secretAccessor`, not project-wide) plus `terraform-ci`'s project-level `secretmanager.admin` (needed to *create* those bindings). The fifth (`feedback-github-pat`, BL-126) shares the access pattern but not the generation pattern — its real value is hand-created and added out-of-band, never `random_password`-generated or Terraform-managed (§3.7).

### 5.3 Network posture

- **Cloud Run:** public ingress + app-layer auth — by design, see 3.13.3.
- **Cloud SQL:** public IP (`ipv4_enabled = true`) but empty `authorized_networks` — unused attack surface, not an active exposure. Cloud Run connects via the IAM-authenticated Cloud SQL connector over a Unix socket, not the public IP path. `deletion_protection = true`, automated backups, `ZONAL` (no HA — acceptable at current scale; revisit `availability_type = "REGIONAL"` if uptime requirements grow).
- **Keyless auth throughout:** neither `terraform-ci` (WIF) nor `backend-runtime` (Cloud Run ADC) has a long-lived JSON key.

### 5.4 Open follow-ups

1. **`SWU_Backlog.md` BL-9 — ✅ resolved 2026-06-15.** All 18 Dependabot PRs triaged (merged or closed as superseded); the backend `pytest`/`pytest-asyncio` pin conflict was resolved via a coordinated bump. Retained here as a pointer only; see BL-9 for the per-PR disposition.
2. **`SWU_Backlog.md` BL-8 / RR-10 — ✅ shipped to dev 2026-07-25 (PR #433).** As-built, `backend/Dockerfile`'s `CMD` is now `uvicorn app.main:app --host 0.0.0.0 --port 8000` — `alembic upgrade head` no longer runs on serving-container start. [ADR-0011](../docs/decisions/0011-migrations-as-discrete-deploy-step.md)'s Option B: a dedicated Cloud Run Job (`migrate`, `terraform/modules/app/migrate_job.tf`, same pattern as `pricing_jobs.tf`) that CI applies and executes synchronously — failing the pipeline on a bad migration — before each environment's `terraform apply` deploys the new backend revision; wired into both `deploy-dev` (`ci.yml`) and the `promote-prod` composite action. **Verified live:** the dev `migrate` job executed successfully 2026-07-25T05:32Z. Local `docker compose` keeps auto-migrate via a `command:` override on the `backend` service (dev-loop convenience, not a prod concern). **Not yet proven in prod** — the last prod promote predates this merge; the prod half of the guarantee (migrate job runs before the prod revision shifts) proves itself on the next promote.
3. **`SWU_Backlog.md` BL-53 — ✅ per-tenant rate limiting shipped 2026-07-24** (§5.1 A04 as-built note above). **Still open:** edge-level control (Cloud Armor/WAF) and a general per-`/api/*`-route limit weren't in this wave's scope — revisit if the app opens beyond its current known users. A08 (`enforce_admins`) remains an accepted trade-off, unchanged.

---

*— End of Platform Spec —*
