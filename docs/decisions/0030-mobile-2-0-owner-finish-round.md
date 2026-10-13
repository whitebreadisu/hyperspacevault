# ADR-0030: Mobile 2.0 owner finish round — the gallery plate on card detail; red only past the limit

## Status
Accepted — 2026-10-12 (BL-257, owner decisions during his walk of the phone build on dev; built in the same session — App Spec §25.2)

## Context
The phone layout (BL-190) was built in seven slices from a prototype that
closed at revision 4, with a fifth round of deltas implemented directly
(R5-1 … R5-7). On 2026-10-12 the owner walked the finished build on his
iPhone and recorded thirteen finish items. Most were corrections with one
obvious answer (a clipped search hint, a button label, a tap target that
was too small a part of its row). Two reversed choices that had been made
deliberately, and those are the ones recorded here.

**The card-detail plate.** The desktop app shows a card's ownership in two
idioms: the vault list's count chip with pips beside it, and the gallery's
console plate (pips at the left, the owned number at the right, inside the
angle-cut steel frame, with a green ring at a playset). Round 5 (R5-5) made
the phone's card-detail plate describe the selected printing, and drew it
as the list's chip and pips placed inside the gallery's frame. On the
phone the owner read that as "a weird combination of the gallery panel
outline but the vault visualization". The phone gallery tile already drew
the true gallery plate, so the two phone surfaces that share a frame
disagreed about what goes inside it.

**The limit colour.** The stepper's count was ported from the desktop card
popup with its rule intact: red when the count is at or past the
printing's keep-limit, amber with an "Over limit" tag when it is past the
limit under a soft cap. Under the default hard cap a user who simply owns
a full playset is at the limit, so the ordinary finished state of a card
was drawn in the colour the design language reserves for "destructive or
blocked". The `+` button is already disabled there, which says what needs
saying.

## Decision
1. **The card-detail plate is the gallery plate, and it behaves exactly
   like a gallery tile scoped to the selected printing's finish.** It uses
   the gallery plate's own markup and classes (one shared component drawn
   by both the gallery cell and card detail) and the same helper functions
   for its numbers, with the selected printing's finish standing in for
   the Vault's scope: the pips fill from every owned printing of that
   finish, summed, against the card's playset size, in the amber scoped
   idiom; when that sum reaches a playset the plate takes the complete
   state; the number is the card's total owned across all printings, green
   when the total reaches a playset and muted at 0. Card detail has no
   "all finishes" state, because a printing is always selected. Signed out
   it shows the gallery's signed-out plate. It remains the button that
   opens Owned by finish. The phone gallery tile itself is unchanged — the
   owner confirmed it was already right.

   *How it got here (both on 2026-10-12).* The plate was first built with
   the selected printing's own quantity for the pips, the ring and the
   number, which is what the slice brief said and what agreed with the
   stepper beneath it. The review showed that this differs from a gallery
   tile in three cases: another finish is also owned (the tile's number
   counts it), two printings share a finish (the tile's pips sum both),
   and the owned printing is not the selected one (the tile still shows
   its number). The owner saw the comparison and chose the gallery's
   behaviour in full, accepting that the plate's number will not always
   equal the stepper's.
2. **A count is red only when it is past its limit — on the phone and on
   the desktop card popup.** At the limit the count keeps its normal
   colour. Past the limit it keeps the colours it already had: amber with
   the "Over limit" tag under a soft cap, red where a hard-cap count is
   already past a limit that was lowered beneath it. The desktop popup's
   bar fill follows the count. Cap enforcement is untouched: `+` is still
   disabled at the limit under a hard cap.

## Consequences
- One plate idiom per frame. Anything that changes the gallery plate now
  changes card detail with it, because both draw the same component; a
  future divergence has to be asked for rather than drifting in.
- The detail plate and a gallery tile scoped to the same finish always
  show the same thing for the same card: both compute the card total, the
  finish's owned sum and the two complete states with the same functions
  (`cardOwnedTotal`, `isPlaysetComplete`, `scopedOwnedCount`,
  `scopedPlaysetComplete`). A test compares the two directly, including
  the three cases where the first build differed.
- The plate's number is the card total, so it can differ from the
  stepper's count for the selected printing directly below it (2 Standard
  and 1 Hyperspace owned, Standard selected: the plate reads 3 with two
  amber pips, the stepper reads 2). The owner accepted this. Selecting
  another printing moves the pips but not the number.
