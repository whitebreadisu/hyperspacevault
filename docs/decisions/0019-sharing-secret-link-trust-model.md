# ADR-0019: Collection sharing via secret-link capability tokens over the existing RLS rails

## Status
Accepted — decision converged 2026-08-10/11 (BL-204 design sessions), shipped in v1.4 2026-08-16 (BL-205); recorded as an ADR 2026-08-17 under the ADR-0020 regime

## Context
Sharing a collection is the app's first product feature whose consumer is not
the tenant owner — and therefore the platform's **first unauthenticated read
of tenant data**, on a system whose entire isolation story to this point was
"every tenant-data read happens inside an authenticated, RLS-scoped session"
(ADR-0001, ADR-0008). The forces:

- The product wants zero-friction sharing: the viewer clicks a link and sees
  the owner's live Vault at full fidelity. **1-user-per-tenant is permanent**,
  so anything resembling viewer accounts, invitations, or grants is out.
- The security posture must not fork: a second, parallel read path around RLS
  would double the surface every future review has to re-verify.
- Owner rulings during design: no share-time configuration (per-card prices
  are public catalog data; a total is arithmetic — no value-hiding switch);
  the owner never learns who viewed; shares are live views, not snapshots.

Alternatives genuinely considered:

- **Viewer accounts / ACL grants.** Rejected — violates permanent
  1-user-per-tenant, adds an identity system for a read-only use case.
- **Public profile pages (enumerable URLs).** Rejected — collections are
  private by default; discoverability was never the ask.
- **Snapshot exports (point-in-time share).** Rejected — owner wants the
  live Vault; snapshots add storage and staleness for less product.
- **Per-share display toggles (hide value, etc.).** Considered and killed by
  owner ruling 2026-08-11 — configuration surface without capability.

## Decision
Share via an **unguessable capability token** — a secret link is the sole
credential — and serve shared reads **through the existing RLS rails**, never
around them:

- `shares(id, tenant_id, token, scope, name, created_at, revoked_at)`;
  `token` ≥128-bit URL-safe random (built: 256-bit). `scope` enum
  `inventory | wanted | list` from day one so the public-facing token table
  never needs a schema migration; v1.4 implements `inventory` only.
- The new public surface is **exactly three token-scoped endpoints** —
  resolve (`token → {name, scope}`), shared quantities, shared limits.
  Everything else the viewer sees rides the already-anonymous catalog family
  (ADR-0008), unchanged.
- Token-scoped reads validate the share row, then run the **existing
  repository paths under the owner-tenant RLS context set explicitly after
  token validation** (`get_shared_db`, the fourth DB dependency — ADR-0008
  amendment). Same rails, no bypass; FORCE RLS untouched.
- Failure indistinguishability: invalid and revoked tokens both 404.
  Revocation is immediate; revoke-and-recreate is the rotation gesture.
  **One active share per scope target** — rename and rotation cover every
  case a second concurrent link would.
- Abuse posture: per-IP rate limiting on the token-scoped endpoints (BL-53
  sliding-window limiter), short-lived private cache headers (no CDN
  persistence), tokens never logged (redaction test-pinned — BL-232 SEC-1),
  `/shared/**` excluded from robots and referrer-stripped (SEC-2/3).
- Viewer-mode principle — **owner's data, viewer's chrome**: mutation
  affordances removed, owner identity limited to the owner-chosen share name
  (≤30 chars, plain text); no view tracking, no saved-shares list,
  tab-session-scoped presence.

## Consequences
- + No second security model: the 2026-08-16 review (BL-232) verified the
  design end-to-end and found no exploitable vulnerability — the review
  surface was three endpoints plus a token table, not a new auth system.
- + `scope` enum future-proofs wanted-list and binder sharing (BL-206/209)
  as pure additions — no platform rework, no token-table migration.
- + Zero viewer friction; anonymous viewers convert via the existing signup
  nudges in situ.
- − **The link is the credential.** Anyone holding the URL sees the live
  Vault; forwarding is indistinguishable from the intended viewer. Accepted
  — mitigations are rotation, revocation, and the one-share-per-scope rule,
  not access control.
- − An unauthenticated surface now exists and must stay on the security
  review checklist forever (rate limits, log redaction, 404
  indistinguishability are all load-bearing and test-pinned).
- − No view analytics by deliberate ruling — the owner cannot know a link
  leaked by observing traffic.
- − Every "requires auth" / "401" / "all /api" documentation claim became
  conditionally false at ship time — handled by the CLAUDE.md
  enforcement-behavior doc-sweep rule, which this feature exercised first.

Current-state mechanics live in Application Spec §19.1 (as-built) and §12
(endpoint reference); the security evidence is the BL-232 review artifact.
