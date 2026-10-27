# ADR-0036: Instruction-layer ownership and read-path budgets

## Status
Accepted — 2026-10-27 (owner decisions at the Foundation Program sitting of 2026-10-27, BL-279 WS-2: the three budgets, the ownership map and the journal split were accepted there). Amends the instruction-layer section of ADR-0017 by reference only; ADR-0017 is private and its text is untouched. Implements BL-279 W2-20; the assessment behind it is BL-272.

## Context
The standing read path, the bytes a session loads before its first work item, had grown to **33.9 KB**: `CLAUDE.md` 14,106 B, the memory index 19,531 B and a small lock line (`WS2_Metrics_Baseline_2026-10.md`, measured 2026-10-27, private). Two traces of that text found the following (both private, `specification_documents/planning/foundation/`):

- **62 trusted prose rules.** Of the rules the inventory lists, 62 are class `trusted`: nothing fails when a session forgets them (`WS2_Rule_Inventory_2026-10.md` §3–4). A rule that only exists as a sentence is followed on the days the session happens to attend to it.
- **69 % of lessons have no rule.** Of 351 logged lessons, 243 map to no rule on any surface; 22 of those live only on a non-rule surface (`WS2_Lesson_Rule_Trace_2026-10.md`). Lessons were being recorded and not converted.
- **One file did four jobs.** Rules, pointers, procedures and history shared a surface, so every addition made all of it slower to read and none of it more enforced.

## Decision
**Ownership map.** Each kind of instruction has one owner, and the budget makes the owner a constraint rather than a preference.

| Surface | Owns | Budget |
|---|---|---|
| `CLAUDE.md` | Project rules and pointers (aliases, the doc map, the session and repo rules) | 4,096 B |
| Memory (index plus files) | Calibration about the owner and current-arc state | index 6,144 B |
| Skills (`.claude/skills/`) | Procedures. A procedure becomes a skill once it has been done by hand twice with the same shape | per skill, loaded on demand |
| Hooks and CI | Enforcement. A new drift class gets a register row and a control (Platform Spec §2.8), not a `CLAUDE.md` sentence | none |
| Journal | Three files with named readers (below) | none |

The SessionStart injection (`session_context.py`: registry head, the resume pointer line, the session-lock line) is the third budgeted surface at **2,048 B**. The three budgets together keep the standing read path under 12,288 B.

**The journal is three files, each with a named reader** (W2-19). Session notes (`Session_Notes_<Topic>_<date>.md`) are the record, read by the next session. `Lessons_Log.md` is one line per lesson, read by sessions and by rule reviews. `Coaching_Log.md` is about the owner and is read by the owner only.

**Two harness metrics, measured per session.** (1) Lapses per session: ritual steps the session skipped or did wrong, counted by the `session-close` checklist. (2) Compactions per log: context compactions in a session's field log. Baseline, measured 2026-10-27: **0.00 lapses per session, 0.10 compactions per log** (`WS2_Metrics_Baseline_2026-10.md`). **Target: no increase over ten sessions while the read path stays under budget.** Each session appends one row to `planning/foundation/metrics/harness_rates.md` (private) at close; the numbers are re-read after ten sessions.

**Enforcement.** The budgets are the `budget` rule of `docs_check.mjs --private`, run by the private pre-commit hook on every ledger commit. It fails when `CLAUDE.md` exceeds 4,096 B, the memory index exceeds 6,144 B or the injection exceeds 2,048 B, and it prints all three byte counts on every run, passing or not. The memory index lives outside the repository, so its path is read from `.claude/private_check.json` (private layer, machine-specific path); where that file, the index or the hook script is absent the rule emits a note and checks nothing (public CI never sees the private layer). The rule is a row in Platform Spec §2.8.

## Consequences
- + Adding a rule now has a price. A sentence that does not fit `CLAUDE.md` is rejected by the commit hook, which forces the question of which owner in the map it belongs to, and the usual answer is a skill step or a check.
- + The pre-trim files are kept verbatim: `CLAUDE.md` at `planning/foundation/archive/CLAUDE_md_2026-10-26.md` and the memory files under `memory/archive/` (private). Nothing was deleted without a recorded disposition.
- + `tools/claude_md_crosscheck.mjs` proves the trim: every sentence removed from `CLAUDE.md` maps to a destination in `claude_md_crosscheck.map.json` (last run: 116 removed, 116 mapped, 0 unmapped).
- + The two harness metrics have a collection point, so a regression in session discipline shows up as a number rather than as an impression.
- − `CLAUDE.md` is at 4,095 B of 4,096 B at the time of writing. Any further rule needs another sentence removed first, which is the intent but will feel tight.
- − Part of the enforcement is local: the budget rule runs only where the private layer exists, so a session in an isolated worktree is not checked until its work reaches the main tree.
- − Lapse counting depends on the session's own honesty at close; the metric is a prompt, not an audit.

## Alternatives considered
- **A smaller memory index only.** Rejected: the measured weight was split across both files, and a one-surface fix leaves the other free to regrow.
- **Budgets as a convention, not a check.** Rejected for the same reason ADR-0033 rejected conventions for documentation: a limit nobody is told about at commit time is a limit that erodes by one sentence at a time.
- **Moving every rule to hooks.** Rejected: calibration about the owner (how to be worked with) cannot be mechanised and stays prose in memory.

## References
- Charter: `specification_documents/planning/Foundation_Program_2026-10-26.md` (private); registry items BL-279 (Foundation Program) and BL-272 (harness assessment).
- Analysis (private): `planning/foundation/WS2_Rule_Inventory_2026-10.md`, `WS2_Lesson_Rule_Trace_2026-10.md`, `WS2_Metrics_Baseline_2026-10.md`; briefs and build log under `planning/foundation/`.
- Controls: Platform Spec §2.8 (rationale ADR-0033); related ADR-0035 (registry), ADR-0020 (documentation regime).
