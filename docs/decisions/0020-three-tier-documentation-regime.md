# ADR-0020: Three-tier documentation regime — current-state / rationale / history

## Status
Accepted — 2026-08-17 (owner acceptance in the BL-233 session, following the four dispositions recorded below)

## Context
The project documents heavily by design, and by v1.4.1 the cost of that habit
had concentrated in the wrong place: history and rationale accreting *inside*
the current-state documents that every session — human or agent — loads as its
standing read path. Measured 2026-08-17:

- **Active backlog: 298 KB**, of which ~90 KB is 26 fully-resolved entries
  still resident full-body (plus shipped epic sub-items on top) — the
  existing archive rule's "at resolution time, or in periodic sweeps" escape
  hatch meant sweeps lagged months.
- **Application Spec: 160 KB**, ~26 KB of it round-by-round build narratives
  (§5.14, §5.15), a frozen investigation census (§10), an ADR-shaped decisions
  ledger (§19.4), and changelog-structured sections (§20/§21).
- **Platform Spec: 107 KB**, ~24 KB of it "Design Rationale" subsections
  (§1.7, §2.7, §3.13, §4.5) plus dated as-built blockquotes layered into §1.1.

Two costs, not one: every session pays tokens/attention for history it does
not need, and — as the BL-231 accuracy sweep demonstrated — current-state
claims are harder to *verify* when interleaved with narrative, because a
sweep must first classify each sentence as claim-about-now vs. record-of-then.

The project already had partial tier mechanisms that work: the backlog archive
with one-line tombstones (RR-25), the frozen V1 spec, the ADR series
(0001–0018), the `analysis/` evidence folder. What was missing was the
*general* rule and the discipline connecting them.

Alternatives considered:

- **Do nothing; rely on section headers to signal history.** Rejected —
  readers and agents load whole files; the cost is per-file, and headers do
  not stop interleaving from creeping into current-state sections.
- **Shard the specs into many small files.** Rejected — fragments the
  "one doc per domain" lookup rule and multiplies cross-references. The
  guardrail adopted is the opposite: *extraction before any structural
  split*; each spec stays one file.
- **Delete superseded text.** Rejected outright — nothing is ever deleted.
  Verbatim moves with tombstones, the same discipline as the test-disposition
  rule and the backlog archive.

## Decision
Adopt a **three-tier documentation regime**; every tracked document belongs to
exactly one tier, and content migrates *down* tiers, never silently away.

- **Tier 1 — current-state** (the small, standing read path): CLAUDE.md,
  README, HISTORY.md (release index), Application Spec, Platform Spec,
  variant-mapping spec + exceptions report, content runbook, architecture
  views, and the *active* backlog. Tier-1 text makes only claims that are
  true **now**; anything phrased as "we did / we chose / it used to" belongs
  in Tier 2 or 3.
- **Tier 2 — rationale**: the ADR series in `docs/decisions/` — one series
  for application and platform decisions alike (it is already mixed). The
  durable "why we chose X" prose currently living inside specs moves here.
- **Tier 3 — history**: per-document archives holding superseded text
  verbatim — `SWU_Application_Spec_Archive.md` and
  `SWU_Platform_Spec_Archive.md` **public, beside the specs** (their
  tombstone pointers must resolve for any repo reader; the text was already
  public), `SWU_Backlog_Archive.md` (private, as today) — plus the frozen
  specs, `analysis/`, and the learning journal.

Standing rules that keep the tiers true:

1. **Supersession rule (same-PR):** when a change supersedes spec text, the
   durable rationale goes to an ADR (new, or a dated amendment to an existing
   one) and the superseded text moves to that spec's archive **verbatim**,
   leaving a dated one-line tombstone pointer — all in the same PR.
2. **Backlog at-resolution archiving:** flipping an item ✅ includes the
   verbatim move to the archive and the tombstone **in the same session**
   (the periodic-sweep escape hatch is removed).
