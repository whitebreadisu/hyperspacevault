# ADR-0021: Hybrid environment model — persistent minimal `swu-prod`, ephemeral `swu-sandbox`

## Status
Accepted — foundational P1 choice; recorded retroactively 2026-08-17 (BL-233 rationale extraction from Platform Spec §3.13.1)

## Context
The platform serves two masters: a solo, low-traffic, cost-sensitive hobby app
that must stay cheap to run forever, and a learning vehicle whose stated
go-deep area is cloud infrastructure. Infrastructure patterns worth hands-on
time (VPCs, load balancers, multi-zone, and later a possible GKE spike —
ADR-0009) are exactly the ones that are expensive or noisy to keep running
permanently. One environment cannot be both minimal and exploratory.

Alternatives:
- **One project for everything** — exploration inflates the production
  environment's cost and complexity, and tearing experiments down risks the
  serving app.
- **Full parity environments** — sandbox tracking prod's every addition
  doubles cost for no learning benefit; parity is what `swu-dev` later
  provided where it actually matters (ADR-0006).

## Decision
Run **one always-on, deliberately minimal production project** (`swu-prod`,
the thing serving `www.hyperspacevault.com`) plus a **separate ephemeral
project for infrastructure exploration** (`swu-sandbox`). The sandbox
deliberately does **not** track prod's P2–P7 additions; it remains at its
P1-bootstrap state by design and exists to be torn up.

## Consequences
- **+** Real production stays low-cost and quiet; experiments can be noisy,
  expensive-for-an-afternoon, and safely deletable.
- **+** Gives later decisions an escape hatch — ADR-0009 routes any GKE
  learning spike to the sandbox precisely because this split exists.
- **−** The sandbox rots by design: nothing in it reflects current prod, so
  it teaches patterns, not this system.
- **−** A third project to remember in IAM/billing hygiene sweeps.

**Related:** ADR-0006 (dedicated `swu-dev` — the parity environment this
model deliberately isn't), ADR-0009 (sandbox as k8s spike ground). Original
prose: Platform Spec archive (§3.13.1, extracted 2026-08-17).
