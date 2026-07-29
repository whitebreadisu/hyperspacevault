# ADR-0009: Serverless containers (Cloud Run) over Kubernetes (GKE); k8s deliberately out of scope

## Status
Accepted — 2026-07-08 (records a foundational P2 choice retroactively, per the 2026-07-08 platform retrospective)

## Context
The backend needed a compute substrate at P2, and one of the platform's stated *go-deep* learning areas is cloud infrastructure & IaC (`SWU_Platform_Roadmap.md` §2). This ADR records the substrate choice — made at P2 but never written down as a decision with its alternatives — so the omission of Kubernetes is an owned choice rather than a silent default.

The standing tension is the platform's dual objective: this is a solo, low-traffic, cost-sensitive hobby app **and** a learning vehicle. Those two lenses disagree here, which is exactly why it's worth an ADR.

Options genuinely considered:
- **(A) Cloud Run** — fully-managed serverless containers; scale-to-zero; no node/cluster ops; native, keyless integration with the Cloud SQL connector, Secret Manager, Workload Identity Federation, and Firebase Hosting rewrites (the wiring the rest of the platform already assumes — platform spec §3.5/§3.11).
- **(B) GKE (Kubernetes)** — the substrate most enterprises actually run and the richest infra learning surface (pods, services, ingress, HPA, node pools, cluster networking). But it carries a standing ops burden (cluster/node upgrades, node-pool management, networking) and a non-trivial *idle* cost (a running control plane + nodes), which fights the "persistent minimal prod" cost model of the hybrid environment design (`SWU_Platform_Roadmap.md` §2, platform spec §3.13.1).
- **(C) Plain Compute Engine VM** — most manual, least managed, not aligned with the container/IaC direction. Rejected quickly.

For the *product*, Cloud Run is unambiguously right. For *learning*, GKE is the richer target — and skipping it leaves the single largest "enterprise infra" surface untouched on the production path. The dormant `swu-sandbox` project (ADR-0006) is the escape hatch: a throwaway GKE spike can live there without touching prod.

## Decision
Use **Cloud Run** for the backend. **Kubernetes/GKE is deliberately out of scope for the production path.** If k8s becomes a learning goal, do it as a throwaway spike in the dormant `swu-sandbox` project (ADR-0006) — never in `swu-prod`.

## Consequences
- **+** Zero cluster/node ops; scale-to-zero and per-request billing fit the minimal-prod cost model.
- **+** Native, keyless integration with the Cloud SQL connector, Secret Manager, WIF, and Firebase Hosting rewrites — the integrations the rest of the platform already depends on.
- **+** Cloud Run revisions map directly onto the build-once/promote model (ADR-0007) and give a first-class rollback lever (traffic shift between revisions).
- **−** The largest enterprise-infra learning surface — Kubernetes — goes **untouched on the prod path**. A real gap in a stated go-deep area, accepted deliberately rather than by omission.
- **−** Cloud Run abstracts away networking/ingress/scheduling details GKE would force you to learn.
- **−** Some portability cost: moving off Cloud Run later means re-expressing the service (the container image itself stays portable).

**Revisit if:** the app needs long-lived connections, background workers, or sidecars that Cloud Run handles poorly; multi-service orchestration grows; or GKE becomes a deliberate learning goal (→ do the sandbox spike first).

**Related:** ADR-0006 (dormant `swu-sandbox` as the k8s spike ground), ADR-0007 (Cloud Run revisions as the promote/rollback target), `SWU_Platform_Roadmap.md` §2 (go-deep learning areas), `SWU_Platform_Spec.md` §3.5 (Cloud Run as-built) / §3.13.1 (hybrid env cost model).
