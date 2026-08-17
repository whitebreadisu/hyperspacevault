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
