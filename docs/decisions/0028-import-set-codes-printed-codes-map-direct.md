# ADR-0028: Import set-code tables — printed codes map direct at onboarding

## Status
Accepted — 2026-10-08 (BL-241, owner decision; amends the App Spec §17.5 refusal posture's admission rule)

## Context
The two foreign-format import presets (SWUDB CSV — also what the HoloScan
scanner app writes — and sw-unlimited-db XLSX) translate a file's set code
through a hand-maintained table and refuse any code not in it as an
itemized `unmapped_set` problem row. Since BL-185/BL-186 (2026-08) a code
entered a table only once a real export from that tool had shown it. The
rule guarded against SWUDB's synthetic and renamed container codes
(`SORPR`→`SOR`, `CE25`→`C25`, `GGTS`→`GG`), where guessing would silently
attribute the wrong printing — the one failure worse than refusing.

Applied to base sets, the same rule had a different effect. Homeworlds
shipped on 2026-10-02 with the set fully in the catalog and both tables
still refusing it, because no export had been seen; nothing scheduled
acquiring one. The first evidence arrived as a support ticket (feedback
#37, 2026-10-06): a HoloScan user whose Homeworlds and Weekly Play rows —
335 of 1,724 — were bounced with copy saying the set was not in the
catalog. Their file then verified every refused code in one pass.

What the evidence base says after that file: every base set ever observed
in either tool (10 of 10) exported its printed code unchanged; every Weekly
Play set observed (6 of 6, printed on the cards as `<CODE>P`) did too; the
only renames ever seen were SWUDB's synthetic container codes. The one
numbering mismatch on record (sw-unlimited-db's HMW sample, 2026-08-03) was
pre-release preview data, not a tool convention — post-release numbering
matched the catalog exactly.

## Decision
At new-set onboarding (runbook Scenario C), the set's **printed codes** —
the base code `<CODE>` and its Weekly Play code `<CODE>P` — are added to
both `SET_CODE_MAP`s **in the onboarding PR**, behind a spot-check: two or
three `(code, number)` pairs per tool compared against the catalog (a
card page, listing or export from that tool). If a tool still carries
pre-release numbering that does not match, that tool's rows are held until
street date and re-checked; the hold is recorded on the post-release
follow-up item with a date.

Every other code — SWUDB's synthetic or renamed containers, convention,
judge, gift-box and one-off series — stays **evidence-gated** exactly as
before: admitted only once a real export from that tool has shown it.

The refusal itself is unchanged: an unmapped code is still an itemized
problem row, never a guess. The row-level copy no longer claims the set is
missing from the catalog; it says the file's set code is not recognised
and asks the user to report it.

The onboarding PR carries the map rows, one positive resolution test per
new code, and a Replace disposition for any test that pinned the set as
unmapped.

## Consequences
- The next base set ships with third-party import support in the same
  release instead of a release cycle later. The HMW gap was a week on prod
  and one support ticket; it will not recur by construction.
- The spot-check is the residual safety: a wrong printed-code assumption
  would be caught at onboarding by a card-name mismatch, not by a user.
- The evidence gate keeps doing the job it was built for — container codes
  that tools invent cannot be predicted and are still never guessed.
- Pre-release onboarding gains one explicit hold rule rather than a
  blanket refusal.

## Supersedes
App Spec §17.5 "The refusal posture (locked)" — the admission sentence
("a code enters a table only once a real export from that tool has shown
it") is replaced by the rule above; the sentence moved verbatim to
`SWU_Application_Spec_Archive.md` (2026-10-08). Runbook Scenario C step 9's
"do NOT add by pattern" bullet is rewritten to point at the new step.
