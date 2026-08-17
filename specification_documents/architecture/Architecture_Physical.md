# Cloud footprint and the road to production

*HyperspaceVault · Architecture · View 3 of 3 — Physical*

Everything runs on Google Cloud in `us-central1`, in two mirrored environments defined by one shared Terraform module — a dev project and a prod project — plus a frozen sandbox for infra experiments. Firebase Hosting is the CDN and front door; there is deliberately no load balancer.

*Prepared 2026-07-28 · Updated 2026-08-16 (v1.4 era: release-gated promotes, applied DB tier, completed restore drills) · Companion views: [Conceptual](Architecture_Conceptual.md) (domain & actors) · [Logical](Architecture_Logical.md) (components & data)*

## Production runtime topology

**Prod (swu-prod) — request path and managed services**

```mermaid
flowchart LR
  user["Browser"] --> dns["Cloud DNS<br/>www.hyperspacevault.com<br/>(apex 301 → www)"]
  dns --> hosting["Firebase Hosting<br/>CDN + TLS<br/>serves the SPA bundle"]
  hosting -->|"rewrites /api/** and /images/**<br/>(same-origin — no CORS in prod)"| run["Cloud Run: backend<br/>FastAPI · scale-to-zero · max 3 instances"]

  run -->|"Unix socket via Cloud SQL connector<br/>(public IP unused — no authorized networks)"| sql[("Cloud SQL<br/>Postgres 16 · zonal · PITR 7d")]
  run -->|"runtime SA, viewer-only"| gcs[("GCS card-images bucket<br/>not public — served only via the backend")]
  run --> sm["Secret Manager<br/>DB URLs/passwords · feedback PAT"]
  run -.->|"verify ID tokens via ADC"| fauth["Firebase Auth<br/>email + Google"]

  sched["Cloud Scheduler<br/>daily 20:30 UTC"] --> psync["Cloud Run Job: price-sync"]
  psync --> sql
  migrate["Cloud Run Job: migrate<br/>alembic upgrade — run by CI<br/>before each new revision"] --> sql

  mon["Cloud Monitoring<br/>9 alert policies · 2 uptime checks<br/>dashboard + Error Reporting"] -.->|"email alerts"| owner["Operator"]
  mon -.->|"probes /health on the direct Run URL<br/>(bypasses CDN cache on purpose)"| run
  mon -.->|"probes www.hyperspacevault.com"| hosting

  classDef store fill:#F3E9D4,stroke:#8A6116;
  class sql,gcs store;
```

The dev project (`swu-dev-jbapps`) is the same module with smaller knobs — one max instance, smaller database tier, no custom domain. A third project (`swu-sandbox`) exists only so infrastructure experiments never touch, or bill like, production.

| Edge caching | Policy | Why |
|---|---|---|
| Public catalog reads | `max-age=300, s-maxage=3600` | Guests hit the CDN, not the backend; ≤1h staleness accepted |
| Card images | `max-age=31536000, immutable` | Object paths are immutable by convention; cache forever |
| Tenant-scoped routes | `private, no-store` | Vault data must never land in a shared cache |

## From pull request to production

Delivery is **build-once, promote-many**: one Docker image is built per merge and pushed to both environments' registries; promotion re-deploys the exact bytes that dev validated. CI authenticates to Google Cloud with workload identity federation — no stored service-account keys anywhere. Database migrations run as a discrete job, to completion, *before* the new service revision takes traffic.

**CI/CD — GitHub Actions**

