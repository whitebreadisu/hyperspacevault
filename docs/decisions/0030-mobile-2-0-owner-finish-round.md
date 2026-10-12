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
1. **The card-detail plate is the gallery plate, scoped to the selected
   printing.** It uses the gallery plate's own markup and classes (one
   shared component drawn by both the gallery cell and card detail), in the
   state the gallery shows while the Vault is scoped to a single finish,
   with the selected printing standing in for that scope: pips are that
   printing's count against the card's playset size, amber while short;
   at a playset the plate takes the complete state; the number is that
   printing's count. Card detail has no "all finishes" state, because a
   printing is always selected. Signed out it shows the gallery's signed-out
   plate. It remains the button that opens Owned by finish. The phone
   gallery tile itself is unchanged — the owner confirmed it was already
   right.
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
- The detail plate's number is the selected printing's count, while a
  gallery tile's number is the card's total across printings. They agree
  whenever one printing is owned and differ otherwise; that difference is
  the point of "scoped to the selected printing" and is the one place the
  two plates are not literally the same reading.
- R5-5's rule that the plate follows the selected printing stands; only its
  drawing is superseded. The Owned-by-finish sheet keeps the chip-and-pips
  idiom (R5-1), which is the list's idiom on a list-like surface.
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

## Related
- App Spec §25.2 (card detail as built), §25.1 (gallery plate), §4.5
  (keep-limits and cap modes).
- [ADR-0018](0018-category-level-cap-precision-restore.md) — keep-limit
  precision; the limits this colour rule reads.
- `frontend/src/mobile/vault/GalleryPlate.tsx`,
  `frontend/src/mobile/card/PrintingPlate.tsx`,
  `frontend/src/mobile/card/cardDetailModel.ts` (`stepperState`),
  `frontend/src/screens/cards/CardPopupInventory.tsx`.
- Tests: `e2e/mobile/fr1-card-detail.spec.ts` (`fr1-07`),
  `e2e/mobile/s2-03-plate.spec.ts`, and the `FR1-05` boundary tables in
  `cardDetailModel.test.ts` and `CardPopup.test.tsx`.
