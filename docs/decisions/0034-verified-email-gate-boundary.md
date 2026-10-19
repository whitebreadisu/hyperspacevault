# ADR-0034: Verified-email gate boundary — inventory data writes, not account configuration

## Status
Accepted — 2026-07-23 (owner decision, recorded until 2026-10-18 as the BL-16/BL-54 as-built notes in `SWU_Platform_Spec.md` §1.1; extracted to this ADR under ADR-0020 in BL-271 Phase C — the original notes are verbatim in `SWU_Platform_Spec_Archive.md`, "Archived 2026-10-18 — tier purity round 2 (BL-271 Phase C)")

## Context
BL-16 (v1.0) added `require_verified_email` (`app/auth.py`): a verified `Authorization: Bearer <token>` is no longer sufficient on its own for the inventory-mutating routes — they also require the decoded token's `email_verified` claim and reject with **403** `{"detail": "email_not_verified"}` otherwise. BL-54 S1 widened the gate to `GET /api/inventory/export`, a read, because the import/export definition package's P9 decision is that verified email gates "the whole surface" (import and export together, `Definition_ImportExport_2026-07-22.md` §2/§7.1, private). That left a question that kept being re-flagged in reviews: should the remaining tenant-scoped mutations — `PUT /api/settings/limits` (account-scoped configuration) and `DELETE /api/account` (account self-service) — carry the gate too?

## Decision
The gate's boundary is **inventory data writes** — `POST /api/inventory/{id}/increment`, `/decrement`, `/adjust`, `POST /api/inventory/import` — plus `GET /api/inventory/export`, which the import/export package pairs with them. **`PUT /api/settings/limits` and `DELETE /api/account` stay ungated by owner decision (2026-07-23, settled).** Every other read (catalog, `GET /api/inventory/quantities`, deck check) is ungated.

## Rationale
Owner's reasoning, verbatim from the as-built note: "the gate's boundary is **inventory data writes** (increment/decrement/adjust, import, export); account-scoped configuration and account self-service (`DELETE /api/account`) sit deliberately outside it. Rationale: settings are RLS-isolated to the caller's own tenant, bounded/validated, and inert until the account verifies (everything they influence is already gated) — a gate there would catch no failure class." And from the BL-16 note: "Every other authenticated route — reads …, catalog endpoints, and `DELETE /api/account` (BL-87) — is deliberately **not** gated: an unverified user must still be able to browse, and must still be able to delete their own account (gating that would strand it)."

Alternative considered and rejected: gating every tenant-scoped mutation uniformly. It would strand unverified accounts (no self-deletion), add friction to configuration that has no effect until verification, and catch no abuse class the inventory-write gate does not already catch.

## Consequences
- + The question stops being re-flagged: the boundary is recorded once here, at the route comment (`app/routers/settings.py`), and per route in the Platform Spec §1.3 registry, whose test (`backend/app/tests/test_route_registry.py`) fails CI when a route's gates change without the spec row.
- + Unverified users can browse, configure limits and delete their own account; only inventory data writes and the export wait for verification.
- − Two account-level mutations run on a verified token alone — accepted for the reasons above.
