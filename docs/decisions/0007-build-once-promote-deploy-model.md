# ADR-0007: Build-once / promote deploy model with a gated prod release (staging deferred)

## Status
Accepted — 2026-06-27. **Implemented** (status corrected 2026-07-24, BL-150 W1): BL-43 (Stage 2 of `SWU_Platform_Roadmap.md` §7) fully complete 2026-06-28. **Amended by ADR-0037 (2026-10-28):** decision item 4's gate is now the verification suites (promote gate G and post-promote check P), not a reviewer

> **Update 2026-07-15 (BL-131):** the decision stands, but the human gate's *mechanism* changed. The GitHub Environment required-reviewers rule died when the repo went private (Enterprise-only on private repos), so the gated in-pipeline `promote-prod` job was replaced by an explicit `promote-prod.yml` `workflow_dispatch` (promote a stated main SHA; build-once semantics unchanged; `risk:low` fast path unchanged). Current mechanism: `SWU_Platform_Spec.md` §2.6.
> **Update 2026-07-29 (BL-172):** the repo is public again (environment protection is available once more); the `workflow_dispatch` mechanism is retained by owner decision — see §2.6.

## Context
With a dedicated dev environment decided (ADR-0006), the question is *how code flows to environments.* Today `.github/workflows/ci.yml` **rebuilds the backend image on deploy** and is hardcoded to `swu-prod`, with deploy gated on `push` to `main`. Adding a dev tier forces a deliberate choice of delivery model.

Two models were considered:
- **(A) Branch-per-environment** — a long-lived `dev` branch deploys to dev, `main` deploys to prod; **each branch builds its own image.**
- **(B) Build once, promote the artifact** — short-lived feature branches merge to trunk (`main`); on merge the image is built **exactly once**, auto-deployed to dev, then the **same SHA-tagged image** is promoted to prod behind a manual approval.

