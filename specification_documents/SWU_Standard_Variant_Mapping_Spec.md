# SWU Standard Variant Mapping — Reference Specification

**Created:** 2026-06-20
**Status:** Living reference document — update as new scenarios are confirmed or new swuapi data resolves existing exceptions.
**Related:** [`SWU_Backlog.md`](SWU_Backlog.md) BL-27 (variant-type enumeration), BL-28 (swuapi.com analysis — origin of this document), BL-29 (catalog rebuild), BL-31/BL-32 (tournament-tier stamp consolidation), BL-33 (schema redesign this document's mechanism feeds into).
**Companion file:** [`swuapi_standard_variant_exceptions.md`](swuapi_standard_variant_exceptions.md) — the current, short, regenerated list of cards with no resolved standard anchor. Check that file for "is X still an exception" questions; you should not need to read this document for that.

---

## 1. Purpose

BL-28's swuapi.com analysis surfaced a problem bigger than originally scoped: relating every card variant — across all sets swuapi exposes (27 at this document's creation; **28 sets / 9,057 cards** as of the 2026-07-14 export, `swuapi_export_2026-07-14.json`), not just our 8 modeled core sets — back to a single "standard" printing within its own set. Early investigation (BL-28) approached this via fuzzy `(name, subtitle, variantType)` text matching and found real edge cases (casing inconsistencies, cross-set name collisions, a card with no resolvable anchor at all). A follow-up check (2026-06-20, this session) found that swuapi exposes a structural field — `variant_of_uuid` — that resolves nearly all of this cleanly, without text matching. That discovery changes the recommended mechanism enough, and the resulting scenario taxonomy is large enough, that it deserves a standalone reference rather than living as a subsection of the backlog or `SWU_Platform_Spec.md`.

