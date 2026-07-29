# ADR-0011: Run database migrations as a discrete deploy step, not on serving-container start

## Status
Accepted — 2026-07-08. **Implemented** (status corrected 2026-07-25, BL-150 W4/W5): BL-8/RR-10 shipped to dev 2026-07-25 (PR #433) — dev's `migrate` Cloud Run Job live-verified executing successfully 2026-07-25T05:32Z. Not yet proven in prod; the last prod promote predates this merge, so the prod half proves itself on the next promote.

## Context
`backend/Dockerfile`'s `CMD` is:
```
sh -c "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"
```
So `alembic upgrade head` runs on **every Cloud Run cold start**, before serving. (Historically the CMD also carried `--reload` and two seed/snapshot process spawns; **BL-8** (`fd507a6`, 2026-06-17) removed those and moved `apply_seed`/`apply_inventory_snapshot` into a FastAPI lifespan — but left `alembic upgrade head` on the CMD. This ADR closes the *second* half of BL-8's definition of done, which asked for the migration-on-start pattern to be "confirmed-and-documented as intentional **or** changed with a documented rationale" — neither had happened.)

Consequences of the current shape:
- With `max_instance_count = 3` (prod, platform spec §3.5), a scale-up event starts multiple containers concurrently, each racing on `alembic upgrade head`. Alembic serializes via the `alembic_version` row, but this has **not** been verified under Cloud Run scaling, and a non-idempotent migration under a lost race is a real (if low-probability) failure mode.
- A failing migration takes down the **serving** path (the container can't start), rather than failing a deploy step while the current revision keeps serving.
- Cloud Run revision rollback (the roadmap's "undo" lever, §7 #3) shifts traffic back to the old image but does **not** roll back schema — coupling migration to serving-start makes the schema change effectively un-undoable via the revision mechanism.
- Migrations run as `swu_user` (`DATABASE_URL`, `BYPASSRLS`) while serving runs as `swu_app` (`APP_DATABASE_URL`) — the two-engine split (platform spec §1.6) already separates these roles, so migration does not *need* the serving container to run it.

Options:
- **(A) Status quo** — `alembic upgrade head` on every container start.
- **(B) Discrete migration step in the promote pipeline (ADR-0007)** — run `alembic upgrade head` **once** against each environment's DB *before* the new Cloud Run revision takes traffic (a Cloud Run Job, or a CI step using the Cloud SQL connector); the serving CMD drops to just `uvicorn`.
- **(C) One-shot init container / startup hook** with external locking — more machinery than B for the same guarantee at this scale.

**Honest complication:** the on-start mechanism performed the real `swu-prod` tenant-#1 backfill in P4 and is the fresh-environment bootstrap. Moving to a discrete step means a brand-new environment's first deploy must run the migration step before/with its first revision, and backward-incompatible migrations now need explicit **expand/contract** discipline (during a rollout the old revision may briefly run against the new schema).

## Decision
Adopt **Option B**. Run `alembic upgrade head` as a **discrete deploy step per environment** in the promote pipeline (ADR-0007), before the new Cloud Run revision receives traffic; reduce the serving container `CMD` to `uvicorn app.main:app --host 0.0.0.0 --port 8000`.

`apply_seed`/`apply_inventory_snapshot` stay where BL-8 put them (the FastAPI lifespan) for now — `apply_seed` as a fresh-environment bootstrap safety net; `apply_inventory_snapshot` still slated for removal at the v1.0 clean-slate milestone (BL-8's deferral).

## Consequences
- **+** Eliminates the concurrent-cold-start migration race — migrations run **once per deploy**, not once per container.
- **+** A failed migration fails the **deploy step** while the current revision keeps serving — no serving outage from a bad migration.
- **+** Migration timing decoupled from cold-start latency.
- **+** Forces the expand/contract discipline for backward-incompatible migrations to be **explicit**, rather than accidentally masked by all-at-once container starts.
- **−** New CI/deploy complexity: a migration job per environment in the promote path, with correct ordering (migrate → deploy revision) — more moving parts in ADR-0007's pipeline.
- **−** Loses the "a fresh environment bootstraps its own schema on first boot" property; a new env's first promote must run the migration step explicitly.
- **−** Rollout window: during traffic shift the old revision can briefly serve against the already-migrated schema — backward-incompatible migrations now *require* expand/contract (arguably a **+**, since the on-start pattern papered over it).
- **−** Does not by itself provide schema rollback; that stays a separate concern (paired down-migrations or forward-fix) — just no longer entangled with revision rollback.

**Related:** BL-8 (implementation, shipped to dev 2026-07-25, PR #433), ADR-0007 (the promote pipeline this step slots into), `SWU_Platform_Spec.md` §1.6 (two-engine role split) / §3.5 (Cloud Run scaling) / §5.4 #2 (updated to the as-built state 2026-07-25), `SWU_Platform_Roadmap.md` §7 #3 (detect + undo maturity).
