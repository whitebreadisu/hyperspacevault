# SWU Application Spec — Archive

Superseded and extracted text from `SWU_Application_Spec.md`, moved here **verbatim**
under the three-tier documentation regime ([ADR-0020](../docs/decisions/0020-three-tier-documentation-regime.md)):
the spec keeps current-state claims and a dated tombstone per extraction; durable
rationale lives in the ADR series; this file preserves the original prose exactly
as it stood at extraction time. Entries are append-only, newest last within each
extraction batch. Section numbers refer to the spec as of the extraction date.

---

## Extraction batch 2026-08-17 (BL-233 initial migration)

### §5.14 Variant scope + Unit Value column (BL-173/BL-181 build record, whole section)

**Disposition:** → archive; the spec's §5.14 is replaced by a current-state summary. The round-by-round build narrative and owner-dialed pixel geometry below are the historical record; the fixed-width geometry (natural width / cap trio / docking breakpoint) was subsequently superseded by BL-226's width tiers (spec §21).

> ### 5.14 Variant scope + Unit Value column (BL-173, merged 2026-07-27)
>
> Full decision record: `planning/Definition_VariantScope_2026-07-26.md` (behavior + owner-locked design); chase-feasibility evidence: `analysis/VariantScope_Finish_Chase_Feasibility_2026-07-26.md`. Built in one Sonnet-agent pass + five owner dev-review rounds (rounds 4–5 iterated live on the local vite loop — see the session's process note). As-built summary (final state after all rounds):
>
> - **The table is 15 columns again:** `# · Name · Variants · Playset · Unit Value · Rarity · …` (supersedes §5.13's 14-column note). Natural width returns to the long-proven **1526px** (round 5: a `table-layout: fixed` table never renders narrower than its column sum, so BL-173's interim +44px grew a sliver horizontal scrollbar on mid-width viewports; the 44px was reclaimed from six ellipsis-guarded columns, keeping every owner-dialed BL-173 width intact).
> - **Unit Value column** (between Playset and Rarity, 102px): the unit price of the relevant printing — scoped variant when scoped, else the Standard printing with min-of-active-kind fallback; ≥$100 renders whole-dollar; unpriced = em-dash; price text pulled 38px off the column's right edge (owner-dialed air before Rarity). Header stacks a **MKT/LOW toggle above the "Unit Value" label** — Market default, persisted in localStorage (`swu.cardsValue.kind`); scope is transient by design. *(Header controls and column width superseded by the BL-181 addendum below; the per-row unit semantics are unchanged as the UNIT mode.)*
>
> **BL-181 addendum (2026-07-31) — Unit/Collection toggle + app-wide Market/Low switches.** Owner-requested after a collection-value audit (the header block's math was verified faithful against a prod DB recomputation; the perceived inflation decomposed into market-vs-low mode, quantity multiplication, and premium variants valued at their own prices — no bug). As-built:
> - **The Value column header is two centered rows** in a 114px column: a large **UNIT/COLLECTION switch** on top, then a small **MARKET/LOW switch left of a static "Value" label**. Both are the new **`ValueSwitch`** control — a track-and-thumb switch showing only the ACTIVE state's label inside the track, flipping per click (blue-accent on-state; `role="switch"`).
> - **COLLECTION mode** (`cardCollectionValue`, `utils/variantScope.ts`): per row, the viewer's owned copies' value — Σ qty × each owned variant's own price (active kind), unpriced variants falling back to the card's Standard price (the §5.12 completion-panel chain at row grain, so the column visibly decomposes the Collection-value block's total). Em-dash for unowned rows AND owned-but-unpriced rows (never a fabricated $0.00). **Scoped:** scoped finish's owned qty × that finish's own price, no fallback — mirroring scoped UNIT mode's no-fallback rule and the scoped pips. Persisted like MKT/LOW (`swu.cardsValue.display`, default UNIT).
> - **One Market/Low idiom app-wide:** the same `ValueSwitch` (full MARKET/LOW labels) replaces the pills in the completion panel's value block and the card popup's rail header (the popup control lives in the decomposed `CardPopupRail` — BL-155's split held).
> - **Geometry:** Value column 102→114 with the full width-sync ripple (natural width 1538, cap trio 1540→**1552**, docking breakpoint 1906→**1918** incl. `DOCKED_MIN_WIDTH` + its pinning test, in-head bracket 226). Playset header label + cell contents nudged **7px right** (the scope trigger deliberately not). The hover inventory dossier now **hugs its content** (`max-content`, 132–200px bounds, nowrap rows with a guaranteed 14px label↔count gap; the max is sized past the catalog's longest real finish label, "Convention Exclusive").
> - **Variant-scope control** in the Playset header (trigger stacked above the "Playset" label, reads **ALL FINISHES** unscoped / `PIPS · <finish>` scoped): single-select menu built from the FinishFilter's own control anatomy (menubar "All finishes" bar-button acting as clear; square pair chips for Standard/Hyperspace/Weekly Play; **Prestige as a pinned chip row**; expander → Convention/Event/Prerelease/Movie plain rows; **Showcase deliberately excluded** — a leaders-only playset-1 finish is not a pip scope; order mirrors the sidebar Finish filter; 13 scopes total).
> - **Scoped state semantics:** picking a scope REPLACES `FilterState.finish` with the single raw value (rows narrow via the existing filter engine); a direct FinishFilter panel edit disengages the scope ("scope drives filter, never vice versa"); Reset All Filters disengages too; unrelated facets don't. Pips fill from the scoped variant's owned count only — **amber fills below the variant playset (no outline); at scoped-complete the pips turn green inside an amber-outlined plate**. The count chip NEVER changes (total across variants, green at total playset). Mapping visuals: an in-header amber bracket spanning Playset+Unit Value (absolute overlay on the sticky th — a separate thead row read as table content and was retired in round 2; round 3 fixed the sticky regression it briefly caused), faint amber wash on both columns' cells, dossier head "OWNED — ALL VARIANTS" with a `◂ scope` marker on the scoped finish's row. Anonymous: scope + Unit Value fully functional; pips stay signed-out-empty.
> - **Filter-panel normalization shipped with the rounds:** FinishFilter renders **Prestige as a 3-chip row** (Std/Foil/Serialized — presentation-tier only; the tree still models a group; tournament families keep expandable groups); the Finish and Set menus open at a **320px floor** (`FilterMenuPortal minWidth` — control widths unchanged); the Set menu's values follow the **Add Cards grouping logic** (base sets with their Weekly Play containers interleaved, then Exclusives subgroups; unknown codes append) and its redundant "All" menubar button is removed (Clear suffices).
> - **Card popup set row (owner round 4):** card type + aspect icons joined the set row, right-aligned (type text left of the icons), aspect icons at **46px** matching the stat badges; the standalone aspects/type line is retired. Popup rarity symbol nudged to `top: 4px` against the set/rarity stack.
> - **Completion popovers:** a subtle divider between set rows; completion blocks preview their open-state blue outline on hover.
> - **Cross-links:** Import/Export's format notes shipped in the same rounds (§17); the pricing gap the scope picker exposed (every non-booster finish em-dash) is BL-174's mapping extension (§16).

### §5.15 Completion-panel set selection + filter-panel UX (BL-179 build record, whole section)

**Disposition:** → archive; the spec's §5.15 is replaced by a current-state summary. The home-base-set dimension and three-way scope toggle described below were retired by BL-224/BL-223 in v1.4 (spec §21); the popover-interaction mechanics and filter-panel behavior survive on the unified Set facet.

> ### 5.15 Completion-panel set selection + filter-panel UX (BL-179, merged 2026-07-30) — **partially superseded by v1.4**
>
> > **Supersession (2026-08-16, v1.4 — §21):** BL-224 retired the separate **home-base-set dimension** outright — popover set rows now read/write the sidebar's own Set facet (`filters.set`, one selection, one language) — and BL-223 replaced the **three-way scope toggle** (Selected sets / Filtered / All) with the two-way FILTERED/ALL Totals switch. The popover-interaction mechanics below (rows-as-filter-control, hover-dismiss, inert zero-universe rows, always-deselectable selections) survive on the unified facet; the "second set axis" and its amber readout/✕ do not.
>
> Owner-specified in-session (issue hyperspacevault#14); built entirely on the local vite loop across **ten owner-review rounds** before one merge (PR hyperspacevault#15) — the first feature shipped on the public repo. As-built:
>
> - **Popover set rows are a filter control.** Each completion block's "by set" rows toggle that set in a **home-base-set dimension** — a second set axis, distinct from the Set facet (facet = home-OR-printing via `source_set_code`; this = `card.set_code` only), ANDed with every other filter, one selection shared across all four popovers. **Rows ignore their own dimension** (the menu never filters itself — §5.14's scope lesson, same shape as `facetValidValues`): they respect every other filter, so a non-base facet selection distributes across home base sets with zeros elsewhere. Zero-universe rows are inert; an already-selected row is always deselectable. Selected rows: steel-blue band + accent edge (green stays reserved for 100%); hover lift; the popover hover-dismisses (armed after pointer entry; wrap-level boundary with a transparent gap bridge). Top-right facet readout ("Sets selected: …") when the Set facet is active.
> - **Three-way scope toggle** in a full-width strip row under the blocks: **Selected sets** (filter panel + base-set selections = the table; renders only while selections exist) / **Filtered** (filter panel only) / **All** (whole catalog). Auto-follows transitions (first selection jumps to Selected sets; clearing the last falls back to Filtered) and never overrides a manual choice between them. Beside it, an amber **"Base sets: …" readout + clear ✕** in the §5.14 bracket type treatment. Popover rows use the Filtered universe under both narrowed lenses, whole catalog under All.
> - **Clearing:** the amber ✕ and the panel's Collection-section chip clear only the base-set dimension; **Reset All Filters clears everything** (FilterState + base sets, staying active when only the latter exist). **Round 11 (2026-07-30):** the three Collection checkboxes (incomplete playsets / cards I own / no inventory) are first-class applied filters — they count toward the collapsed rail's badge, activate Reset, and are cleared by it (replaces BL-91's "reset only touches FilterState" contract; the base-set selection counts as one badge unit for the same badge↔reset coherence).
> - **Filter panel behavior:** facet dropdown menus hover-dismiss (armed; 4px trigger gap bridged; leaving back onto the control exempt). The **docked state is now real and self-asserting**: one-column tier (viewport ≥1052px tall = `DOCKED_MIN_HEIGHT`) AND side-by-side width (≥1906px — breakpoint retuned from 2266, which still assumed the retired 1900px table cap) auto-expands the panel **in-flow against the table's left edge**, pair centered (supersedes BL-144's read-once initial-state model and the 07-26 far-left pin for docked mode); only the « button collapses it there. Everywhere else the panel is the floating overlay: collapsed by default, auto-collapsing once the pointer settles outside it (document-`mouseover`, armed per open; drags and portaled menus guarded). Label: **"Filters"** (owner dev-review 2026-08-05 — was "Catalog Filters" since BL-179 R10; shipped in v1.3).
> - **Table geometry fix (latent since §5.14 round 5):** the 1528px cap left no allowance for the thin vertical scrollbar — its appearance squeezed the wrapper below the 1526px column-sum floor (sliver h-scrollbar; at the list bottom the h-bar's height perturbed the virtualizer viewport = visible row shake). Fixed by construction: `scrollbar-gutter: stable` + the synced width trio 1528 → **1540** (columns + border + 12px gutter allowance).

### §19.4 Decisions record (original full ledger)

**Disposition:** sharing rows → [ADR-0019](../docs/decisions/0019-sharing-secret-link-trust-model.md); design-stage rows for the unshipped list features stay in the spec's trimmed §19.4; the release-framing row is historical (v1.4 shipped 2026-08-16).

> ### 19.4 Decisions record
>
> | Decision | Ruling | Owner date |
> |---|---|---|
> | Product name for lists | **Binders** | 2026-08-11 |
> | Share access model | Secret link, no viewer accounts | 2026-08-10 |
> | Collection-share fidelity | Full Vault, viewer-mode; zero config; prices/value always shown | 2026-08-11 |
> | Share identity | Owner-named at creation; name IS the viewer's header label | 2026-08-11 |
> | Share session | Tab lifetime; newest replaces; no saved list; no view tracking | 2026-08-11 |
> | Wanted granularity | Any-printing OR specific-variant, both first-class | 2026-08-11 |
> | Surplus defaults | R/L auto-overflow ON, C/UC OFF, non-standard ON | 2026-08-11 |
> | Deck lists | Skin only in v1 | 2026-08-10 |
> | QR codes | Deferred to mobile scope (BL-190) | 2026-08-11 |
> | Pricing on shared views | No ToS gate — same public per-card prices anonymous users already see | 2026-08-10 |
> | Share cardinality | One active share per scope target; rename/rotate, no concurrent duplicates | 2026-08-11 |
> | Release framing | v1.4 = BL-205 alone; BL-206 opportunistic pull-forward | 2026-08-11 |
