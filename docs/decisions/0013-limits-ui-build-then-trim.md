# ADR-0013: Trim the inventory-limits UI to a three-way enforcement control (build-then-trim)

## Status
Accepted — 2026-07-13. Partially reversed on its own terms by
[ADR-0018](0018-category-level-cap-precision-restore.md) (2026-08-01):
numeric precision restored at category granularity on user demand.

## Context
The inventory-limits arc (BL-24/25/35, PRs #241–#244) was built end-to-end in one day by three Sonnet build agents under Opus orchestration: per-tenant keep-limit overrides keyed by type-category × curated bucket (15 buckets × 2 categories), a "No limit" first-class value, a 999 technical ceiling, hard/soft enforcement modes, a 30-cell settings grid, and 75 net-new tests. Everything reached the dev environment fully verified. Nothing reached prod — the per-PR promote gates were deliberately batched.

Mid-arc, the product owner raised the question the batching made safe to ask: *"just because I can, should I?"* His actual felt need — stated twice, independently — was "let users treat limits as soft, or remove them entirely," not per-bucket numeric precision. The 53-then-75 new tests were read correctly as a proxy for the state space the precision surface adds: every user-visible degree of freedom is owned forever, through every redesign (a full screens redesign was already queued). The era-specific force: **agents lowered the cost of building, but not the cost of owning** — so the decision gate has to sit at *shipping*, not at *building*, and building-to-learn-then-deciding is now a viable, cheap workflow.

Alternatives genuinely considered, priced by technical debt species:
- **Ship everything** — no drift debt, but recurring UI-coupled carrying cost: the 30-cell grid must survive every settings redesign (starting with the queued one), and classification-rule changes silently re-bucket configured limits, a semantics burden owed to users indefinitely.
- **Full shelve (revert the arc)** — zero end-state debt, but a sharp one-time operational trap (dev DB at migration 0026 vs. reverted code knowing 0024 — startup `alembic upgrade head` fails on unknown revisions, so DB surgery must sequence with the revert), loss of the #244 purge guardrail with its tables, and full artifact decay: the queued redesign rewrites the touched surfaces, so the shelf becomes a re-implementation. Also contradicts the owner's stated want of the soft-lock.
- **Hide the grid behind a flag** — rejected outright: dark code, a UI nothing exercises, the worst debt species.

## Decision
Keep the backend contract whole and unchanged (tables, RLS, endpoints, enforcement, ceiling, all tests); **delete** the per-bucket grid UI and replace the settings section with a single three-way control — **Hard cap / Soft cap / No limits** — where Hard/Soft map to `cap_mode` with an empty override set and "No limits" writes the all-null override set through the existing full-replacement PUT. The per-bucket backend thereby stops being speculative generality and becomes the load-bearing plumbing of the simple control. Grid tests are retired with recorded reasons; the grid remains one `git revert` away, anchored by a live, tested API contract.

## Consequences
- + The product ships the feature the owner actually believes in, with the smallest ownable surface (~3 states vs. ~30 cells × modes).
- + The queued screens redesign no longer includes a grid; the card-popup redesign only needs three max states (1/3 default, soft-amber, ∞).
- + Re-enabling precision later is a UI restore against a contract that never left — cheap, unlike the full-shelve's re-implementation.
- + The #244 rule survives: every tenant-owned table joins `purge_tenant` + its regression test.
- − Two tables and a full per-bucket API remain in prod with no UI exercising their generality; the API surface must stay correct (its pure tests are cheap, but it is surface).
- − API-era per-bucket overrides (possible via direct PUT) display as their cap_mode and are wiped the next time the control saves — the control owns the contract; precision via API is unsupported-but-possible.
- − ~30 grid tests retired; the state-space knowledge they encoded lives only in git history and this record.
- − The build cost of the precision UI is sunk. Accepted knowingly: it bought the load-bearing lesson (ship-gate placement in agentic workflows) and the verified backend.

Related: BL-24/25/35 (backlog, resolved with trim addendum), BL-108 (settings-mutation auth gate question), Learning Guide "Inventory Limits Arc" chapter (Selection & Comparison + the ownership-cost coaching record), session notes 2026-07-12/13.
