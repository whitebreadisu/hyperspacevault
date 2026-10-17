# ADR-0032: Phone keypad keeps its size; the user folds it

## Status
Accepted — 2026-10-17 (BL-270; owner decision after using 2.0 on his phone; supersedes rule R4-6 part 1 of the mobile prototype program, `planning/Mobile_Prototype_Revision_4_2026-10-10.md`)

## Context
The phone keypad (App Spec §25.3) puts the result zone (the resolved card,
"Not in this set", the precon panel) above the key deck. Revision 4's rule
R4-6 ("no hidden result content after a number is keyed") had three parts:
(1) the deck **shrinks automatically** while a result shows — keys 58 → 44 px,
entry row 56 → 48 px; (2) the Card details / Add row is pinned at the bottom
of the zone and excess content scrolls under it; (3) a shared number compacts
the panel. Part 1 meant the keys changed shape the moment a number resolved —
mid-entry, under the user's thumb. After real use the owner called it "very
annoying when trying to key in numbers". Parts 2 and 3 already guarantee that
the Add action is never hidden, so the automatic shrink was buying only extra
visible detail, at the cost of a moving target.

## Decision
1. **The deck keeps its full size** (58 px keys) when a number resolves; it
   never changes size on its own.
2. **The zone scrolls** vertically when its content does not fit; the pinned
   Card details / Add row (R4-6 part 2) and the compact collision panel
   (part 3) stay.
3. **A fold tab** — a small steel-ring tab on the deck's top edge, chevron
   only — shows while the zone's content does not fit, and always while the
   deck is shrunk. Tap: shrink to the compact size (the former R4-6 sizes,
   44 / 48 px); tap again: restore. Shrinking and scrolling are independent:
   the user can do either or both.
4. **The choice sticks** from card to card for the session and is never
   persisted: a fresh load (or the hop back from the camera document) starts
   at full size.
5. **Scope:** every result-zone content above the keypad (resolved card,
   "Not in this set", precon panel). The camera has no keypad and is
   unchanged.
6. **Measured:** `pad_keypad_toggled {state: compact | full}` (App Spec §22),
   to see whether people fold or scroll.

## Consequences
- The tab takes a 28 px band at the bottom of the zone while it shows (the
  zone's bottom padding and the pinned rows' bottom padding grow by it), so it
  never covers the Add row; the content gets 28 px less room in exactly the
  cases where it already overflows.
- "Every choice visible without scrolling at 390 × 844" (the old SOR 2
  worst-case guarantee) now holds once the user shrinks the deck; at full
  size the same content is reachable by scrolling, with Add always visible.
- e2e `s3-04-*` dispositions: `deck-shrinks` replaced (no size change on
  resolve), `add-row-visible-worst-case(-h714)` ported (Add row pinned at full
  size; the unscrolled-choices assertion moves behind a tab tap),
  `deck-restores` replaced (stickiness across Clear / Add / a new card, reset
  on reload); new fold-tab cases.
- Superseded spec wording moved verbatim to `SWU_Application_Spec_Archive.md`
  (batch "Archived 2026-10-17").
