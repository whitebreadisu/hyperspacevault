# ADR-0037: The verification gate replaces the hand ladder; what promotes without the word

## Status
**Accepted — 2026-10-28 (owner sitting, as recommended).** Implements charter decision D6 Phase 2 (autonomy rung R1, "release train") and D5 (the suites become the gate). Amends ADR-0007 §Decision item 4 (prod promotion behind a gate: the gate is now the verification suites, not a reviewer) and ADR-0017's L1 pipeline behaviour (the `risk:low` fast path now waits for the gate). Leaves ADR-0017's taxonomy, fail-closed defaults and the BL-96 whole-build guard unchanged.

## Context
Prod promotion today has two paths (Platform Spec §2.6). The **dispatch** path: the owner, or Claude under the standing "promote it" rule, runs `promote-prod.yml` with a SHA; the workflow checks CI, the release notes and the docs, then migrates, applies terraform, deploys, curls `/health` and `/api/sets`, and moves `prod-current`. The **fast** path: a merge whose every unpromoted commit carries `risk:low` (ADR-0017 L1, BL-96 guard) promotes in-pipeline with no human.

Behind both paths the only automated verification of a deployed environment is that curl. Everything else that says "the product still works for a user" and "the platform still enforces what it claims" has been a **hand ladder**: six steps in the `promote-prod` skill (smoke green, `health_check.mjs --expect`, `prod-current` equals the SHA, the Release exists, the served chunk carries the notes entry, one feature spot-check), plus the owner's own look. Every auth, isolation, rate-limit and header test runs in-process against a test client; none has ever run against `www.hyperspacevault.com` (`WS3_Inventory_Platform_Claims_2026-10.md`, private).

The owner's word, "promote", has therefore been doing two jobs: **approving** a release and **standing in for verification** that did not exist as code. WS-3 builds the verification (journeys on both layouts, platform assertions, a seeded verification tenant per environment). This ADR decides what the word means once the ladder is code, and what may ship without it.

## Decision

**1. Two automated checks, named.**
- **G, the promote gate.** Runs in `promote-prod.yml` after the docs gate and before terraform, against **dev**, which already runs the promoted SHA (build once, ADR-0007): (i) `ci_gate.sh` additionally requires `deploy-dev` success for the SHA; (ii) assertion A06 proves dev serves this SHA; (iii) the seed resets the dev verification tenant; (iv) the journeys J1–J7 run on `phone-390` and `desktop-1440`; (v) `platform_assert.mjs --env dev` runs every applicable assertion. Any assertion FAIL, or any journey failing twice, stops the workflow before terraform touches prod.
- **P, the post-promote check.** Runs after the composite action's smoke step, against **prod**: the seed (inside the prod verification tenant only), the `@smoke` journey J2 on both layouts, `platform_assert.mjs --env prod`. A failure fails the workflow, comments the failing lines on the rolling health issue and `@`-mentions the owner. **No automatic rollback in Phase 2**: rollback remains a dispatch of the previous `prod-current` SHA, by the recipe.

Both callers of the composite action (dispatch and fast) run G and P. The six-step ladder becomes the fallback the skill keeps for the day the job is unavailable.

**2. The fast path keeps its criteria and gains the gate.** `promote-prod-fast` still requires the merged PR's `risk:low` label and `build_clean` from the BL-96 guard, and now runs G first. This is R1's first form and needs no new label.

