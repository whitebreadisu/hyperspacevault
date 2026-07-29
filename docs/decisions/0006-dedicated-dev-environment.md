# ADR-0006: Stand up a dedicated `swu-dev` cloud environment (new project, not repurposed sandbox)

## Status
Accepted — 2026-06-27. **Implemented** (status corrected 2026-07-24, BL-150 W1): BL-43 (Stage 1 of `SWU_Platform_Roadmap.md` §7) fully complete 2026-06-28

## Context
The delivery pipeline today is **local → prod only** (`SWU_Platform_Roadmap.md`). There is no deployed cloud tier between the local Docker stack and production, so an entire class of failures is only ever caught in prod: managed Cloud SQL behavior (IAM-authenticated proxy connections, `alembic upgrade head` on cold start), Cloud Run cold starts, the real Firebase Auth / Identity Platform (not the local emulator), RLS/tenancy under pooled connections, and Secret Manager wiring. A cloud **dev** environment exists to catch that class before users do, and is the prerequisite for letting agents validate work somewhere realistic before prod (Stage 1 of the agentic roadmap).

A `swu-sandbox` GCP project already exists, but two facts shape the decision:
- **It was named and intended as a true *sandbox*** — a place to experiment with things not on the roadmap (e.g. load balancing) — not as a dev tier. Its name should reflect its purpose.
- **It is bootstrapped but bare:** it has the baseline APIs, the Workload Identity pool/provider, a `terraform-ci` service account, a state backend, and providers — but **no app stack** (no Cloud SQL, Cloud Run, secrets, Firebase, etc.) and therefore no state worth preserving.

The naming intent runs into a hard platform fact: **GCP project IDs are immutable.** A project's *display name* can change, but the ID `swu-sandbox` is permanent — and it is baked into the Firebase Hosting URL (`swu-sandbox.web.app`), the state-bucket convention (`swu-sandbox-tfstate`), and the WIF principal path. So a true "rename to `swu-dev`" is impossible; only creating a new project yields a project that genuinely *is* `swu-dev`.

Options genuinely considered:
- **(A) Repurpose `swu-sandbox` as the dev environment.** Reuses the existing bootstrap (least work), but the project ID and all derived identifiers permanently say "sandbox," and it consumes the sandbox slot intended for future experimentation — the exact name-vs-purpose mismatch we want to remove.
- **(B) Create a new `swu-dev` project; leave `swu-sandbox` dormant** for its original experimentation intent.
- **(C) No dedicated environment (status quo).** Rejected — it leaves the dev≠local failure classes uncaught and blocks the agentic roadmap.

## Decision
Adopt **Option B** — create a new `swu-dev` GCP project for the dev environment, and leave `swu-sandbox` dormant (and free) for the load-balancing-style experimentation it was named for. The existing `terraform/environments/sandbox/` bootstrap files become the **template** for `terraform/environments/dev/`, pointed at `swu-dev` with a `swu-dev-tfstate` state bucket.

## Consequences
- **+** The project ID and every derived identifier (`swu-dev.web.app`, state bucket, WIF path) genuinely mean "dev" — purpose and name align, permanently and correctly.
- **+** Preserves a real sandbox slot for future experiments at **zero cost** — idle/empty GCP projects don't bill.
- **+** **No state migration** — sandbox has no app stack or app state, so this is greenfield, not a move.
- **+** Low-risk standup — the sandbox bootstrap (`.tf` for baseline APIs, WIF, `terraform-ci` SA, IAM) is a proven template to copy and re-point.
- **−** A one-time **re-bootstrap** is required (create project, link billing, create the state bucket, then `terraform apply` the bootstrap) rather than reusing sandbox in place.
- **−** **Bootstrap chicken-and-egg:** the Terraform GCS state bucket must exist *before* the first `terraform init`, so standing up the project needs a small manual/scripted pre-step that Terraform cannot do for itself.
- **−** Two more projects in the org to keep an eye on (mitigated: dormant sandbox is free and unmanaged).

**Related:** BL-43 (implementation), ADR-0007 (the deploy model that ships to this environment), `SWU_Platform_Roadmap.md` §7 Stage 1, `docs/decisions/agentic-platform-concepts.md` (§1–3: environment ladder, dev vs. local failure classes, GCP project ID immutability), `project_platform_generator_idea` (the shared-module extraction in BL-43 is its validation step).