3. **Disposition-logged migration:** any bulk tier migration carries a
   per-section disposition log — **stays / → new ADR / → merge into existing
   ADR / → archive** — with no silent deletion. The fourth value exists
   because spec rationale sections overlap existing ADRs (e.g. Platform §3.13
   vs. ADR-0009/0010/0011); minting duplicate decision records would be its
   own drift.
4. **Guardrail:** history extraction before any structural split; no
   re-sharding of Tier-1 docs under this ADR.

Owner dispositions (2026-08-17) folded into this decision: per-spec archive
files (not combined, not per-extraction folder); spec archives public;
ADR-0019 written for the BL-205 sharing trust model rather than accepting
App Spec §19.4 as the record; at-resolution backlog archiving.

## Consequences
- + The standing read path shrinks and stays shrunk — the rules move the cost
  of history to the moment of supersession, where it is smallest
  (before/after sizes recorded in the BL-233 disposition log).
- + Accuracy sweeps get cheaper and sharper: every Tier-1 sentence is a
  falsifiable claim about the present, so BL-231-style verification no longer
  has to classify claim-vs-narrative first.
- + History remains complete and auditable — verbatim text, dated tombstones,
  public archives for public docs.
- − More files and more hops: the full story of a feature now spans spec →
  ADR → archive instead of one scroll.
- − Same-PR supersession adds friction to every spec-touching PR, and
  tombstones are one more thing to get right.
- − The ADR series will grow past the "healthy project has ~a dozen"
  guidance in `docs/decisions/README.md` — accepted; the guidance describes
  greenfield decision volume, not a regime that also receives extracted
  rationale.
- − Archives are append-only and grow without bound — accepted; that is
  their job, and they are off the standing read path.

Execution of the migration this ADR authorizes (backlog catch-up sweep, both
spec extractions, ADR-0019) is BL-233; the per-section disposition log lives
in `specification_documents/analysis/` (private layer).

## Amendment 2026-10-18 — round 2 dispositions (BL-271 Phase C)

Owner decisions of 2026-10-18, executed in BL-271 Phase C (disposition log
`specification_documents/analysis/BL271_Purity_Dispositions_2026-10-18.md`, private):

1. **Design-stage content leaves Tier 1 — a fifth disposition value, "→ design
   shelf".** Text that describes something designed but not built (App Spec §15
   Decks; §19.2–19.4 wanted list, binders, design-stage rulings) is neither
   current state nor superseded history. It moves verbatim to the private
   planning shelf `specification_documents/planning/design/`, and the spec keeps
   the section heading with a one-paragraph pointer carrying the "(private)"
   marker. Rationale: this matches how designs were actually produced (planning
   docs → spec on ship), and the "one file per domain" guardrail was about
   current-state domains. Cost accepted: public readers lose the design text;
   git history retains it.
2. **Active-backlog tombstones are one table.** The per-tier one-line tombstones
   (201 lines, 57.8 KB, 26.7 % of the active file on 2026-10-18) collapse into a
   single `Resolved items — tombstone index` table at the end of the active
   backlog (id · title · resolved date · tier · archive anchor). Same
   resolvability at roughly a third of the bytes; the tier column preserves
   where each item lived.
3. **Canonical archive forms, machine-checked.** Archive heading
   `## Archived YYYY-MM-DD — <label> (BL-n)`; a spec tombstone quotes the heading
   in double quotes (`… see "Archived YYYY-MM-DD — <label> (BL-n)" in
   <Spec>_Archive.md.`). `docs-check` (`.github/scripts/docs_check.mjs`) fails a
   tombstone that quotes a heading the archive lacks and flags an archive heading
   no tombstone quotes. Verbatim archived text is exempt from the private-link
   marker rule, since it cannot be edited.

## Amendment 2026-10-27 — work registry form (BL-279 WS-1)

Amended by ADR-0035 (2026-10-27): the Tier-1 backlog is the one-file-per-item registry folder, archive-by-move replaces the single archive file for new resolutions (the legacy archive is frozen Tier 3), the tombstone index is generated, and at-resolution archiving runs through `resolve-item` and the pre-commit hook. Decision text and the four amended readings are in ADR-0035.

