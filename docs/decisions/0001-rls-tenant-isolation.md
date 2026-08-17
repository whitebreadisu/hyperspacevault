# ADR-0001: Enforce tenant isolation with Postgres Row-Level Security

## Status
Accepted — 2026-06-14 (P4/P5; recorded retroactively 2026-06-23)

## Context
The app is multi-tenant: every Firebase user has a private inventory, auto-provisioned on first login. The isolation boundary must hold even when application code is wrong — a single forgotten `WHERE user_id = ?` should never be able to leak one tenant's data to another. Alternatives considered:

- **(a) Filter in the application layer** — add a tenant predicate to every query. Simple, but correctness depends on developer discipline on *every* query forever; one missed filter is a breach.
- **(b) Schema- or database-per-tenant** — strong isolation, but heavy operational overhead (migrations × N tenants, provisioning cost) for a project where tenants are individual hobbyist users.
- **(c) Postgres Row-Level Security (RLS)** — the database enforces the boundary regardless of what the query says.

## Decision
Use Postgres RLS. The application connects as a non-superuser role (`swu_app`, created by migration 0019), **not** the migration/admin role. Each request sets a tenant context (a session GUC for the current user id) in `get_db()`, and RLS policies on every tenant-scoped table constrain reads *and* writes to that tenant using both `USING` (read) and `WITH CHECK` (write) clauses.

## Consequences
- **+** Isolation is enforced by the database, not by developer discipline — a forgotten predicate can no longer cross tenants.
- **+** Produces a demonstrable, testable security boundary ("two people, two inventories").
- **+** The app role can't bypass policies (it isn't a superuser), so the guarantee holds even for ad-hoc queries through the app connection.
- **−** Every connection **must** set tenant context or tenant-scoped queries return nothing; this wiring in `get_db()` is load-bearing and easy to overlook when adding new entry points.
- **−** Debugging is harder: an empty result can mean "no data" *or* "tenant context wasn't set."
- **−** `WITH CHECK` is required, not optional — without it a tenant can *write* rows attributed to another tenant even when reads are constrained. We hit and fixed exactly this bug during P5; it's why both clauses are mandatory on every policy.

## Amendment — enforcement mechanics worth their own record (2026-08-17, BL-233 rationale extraction from Platform Spec §1.7.1/§1.7.2)

Two implementation decisions inside this boundary carry non-obvious rationale:

- **The `swu_app` role exists because the bootstrap role cannot be
  RLS-constrained.** P4 Stage 2 discovered that `swu_user` (`POSTGRES_USER`,
  Cloud SQL's bootstrap role) has `BYPASSRLS`, attribute removal is refused
  outright for the bootstrap role, and `FORCE ROW LEVEL SECURITY` alone is
  insufficient because table *owners* bypass RLS regardless of `FORCE`.
  There is no way to make `swu_user` RLS-constrained — so migration 0019
  creates `swu_app` as the only role the policies are ever evaluated
  against, and `swu_user` remains the migration-running admin.
- **The tenant GUC is session-scoped `set_config(..., false)`, not
  `SET LOCAL`.** Requests are not one transaction: `upsert_increment` /
  `upsert_decrement` commit then `refresh()` — two transactions.
  `SET LOCAL` reverts at the first `COMMIT`, so the refresh would run with
  the variable unset. Session scope is safe only because each request's
  Session is **bound to one dedicated pooled `Connection` for the request's
  whole life** — a claim that was originally false in practice: an
  engine-bound Session releases its connection at every `commit()`, and
  under concurrent traffic the pool interleaved, producing a live dev 500
  (corrected 2026-07-13; regression coverage in
  `test_session_connection_pinning.py`). Migration 0023's `NULLIF` policy
  form is what made that failure loud instead of a silent cross-tenant read
  — reinforcing this ADR's "empty result vs. missing context" consequence.

The schema-per-tenant alternative this ADR rejects as (b) was also argued
independently in Platform Spec §3.13.2 (now archived): per-tenant schema
overhead would grow linearly with auto-provisioned signups (ADR-0026) for no
isolation benefit RLS doesn't already provide, and RLS runs identically on
local Postgres, CI, and Cloud SQL. Original prose: Platform Spec archive
(§1.7.1/§1.7.2/§3.13.2, extracted 2026-08-17).