- The plate counts the quantities the stepper shows, so a tap on − or +
  moves it before the server answers.
- A printing whose finish the Vault cannot be scoped to (a prize-wall or
  participation printing, for example) still gets the same arithmetic,
  with its own finish as the scope; no gallery tile exists to compare it
  with.
- R5-5's rule that the plate follows the selected printing stands in this
  form: the selected printing chooses the finish the pips count. Its
  drawing, and its "chip = that printing's count", are superseded. The
  Owned-by-finish sheet keeps the chip-and-pips idiom (R5-1), which is the
  list's idiom on a list-like surface, and is where the per-printing
  counts are read.
- Red on a quantity now always means "more than you said you keep". A full
  playset at a hard cap no longer looks like an error on either platform.
- The desktop card popup changed behaviour in a phone-led round. It is the
  only desktop change in the round, and it was the owner's explicit choice
  that the two platforms not disagree.
- The keypad's "In vault n/m" readout (App Spec §25.3) still turns red at
  the limit. It answers a different question — "will the next copy be
  refused?" — and was not part of the owner's item.
- Superseded text is verbatim in `SWU_Application_Spec_Archive.md`
  ("Archived 2026-10-12 — §25.2 plate idiom and limit colour superseded by
  the owner finish round (BL-257)").

## Amendment 2026-10-12 — Showcase returns to the scope picker (BL-259)

**Context.** The single-select finish scope (desktop: the Playset header's
scope menu; phone: the Vault's scope chip and "Finish scope" sheet) offered
thirteen values. Round 4 of the variant-scope review (BL-173) had removed
Showcase from it on the reasoning that a leaders-only finish with a playset
of one "never made sense as a pip scope"; it stayed reachable as a
check-box row in Filters → Finish. In the same 2026-10-12 walk the owner
asked for it back: "add 'Showcase' … as the last choice in the finish
list. Unlike the finish filter, do not make this a checkbox as this is not
a multi-select control — make it a different control that is design
aligned in the respective mobile and desktop versions." He confirmed the
control he meant is the scope picker.

**Decision.** Showcase is a scope value again — fourteen in all. It is the
**last row of the pinned section** on both platforms (after Weekly Play,
before the divider and "Show all finishes…"), so it is visible without
expanding. It is drawn as a **label with one chip** — the chip the pair
rows and the Prestige row already use for a single-select pick, in each
platform's own styling — and not with the check-box glyph. Picking it
behaves like every other scope: the Finish facet is written to Showcase,
the trigger / chip turns amber and reads "Showcase", and pips, number,
value and sort read the Showcase printing. No scoped-behaviour rule
changed: a leader's playset is one, so one Showcase copy completes it, and
cards without a Showcase printing are filtered out exactly as under any
scope they have no printing for.

**Why.** The record holds the request, not a motive: the owner asked for
Showcase as the last choice in the picker, as a non-check-box
single-select control. That reverses the round-4 removal. (Our own note on
what the change does, not his reason: a scope makes pips, number and value
read the one finish, where the Filters → Finish check-box only narrows the
list.)

**Follow-up decisions (2026-10-12, after the slice review).** The review
put three points to the owner; he decided all three the same day.
- **Position confirmed.** Showcase stays the last row of the main (pinned)
  list, above the divider — not the last row of the whole menu with the
  extra finishes open.
- **Chip text kept.** The chip reads "Showcase", repeating the row's name.
- **The four extra finishes take the same control.** Convention Exclusive,
  Event Exclusive, Prerelease Promo and Movie Promo — the rows "Show all
  finishes…" reveals — were check-box rows. The picker is single-select,
  so they are now the same row as Showcase on both platforms: the row's
  label and one chip that repeats it, with the same selected state. The
  scope picker has no check-box row. Their order, the expander, the raw
  values written to the Finish facet and to analytics, and the rule that a
  selected value is never hidden are unchanged. This supersedes the first
  build's "expanded rows untouched".

**Consequences.**
- The chip repeats the row's name ("Showcase · [Showcase]", "Movie Promo ·
  [Movie Promo]") because these values have no sub-flavour to name, unlike
  "Non-foil / Foil". The longest, "Convention Exclusive", fits on one line
  beside its label at 390 px, so the chips carry full names, not the short
  names the trigger uses.
- The row kind `plain` (the check-box row) is removed from
  `utils/variantScope.ts`; every scope row carries chips.
- Filters → Finish is unchanged; its Showcase row remains a check-box
  there, where multi-select is the point.
- Superseded text is verbatim in `SWU_Application_Spec_Archive.md`
  ("Archived 2026-10-12 — §5.13 / §25.1 scope option set superseded:
  Showcase returns to the scope picker (BL-259)").
- Code and tests: `frontend/src/utils/variantScope.ts`
  (`SCOPE_PINNED_ROWS`, row kind `single`),
  `screens/cards/VariantScopeControls.tsx`, `mobile/vault/ScopeChip.tsx`;
  `FR4-01` / `FR4-04` in `variantScope.test.ts`, `FR4-02` in
  `VariantScopeControls.test.tsx`, `fr4-03` in
  `e2e/mobile/fr4-showcase-scope.spec.ts`.

## Amendment 2026-10-12 — Chooser sheet: set logos, pinned headers, deck-row art (BL-257)

Owner feedback F-11, F-12, F-13 from the same phone walk, with his decisions after the slice's review the same day.

- **Set logos are laid out by their artwork, not their file (F-11) — on every phone surface.** The set PNGs differ in aspect (2.5:1 to 7.4:1) and in transparent padding, so fitting the file's box made some logos read huge, others small and off-centre. The phone measures each logo's opaque artwork once (alpha bounding box, `frontend/scripts/measure-set-logos.mjs`), records it in one table (`SET_LOGO_ART`), centres the artwork in a fixed logo box and gives every set's artwork the same area (62.5 % of the box, capped by the box). Optical factors chosen by eye: Legends of the Force × 1.10 and Twilight of the Republic × 1.12 (thin, airy marks); A Lawless Time × 0.64 — its mark is the densest, and bounding-box area cannot see ink, so at equal area it read as the biggest logo (0.64 of the area is 0.88 of the box's width). Jump to Lightspeed is nudged 3.5 % of its width to the right, because the streak on its right pulls the bounding box off the wordmark. Spark of Rebellion's 11:1 wordmark is the accepted exception: at the box's full width it is about half the common area. *Rejected:* editing or re-exporting the PNGs (desktop uses the same files, and a table survives a logo replacement with one re-measure); equal height or equal width. **One component (`SetLogo`) draws every set logo on the phone:** the keypad chooser's set rows and deck rows, Completion by set, the keypad's set button, the precon panel head, the Filters Set picker chips and selected-set chips, and the card-detail header (there the artwork is held to the right margin instead of centred). No phone surface is left on the old file-box fit. Desktop is unchanged.
- **Set / Precon deck are pinned accordion headers, both collapsed on open (F-12).** Expanding a list in place pushed the other header off-screen. The two headers now behave like the Verify sheet's section headers: always visible, the open list fills the panel between them and is the only scroller, opening one folds the other. Owner's differences from the Verify sheet: both start collapsed, and tapping the open header collapses it again. The mechanism is mirrored under the chooser's own class names rather than generalised, so the Verify sheet could not regress.
- **Deck rows show the deck's leader and base (F-13).** Desktop's hover preview has no touch equivalent, so the art moves onto the row: leader in landscape in front, base behind and raised; Twin Suns = two leaders with one base between; the Hoth box = two leaders and two bases. Desktop's resolution (`buildPreconPreview`) is reused; the composition is a phone-size mirror of desktop's, not the same component (desktop's has fixed sizes and named images, and it does not remove art whose image fails — it only swaps once to the stored URL). Owner decisions after the review: **(1) deck names wrap** to a second line so every name reads in full (rejected: one line with an ellipsis, which cut "Aggressive Negotiations" at 390 px and any selected Twin Suns name); **(2) the deck-row logo box is 66 × 24** (rejected: 50 px, which left Spark of Rebellion 4.6 px tall; and dropping the logo from deck rows); **(3) the base peeks 13 px** — the name strip and a sliver of the card, about 30 % of the base, close to desktop's 32 % (rejected: 8 px, name strip only); **(4) the text follows the art** — it starts right after the art, so it starts further right on the five two-leader rows (rejected: a fixed art column, which costs 62 px of text on single rows). Rows are 68 px on every row kind (cap 76; were 58); leaders are 60 × 43 on every row kind. A deck whose leader cannot be resolved shows no art; a leader image that fails removes the art but keeps its space, so the row does not shift.

## Amendment 2026-10-12 — Round 2 (2026-10-12): camera start, message panel outline, collapsed-row spacing (BL-257)

Owner feedback F-14, F-15, F-16 after the finish round reached dev.

- **The camera starts in a focusing state: the guide is visible but dim until the picture first sharpens (F-16).** On the owner's phone the picture starts blurry and then shifts as it snaps into focus, so a card lined up early is no longer on the guide. The likely cause is the phone's multi-lens back camera, which is one virtual device that changes physical lens by subject distance; the lenses sit a centimetre or two apart, and a web page cannot stop the switch (no focus mode or lens choice is exposed on that device). Decision (owner, option 2 of 3): keep the camera as it is and change what the screen says — from every stream start the guide's lines are dim and the meter reads "Focusing…", until the first frame that passes the existing sharpness gate, or 3 s (so an empty table never leaves the guide dim). He chose **visible but dim** over hiding the guide. It is display only: reading is not gated or delayed, it does not return mid-session, and it adds no analytics event. Asking for one physical lens instead (which would remove the shift itself) changes the guide geometry and reading thresholds measured on the multi-lens camera, so it is a measured follow-up: **BL-261** (issue #229).
- **The camera message panel's outline follows its cut corners (F-15).** The panel drew its line as an inset shadow and then cut two corners with a clip, which leaves nothing to draw along the diagonals. The line is now its own clipped layer, as on the app's other cut-corner panels; the meter had the same pairing and got the same fix.
- **Collapsed card detail: 5 px more between the Market / Low toggle and the price (F-14).** The pair stays centred in the row; the row height and the collapse geometry are unchanged.

App Spec §24.2, §25.2 and §25.7 state the result; nothing was superseded (additions only).

## Related
- App Spec §25.2 (card detail as built), §25.1 (gallery plate), §4.5
  (keep-limits and cap modes).
- [ADR-0018](0018-category-level-cap-precision-restore.md) — keep-limit
  precision; the limits this colour rule reads.
- `frontend/src/mobile/vault/GalleryPlate.tsx`,
  `frontend/src/mobile/card/PrintingPlate.tsx`,
  `frontend/src/mobile/card/cardDetailModel.ts` (`plateState`,
  `stepperState`), `frontend/src/mobile/vault/GalleryCell.tsx`,
  `frontend/src/screens/cards/CardPopupInventory.tsx`.
- Tests: `e2e/mobile/fr1-card-detail.spec.ts` (`fr1-07`),
  `e2e/mobile/s2-03-plate.spec.ts`, and the `FR1-05` boundary tables in
  `cardDetailModel.test.ts` and `CardPopup.test.tsx`.
