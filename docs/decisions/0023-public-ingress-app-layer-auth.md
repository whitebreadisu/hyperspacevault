# ADR-0023: Public Cloud Run ingress (`allUsers` invoker) with auth enforced at the application layer

## Status
Accepted — P2 choice, re-verified at P7 Stage 4; access model updated by BL-56 (ADR-0008) and BL-205 (ADR-0019); recorded retroactively 2026-08-17 (BL-233 rationale extraction from Platform Spec §3.13.3)

## Context
The backend URL has to be reachable by the browser through Firebase Hosting's
`/api/**` rewrite. Cloud Run offers an IAM-level gate (requiring a
Google-signed `Authorization` header at the platform layer) that could sit in
front of the app's own auth. The Hosting rewrite path, however, does not send
Cloud-Run-IAM-compatible credentials — and the app performs its own
authentication anyway (Firebase ID token verification + RLS, ADR-0001).

The posture was adopted at P2 before auth existed at all, then **re-verified
rather than removed** once P5 added Firebase Auth: P7 Stage 4 live-curl
confirmed `401` on every `/api/*` route without a valid token — true then,
and still true for inventory and every mutation, though no longer uniform
once BL-56 made catalog reads anonymous (ADR-0008) and BL-205 added
share-token viewer reads (ADR-0019).

## Decision
`ingress = INGRESS_TRAFFIC_ALL` with `roles/run.invoker = allUsers`: the
service is publicly reachable, and **access control lives entirely in the
application layer** — `get_db` for tenant-scoped/mutating routes,
`get_catalog_db`/`get_optional_db` for public catalog reads, `get_shared_db`
for token-scoped share reads, all backstopped by RLS. No IAM-level
restriction is added: it would be redundant with the app-layer check, not
additive, and would break the Hosting-rewrite path.

## Consequences
- **+** One auth model to reason about and test; the common, accepted
  pattern for services that authenticate their own callers.
- **+** The Hosting rewrite (and later the same-origin image serving,
  ADR-0012) work without credential plumbing.
- **−** Every request reaches the app before being rejected — unauthenticated
  traffic consumes Cloud Run compute, making cost guardrails (instance cap +
  billing budget, Platform Spec §4.6) and rate limiting (BL-53) load-bearing
  rather than optional.
- **−** The platform layer contributes nothing to the security boundary;
  the app-layer dependency wiring and RLS are the whole story and must stay
  on every review checklist.

**Related:** ADR-0001 (RLS backstop), ADR-0008 (anonymous catalog tier),
ADR-0019 (share-token tier). Original prose: Platform Spec archive
(§3.13.3, extracted 2026-08-17).
