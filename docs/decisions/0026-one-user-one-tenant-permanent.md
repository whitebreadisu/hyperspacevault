# ADR-0026: One user, one tenant — auto-provisioned, and permanent by owner decision

## Status
Accepted — auto-provisioning chosen at P5; upgraded from "for now" to **permanent** 2026-07-30 (public-release review, owner decision); recorded 2026-08-17 (BL-233 rationale extraction from Platform Spec §1.7.3)

## Context
Multi-tenancy needs a provisioning model. The candidates at P5: auto-create
a private tenant per user on first sign-in, or support invitation into an
existing tenant (a household/team scenario). Auto-provisioning is the
smallest model that satisfies the P5 milestone literally — "two people, two
inventories" — and `users.tenant_id` being a plain foreign key meant the
team scenario would be a change to provisioning *logic*, not a schema
migration, so choosing small foreclosed nothing.

At the 2026-07-30 public-release review the owner upgraded the choice from
interim to permanent: "I do not ever see a need to have multiple users per
tenant" (BL-89 retired; App Spec §2).

## Decision
The first time a `firebase_uid` is seen, create a brand-new `tenants` row
*and* a `users` row pointing at it, in the same request. **Every user is the
sole member of their own tenant, permanently.** The schema flexibility
remains but is deliberately unused — no uniqueness constraint is being
added, since a migration would buy nothing.

## Consequences
- **+** Zero-friction onboarding: sign-in *is* provisioning.
- **+** Whole-tenant operations stay simple forever: `DELETE /api/account`'s
  purge needs no shared-tenant deletion semantics, ever (BL-87/BL-88); the
  same reasoning simplified `purge_tenant`'s share cleanup (BL-205).
- **+** Sharing could be built as read-only capability links (ADR-0019)
  rather than membership — "no viewer accounts, ever" leans on this
  decision.
- **−** A genuine household/team feature would now be a product-direction
  reversal, not a dormant option — the owner has explicitly priced that at
  zero.
- **−** "Tenant" and "user" are synonymous in practice, which every new
  reader of the schema has to learn once.

**Related:** ADR-0001 (RLS scoping per tenant), ADR-0019 (sharing without
membership). Original prose: Platform Spec archive (§1.7.3, extracted
2026-08-17).