```mermaid
flowchart LR
  pr["Pull request"] --> checks["CI checks<br/>pytest ≥75% cov · vitest ≥75%<br/>ruff · eslint · prettier · terraform fmt"]
  checks --> ciok{"ci-ok<br/>required branch-protection check<br/>(docs-only PRs classify + skip<br/>the heavy jobs, still report)"}
  ciok --> merge["Merge to main"]
  merge --> build["Build image once<br/>push :sha to dev AND prod registries"]
  build --> dev["deploy-dev (automatic)<br/>migrate job → terraform apply<br/>→ hosting deploy → smoke test"]
  dev --> gate{"Every unpromoted commit<br/>labeled risk:low?<br/>(fails closed)"}
  gate -->|"yes — auto"| notes
  gate -->|"no — owner runs<br/>promote-prod workflow"| notes{"Release-notes gate<br/>promoted build must carry its own<br/>in-app release-notes entry"}
  notes --> promote["Promote to prod<br/>same composite action, same image"]
  promote --> tag["prod-current tag<br/>moved to promoted SHA<br/>after prod smoke test"]
  promote --> mirror["GitHub Release mirror<br/>annotated tag + Release created<br/>from the in-app notes entry"]

  classDef gatestyle fill:#F3E9D4,stroke:#8A6116,stroke-width:2px;
  class gate,notes,ciok gatestyle;
```

- **Human gate by default:** the pipeline ends at dev. Production is a deliberate `workflow_dispatch` with a SHA that must be an ancestor of main.
- **Risk-tiered fast lane:** auto-promotion fires only if *every* commit since the last promote carried a `risk:low` label — a whole-build guard that fails closed on any missing label, missing PR, or unreadable state.
- **`prod-current` is the source of truth** for "what is production running" — a tag moved only after the prod smoke test passes, readable without any cloud credentials.
- **Every promote is release-noted:** the promote workflow refuses to ship a build whose version lacks its in-app release-notes entry, then mirrors that entry to a GitHub Release on the public repo — users and the repo see the same story.
- **Docs-only changes trigger zero workflow runs** — the pipeline's cost floor is guarded at the trigger level, with change detection as belt-and-braces.

## Environments at a glance

| | dev — swu-dev-jbapps | prod — swu-prod |
|---|---|---|
| Deploys | Automatic on merge to main | Owner-gated promote (or all-risk:low auto) |
| Front door | `swu-dev-jbapps.web.app` | `www.hyperspacevault.com` (apex 301; legacy domain a permanent 301 since 2026-07-30) |
| Cloud Run max instances | 1 | 3 — bounds worst-case cost of flooding the anonymous catalog endpoints |
| Cloud SQL tier | db-f1-micro | db-g1-small (applied and live-verified 2026-08-01) |
| Deletion protection | Off | On |
| Alerting | 8 policies (doubles as a canary for alert config) | 9 policies — adds custom-domain uptime |

Local development mirrors the cloud shape with Docker Compose: Postgres 16, the backend (auto-migrating on start), the Vite dev server, and a Firebase Auth *emulator* — so a laptop needs **zero GCP credentials**, and row-level security is exercised identically in local, CI, and prod because the same migrations create the same restricted role everywhere.

## Cost and operations posture — chosen, not defaulted

- **Scale-to-zero everywhere**, bounded above (3 prod / 1 dev instances), with a $50/month billing budget alerting at 50/90/100%. The budget is deliberately managed outside Terraform so CI's cloud identity never holds billing permissions.
- **Uptime checks probe the direct backend URL, not the CDN** — a cached front door would happily serve hits long after the backend died. A second prod-only probe covers the real domain so DNS/TLS/Hosting failures aren't invisible either.
- **Zonal database, no HA** — accepted at current scale, with backups + 7-day point-in-time recovery. Stated RPO ≤ 1h / RTO ≤ 4h — validated: restore drills were performed in both environments (dev rehearsal 2026-07-30, prod drill 2026-08-01) with roughly 26× RTO headroom.
- **Rate limiting is in-memory per instance** (no WAF) — proportionate to current traffic; the instance cap is the backstop against abuse of the anonymous surface.

> **Known drift, stated on purpose** (an as-built diagram should say so): Google sign-in is enabled in the console but not yet declared in Terraform — a tracked backlog item, not a surprise. (Two earlier drift items resolved since this view was first prepared: the prod database tier upgrade was applied 2026-08-01, and the legacy domain became a permanent 301 on 2026-07-30.)

---

*Prepared 2026-07-28, updated 2026-08-16 from the as-built system; companion views: [Conceptual](Architecture_Conceptual.md) · [Logical](Architecture_Logical.md)*
