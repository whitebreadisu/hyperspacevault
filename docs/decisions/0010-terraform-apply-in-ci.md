# ADR-0010: Run `terraform apply` in GitHub Actions (hand-serialized), not a dedicated Terraform automation platform

## Status
Accepted — 2026-07-08 (records the status-quo CI apply choice explicitly, per the 2026-07-08 platform retrospective)

## Context
Terraform is the IaC tool (`SWU_Platform_Roadmap.md` §2). A separate question — never recorded as its own decision — is *what runs `apply`.* The concurrency pain this setup has already paid for (BL-79, RR-6/F28) makes it worth an explicit ADR.

Options:
- **(A) `terraform apply` directly in GitHub Actions** — the CI we already own, authenticated via WIF (keyless), with concurrency controlled by workflow config. State locking comes from the GCS backend (platform spec §3.2).
- **(B) A dedicated Terraform automation platform** — Terraform Cloud / Spacelift / Atlantis — providing plan-as-PR-comment, managed state locking, drift detection, policy-as-code (Sentinel/OPA), and a native apply-gating UI.

Model B is the "enterprise" answer and the closest native fit to the *plan-safe / apply-gated* principle (`SWU_Platform_Roadmap.md` §7 #6). But it introduces a third-party control plane — a new account, a new auth surface, another vendor in the deploy path — for a **single-repo, two-environment, solo** project.

Model A's cost is real and already being paid: because `apply` runs in CI, concurrent `main`-branch runs can race on the GCS state lock mid-apply. That is precisely why the RR-6 concurrency model exists (one group per ref; `main` runs **queue and are never cancelled**; at most one prod gate pends — platform spec §2.1) and why BL-79 preceded it. That serialization is a hand-rolled reimplementation of what a TF automation platform provides natively.

## Decision
Keep **`terraform apply` in GitHub Actions**, with the RR-6 concurrency model (one group per ref; `main` runs queue and are never cancelled) as the state-lock-safety mechanism. **Do not adopt a dedicated Terraform automation platform** at this scale.

## Consequences
- **+** One CI system, one auth surface (WIF) — no third-party control plane, no extra vendor account/secret in the deploy path.
- **+** State locking is already handled by the GCS backend; the RR-6 concurrency rules keep `main` applies serialized.
- **+** Consistent with the minimal-surface, keyless posture (WIF, incremental IAM) the rest of the platform holds (platform spec §3.4/§5.3).
- **−** The concurrency serialization is **hand-rolled workflow YAML, not a native guarantee** — it has already needed two rounds of work (BL-79, then RR-6) and remains a maintenance surface.
- **−** No native **drift detection**, no **plan-as-PR-comment**, no **policy-as-code** gate — capabilities a TF platform gives out of the box that this setup lacks.
- **−** `terraform apply` runs with the CI service account's full permissions inside a general-purpose CI runner — a broader blast radius than a purpose-built, audited apply control plane.

**Revisit if:** multiple repos/teams need shared TF workflows; drift detection becomes a real need; policy-as-code enforcement is wanted; or the hand-rolled concurrency model needs a *third* round of fixes.

**Related:** BL-79 (CI concurrency, issue #108), RR-6/F27–F29 (CI hygiene series), ADR-0007 (plan-safe / apply-gated deploy model), `SWU_Platform_Roadmap.md` §7 principle 6, `SWU_Platform_Spec.md` §2.1 (concurrency model) / §3.2 (GCS state backend).