This document exists so that:
- A future session implementing BL-29's ingestion script (or BL-33's schema migration) doesn't need to re-derive the matching mechanism from scratch or from scattered chat history.
- The full scenario taxonomy (old-set numbering collisions, container sets, reprints, the one true exception, etc.) is recorded in one place with real confirmed examples, not summarized from memory.
- The exception-handling philosophy (flag, don't block; assume future swuapi data resolves it) is stated explicitly once, rather than re-decided every time a "Zam situation" shows up.

---

## 2. The Core Concept

**Every card variant, across every set swuapi exposes, must resolve to exactly one standard-bearing root within its own set.**

Two things are deliberately *out of scope* for that statement, and called out explicitly so this document isn't mistaken for covering them:

- **Cross-set reprints are not merged.** A card reprinted in a later set (e.g. Corellian Freighter in both SOR and JTL) gets two independent roots — one per set. "Standard" is a per-set concept here, not a cross-set physical-card identity. (Cross-set "show me every printing of this card, reprints included" is a real, wanted future feature — see §7 — but it's a *grouping on top of* this mechanism, not part of it.)
- **One exception class exists today and is expected to shrink over time, not be eliminated by force.** A card whose own set hasn't yet revealed (or never will reveal) a `"Standard"`-typed printing is flagged, not excluded from the catalog, and not treated as a bug to fix. See §6.

---

## 3. The Mechanism — `variant_of_uuid`

Confirmed via live `api.swuapi.com` queries (2026-06-20), not assumed from documentation:

- Every card object has a `uuid` (swuapi's own identity for that exact printing) and a `variant_of_uuid`.
- A **root** row — the standard-bearing printing of a card within its set — has `variant_of_uuid: null`.
- Every other variant of that card, **within the same set**, has `variant_of_uuid` set to its root's `uuid`.

**Confirmed example — Corellian Freighter (cross-set reprint, §5 Scenario B):**

| set_code | card_number | variant_type | uuid | variant_of_uuid |
|----------|-------------|--------------|------|-----------------|
| SOR | 250 | Standard | `019d3177-5212-...` | `null` |
| SOR | 250 | Standard Foil | `019d3178-4005-...` | `019d3177-5212-...` |
| SOR | 508 | Hyperspace | `019d3177-584c-...` | `019d3177-5212-...` |
| SOR | 508 | Hyperspace Foil | `019d3178-43a4-...` | `019d3177-5212-...` |
| JTL | 258 | Standard | `019d3179-fb11-...` | `null` |
| JTL | 520 | Hyperspace | `019d317a-3ec7-...` | `019d3179-fb11-...` |
| JTL | 756 | Standard Foil | `019d317a-7a00-...` | `019d3179-fb11-...` |
| JTL | 992 | Hyperspace Foil | `019d317a-b60f-...` | `019d3179-fb11-...` |

SOR and JTL each have their own independent root. Nothing in JTL ever points to a SOR uuid, even though it's the same physical card reprinted. This directly confirms the design preference: a variant relates to the standard printing **within its own set**, even when an identical card exists as its own standard elsewhere.

**Confirmed example — container set, cross-set anchor (SORP Weekly Play, §5 Scenario C):**

Every SORP (Spark of Rebellion Weekly Play) card's `variant_of_uuid` points directly to a `uuid` in the **SOR** core set — never to another SORP row, never null. Spot-checked across 10 cards; pattern held for all of them. Confirmed structurally identical behavior for Convention Exclusive (C26) — see §5 Scenario G/H for the C26 table.

### The integrity invariant this design depends on — corrected 2026-06-21 against the full export

**Multi-hop chains exist — resolution must walk to the ultimate root, not assume one hop.** The original wording here ("must always point directly to a root... never to another non-root variant") was written from a handful of spot-checked examples and is **factually wrong** against the full corpus. A full live capture of all 8,353 cards (2026-06-21, `backend/app/tests/fixtures/swuapi_export_2026-06-21.json`) found **143 two-hop chains**, concentrated in 6 Weekly Play/Promo container sets (P25: 44, P26: 23, LAWP: 20, SECP: 20, LOFP: 19, JTLP: 17), all following the same pattern: `"<X> Foil" → "<X>" → Standard root` — e.g. `JTLP_21 "Weekly Play Foil" → JTLP_1 "Weekly Play" → JTL_32 "Standard"`. The intermediate card (`JTLP_1`) is itself a non-root variant whose own `variant_of_uuid` correctly points to the JTL root; the foil sibling just points to the intermediate card instead of straight to the root.

**The corrected invariant:** resolving any card's `base_card_id` requires **walking `variant_of_uuid` until reaching a row whose own `variant_of_uuid` is `null`** (the ultimate root) — not assuming a single hop. Zero hops beyond 2 were found in the full export; the invariant test (§8) should assert termination within a small bounded number of hops (and fail loudly if a cycle or an unexpectedly deep chain appears), not assume exactly one hop. This is a mechanism correction recorded here, not a vocabulary or product decision — it doesn't touch finish-vs-provenance modeling (§3.2) or `stamp_group` assignment, both still reserved for BL-27's Opus-level pass.

---

## 4. Database Design

Full schema detail lives in `SWU_Backlog.md` BL-33 — this section states only how `variant_of_uuid` feeds it, so the two documents don't drift.

- **`base_cards`** rows = roots. One row per `variant_of_uuid: null` card, grouped by its own set.
- **`card_variants.base_card_id`** is derived directly by resolving each card's `variant_of_uuid` to its root's row — no `(name, subtitle, variantType)` fuzzy matching needed for this step at all. (Text matching is still relevant for the deferred cross-set reprint grouping in §7, just not for within-set anchoring.)
- **`swuapi_id`** (unique-indexed on both tables) stores the raw `uuid` — this is what makes re-sync an upsert-by-ID operation rather than re-running matching logic on every poll.

**Resolved 2026-06-20 (swuapi-first redesign session — see `SWU_Application_Spec.md` §4.1):** the 17 "pure variant container" sets (the 7 Weekly Play sets, Judge Program, Promo, Convention Exclusive, Gamegenic, Gift Box, Movie Promo) **do get rows in the `sets` table** — a single `sets` table holds both base and container sets, distinguished by a *curated* **`is_base_set`** boolean (container sets are `is_base_set = false`). This was decided by user-experience intent: the catalog/inventory set pickers default to base sets and toggle to reveal the long-tail container sets, and `card_variants.source_set_code` (provenance) must FK to a real set row carrying a display name. (The earlier lean — container sets as a bare attribute with no set row — didn't account for the picker's need to display them by name.) TS26 and IBH are `is_base_set = true` (their roots are genuinely new). The flag is curated rather than derived from "contains ≥1 root" because the derived rule misfires on C26 (mostly a container, but holds the lone Zam Wesell orphan root).

---

## 5. Scenario Taxonomy

Each scenario lists: description, a real confirmed example, and what a test must assert.

### A. Simple single-set family
Most SOR/JTL-onward cards. One root, several non-root variants, all pointing to it, all within one set.
**Assert:** every non-root variant resolves to exactly one root in the same set.

### B. Cross-set reprint (independent roots)
Corellian Freighter (SOR_250 / JTL_258) — see §3 table.
**Assert:** two sets' roots for the "same" physical card are never merged into one `base_cards` row, despite identical name/subtitle.

### C. Container-set variant (cross-set anchor)
SORP (Weekly Play) cards → SOR root; C26 (Convention Exclusive) cards → core-set roots (Boba Fett, The Mandalorian, Qi'ra, Cad Bane, Jabba the Hutt all resolve into other sets — see §5G table).
**Assert:** a variant's `base_card_id` correctly resolves into a **different** set's root; container-set membership doesn't change which `base_cards` row a variant belongs to.

### D. Old-set card-number collision
SOR/SHD/TWI contain 14 genuine cross-variant `card_number` collisions (concentrated entirely in the three earliest sets — confirmed zero in JTL onward).
**Assert:** matching never relies on `card_number` as a key; resolution via `variant_of_uuid` is correct regardless of number reuse.

### E. Newer-set baseline (no collisions)
JTL onward.
**Assert:** the same mechanism produces the correct result without any set-specific special-casing — a regression here would mean the mechanism silently depends on collision-handling logic that shouldn't exist.

### F. Serialized Prestige triple-finish collision
SEC's 21 "Serialized Prestige" senator cards (Queen Amidala, Mon Mothma, etc.) each have **3 rows sharing identical `set_code`/`card_number`/`variant_type`** ("Serialized Prestige") — three distinct finishes (Carbonite/Gold/Rose Gold), distinguishable only by `uuid` and image filename suffix (`_A`/`_B`/`_C` observed in `front_image_url`), not any structured field.
**Assert:** all three finish rows are retained as distinct `card_variants` rows keyed by `swuapi_id`/`uuid`; `(base_card_id, variant_type)` must **not** be assumed a unique constraint — this is the one confirmed case where it isn't. *(Carried forward from BL-28's findings log; needs re-verification against live data when this scenario's test is written — not yet re-confirmed this session.)*

### G. Standalone new-base set
TS26, IBH — and C26's non-exception cards.

Confirmed C26 table (2026-06-20):

| name | subtitle | card_number | variant_type | variant_of_uuid |
|------|----------|-------------|---------------|------------------|
| Boba Fett | For a Price | 1 | Convention Exclusive | → core-set uuid |
| The Mandalorian | Let's See the Puck | 2 | Convention Exclusive | → core-set uuid |
| **Zam Wesell** | **Not What She Seems** | **3** | **Convention Exclusive** | **`null`** |
| Qi'ra | Master of Teräs Käsi | 4 | Convention Exclusive | → core-set uuid |
| Cad Bane | Now It's My Turn | 5 | Convention Exclusive | → core-set uuid |
| Jabba the Hutt | Eminence of Tatooine | 6 | Convention Exclusive | → core-set uuid |

Five of six C26 cards are Scenario C (container-set variants of existing core-set roots). TS26 and IBH cards that don't match any core-8 card are the genuine version of this scenario — new roots, in their own right, no anchor needed because they *are* the anchor.
**Assert:** a root with `variant_type == "Standard"` and `variant_of_uuid: null` in a non-core set is correct and complete — it must not be flagged as an exception just because it doesn't match a core-8 card by name.

### H. No-anchor exception
Zam Wesell – "Not What She Seems" (C26, card #3) — the one row in the table above with `variant_of_uuid: null` whose own `variant_type` is `"Convention Exclusive"`, not `"Standard"`.
**Assert:** this exact condition — root, non-`"Standard"` `variant_type` — is the precise, sole definition of "no standard anchor exists." See §6.

### I. Chain-depth invariant — corrected 2026-06-21
All sets, all cards. **143 real 2-hop chains exist**, all of the form `"<X> Foil" → "<X>" → Standard root`, concentrated in 6 Weekly Play/Promo container sets (P25, P26, LAWP, SECP, LOFP, JTLP) — see §3 for the corrected mechanism and confirmed examples.
**Assert:** resolving any card's anchor terminates at a true root (`variant_of_uuid: null`) within a small bounded number of hops, with no cycles — not that it takes exactly one hop, which is false for 143 confirmed cards. See §3.

---

## 6. Exception Handling

**Definition (refined 2026-06-21, BL-27):** a card is a standard-anchor exception if and only if it is a root (`variant_of_uuid: null`) whose own `variant_type` is not `"Standard"` **and** it has no unique non-token `(name, subtitle)` match to a Standard root elsewhere in the corpus (i.e. the fallback below cannot resolve it).

This is intentionally narrow and structural — not "no card matched by name search," which was the (less precise) framing BL-28 originally used. **Census + decision 2026-06-21 (BL-27):** a full census of the captured `/cards` export (8,353 records) found **15** roots with a non-`"Standard"` `variant_type`. Of these, **14 have a unique non-token cross-set `(name, subtitle)` match to a real Standard root** — Jeremy's call (having inspected the set) is that these are swuapi *data errors* (an unpopulated `variant_of_uuid`), so ingestion **re-anchors them via the `(name, subtitle)` fallback** rather than flagging them; they are **not** exceptions. One candidate, `GG_5 Experience`, matched 7 Standards because it is a duplicate-per-set **token** — it is exempt from the fallback and stays its own `base_card` (redesign spec §3.4). The fallback is a **targeted correction for non-`"Standard"` roots only** — `variant_of_uuid` remains the authoritative within-set anchoring mechanism for everything else — and must return a **unique non-token match**; if it returns 0 or >1, stop and decide manually. Only **Zam Wesell** has no match and remains the sole confirmed true exception. Full diagnostic detail in `swuapi_standard_variant_exceptions_review_2026-06-21.md`.

**Philosophy:** exceptions are flagged, never block catalog inclusion, and are assumed to resolve over time as swuapi reveals more data (a future convention reveal, a future set, etc.) — not bugs in our ingestion logic to chase down. The C26 set itself (6 total cards, no release date, last-scraped today) and ASH (not yet released) are both examples of "in-development" containers; a card like this previewing unreleased content is expected behavior of a live, evolving data source, not a data-quality problem.

**Where the current list lives:** [`swuapi_standard_variant_exceptions.md`](swuapi_standard_variant_exceptions.md). **Corrected 2026-07-24 (BL-150 W1):** that file is **not** regenerated automatically on each ingestion run, despite what this document and the file's own footer previously claimed. `render_exceptions_doc()`/`regenerate_exceptions_doc()` exist in `swuapi_transform.py`, but `run_swuapi_ingestion.py` never calls them — confirmed by the runbook's Scenario E correction (first live execution, 2026-07-14): "the runner does NOT call these automatically." If an ingestion's exception set differs from the committed doc, `regenerate_exceptions_doc()` must be invoked explicitly. Deliberately kept short and separate from this document — checking "is this still an exception" should never require reading the full reference spec.

---

## 7. Deferred / Related Concepts (explicitly out of scope here)

- **Cross-set reprint grouping.** "Show every printing of this physical card, reprints across sets included" (wanted for the card detail popup) requires grouping independent roots by `(name, subtitle)`, case-insensitive, *across* sets — layered on top of the within-set mechanism this document describes, not part of it. Deferred per 2026-06-20 conversation; pick up when popup work (S6) reaches this feature. **Tracked: `SWU_Backlog.md` BL-52.**
- **`stamp_group` (BL-31/BL-32).** Grouping a root's many non-root *tournament-tier* children (e.g. Rey's 6 RQ-tier variants, pixel-identical art with only a stamp changed) for UI consolidation is a sub-grouping among one root's children — a UI concern, not a base-card-matching concern. This document's mechanism determines *that* those 6 variants share a root; which of them visually look alike is BL-31/32's problem.

---

## 8. Test Strategy

- **Fixture-based, not live API calls in CI.** Capture the specific confirmed examples in §5 (and the full `/export/all` snapshot for the large test below) as test fixtures. Live `api.swuapi.com` queries are for occasional manual re-verification (confirming fixtures haven't drifted from reality), not part of the automated suite.
- **The one large test:** load the captured full export, build the `variant_of_uuid` graph per set, and assert for every card:
  1. It is either a root, or walking `variant_of_uuid` terminates at exactly one root **within its own set**, within a small bounded number of hops (§3, §5A-C, §5I — corrected 2026-06-21: chains up to 2 hops deep are real and expected, confirmed in 143 cards across 6 container sets; assert termination and boundedness, not single-hop).
  2. No cycles exist anywhere in the dataset.
  3. **Corrected 2026-07-24 (BL-150 W1) — the invariant has three legs, not two.** Every root either (a) has `variant_type == "Standard"`; or (b) is one of the 14 non-`"Standard"` roots that the §6 `(name, subtitle)` fallback re-anchors automatically at ingestion (not exceptions — they never reach the exceptions file); or (c) is present in the current contents of `swuapi_standard_variant_exceptions.md` (§6 — **currently 1 entry**, Zam Wesell `C26_3` — the sole root the fallback cannot resolve). The prior wording here inverted the count (said "15, not 1") and collapsed legs (b) and (c) into one, which is exactly backwards from §6's own definition and misleads the test-writing audience this bullet is written for.
- **Targeted tests per taxonomy row (§5B, D, E, F, G, H)** using the specific named examples in this document, so a regression in one scenario fails legibly and points at the right case, rather than only failing the one large test with no indication of which scenario broke.

---

## 9. Appendix — Confirmed Reference Examples

Raw data pulled live from `api.swuapi.com` on 2026-06-20, used as ground truth for fixtures in §8.

**Corellian Freighter** (§3, §5B) — full table in §3.

**SORP (Weekly Play) sample** (§5C):

| name | subtitle | card_number | variant_type |
|------|----------|-------------|---------------|
| Luke Skywalker | Faithful Friend | 1 | Hyperspace |
| Darth Vader | Dark Lord of the Sith | 2 | Hyperspace |
| Vader's Lightsaber | — | 4 | Hyperspace |
| I Am Your Father | — | 5 | Hyperspace |
| Grand Moff Tarkin | Death Star Overseer | 6 | Hyperspace |
| Admiral Motti | Brazen and Scornful | 7 | Hyperspace |
| Luke's Lightsaber | — | 8 | Hyperspace |
| C-3PO | Protocol Droid | 9 | Hyperspace |
| R2-D2 | Ignoring Protocol | 10 | Hyperspace |
| Leia Organa | Defiant Princess | 11 | Hyperspace |

(all 10 resolve `variant_of_uuid` into SOR — confirmed, individual SOR uuids omitted here for brevity, available via live re-query if needed.)

**C26 (Convention Exclusive)** (§5G/H) — full table in §5G.

**SEC — Zam Wesell, "Inconspicuous Assassin"** (distinct from the C26 "Not What She Seems" card — same character name, different physical card):

| card_number | variant_type | variant_of_uuid points to |
|---|---|---|
| 29 | Standard | `null` (this is the root) |
| 293 | Hyperspace | SEC_29 |
| 539 | Standard Foil | SEC_29 |
| 785 | Hyperspace Foil | SEC_29 |
| 1069 | Standard Prestige | SEC_29 |
| 1112 | Foil Prestige | SEC_29 |
| 1155 | Serialized Prestige | SEC_29 |
