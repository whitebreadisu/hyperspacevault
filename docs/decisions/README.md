# Architecture Decision Records (ADRs)

This folder holds **Architecture Decision Records** — short, numbered, append-only notes that capture *why* a significant architectural decision was made: the forces at the time, the alternatives weighed, and the consequences accepted.

## Conventions
- One decision per file, named `NNNN-kebab-title.md`.
- ADRs are **immutable once Accepted.** A decision is never edited to change its meaning — instead a new ADR *supersedes* it (the new one references the old; the old one's Status is set to `Superseded by ADR-NNNN`).
- Use [`0000-template.md`](0000-template.md) as the starting point.

## When to write one
A decision earns an ADR when it is *most* of: structural / cross-cutting · expensive to reverse · had real alternatives · would make a future reader ask "why is it this way?". Routine, easily-reversible choices do **not** get an ADR. A healthy project has ~a dozen, not a hundred — though under the three-tier documentation regime ([ADR-0020](0020-three-tier-documentation-regime.md)) this series is also the destination for decision rationale extracted from the current-state specs, so the count runs somewhat above pure greenfield volume by design.

## Index
| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-rls-tenant-isolation.md) | Tenant isolation via Postgres Row-Level Security | Accepted |
| [0002](0002-csv-to-swuapi-rewrite.md) | Rewrite catalog ingestion from CSV to swuapi | Accepted |
| [0003](0003-two-axis-variant-model.md) | Two-axis variant model (finish × provenance) | Accepted |
| [0004](0004-catalog-bootstrap-from-swuapi-export.md) | Bootstrap the catalog by ingesting the committed swuapi export on startup | Accepted |
| [0005](0005-catalog-performance-client-side.md) | Catalog performance — client-side payload-shrink + virtualization | Accepted |
| [0006](0006-dedicated-dev-environment.md) | Dedicated `swu-dev` cloud environment (new project, not repurposed sandbox) | Accepted |
| [0007](0007-build-once-promote-deploy-model.md) | Build-once / promote deploy model with a gated prod release | Accepted |
| [0008](0008-anonymous-catalog-reads.md) | Anonymous catalog reads via a tenant-less RLS-safe session | Accepted |
| [0009](0009-cloud-run-over-gke.md) | Cloud Run over GKE; Kubernetes deliberately out of scope | Accepted |
| [0010](0010-terraform-apply-in-ci.md) | `terraform apply` in GitHub Actions, not a dedicated TF automation platform | Accepted |
| [0011](0011-migrations-as-discrete-deploy-step.md) | Database migrations as a discrete deploy step, not on container start | Accepted |
| [0012](0012-card-image-self-hosting.md) | Card-image self-hosting — per-env GCS mirror, renditions, same-origin serving | Accepted |
| [0013](0013-limits-ui-build-then-trim.md) | Trim the inventory-limits UI to a three-way enforcement control (build-then-trim) | Accepted |
| [0014](0014-deck-card-level-references.md) | Decks reference cards, not printings — anchored on non-token root numbers | Accepted |
| [0015](0015-deck-interop-de-facto-json.md) | Deck interop via the de facto JSON, clipboard-first | Accepted |
| [0016](0016-auth-provider-collision-auto-link.md) | Social-provider collisions resolve by native auto-link — one account per email | Accepted |
| [0017](0017-risk-tiered-autonomy-rubric.md) | Risk-tiered autonomy rubric — explicit levels, fail-closed defaults, one machine-consumed label | Accepted |
| [0018](0018-category-level-cap-precision-restore.md) | Restore numeric keep-limit precision at category granularity | Accepted |
| [0019](0019-sharing-secret-link-trust-model.md) | Collection sharing via secret-link capability tokens over the existing RLS rails | Accepted |
| [0020](0020-three-tier-documentation-regime.md) | Three-tier documentation regime — current-state / rationale / history | Accepted |
| [0021](0021-hybrid-environment-model.md) | Hybrid environment model — persistent minimal `swu-prod`, ephemeral `swu-sandbox` | Accepted |
| [0022](0022-wif-keyless-ci-auth.md) | CI authenticates to GCP via Workload Identity Federation, never SA keys | Accepted |
| [0023](0023-public-ingress-app-layer-auth.md) | Public Cloud Run ingress with auth enforced at the application layer | Accepted |
| [0024](0024-firebase-auth-provider-selection.md) | Firebase Authentication over Auth0 / Clerk / Supabase Auth | Accepted |
| [0025](0025-cloud-error-reporting-over-sentry.md) | Cloud Error Reporting over Sentry | Accepted |
| [0026](0026-one-user-one-tenant-permanent.md) | One user, one tenant — auto-provisioned, and permanent | Accepted |
