# ADR-0031: Set order — main-release sets newest first, everywhere

## Status
Accepted — 2026-10-12 (BL-258; owner decision during the mobile 2.0 review round, feedback F-02; built in finish-round stage 2a)

## Context
Every list of sets in the product — the Vault's rows and its Set sort, the
desktop and phone set pickers, the completion-by-set rows, the precon deck
list, and the two downloadable files — ran oldest first: SOR, SHD, TWI, JTL,
LOF, SEC, LAW, ASH, HMW. The order lived in three independent places that had
drifted into three mechanisms: the frontend's `SET_CANONICAL` (pickers), a
second `CURATED_SET_ORDER` array plus a `release_date` tier in
`utils/catalog.ts` (the Vault; the date tier silently won for SOR..LAW, so
reordering the array alone would have done nothing), and the backend's
`CURATED_EXPORT_SET_ORDER` (files). The owner opens the app for the newest
set: with a 9-set main block, Homeworlds sat at the bottom of every list.

## Decision
1. **The main block runs newest first:** HMW, ASH, LAW, SEC, LOF, JTL, TWI,
   SHD, SOR — on every surface, desktop and phone, including the exports.
2. **Structure is unchanged.** Intro Battle: Hoth and Twin Suns keep their
   place after the main block (IBH, then TS26); each Weekly Play set follows
   its base set (so the Weekly Play block mirrors the main block); every other
   set (convention, judge, promo, gift box, movie, Gamegenic, unknown codes)
   keeps its existing position and relative order. Blocks, dividers and
   subgroup labels are untouched. Within a set, card number stays ascending.
3. **One frontend definition.** `SET_CANONICAL` in `utils/setGrouping.ts` is
   the display order; `setReleaseRank` in `utils/catalog.ts` ranks base sets
   by their index in `BASE_SET_ORDER`, Weekly Play sets directly after their
   base, and only sets outside that list fall back to the old
   `release_date`-then-alphabetical rule. The separate `CURATED_SET_ORDER`
   array is removed, and an explicit `release_date` can no longer reorder a
   base set. The precon list ranks with the same `setSortRank`.
4. **The Set sort toggle:** `Set` ascending and `#` ascending are the new
   default; `Set` descending shows oldest first (the group order reversed,
   numbers still ascending); `#` descending keeps the default group order.
5. **Out of scope, deliberately:** the printings lists (home set first, then
   alphabetical), the `/api/sets` response order, the import adapters, deck
   check, and the published release notes.

## Consequences
- A new main set is added at the **front** of `SET_CANONICAL` and of the
  backend base block and Weekly Play block (the content runbook, Scenario C
  step 3, says so); a new secondary base set still goes after the main block.
- The exports and the catalog reference CSV follow the screen, so a file and
  the Vault read in the same order.
- Tests that pinned the old order were ported (same intent, new order),
  replaced (the `release_date`-beats-curated-index case is designed away) or
  newly written (FR2-01..09, literal expectations rather than derived from the
  constant); the disposition log is in the stage's build log.
- Superseded spec wording moved verbatim to `SWU_Application_Spec_Archive.md`
  (batch "Archived 2026-10-12").