The industry consensus (DORA/*Accelerate*, Google "Modern CD", the CD Foundation) is firmly Model B, resting on a near-universal law: **build the artifact once, then promote that same artifact through environments — never rebuild per environment.** If dev and prod each build their own image, the thing tested in dev is not bit-identical to the thing shipped to prod (dependencies/caches drift), which defeats the purpose of having a dev tier. Supporting practices: trunk-based development (long-lived branches are legacy for CD) and treating environments as a deploy-time concern, not a branch.

A **staging** tier was also considered and explicitly weighed against the principle *"a tier earns its place only when it catches a failure class no other tier catches."* Staging's distinct value (prod-fidelity validation of a specific candidate, a stable QA/UAT target, prod-scale migration/perf rehearsal, real prod-like integrations, release-mechanics rehearsal) maps to circumstances that **do not yet exist here**: solo→maybe-two-dev, single app, tiny data volume, no heavy integrations, pre-v1.0 with no real users. The cheaper next increment when pre-exposure validation *is* needed is **Cloud Run revision traffic-splitting (canary)**, not a third environment.

The prod approval gate is also load-bearing for the agentic roadmap: it is the enforced human-in-the-loop boundary that lets agent autonomy increase without prod risk increasing in lockstep (Agentic Platform Evolution, principle 2).

## Decision
Adopt **Model B — build once, promote the artifact**, right-sized:
1. Trunk-based: feature branch → PR → `main`.
2. On merge to `main`: build the backend image **once**, push SHA-tagged to Artifact Registry (as today).
3. **Auto-deploy that image to `swu-dev`** and run smoke checks.
4. **Promote the same SHA to prod behind a GitHub Environment (`production`) required-reviewer gate**, with prod-only secrets scoped to that environment.

**Reject Model A (branch-per-env)** — it violates build-once. **Defer staging** until its triggers fire (real users + prod-scale data; a stable UAT target; prod-like integrations; canary/blue-green adoption; or autonomous agent merges wanting an automated prod-fidelity gate); reach for **Cloud Run canary** before a staging tier. Apply **plan-safe / apply-gated** for Terraform: agents/CI may run `terraform plan` freely; `terraform apply` to prod is human-gated, with the plan as the approval artifact.

## Consequences
- **+** The tested artifact and the shipped artifact are the **same bytes** — the core safety guarantee of having a dev tier.
- **+** Trunk-based avoids long-lived-branch merge overhead.
- **+** The prod gate is the human-in-the-loop boundary that **enables** progressive agentic autonomy (decouples agent-scope from prod-risk).
- **+** Cleaner CI than two parallel hardcoded pipelines: build once, two deploy jobs consume the same tag.
- **+** `plan`-as-approval-artifact gives agents a safe, useful role on infra changes without unattended `apply`.
- **−** More setup than branch-per-env (a gated promote job + GitHub Environments config + parameterizing the prod-hardcoded workflow).
- **−** **New discipline:** `main` stops being where you work directly — it becomes "promote validated dev"; the prod promote is a deliberate, separate step. Direct push-to-`main`-ships-to-prod ends.
- **−** No staging means **no prod-fidelity / prod-scale rehearsal tier** yet — accepted; triggers are documented so the gap is deliberate, not forgotten.
- **−** The gate becomes **theater if rubber-stamped** — it must be genuinely exercised or the change class formally moved to auto-promote.
- **−** How far the human gate can later thin is **bounded by detection + rollback maturity** (P6 observability + Cloud Run revision rollback are the levers).

**Related:** BL-43 (implementation), ADR-0006 (the `swu-dev` environment this ships to), `SWU_Platform_Roadmap.md` §7 (principles 2/3/5/6; Stages 2–4), `docs/decisions/agentic-platform-concepts.md` (§4–9: build-once comparison, staging triggers, gate mechanics, autonomy concepts).

---

**Amendment 2026-10-12 (BL-256) — every test job gates every deploy.** The post-merge chain had grown a gap: the mobile Playwright job (`frontend-e2e-mobile`, added by BL-247) was required by the PR's `ci-ok` check but not by `detect-changes`, so a main push built and deployed dev while that suite was still running, and the `risk:low` fast promote inherited the same chain. Two rules now hold: (1) `detect-changes` (and so `build-and-push`, `deploy-dev`, `promote-prod-fast`) needs every test job, not a subset — a new test job is added to that `needs` list in the same PR that creates it; (2) `promote-prod.yml` independently verifies the promoted SHA's own main-run check runs (`.github/scripts/ci_gate.sh`) before anything moves, because branch protection proves only the PR's checks, not the merged commit's. Found by an external repo review (2026-10-12); confirmed live on `7d984df`.

**Amendment 2026-10-12 (BL-260) — the mobile e2e gate is sharded behind a stable name.** The phone Playwright suite took ~25 min as one job (summed test time 49 min over 2 workers), making it the long pole of every PR and every deploy. It now runs as a five-leg matrix (`e2e-mobile-shard`) split by Playwright project (`phone-390` and `phone-430` halved with `--shard=N/2`, `scan` + `desktop-1440` together; a plain `--shard=N/4` was rejected because project-ordered chunks left one leg with almost only self-skipped desktop tests) that starts alongside `frontend` instead of after it, and the required check name `frontend-e2e-mobile` is kept by a small aggregator job that succeeds only if all shards succeeded and is skipped exactly when the suite is skipped. The BL-256 rules hold unchanged: `detect-changes` and the rest of the chain need `frontend-e2e-mobile`, and `ci_gate.sh` still verifies it on the promoted SHA; a gate that is split across jobs must keep one stable aggregate name so those consumers never change. Why: CI wall time 30 min toward a target under 15 min (issue #227); public-repo runner minutes are free, so parallelism costs nothing.

**Amendment 2026-10-13 (BL-255) — one CI retry for the phone e2e suite, with flaky tests reported.** Five of ten recent CI runs were red on a first attempt, each on a different phone test, each green on re-run; a required gate that fails at random blocks merges and deploys without telling anyone anything. The suite now gets exactly one automatic retry in CI (`retries: 1` when `CI` is set; local runs keep zero). A test that fails and then passes is not a failure of its leg, but it is never hidden: each leg's job summary lists it (project, spec:line, title, first error of the failed attempt) and the run carries a `::warning::` annotation per flaky test, with the JSON report uploaded as an artifact. A test that fails twice still fails the leg. The `frontend-e2e-mobile` aggregator, `ci-ok` and `ci_gate.sh` are untouched, since a pass-on-retry leg concludes `success`. Flaky tests stay visible and tracked on issue #214 rather than being absorbed silently.
