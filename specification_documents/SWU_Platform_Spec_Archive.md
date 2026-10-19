# SWU Platform Spec — Archive

Superseded and extracted text from `SWU_Platform_Spec.md`, moved here **verbatim**
under the three-tier documentation regime ([ADR-0020](../docs/decisions/0020-three-tier-documentation-regime.md)):
the spec keeps current-state claims and a dated tombstone per extraction; durable
rationale lives in the ADR series; this file preserves the original prose exactly
as it stood at extraction time. Entries are append-only, newest last within each
extraction batch. Section numbers refer to the spec as of the extraction date.

---

## Extraction batch 2026-08-17 (BL-233 initial migration)

### §1.7 Design Rationale (whole section)

**Disposition:** §1.7.1 + §1.7.2 → [ADR-0001](../docs/decisions/0001-rls-tenant-isolation.md) amendment 2026-08-17 · §1.7.3 → [ADR-0026](../docs/decisions/0026-one-user-one-tenant-permanent.md) · §1.7.4 → [ADR-0024](../docs/decisions/0024-firebase-auth-provider-selection.md)

> ### 1.7 Design Rationale
>
> #### 1.7.1 Session-scoped `set_config` (third argument `false`), not `SET LOCAL`
>
> **Selected:** `set_config('app.current_tenant_id', tenant_id, false)` — session-scoped, persists until the connection is returned to the pool.
>
> P4 Stage 3's original framing assumed one transaction per request, with `SET LOCAL` (equivalent to `set_config(..., true)`, transaction-scoped) resetting the variable automatically at the end of each request. But `upsert_increment`/`upsert_decrement` call `db.commit()` then `db.refresh(inv)` — **two transactions per request**. `SET LOCAL` reverts at the first `COMMIT`, so the `refresh()` transaction would see `app.current_tenant_id` unset and silently fall back to tenant #1 via migration 0018's `COALESCE` bridge — the wrong tenant's data, with no error.
>
> Session-scoped `set_config` is set once per `get_db()` call (step 7 above) and remains in effect for every transaction of the request, because each request's SQLAlchemy Session is **bound to one dedicated pooled `Connection` for the request's whole life** (`_open_authenticated_session` / `_open_catalog_session` return the pair; the dependency closes both).
>
> **Corrected 2026-07-13.** This paragraph originally claimed the dependency `yield` alone kept one connection checked out per request — false: an engine-bound Session releases its connection to the pool at every `commit()` and lazily checks out another (possibly different) one for the next statement. Under concurrent traffic the pool interleaves, and a mid-request commit (e.g. `PUT /api/settings/limits`' `replace_overrides`) could be followed by a connection last used by a tenant-less catalog session — GUC `''` — producing a live 500 in dev (`invalid input syntax for type integer: ""`); serial traffic had passed for weeks by pool luck. The explicit connection binding above is the fix; regression coverage in `test_session_connection_pinning.py` deterministically reproduces the interleave. (Migration 0023's NULLIF policies meant the failure was a loud cast error rather than silent tenant-#1 fallback — the 0018-era `COALESCE` bridge would have made this a silent cross-tenant read.)
>
> #### 1.7.2 `swu_app` role split from `swu_user`
>
> **Selected:** a new, separate least-privilege role (`swu_app`, migration 0019) that RLS policies actually apply to; `swu_user` remains the migration-running admin.
>
> P4 Stage 2 discovered that `swu_user` (`POSTGRES_USER` / Cloud SQL's bootstrap role) has `BYPASSRLS`, and `ALTER ROLE swu_user NOSUPERUSER`-equivalent attribute removal is refused outright for the bootstrap role — `FORCE ROW LEVEL SECURITY` alone is not sufficient, because table *owners* bypass RLS by default regardless of `FORCE`. There is no way to make `swu_user` RLS-constrained. `swu_app` is the only role the `tenant_isolation` and `user_self_access` policies are ever evaluated against.
>
> This required adding `APP_DB_PASSWORD` as a Cloud Run env var (Section 3.7) so migration 0019's `CREATE ROLE swu_app WITH LOGIN PASSWORD '...'` has a password to use. **As of BL-8/RR-10 (§5.4 #2, PR #433, dev-live 2026-07-25)** this migration runs once per deploy in the discrete `migrate` Cloud Run Job, not on every container start.
>
> #### 1.7.3 Tenant auto-provisioning — "one user, one tenant" (permanent)
>
> **Selected:** the first time a `firebase_uid` is seen, create a brand-new `tenants` row *and* a `users` row pointing at it, in the same request. Every user is the sole member of their own tenant.
>
> This is the smallest model that satisfies P5's milestone literally — "two people, two inventories." The alternative (inviting a user to join an *existing* tenant — a household/team scenario) is a real possible future feature, but `users.tenant_id` is just a foreign key: "invite a teammate" becomes a change to provisioning *logic* (point a new user row at an existing tenant instead of creating one), not a schema migration. The current schema doesn't foreclose it.
>
> **Decision upgrade (2026-07-30, public-release review — this section was originally titled "(for now)"):** one user per tenant is now **permanent** by owner decision ("I do not ever see a need to have multiple users per tenant"; App Spec §2, BL-89 retired). The paragraph above stays as the historical record of why the schema was left flexible; the flexibility is now deliberately unused — no uniqueness constraint is being added, since a migration would buy nothing. Consequence: `DELETE /api/account`'s whole-tenant purge (§1.1, BL-87/BL-88) needs no shared-tenant deletion semantics, ever.
>
> #### 1.7.4 Auth provider selection — Firebase Authentication vs. Auth0 / Clerk / Supabase Auth
>
> **Selected: Firebase Authentication** (the free tier of GCP Identity Platform), enabled via `google_identity_platform_config` (Section 3.9). **Originally Email/Password sign-in only; Google sign-in (BL-118) and password reset (BL-116) shipped 2026-07-20** — see the as-built addition in Section 1.1. This subsection's comparison table and rationale describe the *original* provider-selection decision (Firebase Auth vs. Auth0/Clerk/Supabase Auth as a platform, not a specific-provider choice) and remain accurate as a decision record; they were never a claim that only one sign-in method would ever be enabled within Firebase Auth.
>
> | | **Firebase Auth (selected)** | Auth0 | Clerk | Supabase Auth |
> |---|---|---|---|---|
> | Cost at hobby scale | Free, no practical cap for email/password | Free to ~7,500 MAU, then per-MAU | Free to ~10,000 MAU, then per-MAU | Generous free tier, scoped to a Supabase project |
> | GCP-native integration | Same Firebase project already used for Hosting (P2); Cloud Run verifies tokens via ADC, no new secret | None — separate vendor/dashboard/credentials | None | None — second database-adjacent vendor alongside Cloud SQL |
> | Frontend DX (React) | Solid official SDK; build-your-own forms | Excellent docs, hosted login page | Best-in-class prebuilt `<SignIn>`/`<SignUp>` | Solid SDK, less-polished prebuilt UI |
> | Portability off GCP | Lower — coupled to Firebase/GCP | High | High | Medium — coupled to Supabase |
>
> **What tipped it:** zero new vendor/dashboard, reuse of the existing Firebase project, consistency with the GCP-first reasoning from P1. **Revisit if:** enterprise SSO (SAML/OIDC) is ever needed (Identity Platform's paid tier covers it without switching providers), or portability off GCP becomes a priority (Auth0/Clerk's "works anywhere" trait, with Clerk's prebuilt components cutting frontend rework).

### §2.7.1 Workload Identity Federation (OIDC), not service account keys

**Disposition:** → [ADR-0022](../docs/decisions/0022-wif-keyless-ci-auth.md) · (§2.7.2, the coverage-gate calibration note, stays in the spec — below ADR threshold)

> #### 2.7.1 Workload Identity Federation (OIDC), not service account keys
>
> **Selected (P1):** GitHub Actions authenticates to GCP via WIF — short-lived OIDC tokens, no long-lived JSON key files anywhere (not in git, not in GitHub secrets).
>
> `terraform/environments/prod/wif.tf` creates pool `github-actions` / provider `github`, with `attribute_condition = "assertion.repository == 'whitebreadisu/hyperspacevault'"` — belt-and-suspenders with the `principalSet://...attribute.repository/whitebreadisu/hyperspacevault` binding on `terraform-ci` itself (Section 3.4). Only `terraform-ci` is WIF-bound; `backend-runtime` is only ever assumed by Cloud Run at runtime via Application Default Credentials, never by CI.

### §3.13 Design Rationale (whole section)

**Disposition:** §3.13.1 → [ADR-0021](../docs/decisions/0021-hybrid-environment-model.md) · §3.13.2 → already recorded as [ADR-0001](../docs/decisions/0001-rls-tenant-isolation.md) alternative (b), scale argument folded into its 2026-08-17 amendment · §3.13.3 → [ADR-0023](../docs/decisions/0023-public-ingress-app-layer-auth.md)

> ### 3.13 Design Rationale
>
> #### 3.13.1 Hybrid environment model: persistent minimal `swu-prod` + ephemeral `swu-sandbox`
>
> **Selected (P1, foundational):** one always-on, deliberately minimal production project, plus a separate project for exploring infrastructure patterns (VPCs, load balancers, multi-zone) that would be expensive or noisy to keep running permanently.
>
> This gives a real, low-cost production app (the thing actually serving `www.hyperspacevault.com`) while still allowing hands-on access to patterns that don't belong in — and would inflate the cost/complexity of — the production environment. `swu-sandbox` deliberately has not tracked `swu-prod`'s P2-P7 additions; it remains at its P1-bootstrap state by design.
>
> #### 3.13.2 Multi-tenancy: shared schema + Postgres RLS, not schema-per-tenant
>
> **Selected (P1/P4, foundational):** one schema, shared tables, `tenant_id` columns + RLS policies (Section 1.5) — "real SaaS-grade isolation" enforced by the database itself, beneath the application layer.
>
> Schema-per-tenant (or database-per-tenant) avoids needing RLS at all, but multiplies migration/connection-management operational overhead per tenant — and at this project's scale (auto-provisioned, one-tenant-per-user, Section 1.7.3), that overhead would grow linearly with signups for no isolation benefit RLS doesn't already provide. RLS works identically on local Postgres and Cloud SQL, so the same policies are exercised in CI (Section 2.2) as in production.
>
> #### 3.13.3 Public Cloud Run ingress (`allUsers`) + app-layer auth
>
> **Selected (P2, revisited at P7 Stage 4; access model updated by BL-56):** `ingress = INGRESS_TRAFFIC_ALL` with `roles/run.invoker = allUsers` — the backend URL is reachable by anyone, with access control enforced entirely at the application layer (Section 1: `get_db` for tenant-scoped/mutating routes, `get_catalog_db`/`get_optional_db` for the public catalog reads, all three backstopped by RLS).
>
> This was originally adopted at P2 ("It's alive") before auth existed at all, and was *re-verified rather than removed* once P5 added Firebase Auth: P7 Stage 4 live-curl-confirmed `401` on every `/api/*` route without a valid token — true at the time, and still true for `/api/inventory` and every mutation today, but no longer true uniformly since BL-56 made the catalog reads anonymous (Section 1.1, [ADR-0008](../docs/decisions/0008-anonymous-catalog-reads.md)). This is a common, accepted pattern for services that perform their own authentication — an IAM-level restriction (e.g., requiring a Google-signed `Authorization` header at the Cloud Run layer) would be redundant with, not additive to, the app-layer check, and would complicate the Firebase-Hosting-rewrite path (3.11), which does not send Cloud-Run-IAM-compatible credentials.

### §4.5.1 Cloud Error Reporting vs. Sentry

**Disposition:** → [ADR-0025](../docs/decisions/0025-cloud-error-reporting-over-sentry.md) · (§4.5.2, the alert-threshold calibration note, stays in the spec — below ADR threshold)

> #### 4.5.1 Cloud Error Reporting vs. Sentry
>
> **Selected: Cloud Error Reporting.**
>
> | | **Cloud Error Reporting (selected)** | Sentry |
> |---|---|---|
> | Cost at hobby scale | Free, included with Cloud Logging/Cloud Run | Free to ~5K events/month, then per-event |
> | Setup effort | Zero new accounts — reads existing structured logs (4.1) | New account, new SDK dependency, new DSN secret, separate dashboard |
> | Error grouping / DX | Groups by exception type + top frame; links back to Cloud Logging. Functional, basic | Industry-leading grouping, release tracking, breadcrumbs, source context |
> | Alerting | Same Cloud Monitoring alert policies as 4.3 — one system | Sentry's own separate alerting system |
> | Portability off GCP | Low | High |
>
> **What tipped it:** zero new account/SDK/secret, composes directly with 4.1's logging and 4.3's alerting — one "pane of glass." **Revisit if:** error volume/team size grows enough that *triage quality* ("which of these 200 similar errors is new") becomes the bottleneck — Sentry's SDK can run *alongside* continued Cloud Logging as a pure addition, not a migration.

## Archived 2026-10-12 — mobile e2e sharding (BL-260)

### §2.1 job count and pipeline diagram (pre-BL-260)

> `.github/workflows/ci.yml` defines eleven jobs in a build-once / promote model:
>
> ```
> backend ─────────────────────────┐
> frontend ─► frontend-e2e-mobile ─┴─► detect-changes ─► build-and-push ──┬─► check-risk-level ─► promote-prod-fast (risk:low)
>                                     (main push,         (main only,      └─► deploy-dev
>                                      skipped if          skipped if
>                                      docs-only)          docs-only)
> ```

Tombstone 2026-10-12: `frontend-e2e-mobile` was a single job that ran after `frontend`; it is now an aggregator over the `e2e-mobile-shard` matrix (five legs split by project), and the legs start with `frontend` (see Platform Spec §2.1, ADR-0007 amendment BL-260).

## Archived 2026-10-18 — tier purity round 2 (BL-271 Phase C)

Disposition log: `analysis/BL271_Purity_Dispositions_2026-10-18.md` (private). The Purpose section's pre-ADR-0020 framing, the §1.1 as-built blockquote chain, §1.3's narrative and hand-counted paragraphs, the §2.1 revision note and §5.4's resolved items left the Tier-1 spec; their present-tense facts were folded into §1.1–§1.5, §1.8 and §3.9, and the BL-54 gate-boundary rationale became ADR-0034. Each child names its source and disposition; text is verbatim.

### Purpose & How to Use — opening paragraphs, relationship table, `Design Rationale sections` paragraph

**Disposition:** → archive; rewritten (R10): the App Spec is the application spec (not the frozen V1 spec); the table gains the App Spec, the archive and the ADR series and marks private files; the "inline, not a separate ADR folder" paragraph described the pre-ADR-0020 regime

> `SWU_ClaudeCode_Spec.md` is the application spec: data model, API, frontend UI. It explicitly put cloud hosting, CI/CD, and multi-tenancy out of scope for V1.
>
> This document is its platform-side peer. It describes **how the deployed system actually works today** — authentication and multi-tenancy, the CI/CD pipeline, the Terraform-managed GCP infrastructure, observability, and the current security posture — with file/line references precise enough that a reviewer (human or AI) can verify each claim against the code without re-deriving it.
>
> Under the three-tier documentation regime ([ADR-0020](../docs/decisions/0020-three-tier-documentation-regime.md)) this is a **Tier-1 current-state** document: decision rationale lives in `docs/decisions/` (ADRs), and superseded text moves verbatim — with a dated tombstone here — to `SWU_Platform_Spec_Archive.md`.
>
> **Relationship to other documents:**
>
> | Document | Role |
> |---|---|
> | `SWU_ClaudeCode_Spec.md` | Application spec — data model, API, frontend UI (V1) |
> | **`SWU_Platform_Spec.md`** (this document) | As-built platform reference — auth/tenancy, CI/CD, infrastructure, observability, security |
> | `SWU_Platform_Roadmap.md` | Phase-by-phase history and status tracker (P1-P7). Slimmed per `SWU_Backlog.md` BL-2 once this document existed — read it for *when and why* a decision was made; read this document for *how it works now*. |
> | `SWU_Platform_Security_Review.md` | Full OWASP Top 10 + secrets/network walkthrough (P7 Stage 4). Section 5 below is a condensed summary that cross-references it. |
> | `learning_guide/SWU_Learning_Guide.md` | Teaching-oriented companion — deeper "why," external resources, concept explanations. This document is the terse reference; the learning guide is the narrative. |
> | `SWU_Backlog.md` | Open tech-debt/follow-up items, including several referenced from this document (BL-8, BL-9). |
>
> **Design Rationale sections.** Several sections below include an inline "Design Rationale" subsection — a condensed decision record (selected option, alternatives considered, what tipped it) for choices that shaped the as-built system. These were migrated from `SWU_Platform_Roadmap.md`'s "Open Decisions" log and `SWU_Learning_Guide.md`'s "Selection & Comparison" sections (per `SWU_Backlog.md` Open Question B, resolved 2026-06-14 as "inline, not a separate ADR folder"). The roadmap/learning guide retain the full narrative treatment for anyone who wants the teaching version; these are the condensed, durable record.

### §1.1 Overview — lead paragraph and the nine `As-built addition` blockquotes (BL-56, 126, 16, 205, 54, 116/118 + drift note, 88, 263/212)

**Disposition:** → archive (a changelog layered into the overview); facts folded as present tense into §1.1's session-dependency table and RLS paragraph, §1.2, §1.5 (migrations 0023/0027/0030), §1.8 (new) and §3.9 (R11); the BL-54 gate-boundary rationale → ADR-0034

> Most `/api/*` routes require `Authorization: Bearer <Firebase ID token>`. A single FastAPI dependency, `get_db`, both verifies that token and establishes the caller's tenant context for PostgreSQL Row-Level Security (RLS) — every such router gets both for free by declaring `Depends(get_db)`. The exceptions are the public catalog reads, the BL-205 share-token reads (both below) and the BL-235 analytics relay `/api/relay/*` (`app/routers/relay.py`, [ADR-0027](../docs/decisions/0027-posthog-analytics-first-party-proxy.md)): a stateless, unauthenticated forwarder to PostHog Cloud US that declares no auth or DB dependency, forwards only `content-type`/`content-encoding`/`user-agent` plus the client IP, holds no secrets and touches no app state.
>
> > **As-built exception — BL-56 (anonymous catalog reads, shipped to prod 2026-07-05).** The unified Cards view (`SWU_Application_Spec.md` §5.5) makes the catalog readable by anonymous visitors. Catalog reads run on **two additional dependencies** alongside `get_db`: **`get_catalog_db`** (strictly tenant-less — `GET /api/sets`, and `GET /api/base-cards` *list* since BL-101's catalog/quantity split removed `quantity` from it) opens a `swu_app` session that verifies no token and sets no tenant; **`get_optional_db`** (optional-auth — `GET /api/base-cards/{id}` detail only) resolves a real tenant when a valid token is present (real per-tenant `quantity`) and runs tenant-less otherwise (`quantity: 0`), still returning `401` for a *present-but-invalid* token. The Cards list's per-tenant quantities come from the auth-gated `GET /api/inventory/quantities` (BL-101), merged client-side. *(BL-102, 2026-07-10: the `GET /api/cards*` family and the heavy `GET /api/inventory` list — runtime-dead since BL-56/BL-44 — were retired outright.)* All `/api/inventory` routes and every tenant-data mutation stay on `get_db` (auth-gated). RLS is the fail-safe: **migration 0023** replaced the `tenant_isolation` policy's `COALESCE(current_setting('app.current_tenant_id', true)::integer, 1)` fallback (which would have leaked tenant 1's inventory to a no-tenant session) with a `NULLIF(current_setting('app.current_tenant_id', true), '')::integer` form, so an unset **or** explicitly-cleared tenant matches **zero** rows; `get_catalog_db`/`get_optional_db` clear both session GUCs to `''` on every checkout because `swu_app` connections are pooled. Rationale + rejected alternatives: [ADR-0008](../docs/decisions/0008-anonymous-catalog-reads.md). *Live in prod.*
>
> > **As-built addition — BL-126 (user feedback, shipped 2026-07-14).** `POST /api/feedback` (`SWU_Application_Spec.md` §4.6/§5.9/§12) is a **second** consumer of `get_optional_db`, alongside `GET /api/base-cards/{id}`. Unlike that route, an anonymous caller here is not a degraded stand-in for a signed-in one — anonymous submission is a fully first-class, intentionally-supported case. The row-level consent semantics (whether `tenant_id`/email ever get attached) are enforced in `app/services/feedback.py`, not by this dependency — `get_optional_db` contributes only `request.state.tenant_id` (`None` for anonymous, the real tenant for a signed-in caller), exactly as it does for every other optional-auth route. The `feedback` table (migration `0027`) is this codebase's **first tenant-optional table** — every prior tenant-owned table assumes a real `tenant_id` — and accordingly departs from the single blanket `tenant_isolation` policy pattern below (§1.5) with three narrower, command-specific RLS policies. Full data-model and RLS detail lives in the App Spec (§4.6), which is the shape's actual home, the same way migrations 0025/0026's tenant-settings RLS is documented there and not duplicated here. *Live in prod.*
>
> > **As-built addition — BL-16 (email verification, v1.0).** A verified `Authorization: Bearer <token>` is no longer sufficient on its own for the two inventory-**mutating** routes (`POST /api/inventory/{id}/increment`/`decrement`): they also declare `Depends(require_verified_email)` (`app/auth.py`), which reads the *same* resolved `get_current_identity` result (FastAPI's per-request dependency cache means the token is still verified exactly once) and rejects with **403** `{"detail": "email_not_verified"}` if the decoded token's `email_verified` claim is false or absent. Every other authenticated route — reads (`GET /api/inventory/quantities`; the heavy `GET /api/inventory` list was retired in BL-102), catalog endpoints, and `DELETE /api/account` (BL-87) — is deliberately **not** gated: an unverified user must still be able to browse, and must still be able to delete their own account (gating that would strand it). The frontend calls `sendEmailVerification()` after signup and shows a persistent, dismiss-proof `VerifyEmailBanner` (`frontend/src/components/VerifyEmailBanner.tsx`) whenever a signed-in user is unverified, with Resend and "I've verified" (forces `reload()` + `getIdToken(true)` so the backend sees the new claim) actions. *Live in prod; supersedes the "no verification required" interim trade-off `SWU_Backlog.md`'s BL-16 entry previously described.*
> >
> > **As-built addition — BL-205 (share-token viewer reads, App Spec §19.1 authoritative).** A fourth session dependency, **`get_shared_db`**, backs `GET /api/shared/{token}[/quantities|/limits]` — the platform's first unauthenticated read of tenant data. No `Authorization` header is inspected: the ≥128-bit share token is the credential. Resolution runs on the RLS rails — the session starts tenant-less (same GUC clearing as `get_catalog_db`), sets `app.share_token`, and the `shares_token_select` policy (migration `0030`) makes exactly the matching **unrevoked** row visible; only then is `app.current_tenant_id` set to the share's owner tenant, so the two data routes reuse the owner's own service reads unchanged. Invalid and revoked tokens are indistinguishable (404 both); shared reads are per-IP rate-limited (BL-53 cheap tier) and carry `Cache-Control: private, max-age=30`; revocation is soft (`revoked_at`) and immediate; share management (`/api/shares`) is a normal `get_db` tenant surface, and `purge_tenant` clears `shares` on account deletion. Owner-side cardinality: one active share per scope target (partial unique index). *Ships with v1.4 (BL-205).*
> >
> > **As-built addition — BL-54 S1 (inventory export, `require_verified_email` widened).** `GET /api/inventory/export?format=json|csv` also declares `Depends(require_verified_email)`, despite being a read — the import/export definition package's P9 decision is that verified email gates "the whole surface" (import and export together, `Definition_ImportExport_2026-07-22.md` §2/§7.1), not just mutations. This is the first read route carrying the gate; every other read (catalog, `GET /api/inventory/quantities`, deck check) remains ungated. `GET /api/catalog/reference.csv` (§6/§7.4) is unaffected — it's fully public/tenant-less like `GET /api/sets`, carrying no `require_verified_email` or even `get_db` at all. **`PUT /api/settings/limits` stays ungated by owner decision (Jeremy, 2026-07-23, settled):** the gate's boundary is **inventory data writes** (increment/decrement/adjust, import, export); account-scoped configuration and account self-service (`DELETE /api/account`) sit deliberately outside it. Rationale: settings are RLS-isolated to the caller's own tenant, bounded/validated, and inert until the account verifies (everything they influence is already gated) — a gate there would catch no failure class. Recorded here + at the route comment (`app/routers/settings.py`) so the question stops being re-flagged.
> >
> > **As-built addition — BL-116 (password reset) + BL-118 (Google sign-in), shipped to prod 2026-07-20.** Auth is no longer Email/Password-only, correcting §1.7.4 and §3.9 below. **BL-116** adds a self-service reset: `AuthModal.tsx`'s "forgot password" screen calls Firebase's `sendPasswordResetEmail`; no backend change (token verification stays provider-agnostic, §1.2). **BL-118** adds a second sign-in provider: `AuthModal.tsx` uses `GoogleAuthProvider` + `signInWithPopup` (with `signInWithRedirect` as a documented fallback), and `DeleteAccountModal.tsx` uses `reauthenticateWithPopup` so a Google-only user can still pass the BL-88 recent-auth gate before deleting their account or (where applicable) changing a password. **Collision policy:** [ADR-0016](../docs/decisions/0016-auth-provider-collision-auto-link.md) (Accepted 2026-07-20) — one account per email, resolved by Firebase's native auto-link rather than a manual linking UX: a Google sign-in matching an existing verified password account links alongside it; matching an unverified password account unlinks the password credential and verifies the account via Google. The reverse collision (Google-first user later tries to register with a password) is handled at error time (`auth/email-already-in-use`), since enumeration protection (`enableImprovedEmailPrivacy: true`) rules out pre-detection. Backend token validation is entirely unaffected by which provider issued the token — `verify_firebase_token` (§1.2) doesn't distinguish providers.
> >
> > **Terraform-vs-console drift (deliberate but previously undocumented).** The Google provider is **console-enabled, not Terraform-managed**: `terraform/modules/app/identity_platform.tf`'s `google_identity_platform_config.default` still declares only `sign_in.email { enabled = true }` (+ phone explicitly `enabled = false`, to prevent a perpetual plan diff) — no `sign_in.google` block exists. `terraform apply` neither knows about nor would revert the console-enabled Google provider (Identity Platform config outside the fields a resource declares is left alone), so this isn't a live drift risk, but it means the Terraform module map (Section 3.9) and the actual enabled-providers list diverge, and a future `terraform import`/refresh of this resource would not surface Google. This is exactly the class of gap the CLAUDE.md Documentation Drift rule targets — recorded here since the auth epic's own PRs never ran that sweep against this document.
> >
> > **As-built addition — BL-88 (server-side recent-auth check), shipped 2026-07-24.** `DELETE /api/account` (BL-87) previously trusted any valid Firebase ID token, however old — the password/Google reauth `DeleteAccountModal` performs before calling it was client-side UX only, not a server-enforced control. The route now also declares `Depends(require_recent_auth)` (§1.2 above, `app/auth.py:137-174`): the caller's decoded token must carry an `auth_time` claim within `RECENT_AUTH_WINDOW_SECONDS` (5 minutes) of the request, or the route rejects with `401 {"detail": {"code": "recent-auth-required"}}` **before** `account_service.delete_account(db)` runs — a stolen-but-valid, older-than-5-minutes ID token can no longer hit the purge endpoint directly and skip the password/Google gate. A **missing** `auth_time` claim is treated as stale, never as an implicit pass. The frontend's existing `DeleteAccountModal` reauth flow (password `reauthenticateWithCredential` or, since BL-118, `reauthenticateWithPopup` for Google-only users) already refreshes `auth_time` as a side effect, so it satisfies the new server check with no UX change. Deliberately **not** also gated on `require_verified_email` — recency and email verification are separate concerns, and an unverified user must still be able to delete their own account. *Merged to `main` 2026-07-24 (PR #432, ruff-format follow-up #434); deployed to dev via the standard merge pipeline. The last prod promote run predates this merge — not yet live in prod as of this revision. (Update 2026-07-30: promoted with the 2026-07-25/26 wave — live in prod; see the Security Review's 2026-07-30 addendum.)*
> >
> > **As-built addition — BL-263 + BL-212 (client auth start-up), 2.0.1, 2026-10-15.** `frontend/src/firebase.ts` initialises Auth with `initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence] })` — `getAuth()`'s own persistence list, **without** the popup/redirect resolver — in every document (it was already so in the isolated `/scan/` document). Reason: with `getAuth()` the SDK loads its resolver (`https://apis.google.com/js/api.js` + gapi) *before* restoring the session on phone user agents and any Safari, so a slow or hanging Google host held the app on "Loading…" (BL-263). The resolver is exported as `googleResolver` and passed only to `signInWithPopup`, `signInWithRedirect`, `reauthenticateWithPopup` and `getRedirectResult`; `AuthContext` calls `getRedirectResult` only when `AuthModal` marked a redirect as pending (`sessionStorage` `hsv:google-redirect-pending`, `utils/googleAuth.ts`), so a normal page load contacts no Google host (pinned by `src/firebase.test.ts` and e2e `bl263-no-google-wait`). On a redirect return the app may paint signed out for a moment before `getRedirectResult` completes the sign-in. Same release: **firebase 12.19.0** (`@firebase/auth` 1.13.6; main: firebase 13.0.0, BL-265 part 2 — ships with v2.1) — 1.13.5 removed the 1.13.4 `isHiding` guard that threw `Database is closing/hidden` when a session restore or sign-in touched IndexedDB while the page was hidden, leaving Auth initialisation unresolved (BL-212; seen on 11 of 395 launch-day browsers).

### §1.3 — opening sentence (external-review narrative) and `app/database.py:159-162` citation

**Disposition:** → archive (narrative); the `get_db` signature intro is rewritten without line numbers (decision 3)

> This is the mechanism that an external review (ChatGPT, 2026-06-14) misread as missing. `app/database.py:159-162`:

### §1.3 — hand-counted routes paragraph and the `For a future reviewer` paragraph

**Disposition:** → archive (the registry below owns the counts and the gated-route list; the counts paragraph duplicated it as of 2026-10-18); replaced by a reading guide for the registry (R12)

> The registry below is machine-checked (`backend/app/tests/test_route_registry.py`); the counts here are derived from it and the per-router breakdown is as of 2026-10-18: **15** route declarations of `Depends(get_db)` across `app/routers/`: `account.py` (1), `deck_check.py` (1), `inventory.py` (6), `settings.py` (2), `shares.py` (5, the BL-205 owner-side share management). No router declares a separate auth dependency. `get_catalog_db` (5): `sets.py` (2), `base_cards.py` list + `/{id}/price-history` (2), `catalog.py` `/reference.csv` (1). `get_optional_db` (2): `base_cards.py` `/{id}`, `feedback.py` `POST`. `get_shared_db` (3): `shares.py`'s viewer router `/api/shared/{token}[/quantities|/limits]`. No DB dependency: `images.py` (GCS bucket via `get_images_bucket`) and `relay.py` (BL-235 analytics relay). The mechanism below is unchanged; only which routers exercise it.
>
> **For a future reviewer:** if you're checking "is auth actually enforced on route X," the check is "does X declare `Depends(get_db)`?" — not "does X (or its router) mention auth/identity anywhere." The auth check is a side effect of acquiring a database session, by design (Section 1.6 explains why a *second*, RLS-scoped session is the right place for it). If you're checking "is route X also gated on a verified email (BL-16)," the check is "does X declare `dependencies=[Depends(require_verified_email)]`?" — as of this writing, `POST /api/inventory/{id}/increment`, `.../decrement`, `.../adjust` (BL-219), `POST /api/inventory/import` and `GET /api/inventory/export` (BL-54 S1).

### §2.1 — italic revision-history note (2026-07-08 / 2026-07-24)

**Disposition:** → archive (revision history naming the retired `promote-prod` job; the phase history pointer is the Roadmap)

> *(Rewritten as-built 2026-07-08 after the RR-6 CI hygiene series — the previous version of this section described the pre-BL-43 five-job pipeline. Corrected 2026-07-24 (BL-150 W1) — the diagram below still showed the pre-BL-131 gated `promote-prod` job and omitted `detect-changes` entirely; see §2.6 for the promotion mechanism the diagram now matches. Phase history: `SWU_Platform_Roadmap.md`; build-once/promote rationale: ADR-0007.)*
>
> `.github/workflows/ci.yml` defines thirteen jobs in a build-once / promote model:

### §5.4 Open follow-ups — three resolved items (BL-9, BL-8, BL-53)

**Disposition:** → archive (all three ✅); one present-tense posture sentence remains (R13)

> 1. **`SWU_Backlog.md` BL-9 — ✅ resolved 2026-06-15.** All 18 Dependabot PRs triaged (merged or closed as superseded); the backend `pytest`/`pytest-asyncio` pin conflict was resolved via a coordinated bump. Retained here as a pointer only; see BL-9 for the per-PR disposition.
> 2. **`SWU_Backlog.md` BL-8 / RR-10 — ✅ shipped to dev 2026-07-25 (PR #433).** As-built, `backend/Dockerfile`'s `CMD` is now `uvicorn app.main:app --host 0.0.0.0 --port 8000` — `alembic upgrade head` no longer runs on serving-container start. [ADR-0011](../docs/decisions/0011-migrations-as-discrete-deploy-step.md)'s Option B: a dedicated Cloud Run Job (`migrate`, `terraform/modules/app/migrate_job.tf`, same pattern as `pricing_jobs.tf`) that CI applies and executes synchronously — failing the pipeline on a bad migration — before each environment's `terraform apply` deploys the new backend revision; wired into both `deploy-dev` (`ci.yml`) and the `promote-prod` composite action. **Verified live:** the dev `migrate` job executed successfully 2026-07-25T05:32Z. Local `docker compose` keeps auto-migrate via a `command:` override on the `backend` service (dev-loop convenience, not a prod concern). **Not yet proven in prod** — the last prod promote predates this merge; the prod half of the guarantee (migrate job runs before the prod revision shifts) proves itself on the next promote.
> 3. **`SWU_Backlog.md` BL-53 — ✅ per-tenant rate limiting shipped 2026-07-24** (§5.1 A04 as-built note above). **Still open:** edge-level control (Cloud Armor/WAF) and a general per-`/api/*`-route limit weren't in this wave's scope — revisit if the app opens beyond its current known users. A08 (`enforce_admins`) remains an accepted trade-off, unchanged.

### §2.6 — `Reworked 2026-07-15 (BL-131)` history paragraph

**Disposition:** → archive (dated-update changelog naming the retired `promote-prod` job — the last `ci-job-name` finding; its current facts — dispatch retained by owner decision, release-notes gate, Releases mirror — rewritten as present tense in place)

> **Reworked 2026-07-15 (BL-131).** Through 2026-07-14 the human gate was a `promote-prod` job at the end of the main pipeline, held by the GitHub "production" environment's required-reviewers rule. The repo going private (2026-07-14) silently removed that rule — environment protection is Enterprise-only on private repos (verified empirically: the API re-add returns 422 on Pro). Promotion was reworked rather than paying Enterprise for one rule. **Update 2026-07-29 (BL-172):** the repo is public again and environment protection is available once more — the dispatch mechanism below is retained by owner decision: it already implements the intended policy (explicit owner-authorized promotes plus the `risk:low` fast lane) with no platform-tier dependency. **Update 2026-08-13 (BL-210):** the dispatch now runs a **release-notes gate** before terraform — at the promoted SHA, the newest `releaseNotes.ts` entry must match `frontend/package.json`'s version (trailing-`.0` normalized) and carry promote-day's America/Chicago date, else the promote fails before touching prod (`allow_stale_notes` dispatch input waives only the date check, for rollbacks/re-promotes); after a successful promote, the workflow mirrors the shipped entry to a **GitHub Release** on the `v{version}` tag (creating the tag at the promoted SHA if absent; mirror failure never fails the promote). Tooling: `.github/scripts/release_notes.mjs`.
