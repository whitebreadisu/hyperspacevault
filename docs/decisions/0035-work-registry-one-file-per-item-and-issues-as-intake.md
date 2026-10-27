# ADR-0035: Work registry as one file per item; GitHub Issues as intake only

## Status
Accepted — 2026-10-27 (owner decisions D1, D2 and D3 of 2026-10-26 in the Foundation Program walkthrough, BL-279; the implementation merged 2026-10-27 in PRs #307, #308 and #309). Amends ADR-0020 (see "Amendments to ADR-0020" below).

## Context
The work registry was one file, `SWU_Backlog.md`, and by 2026-10-26 it was too large for a session to read: **190 KB, 1,413 lines, 69 open items, 210 tombstone rows** (charter `Foundation_Program_2026-10-26.md` §2, measured 2026-10-26; the tombstone count re-measured against the archive headings on 2026-10-27, `WS1_BUILD_LOG.md` stage 1a). Its six-tier structure dated from 2026-06 and no longer described the work; two regex parsers (the backlog dashboard and `docs-check --private`) each re-derived structure from heading and field conventions in one large file. Filing or resolving one item meant editing a 190 KB file, and 40 of the 69 items had no GitHub issue under the 2026-07-10 cutoff rule (charter §2), so the issue/board mirror was already partial.

The registry's purpose is to be read by agents at the start of a session and updated at the end of one; the form was the cost.

## Decision
**D1 — one file per item.** A folder, `specification_documents/backlog/` (private layer), holds one markdown file per item, named by id (`BL-<n>.md`; open questions are `Q-<letter>.md` with type `question`). Frontmatter keys are defined by `_schema.json`: `id`, `title`, `status`, `area`, `type`, `priority`, `filed`, `workstream`, `related`, `feedback`, `public`, `source` (plus `resolved`, `public_line` and a few optional keys). The body is the narrative exactly as before, verbatim. The six tiers are retired; the workstream and area fields replace them. Generated artefacts: `INDEX.md` (open work, max id on line 1), `TOMBSTONES.md` (every resolved id), a local HTML view, and a public `ROADMAP.md` of the items carrying `public: true` (title and one line only). Archiving is moving the file to `backlog/archive/`; the tombstone index is generated from the archive folder plus `_legacy_tombstones.json` (frozen data for the 210 ids resolved before the migration). The parser is one module, `registry.mjs`, which both the view generator and `docs-check --private` import.

**D2 — Issues are public intake only; no mirror.** Board #1 is retired (BL-279's card is the last one ever added), the Projects tab is turned off and milestones are dropped. GitHub Issues stay enabled as zero-maintenance public intake with bug-report and feature-request templates and a short `CONTRIBUTING.md`. The direction signal for visitors is the generated `ROADMAP.md`; private narrative never leaves the private layer. The issue/board ritual ended 2026-10-26: a new item is a registry file and no issue. An issue mirror is parked with a trigger: generate one only when a GitHub-driven agent (hosted or cross-model, rung R4) needs issues as its task input. The owner's reasoning, from charter §6 D2: "the repo is a portfolio piece; the signals a visitor weighs are README, badges, releases, cadence and HISTORY — not the issues tab; an abandoned look comes from stale issues, not few issues."

**D3 — full disposition pass, retire-by-default.** One table with one row per open item and a recommended disposition from a fixed set (absorbed into a workstream / stays / closed — already done / retired — superseded / retired — not wanted now); the owner reviews it in one sitting and claims what to keep. Old, unbacked (no feedback marker) and unclaimed items retire; feedback-backed and workstream-absorbed items survive by definition. Retire is a verbatim archive plus a tombstone, revivable by moving the file back. The table and its outcome are in `WS1_Disposition_2026-10.md` (private).

## Consequences
- + Listing open work reads `INDEX.md`, not 190 KB; filing an item touches one small file; the parser class changes from a regex state machine to schema validation (WS-1 metrics are in `WS1_BUILD_LOG.md`).
- + The migration is proven, not asserted: `registry.mjs --roundtrip all` re-renders every migrated entry against its legacy text: "76 checked, 76 identical (74 byte-exact, 2 whitespace-normalised), 0 differ" (`WS1_BUILD_LOG.md`, stage 1b). Filing dates came from the entry itself for 35 files, from git history for 3, and from the archive for 38.
- + Sessions use the `file-item` and `resolve-item` skills; the next id is computed by `registry.mjs max-id` over the folder, the archive folder and the legacy ids, which replaces the "check both remotes for the max id" sentence.
- + The internal pre-commit hook (`.claude/hooks/internal_pre_commit.sh`) runs `docs-check --private` whenever the folder is staged: schema, done/retired-in-active, archive and legacy tombstone consistency, and freshness of `INDEX.md` and `TOMBSTONES.md`. Public CI cannot see the private folder, so there `--private` degrades to the note "backlog registry absent in this tree; nothing checked". `ROADMAP.md` freshness is therefore a trusted ritual step of the two skills, not a machine check (Platform Spec §2.8).
- + The dual-repo setup document gains the registry lines: the public repo excludes the folder, and the internal repo needs `specification_documents/backlog/** text eol=lf` in `.git-internal/info/attributes`.
- − Cross-references to items resolve by filename and through two generated indexes instead of one scroll; the generated files must be regenerated on every item change (the hook enforces it for `INDEX.md` and `TOMBSTONES.md`).
- − No board and no issue per item: execution tracking is the registry plus the PR trail. Accepted by D2.

## Amendments to ADR-0020
Amended by ADR-0035 (2026-10-27). ADR-0020's text stays as written; for the backlog these readings supersede it:
1. **Tier 1 backlog form.** The "active backlog" in Tier 1 is the registry folder (`backlog/`, entry point `INDEX.md`), not a single file.
2. **Archive-by-move.** For items resolved from 2026-10 onward the archive is the folder `backlog/archive/`: the resolved item file moves there verbatim. `SWU_Backlog_Archive.md` is frozen as Tier 3 (it additionally holds the superseded single-file preamble, appended once during the migration).
3. **Tombstone index generated.** ADR-0020's 2026-10-18 amendment kept the tombstone table by hand at the end of the active backlog; it is now `TOMBSTONES.md`, generated and never hand-edited (rows for legacy ids come from the frozen `_legacy_tombstones.json`).
4. **At-resolution archiving is mechanical.** Standing rule 2 ("flipping an item ✅ includes the verbatim move to the archive and the tombstone in the same session") now runs through `resolve-item` plus the pre-commit hook rather than discipline alone.

## Alternatives considered
- **Keep one file and add a tombstone table or more structure.** Rejected: ADR-0020's 2026-10-18 table cut tombstone bytes to roughly a third, but the file still read at 190 KB and still needed regex parsing; the cost was the single-file form.
- **GitHub Issues as the registry.** Rejected: the registry is private narrative (analysis, owner reasoning, unfiled ideas) that must not sit on a public repo, and D2's reasoning is that the issues tab is not a signal the project wants to maintain.
- **A database or app.** Rejected: agents and the owner already work in files under git, and the round-trip proof and the pre-commit hook need plain files; an app would add a service to run for a one-user ledger.

## References
- Charter: `specification_documents/planning/Foundation_Program_2026-10-26.md` §2, §6 D1–D3 (private).
- Briefs and logs: `planning/foundation/briefs/WS1_Work_Model_Brief.md`, `planning/foundation/build_logs/WS1_BUILD_LOG.md`, `planning/foundation/reviews/WS1_1b_review.md` (private).
- PRs: #307 (docs-check private mode over the registry), #308 (comment-check, D4), #309 (daily health-check routine, R3).
- Registry item: BL-279 (Foundation Program). Controls: Platform Spec §2.8 (rationale ADR-0033).