**3. A weekly release train for gated work the owner has pre-cleared.** A scheduled workflow (`release-train.yml`, every Tuesday at 09:00 America/Chicago, also dispatchable; the cron `0 14 * * 2` is UTC, so it is 09:00 in CDT and 08:00 in CST after the November clock change, an accepted drift) promotes `main`'s head when **all** of the following hold; otherwise it exits with a readable reason and promotes nothing:
- every unpromoted commit (`prod-current..HEAD`) carries `risk:low` **or** the new label **`risk:train`** — unlabelled work still waits for the word, so ADR-0017's fail-closed default stands;
- `risk:train` means, by the PR author's claim in the description: L2 work (not L3), with no destructive migration (no `DROP`, no data rewrite), no terraform change, and verified on dev by the author or the reviewer; disagreement resolves downward, as in ADR-0017 rule 3;
- the release-notes entry at `HEAD` is **newer than `prod-current`'s** and dated within the last **7 days** (the train relaxes the "promote-day date" rule of the notes gate for its own runs only; the dispatch path keeps the same-day rule);
- G passes.
P runs after. **Two consecutive train halts** (G or P red) disable the schedule through a repository variable until the owner re-enables it.

**4. What still needs the word.** L3 work (ADR-0017); any migration that drops or rewrites data; any terraform change; a rollback; anything the train refused. For these the owner, or Claude under the standing rule, dispatches `promote-prod.yml`, which also runs G and P.

**5. The stop condition, in one sentence.** Any red probe halts the release that produced it before prod is touched (G) or pages the owner the moment prod differs from dev (P); nothing retries a wrong answer.

**6. Measures for the R1 experiment report** (`planning/foundation/experiments/R1_release_train.md`, private): promotes per week by path (dispatch / fast / train); G catches and P catches with their probe ids; false stops (a halt later judged wrong) and their cause; merge-to-prod time by path; owner minutes per promote; the owner's own account after the first supervised train run.

## Consequences
- + The owner's word now means approval, not verification. A release the owner did not watch has the same evidence behind it as one they did.
- + The autonomy ceiling moves by editing this table (which label, which rule), with the gate as the floor under every path, which is the "edit the table, ratify, observe" loop ADR-0017 asked for.
- + Fail-closed is preserved: unlabelled work waits; a missing `deploy-dev`, a stale notes entry, or a red probe refuses the promote with a readable message.
- − A promote now takes about five minutes longer (G) plus three (P). Accepted: that time was the hand ladder's, and it was paid by a person.
- − `risk:train` is a second human-judged label, with the mis-claim risk ADR-0017 already carries for `risk:low`. Mitigations: the criteria sentence in the PR description, the train performs its own lineage check over `prod-current..HEAD` for both labels (the fast path's BL-96 guard is unchanged and still requires `risk:low` alone), and G itself, which is the check a mis-claim would have to pass.
- − The train's 7-day notes rule means a train release can ship an entry dated up to a week earlier. Accepted, because the alternative is an entry no one can date in advance; the Release mirror carries the actual promote time.
- − Relaxing the notes-date rule for the train means the notes gate has two modes; `release_notes.mjs gate` gains a `--train` flag and a test for each mode, and controls-register row 1 is updated.

## Owner decisions at the sitting (2026-10-28, "as recommended on all six")
- Item 2 (gated fast path) in Phase 2: **yes**
- Item 3 (`risk:train` + weekly train) in Phase 2: **yes** (the R1 experiment proper)
- Train day and hour: **Tuesday 09:00 America/Chicago** (cron `0 14 * * 2` in CDT; the UTC cron drifts one hour in winter)
- The 7-day notes rule for train runs: **accepted**
- Paging channel for P: **GitHub mention on the rolling health issue**

## Follow-ups
- A separate rollback waiver input is an open owner call: `allow_stale_notes` also waives the notes and docs gates, so one input does two jobs for a rollback.
- The train writes `RELEASE_TRAIN_HALTS` / `RELEASE_TRAIN_PAUSED` with a repository secret (`RELEASE_TRAIN_ADMIN_TOKEN`, Variables write); the workflow's own `GITHUB_TOKEN` cannot write repository variables.
- A train whose head is docs-only (no image, no dev deploy) holds rather than promoting the newest promotable ancestor, and a hold is never a halt. Promoting the newest ancestor that has an image is an open owner option.
- `promote-prod.yml` gains a boolean input `train` (default false) set only by the train; its one effect is the notes gate's `--train` mode.
