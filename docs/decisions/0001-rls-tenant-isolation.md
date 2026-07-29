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