## Amendment 2026-11-01 — source comments describe now (BL-278, Foundation D4)

Owner ratification of 2026-11-01, extending the regime to comments and docstrings in code. This is the Tier-1 test of this ADR applied to a comment.

**Scope.** Comments and docstrings in non-test source under `frontend/src` and `backend/app`. Out of scope: test files, test names and test ids (a BL-id there is a navigation aid and stays); commit messages and PR bodies (they are the history tier for code); content data files under `frontend/src/content/` (such as `releaseNotes.ts`), which are release history by design and are exempt from the check.

**Rule.** A comment makes a claim that is true now: a constraint, an invariant, a contract, or the reason a non-obvious choice holds. It does not narrate how the code reached its current shape. Anything phrased as "we did / we chose / it used to / round N / fixed in" belongs in Tier 2 or 3.

**A comment may cite:**
- a section of a Tier-1 specification (`App Spec §19.1`, `Platform Spec §2.8`, `mapping spec §3`), named when the document is not obvious from the file;
- an ADR by number (`ADR-0031`);
- another source file or symbol (extends Foundation D4, which names only the two kinds above; both extensions describe the present and were already in use);
- an external standard, library document or vendor behaviour, such as a Safari rendering bug or an RFC (extends Foundation D4).

A planning or analysis document is not a permitted citation. Where a comment cites one today, the sweep replaces the citation with the spec section that holds the point, or writes a short ADR first.

**A comment may not cite:** a backlog id (`BL-n`); a GitHub issue number such as `#140` (treated as history, like a backlog id); a slice, stage, round, wave or run tag (`S1-07`, `R5-2`, `round 4`, `wave 1 fix 3`, `RUN 2B`); a review finding or review date (`S1 review F7`, `owner dev review 2026-07-26`); a previous implementation (`used to`, `the old X`, `pre-BL-n`, `replacing the old`); a person.

**What happens to rationale before a comment goes.** For every block the sweep touches, one of four dispositions, logged per module (the discipline of rule 3 of this ADR):
1. **keep** — the block already conforms;
2. **rewrite** — the block states a present reason; it is rewritten in present tense without the forbidden citations and keeps the reason;
3. **move → ADR-n / move → spec §n** — the block holds durable rationale or a behaviour contract that no ADR or spec section holds yet; it is written there first, in the same PR, and the comment keeps a one-line pointer;
4. **drop** — the block narrates a change or is scaffolding; nothing present depends on it; git holds the history.

No block is deleted without a logged disposition. The per-module disposition log is kept with the BL-278 work.

**Sweep.** Dedicated per-module stages under WS-4, never per-touch (D4). Each stage is one PR; the journey suite is its gate like any other PR.

**Enforcement.** `.github/scripts/comment_check.mjs` fails a BL-id in a non-test comment. The allowlist is a per-file count baseline (`path count` per line) that may only decrease: a file still on the list cannot grow new BL-id comments before its module is swept, an unlisted file may have none, and a count left above the real number fails until it is lowered. `frontend/src/content/` is not scanned. The check does not yet enforce the GitHub-issue-number rule; it is added once the BL-id sweep is done. The baseline reaches zero when the last module is swept, and the file is then deleted.

**What this costs, stated.** The direct hop from a line of code to its backlog item is lost once the item is archived. Spec-to-code navigation stays (the specs cite code by function name); code-to-spec stays through `§` citations; code-to-history is `git log -S <symbol>` / `git blame` and the backlog archive. Accepted (D4).

**Consequences.**
- + Comments cannot drift from a narrated history.
- + A smaller standing read in the files agents open most.
- + One CI rule, with a baseline that only shrinks.
- − About a thousand comment edits across 280 files, spread over the module stages.
- − A reader who wants the story must open git or an ADR.
- − The two citation extensions go beyond D4 as written, and the issue-number rule is stated before it is enforced.
