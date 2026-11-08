# ADR-0039: Name-and-subtitle fallback — several matches anchor to the earliest-released set

## Status
Proposed — 2026-11-08 (BL-349; owner decision during the Icons 2027 onboarding; the owner ratifies)

## Context
A small number of swuapi cards are roots (`variant_of_uuid: null`) whose own
`variant_type` is not `"Standard"`. Gamegenic, convention, judge and a few
Weekly Play printings arrive this way because upstream never filled in the link
to their Standard printing. Ingestion re-anchors each of them through the
case-insensitive `(name, subtitle)` fallback (App Spec §10.6, mapping spec §6).
Until now the rule was **exactly one non-token Standard match, otherwise stop**.
More than one match raised `AmbiguousFallbackError` and rolled back the whole
ingestion.

That rule assumed a name and subtitle identify one Standard root across the
corpus. Reprint sets break that assumption. Cross-set reprints are independent
roots by design (mapping spec §2, §5B), so a reprint set gives an old card a
second Standard root with the same name and subtitle. IC27 (Icons 2027
Edition, 2026-11-08 export) is the first secondary base set that reprints this
way: 94 of its 196 Standard roots share a name and subtitle with an earlier
set. Its Echo Base (`IC27_10`) gave `GG_2 Echo Base` (Gamegenic Hyperspace
Foil) a second match next to `SOR_24`, and the whole 615-card refresh stopped.
The other ten fallback-anchored roots (GG_1/3/4, C25_2/3, J25_4/6, JTLP_4/10,
LOFP_4) are exposed in the same way whenever a later set reprints their card.

Options weighed (owner, 2026-11-08):
1. A curated override table per uuid. This fixes the one card, but every new
   reprint set needs a fresh hand decision, and the next collision stops
   ingestion again.
2. **A deterministic tie-break: the earliest-released set wins.**
3. Record the root as an exception and give it its own base card. This moves
   a printing users already own away from its original card.

## Decision
1. **One match** anchors as before. **Zero matches** stay an exception
   (flagged, never blocked).
2. **Several matches** anchor to the match in the **earliest-released set**,
   ordered by *(release date, set code)*. The set code is a stable secondary
   key, so two sets released the same day still order the same way regardless
   of export order. Only the earliest set's matches count: one match there
   wins however many later sets also match (one SOR match plus two IC27
   matches anchors to SOR).
3. **Where release dates come from:** `CANONICAL_RELEASE_DATES` in
   `swuapi_transform.py` comes first, so an upstream edit cannot flip a settled
   tie. Otherwise swuapi's own `sets[].release_date` is used. The stored
   `sets.release_date` follows the same precedence (one helper,
   `_set_release_date`), so the database and the tie-break cannot disagree.
   Dates are parsed as ISO dates and compared as dates, never as strings: a
   curated date that does not parse is a code error and raises; an upstream
   date that does not parse leaves its set undated. The
   table now carries every base set's official street date, taken from the
   `releaseDate` of its starwarsunlimited.com product page on 2026-11-08: SOR
   2024-03-08, SHD 2024-07-12, TWI 2024-11-08, JTL 2025-03-14, LOF 2025-07-11,
   IBH 2025-10-03, SEC 2025-11-07, LAW 2026-03-13, TS26 2026-05-08, ASH
   2026-07-17, HMW 2026-10-09, IC27 2026-11-20. SHD, LOF, SEC and LAW
   previously carried different dates (SHD's later, the other three earlier)
   and were corrected. The
   relative order of the sets is unchanged except that IBH now precedes SEC.
4. **The hard stop remains** (`AmbiguousFallbackError`) in two cases:
   - a matched set has no known release date;
   - the earliest-released set holds two or more of the matches, i.e. two
     Standard roots with the same name sit in that set (duplicates in a later
     set do not matter).

   Neither can be ordered on principle, so a person decides.

## Consequences
- `GG_2 Echo Base` stays on `SOR_24`. On the 2026-11-08 export all 11
  fallback-anchored roots keep their existing anchor, and no existing variant
  changes base card (checked by diffing the transform output of the
  2026-10-02 and 2026-11-08 exports).
- A future reprint set no longer stops ingestion for this reason. It does need
  its release date in `CANONICAL_RELEASE_DATES` (runbook Scenario C step 2)
  before a collision involving it can be decided, and the error message says
  so.
- Rationale: a container printing belongs with the original card, the one the
  promotional product was made from and the one users already file it under.
  A reprint is a newer independent root, not the canonical home.
- `sets.release_date` changes for SHD, LOF, SEC and LAW, and is newly filled
  for IBH, TS26, ASH, HMW and IC27, on the next ingestion in each environment
  (`ON CONFLICT ... COALESCE`). Making the curated date win over upstream for
  the stored value changes no date in the 2026-10-02 or 2026-11-08 export:
  swuapi dates only SORP, SHDP and TWIP, none of them curated. Base-set display order does not read
  `release_date` (ADR-0031), so nothing reorders on screen.
- Tests: `test_swuapi_transform.py` pins the tie-break (earliest wins in either
  export order; swuapi date for an uncurated set; the curated date beats a
  conflicting swuapi date, in the tie-break and the stored row; equal dates
  fall back to set code; a unique earliest match wins over later duplicates;
  two matches in the earliest set raises; an undated or unparseable-date set
  raises; a single match needs no date).
- Mapping spec §6, App Spec §10.6 and the exceptions report state the rule.
  The replaced text is archived in `SWU_Application_Spec_Archive.md`
  (2026-11-08, BL-349).
