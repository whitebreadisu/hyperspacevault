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

---

## Extraction batch 2026-10-02 (BL-239 Homeworlds onboarding — standing exception resolved upstream)

The variant-mapping spec and the exceptions report have no archive file of their own; their superseded text is kept here, labelled by source document.

### App Spec §3.3 — sole-exception claim (sentence)

**Disposition:** → archive; upstream populated `C26_3.variant_of_uuid` (→ `HMW_134`) in the 2026-10-02 export, so the catalog has zero standard-anchor exceptions.

> leaving **Zam Wesell as the sole genuine exception** (§10.6).

### App Spec §10.6 — Zam bullet

**Disposition:** → archive; the sole exception resolved upstream 2026-10-02. Rationale for the manual orphan cleanup → ADR-0004 amendment.

> - **Zam Wesell (C26_3)** is the sole genuine no-anchor exception (0 matches). The exceptions file regenerates to just Zam.

### Mapping Spec §6 — sole-exception sentence

**Disposition:** → archive; resolved upstream 2026-10-02.

> Only **Zam Wesell** has no match and remains the sole confirmed true exception.

### Mapping Spec §6 — philosophy example sentence

**Disposition:** → archive; the examples it names (C26 unreleased, ASH unreleased) are no longer current.

> The C26 set itself (6 total cards, no release date, last-scraped today) and ASH (not yet released) are both examples of "in-development" containers; a card like this previewing unreleased content is expected behavior of a live, evolving data source, not a data-quality problem.

### Mapping Spec §8 item 3 — exception-count clause

**Disposition:** → archive; the count is fixture-relative now that the live catalog has zero.

> (§6 — **currently 1 entry**, Zam Wesell `C26_3` — the sole root the fallback cannot resolve).

### Exceptions report — current-exceptions table (whole section)

**Disposition:** → archive; `C26_3` resolved upstream 2026-10-02, the report now lists zero.

> ## Current exceptions (1)
>
> | Set | Card # | Name | Subtitle | Variant Type | Notes |
> |-----|--------|------|----------|---------------|-------|
> | C26 | 3 | Zam Wesell | Not What She Seems | Convention Exclusive | The sole true orphan — no Standard `(name, subtitle)` match anywhere in the corpus. C26 is an in-development preview set (no release date, 6 total cards); likely previews a printing not yet revealed. |

### App Spec §17.5 — refusal-posture bullet, admission sentence (archived 2026-10-08, BL-241)

**Disposition:** → ADR-0028 (printed codes map direct at onboarding) + archive. The "never a guess" refusal stays in §17.5; only the admission rule changed.

> - **The refusal posture (locked):** all mapping tables are **deliberately partial** — an unmapped set code (`unmapped_set`) or quantity column (`unmapped_column`) becomes an itemized problem row, **never a guess** (a wrong set/column guess silently attributes the wrong printing — the one failure mode worse than refusing). Owner's standing rule: the tables map only swuapi-sourced catalog content, and a code enters a table only once a real export from that tool has shown it (e.g. `HMW` stayed unmapped from its 2026-08 preview appearance until a real HoloScan/SWUDB-format export verified it on 2026-10-08).

## Archived 2026-10-11 — §25.4 slice-4 interim wording superseded by slice 5 (§25.5)

Two §25.4 sentences described slice-4 state ("until slice 5"); replaced in place when slice 5 landed (BL-251). Verbatim:

> Code: `frontend/src/mobile/more/`. Routes `#/more`, `#/about`, `#/more/about`, `#/more/updates`, `#/more/importexport`; Settings, Change Password and Sharing stay one-sentence placeholders until slice 5.

> - **Gating** is desktop's. Import & Export and Sharing stay listed as `aria-disabled` teasers for a signed-out visitor and open sign-in. Import & Export is also inert for a signed-in unverified account and a tap shows "Verify your email to import or export your collection." Desktop's tail "— see the banner above." is dropped because the phone has no verify banner until slice 5.

## Archived 2026-10-11 — §25.1 shared-link interim sentence superseded by slice 6

One §25.1 sentence described the pre-slice-6 state; replaced in place when the shared vault landed on the phone (BL-252). Verbatim:

> - **Share links.** `/shared/{token}` links render the desktop view on phones until the shared-vault slice.

## Archived 2026-10-11 — §24 / §25.1 spike-era and interim wording superseded by the camera build (BL-253)

Sentences replaced in place when the scanner was built (stages 7a-7c). Each is the exact superseded text.

**§24 heading and Status paragraph ("NOT BUILT", prototype static mock).** Verbatim:

> ## 24. Card scanning (BL-238 spike — specified 2026-10-10; **NOT BUILT**)
>
> **Status.** Design decided from the BL-238 camera spike (ADR-0029); nothing
> ships yet. The mobile prototype (BL-190, Revision 1) carries the camera
> screen as a static mock of this section. Owed before a build commits:
> the Stage 3 timed pile against the keypad, ≥ 110 attempts under the final
> rules, printed-code collision evidence from the community, a second phone.
>

**§24.2 optional explicit controls sentence.** Verbatim:

> distance is the user's control. Optional explicit controls (zoom, focus
>   distance, torch, lens) may exist but default untouched.

**§24.3 crop-start clause.** Verbatim:

> The OCR crop is the group plus
> 3.15 mm of padding, starting 0.6 mm right of `©FFG` so that text is
> excluded.

**§24.3 sliders sentence.** Verbatim:

> two ±4 mm sliders exist for on-phone calibration. The owner expects to keep
> refining these values.

**§25.1 Shell bullet, bottom-bar clause.** Verbatim:

> Three-item bottom bar (Vault, centre keypad SWUButton — camera behind `MOBILE_CAMERA_ENABLED = false` — More).

**§25.1 routes bullet, route list.** Verbatim:

> `#/card/<id>` (§25.2) and `#/pad` (§25.3) are built;

**§25.3 Tool layer bullet, camera-toggle clause.** Verbatim:

> The camera mode toggle exists only behind `MOBILE_CAMERA_ENABLED` (off; the camera ships in slice 7).

## Archived 2026-10-11 — §25 slice-by-slice text superseded by the closing consolidation (BL-252 S6-09)

Superseded by the consolidated §25 (25.0 overview, 25.1–25.7 de-duplicated, §25.6 added): the gate, routes and share-link bullets of §25.1, the per-subsection Analytics and Tests/Harness bullets (now §25.0 and §22), the in-text supersession tombstones, and the interim wording ("placeholder", "arrives with the closing sweep", "since slice 5", "the §25 consolidation belongs to the closing sweep"). The whole pre-consolidation §25 follows **verbatim**.

> ## 25. Mobile experience (BL-190 — as built, slice by slice)
> 
> ### 25.1 S1 Shell + Vault (BL-247)
> 
> - **Gate.** `useIsPhone()` = `matchMedia("(max-width: 767px)")`, live; when it matches, `App.tsx` renders `frontend/src/mobile/MobileApp` inside the same providers, otherwise the desktop tree. Tablets (>= 768 px) get desktop. Phone CSS is scoped under `.m-app`.
> - **Share links.** `/shared/{token}` renders the phone tree at phone width; the shared vault is a second pane beside the own Vault, switched from the bar's Vault button (§25.6 arrives with the closing sweep). *2026-10-11: slice-1 interim sentence superseded by slice 6 — verbatim in SWU_Application_Spec_Archive.md.*
> - **Routes (hash).** `#/vault` (params `set`, `finish`, `q`, `view`, `size`, `gsize`, `sheet=scope|sort|filters|sets`, `collapsed=1`), `#/more/feedback`; `#/card/<id>` (§25.2), `#/pad` (§25.3) and `#/camera` (§25.7: on `/` it hops to the isolated `/scan/` document, which shows the camera) are built; `#/more`, `#/about`, `#/more/{about,updates,importexport}` are built (§25.4); `#/more/{settings,password,delete,sharing}` are built (§25.5). Unknown or empty hash → `#/vault`; back = history back, else `#/vault`.
> - **Shell.** Three-item bottom bar (Vault, centre SWUButton showing a keypad and a camera glyph, lit for the mode used last, More). *2026-10-11: the "camera behind `MOBILE_CAMERA_ENABLED = false`" clause is superseded (the flag is on) — archive.* Header: `[HSV] Hyperspace Vault` over `Unofficial Fan Project [v#.#.#]`, text Feedback button, account slot (Sign in / avatar menu: Settings, Change Password with a password provider only, About & Legal, Log Out). Title / badge tap opens the About & Legal / [HSV] Updates chooser; the unread release-notes cue glows on the title (badge when collapsed), never on More.
> - **Collapse.** The header collapses as the list scrolls; back at the top it stays collapsed; a tap on the strip or a deliberate pull from the top expands. Motion is transform + opacity only; the starfield is clipped, never moved. Strip: badge, amber funnel while the totals are filtered, %, ten ticks, "n cards", value without cents.
> - **Completion panel.** Desktop `computePanelMetrics` over the narrowed list (or every card under Totals = All). Totals Filtered / All shows only while narrowed and signed in; Filtered draws the amber ring. Market / Low = desktop's persisted price kind (shared with the rows). Signed out: em dashes, empty ticks, no breakdown. Tapping the body opens **Completion by set**: one row per base set (`buildSetBreakdown` over every narrowing except the Set facet); a row tap sets the Set facet to that set.
> - **Status rows.** Row one: search ("Search the vault"; name, subtitle, card number), Clear (only while narrowed, amber), Filters + active count. Row two: count ("n cards", amber when narrowed, no "of m"), finish-scope chip, icon-only Sort (desktop's sortable columns, `nextSortState`), List / Gallery toggle (List → 4 row sizes incl. no image; Gallery → 1 / 2 / 3 across; remembered per browser session).
> - **Search mode.** Focus collapses both headers, the status row and the bottom bar (separators stay); blur restores; clearing the query does not.
> - **Finish scope.** Picking a scope writes the Finish facet (so Clear appears); editing the Finish facet disengages it; "All finishes" clears; never persisted. The scope drives row pips, number, price and art, and the sort.
> - **Card surfaces.** Rows and gallery plates use desktop's count chip + pips (`cards.css` literals); no "n/m" on any card surface; missing price = "—". Lists are virtualised. Empty state: "No cards match the current filters."
> - **Leave Feedback** (`#/more/feedback`): desktop FeedbackModal copy and rules in a steel-ring screen; auto-closes 1.5 s after "Thanks for the feedback!".
> - **Analytics.** `layout` super-property (`phone` / `desktop`); phone events carry `layout: "phone"`: `screen_viewed` (vault, feedback), `view_mode_changed` (`rows_none…rows_lg`, `gallery_1…gallery_3`), `search_performed`, `sort_changed`, `finish_scope_changed`, `filters_cleared`, `feedback_submitted`.
> - **Tests.** Layout: Playwright in `frontend/e2e/mobile/` (projects phone-390, phone-430, desktop-1440; API answered from `e2e/mobile/fixtures/`; sign-in on the Firebase Auth emulator). Run `npm run e2e:mobile` in `frontend/` (starts the emulator when port 9099 is free); CI job `frontend-e2e-mobile`, required by `ci-ok`. Logic: vitest beside the code in `frontend/src/mobile/`.
> 
> ### 25.2 S2 Card detail + Filters (BL-248)
> 
> **Card detail** (`frontend/src/mobile/card/`, route `#/card/<id>[?v=<variantId>]`):
> - Renders as a **layer over the Vault**, so the Vault's filters, scope and scroll position survive a round trip; the bottom bar is hidden under it. X top-right closes it.
> - Fixed starfield header that never collapses; the art region collapses on scroll by transform + opacity only (layout probe: 0 layouts / 0 shifts at 390 and 430); scrolling back to the top never re-expands; a tap or a deliberate pull does. Leaders flip (two-phase rotateY); bases show a landscape art box.
> - The top bar's "n of m" is amber when the list the card was opened from is narrowed; prev / next open the neighbour on its matching printing (scoped printing from a scoped row, displayed printing from a gallery cell).
> - The plate (steel frame, count chip + 10 px pips) describes the **selected printing** (R5-5): chip = that printing's count; pips amber while short of the playset, green inside the amber plate at a playset; no scope marker. Changing the printing in the rail updates the plate, art and price at once.
> - The rail is titled "Variants" (desktop label); only the selected printing carries a − / + stepper (desktop `adjustCard` with an optimistic patch); other rows show ×N. Signed out, the stepper is `aria-disabled` and routes to sign-in. Over the limit, the quantity is red/amber with desktop's "Over limit" tag; no "n/m" on card surfaces.
> - Price history: desktop ranges 30D / 90D / 1Y / All, line chart; a drag or tap sets the reading (touch replacement for the desktop crosshair); the readout shows the point's real date; empty state = desktop wording.
> - Swipe between cards: the body slides as one page under the fixed header (owner switch swipe=body); snap-back under threshold; the route changes after the motion.
> - Owned-by-finish sheet (R5-1), opened from a Vault row's price/playset cluster (signed in) or from the detail plate: head = the card's count chip + pips; one row per printing, owned or not, each with its own neutral chip and pips (0 = empty grey; short = amber; playset = green inside the amber plate); "Open card" only when opened from the Vault.
> - Aspects sheet: tapping an aspect icon lists the card's aspects with names (touch replacement for the desktop hover name).
> - Analytics (additive, `layout: "phone"`): `card_popup_opened {source: row | gallery | swipe | nav}`, `popup_card_navigated {method: swipe | …}`, `price_history_opened` (first range tap or chart touch per card), `quantity_changed {surface: "detail"}`.
> 
> **Filters sheet** (`frontend/src/mobile/filters/`):
> - **Entry.** The Vault's Filters button opens the Filters sheet (`mobile/filters/FiltersSheet.tsx`). Compact rows, content-fit height (max 86 % of the screen). When content grows (Gameplay opens, chips wrap, a logo loads) the sheet keeps its previous top and slides up with a transform; a shrink snaps. X top-right.
> - **Live, not a draft.** Every edit applies to the Vault at once (as on desktop). Filters, search, toggles and scope are plain screen state, never persisted: a fresh open of the app starts unfiltered.
> - **Row order:** Set, Rarity, Collection, Finish, then Gameplay (collapsed by default). Set, Collection and Finish rows show the selected values as removable 44 px chips (drawn 30 px). With nothing selected they show desktop's placeholder ("All sets" / "Any" / "All finishes"). A tap on the row opens that facet's picker over Filters; a tap on a chip removes that value. Rarity stays inline as five icon-only badges.
> - **Badge.** The Filters button badge and the sheet's "n active" use desktop `countActiveFilters` plus the four Collection toggles. Each group counts once, search counts as its own group, and a mode-only Aspects change counts 1 (desktop quirk).
> - **Footer.** Reset filters (amber outline; inert and grey at default) = desktop Reset: every facet, the search, the four toggles and the scope. "Show N cards" is live and closes the sheet.
> - **Dead ends.** Every facet value is faceted against the other active filters (desktop `facetValidValues` over the toggle-narrowed, searched list). Pickers show their whole universe (`showAllValues` on): a 0-match value reads "(0)", is greyed and cannot be added. A selected value is never hidden and stays removable.
> - **Set picker.** Base sets appear as logo chips in desktop order (`BASE_SET_ORDER`). The top bar holds "Show all sets" / "Base sets only" and Clear (no All, as desktop). The long tail (`allSetsGroups`) lists each base set's Weekly Play set in base order, then a divider, then the Exclusives. A selected long-tail set stays visible in base-only view.
> - **Collection picker.** Four switches in desktop's order (Only incomplete playsets / Only cards I own / Only cards I don't own / Over my keep limit), with desktop's exclusions applied as a toggle turns on. While scoped, the toggles are amber with a "Scoped: these read your <finish> copies only." note. Signed out, the Collection row reads "Sign in to filter" and a tap opens sign-in (MobileApp `openSignIn`).
> - **Finish picker** = desktop FinishFilter's two-tier tree (`buildFinishTree` / `shapeFinishTree`): pair rows (Non-foil / Foil chips), the Prestige row (Std / Foil / Serialized), plain rows, and tournament families. A family header only expands it; a collapsed family with selections shows "· n". A divider follows the pinned block. The top bar holds All + Clear. The value the scope wrote shows amber on the Finish row. Any Finish edit other than exactly the scoped value disengages the scope; edits to other facets keep it.
> - **Gameplay** (desktop's Gameplay group, Aspects first). The collapsed head shows "· n active" (one per group). Inside, in order:
>   - Aspects: seven chits including No Aspect. Empty = all lit; the first tap narrows to that one aspect.
>   - Any / Within / Exact (Exact is the default), with its one-line meaning.
>   - Type and Arena chips.
>   - Keyword and Trait rows. Each opens a full-height picker with a pinned 16 px search, focused on open, and an All / "All matches (n)" + Clear bar.
>   - Cost / Power / HP: one track with two 44 px thumbs and a Russo One readout ("Any" at full range). A narrowed range excludes cards with no value for that stat.
> - **Pickers.** A picker stacks over Filters with Done pinned in its foot. Set, Finish, Keyword and Trait pickers are full height; Collection sizes to its four rows. Escape closes only the top sheet. Show-all, expanded families and the search box reset on every open.
> - **Motion.** Inside the sheet and pickers only transform and opacity animate. Colour changes are instant.
> - **Analytics** (additive, BL-244), all with `layout: "phone"`:
>   - `filter_applied {field, active_filter_count, results_count}` fires once per user edit, after the change applies. Field names are desktop's (set, rarity, finish, type, arena, keyword, trait, cost, power, hp, aspect, aspect_mode, completion, owned, no_inventory, over_cap).
>   - `filters_cleared` fires on Reset.
>   - `finish_scope_changed` fires only on a scope pick.
> - **Harness.** Playwright specs `e2e/mobile/s2-12…s2-19-*.spec.ts` (helpers in `e2e/mobile/filters-helpers.ts`: rev4 b1Targets / b1NoOverflow / b1Motion ports) and vitest in `src/mobile/filters/` (`filterModel.test.ts`, `filterAnalytics.test.tsx`).
> 
> ### 25.3 S3 Keypad, choosers, verify batch, commit (BL-249)
> 
> Code: `frontend/src/mobile/tool/`. Route `#/pad` (the bar's centre button).
> - **Tool layer.** Opens over the current screen. The screen underneath stays mounted with its state; the bar is covered and inert. The header has the title and an X top-right (44 px). The header carries the keypad | camera mode toggle (camera mode: §25.7). *2026-10-11: "exists only behind `MOBILE_CAMERA_ENABLED` (off; the camera ships in slice 7)" is superseded — archive.* The keypad ignores the Vault's finish scope.
> - **Keypad.** Entry row: set button · number display (Russo One, max 4 digits, no system keyboard) · Verify button. Keys: Russo One 0–9, Clear and backspace, 58 px at rest. Hardware digits, Backspace and Enter work too. Resolution uses desktop `resolveRow` over the catalogue; a shared number shows desktop's axes (Which card? / Set / Stamp / Finish) as chips. A miss reads "Not in this set" plus desktop's sentence.
> - **Readout.** "In vault n/m" and "After add n/m" for the resolved printing, against its effective keep-limit (`LimitsContext`, hard or soft). At or over the limit the line is red `#ef4444`. "After add" counts owned + copies in the batch + 1. This readout is the only phone surface with an "n/m" fraction.
> - **Result layout.** While a card shows, the deck shrinks (44 px keys, 48 px entry row; one class flip, no animation). Card details / Add to batch stays pinned at the bottom of the result zone. A shared number compacts the panel. A finish-only share keeps desktop's non-foil default (BL-191) with the amber cue and a Change link. The deck restores on Clear and after Add.
> - **Set / precon selector.** The "Choose a set" sheet has two collapsed choosers, Set and Precon deck. Set = desktop `setGrouping` (Base sets only / Show all sets, with the toggle in the sheet foot). Precon = desktop's 23 entries (22 decks + the Hoth box). The set button shows the base logo + code (a subset reads as its base set) or the code alone for an exclusive. "Change set" reopens the choosers.
> - **Precon panel.** Shows the deck name, "N cards · M distinct", Change set and Add deck to batch. Hard-cap users also get desktop's two radios ("Don't add copies above my keep-limits" (default) / "Add the full deck, even above my keep-limits"). The number field reads "Deck" and the keys rest (`aria-disabled`, dimmed). Add deck writes every deck copy to the batch, flagged `force` when the second radio is chosen.
> - **Card details** from the keypad opens the S2 card layer on the resolved printing. The tool and its batch stay underneath, with no guard.
> - **Batch** (`batch.ts`). One row per copy: the same number three times makes three rows, and a 52-card deck makes 52 rows. It lives in a session-only module store, so it survives closing the tool and opening a card. Admission is computed when the batch is shown, per printing, with desktop's arithmetic (`inventoryStatus`, the same as `splitForVerification`): under a hard cap, copies past the effective limit are "not added" with "Inventory limit already reached."; soft cap and forced copies stay added with desktop's over-limit note; the 999 ceiling blocks in both modes. A deck copy the catalogue does not hold is listed as unresolved.
> - **Verify button.** Sits in the entry row and reads "Verify" with a count badge; the amber ring is on the badge only. It is dimmed and `aria-disabled` while the batch is empty. Adding flashes "In batch".
> - **Verify cards sheet.** Desktop AddCardsVerification's sections in order: "Unresolved rows — this shouldn't happen with precon data" (only when present), "The following cards will be added to inventory", and "The following cards will not be added" (only when any). Each section shows its count. Columns are desktop's (Card#, Name, Set, Finish, Inventory "owned → after", plus Reason in the not-added section), stacked to fit 390 px and grouped by set ("SOR — Spark of Rebellion"). Each added row has a 44 px "−" quick remove that drops one copy. There are no Keep/Skip toggles and no steppers.
> - **Footer.** "N of M cards will be added.", "Discard batch" (red text) and "Add N cards to vault" (SWUButton, inert at 0).
> - **Long batches.** When the list overflows and both the added and not-added sections exist, the two headers pin: added at the top, not-added at the bottom with its count. They act as a two-way accordion: the expanded section fills the 86 % sheet and scrolls. The sheet opens with the added section expanded. The only motion is the entering list's opacity + transform. If everything fits, or there is a single section, or the unresolved section is present, the sheet is a plain scroll.
> - **Close guard.** The tool's X with a non-empty batch, and "Discard batch", open desktop's confirm: "Discard this batch?", desktop body copy, steel ring, X top-right. **Discard & Close** has the destructive fill `#c0202e` set on the button itself (resting and hovered); Return to Batch is navy. Discard empties the batch and closes the tool (from the X) or the sheet (from Discard batch). Escape, the scrim and the X return to the batch.
> - **Commit.** Keypad copies make one `adjustCard(variantId, delta)` per printing with the folded delta. Precon copies rebuild desktop's `swu-inv/1` import file from the admitted copies (merged by swuapi_uuid) and send `runImport(file, "merge_add", capHandling, "commit")`. capHandling is "trim" for hard cap without force and "add_above" otherwise. Keypad copies go first. Desktop's busy overlay ("Applying N cards…" → "Refreshing your Vault…") runs while quantities refresh; then the sheet shows "N cards added." and closes after 1.3 s, and the batch empties.
> - **Commit errors.** Errors show inline in the sheet footer: desktop's email-verification copy, the import error message, or "Something went wrong adding those cards. Try again." Copies already written leave the batch; the rest stay.
> - **Analytics** (additive, `layout: "phone"`): `screen_viewed {screen: "tool"}` once per open; `add_cards_committed {method: keypad | precon, cards_added, distinct_cards}` once per path that wrote, with desktop's counting; `add_cards_abandoned {pending_entries}` on Discard & Close, where pending_entries = copies in the batch.
> - **Harness.** Playwright `e2e/mobile/s3-*.spec.ts` (helpers `tool-helpers.ts`; the API double answers `POST /api/inventory/import`, and quantities follow the adjust / import doubles). Vitest: `padModel.test.ts`, `batch.test.ts`, `commit.test.ts`, `toolLayer.test.tsx`.
> 
> ### 25.4 S4 More, About & Legal, [HSV] Updates, Import & Export (BL-250)
> 
> *2026-10-11: two slice-4 interim sentences ("until slice 5") superseded by §25.5 — verbatim in SWU_Application_Spec_Archive.md.*
> 
> Code: `frontend/src/mobile/more/`. Routes `#/more`, `#/about`, `#/more/about`, `#/more/updates`, `#/more/importexport`; Settings, Change Password and Sharing are real screens since slice 5 (§25.5).
> - **More** (`#/more`, bar stays, More active). The brand block is one About button; the account slot sits beside it. Groups: Collection (Import & Export, Sharing, and the sentence "Deck Check is on the desktop site." with no entry or route), Account (signed in only: Settings, Change Password with a password provider only), Hyperspace Vault (About & Legal, [HSV] Updates, Leave Feedback), then Log Out, or Sign in when signed out. Rows are 52 px with `#1e2748` hairlines, chevrons on the navigating rows only (Log Out and Sign in have none). No Prototype group.
> - **Gating** is desktop's. Import & Export and Sharing stay listed as `aria-disabled` teasers for a signed-out visitor and open sign-in. Import & Export is also inert for a signed-in unverified account and a tap shows "Verify your email to import or export your collection." Desktop's tail "— see the banner above." is dropped: the verify banner arrived with slice 5 (§25.5) and lives under the Vault header, not on More.
> - **About & Legal** (`#/about`, `#/more/about`). Steel-ring full shell (18 / 17 px cuts), title "About This Project", Disclaimer / Privacy (5 bullets) / Attribution verbatim from `AboutModal` at 14 px, desktop's Close button at 44 px. The body JSX is a fork of `AboutModal` (BL-254 folds it back); its CSS is imported unchanged.
> - **[HSV] Updates** (`#/more/updates`). `NewArrivalsPage` at phone width: a one-row sideways-scrolling quicklink rail (44 px chips, About & Legal last), then every `RELEASE_NOTES` entry newest first, each with the set starfield band (amber version and date), the circuit seam and its sections verbatim. Desktop's wrapping rail is three sticky rows at 390 px, so the phone rail scrolls instead. The page helpers are module-private on desktop and are forked (BL-254).
> - **Unread cue** (`useReleaseCue`: pure `cueStep` + `moreRowPulses`). Mounting the real Updates screen is the only thing that clears the cue (`saveLastSeenKey(latestEntryKey(...))`); the route alone and the chooser's Updates button do not. The title / badge glow is the primary cue; the More tab never glows. If More is reached before the title, the Updates row in More pulses (`d2-cue-glow`, 2 s, opacity-only layer; reduced motion = steady 0.85); a title tap first suppresses the More-row pulse for the session.
> - **Back rule.** A More sub-page entered from More shows a left back chevron and returns to `#/more`; entered from the title chooser, the account menu, a rail chip or a deep link it shows the X top-right, which goes back through history, else to the Vault (from a rail chip it returns to Updates). The chevron decision is kept per screen until More or the Vault is next reached, so a history return keeps it. Escape does the same, except while the keypad, a card, a sheet or the sign-in layer is above the screen (the layer takes it) and while Import & Export is previewing or committing (Escape, the X and the chevron do nothing).
> - **Leave Feedback** (`#/more/feedback`). Reached from More it shows the left back chevron returning to `#/more`; reached from the Vault header it keeps the X top-right.
> - **Import & Export** (`#/more/importexport`, `ImportExportScreen`). Steel-ring full shell, one column. Gate = desktop's view forcing: signed out → back to More with the sign-in prompt; signed in but unverified → back to More with no prompt; verified → the screen. Desktop's configure → preview → success stepper with desktop's copy verbatim.
> - **Export.** Download JSON, Download CSV and Download catalog (CSV) call `exportInventory` / `downloadCatalogReference` (`GET /api/inventory/export?format=json|csv`, `GET /api/catalog/reference.csv`) and save the response with `downloadBlob`; each button reads "Preparing…" while it runs. The Export section shows on the configure step only.
> - **Configure.** The notes (blue [HSV] format, amber "Coming from another tracker?"), the file field, Merge mode and Keep-limits radios, Preview import. The real `<input type=file>` (16 px) lies invisibly over a 44 px button. Radios are whole-row 48 px `role=radio` buttons with a drawn dot; neither group has a default; "Replace All (destructive)" is in `--color-danger` and outlines red when picked. Preview import is `aria-disabled` until a file and both picks exist.
> - **Preview + commit.** `runImport(file, mode, capHandling, "dry_run")` under the busy overlay "Checking your file…". The report is a phone list with desktop's information: totals, ignored columns, the always-visible "Will be removed" section, Problem | Resolved tabs, error + recommendation + possible printings, resolved "n → m" with trim / fallback / mismatch notes, and Download problem rows (CSV). Lists render 100 rows at a time with a 44 px "Show more". Replace All shows "I understand this will permanently remove N cards not in this file." on this preview step (desktop parity); Confirm import stays `aria-disabled` until it is ticked. Confirm runs `runImport(…, "commit")` with the same file under "Applying N cards…" → "Refreshing your Vault…" (`refreshQuantities`), then "Import complete — N rows written." with Import another file and Back to Vault. Errors show inline as on desktop.
> - **Report forks.** Reason copy, `cardLabel`, `candidateLabel`, `problemRowsCsv`, the mode / cap option lists and `fileFormat` are module-private on desktop and copied unchanged into `importFork.ts` (BL-254).
> - **Analytics** (additive, `layout: "phone"`): `screen_viewed {screen: more | about | new_arrivals | import_export | feedback}` (Updates uses desktop's `new_arrivals`); `import_dry_run {format, rows, error_rows}`, `import_committed {mode, rows_applied}`, `export_performed {format: json | csv}` as desktop's call sites; the catalogue reference sends no event.
> - **Harness.** Playwright `e2e/mobile/s4-*.spec.ts` (helpers `more-helpers.ts`: a second, email-verified account on the Auth emulator for the verified cases; the API double answers the export routes and returns full dry-run / commit reports incl. replace-all removals). Vitest: `more.test.tsx`, `importexport.test.tsx`.
> 
> ### 25.5 S5 Account: Settings, Change Password, Delete Account, Sharing, verify banner (BL-251)
> 
> Code: `frontend/src/mobile/account/`. Routes `#/more/settings`, `#/more/password`, `#/more/delete`, `#/more/sharing`. No desktop component is edited or forked; no auth, RLS or visibility behaviour changes (the screens call the same APIs behind the same gates).
> - **Settings** (`#/more/settings`, `SettingsScreen`). Desktop `SettingsPage` renders unchanged inside a plain rounded card (1 px border, 4 px radius, 3 px blue top bar, no cut corners) under the shell head: back chevron from More, X top-right from the account menu (§25.4 back rule). Desktop's page heading is hidden because the head already says "Settings". Sections as desktop: keep-limit steppers (floors 1 for Leaders & Bases, 3 for all other cards) drawn at 44 px and stacked, Hard cap / Soft cap / No limits (No limits makes the steppers inert), Save / Discard locked until the form is dirty, the Usage Analytics checkbox, and the Danger Zone. Loading and error states are desktop's own.
> - **"Saved."** Desktop's page shows no saved confirmation, so the card wrapper owns it: a Save tap followed by a new limits matrix from `LimitsContext` (the PUT response) shows a status line under the Save row; any other tap in the card clears it. A failed save leaves the context untouched and shows nothing.
> - **Change Password** (`#/more/password`). Desktop `ChangePasswordModal`, unchanged, in a centred layer (`AccountLayer`, the sign-in layer's wrapper: card `min(100% - 32px, 420px)`, 16 px inputs, X top-right at 44 px, every control >= 44 px) over the screen it was opened from, which stays mounted and `inert`. Three fields, "New passwords do not match.", silent reauthentication, no reauth note. Closing goes back through history, else to `#/more`.
> - **Delete Account** (`#/more/delete`). Desktop `DeleteAccountModal`, unchanged, in the same layer over Settings (which stays mounted). Reached only from Settings' Danger Zone button, plus the deep link; More and the account menu have no entry. Two steps as desktop: warning + current password (a Google-only account sees the Google reauthentication copy instead), then "Are You Sure?" with the DELETE gate and the red confirm. After a successful delete Firebase signs out and the shell returns to the Vault. Closing returns to Settings.
> - **Sharing** (`#/more/sharing`). Desktop `ShareManageModal`, unchanged, in the same layer over More (or the Vault, from wherever it was opened). Empty state = the create form (name, <= 30 characters); the active share shows its name with Rename, the secret link with Copy (`navigator.clipboard.writeText` inside the tap handler; if it fails the desktop message appears and the link field selects its text on focus), Rotate Link and Revoke, the last two behind desktop's red confirm gates; at most one active share (§19.1). Loading and error copy are desktop's. Share management needs only a signed-in account (no verified email), as on desktop.
> - **Guards** (route-level, additive): signed out at `#/more/settings`, `#/more/delete` or `#/more/password` goes to the Vault; signed out at `#/more/sharing` goes to More with the sign-in layer raised; a Google-only account at `#/more/password` goes to More. A signed-out visitor never sees an account layer mount.
> - **Google-only accounts** (`hasPasswordProvider` false): no Change Password row in More or the account menu; Settings, Sharing and Delete Account stay. The emulator cannot sign in with Google, so this branch is covered by vitest only.
> - **Verify-email banner.** Desktop `VerifyEmailBanner`, unchanged, is the first child of the Vault's list area (`.m-vault__below`), under the header and above the status rows, full width in `#2a2110` with the `#b45309` rule. It shows for a signed-in, unverified account; it has no close button, "Resend email" has desktop's 30 s cooldown and spam-folder hint, and "I've verified" rechecks. It is content, so it does not collapse with the header; search mode hides it while the search box has focus. Buttons are 44 px. More keeps its shortened unverified sentence (§25.4); the banner lives only on the Vault.
> - **Analytics** (additive, `layout: "phone"`): `screen_viewed {screen: settings | password | delete | sharing}` once per open (closing a layer onto the screen beneath it is not a new view; a redirected signed-out visit sends nothing). `share_created` is desktop's own call (the `layout` super-property tags it); desktop sends no rotate or revoke event, so none is added. Desktop sends no `settings_*` events.
> - **Harness.** Playwright `e2e/mobile/s5-*.spec.ts` (the API double keeps the last limits PUT and holds one stateful share; the shared e2e account is signed in unverified, so every Vault spec runs with the banner, and the verified-account cases reuse `more-helpers.ts`). Vitest: `account.test.tsx`, `sharing.test.tsx`.
> 
> ### 25.7 S7 Camera (BL-253)
> 
> Code: `frontend/src/mobile/camera/` (scanner) and `frontend/src/mobile/tool/{cameraHop,cue,batchPersist,scanSettings}.ts` (the parts the main document also loads). As-built facts from stages 7a-7c; the §25 consolidation belongs to the closing sweep.
> - **Document.** `/scan/` is a second Vite entry (`frontend/scan.html` -> `src/scan.tsx`) serving the **full app bundle**, so Vault, card detail, Verify and More all work inside it; the camera screen is the tool layer's camera mode. The main document never imports `mobile/camera/` (bundle check: `main-*.js` 0.25 kB and `App-*.js` contain none of the scanner, which lives in `scan-*.js` and `scan-workers/`). Dev and `vite preview` rewrite `/scan` and `/scan/` to `scan.html`; Firebase Hosting does the same with a 301 `/scan` -> `/scan/` and a `/scan/**` rewrite.
> - **Headers.** Only `/scan/**` and `/scan.html` carry COOP `same-origin`, COEP `require-corp`, `Permissions-Policy: camera=(self), microphone=(), geolocation=()` and `Cache-Control: no-cache`; `/vendor/scan/**` is `public, max-age=31536000, immutable` + CORP `same-origin` + COEP; `/scan-workers/**` carries CORP + COEP. COEP is needed on the worker script and the vendored files (without it the Paddle init never answers). The main document gets no COOP/COEP and its Permissions-Policy is untouched, so the Google sign-in popup keeps `window.opener`. One pure `headersFor(path)` feeds the dev middleware and is asserted equal to `firebase.json`.
> - **Isolation.** `/scan/` is `crossOriginIsolated`; `window.__scan.isolation` reports `crossOriginIsolated`, `SharedArrayBuffer`, `hardwareConcurrency`, ort threads = `crossOriginIsolated ? min(4, hardwareConcurrency) : 1`, and wasm SIMD (Chromium on the dev server: 12 cores, 4 threads, SIMD on). Phone-device proof is the LAN round's.
> - **Auth inside `/scan/`.** An isolated document calls `initializeAuth` with the same persistence stack (IndexedDB, local, session) **without** the popup/redirect resolver, because the auth helper iframe is blocked under COEP; the signed-in session is shared with `/`. Google sign-in cannot run there: any sign-in request inside `/scan/` bounces to `/#/vault` (return URL in `sessionStorage` `hsv.scan.signin`) and returns once signed in.
> - **The hop.** Camera mode on `/` navigates (`location.assign`) to `/scan/#/camera`; the entry beneath the tool is first rewritten to the screen under it, so Back never re-hops. Inside `/scan/` the keypad side of the mode toggle switches **in place** (`/scan/#/pad`); closing a hop-entered camera at navigation depth 0 walks back to the screen beneath it; a cold `/scan/` tab closes onto its own Vault. The camera stream is released on leaving the camera mode.
> - **State across documents.** The batch, `mode`, set code and precon deck are mirrored to `sessionStorage` `hsv.tool.v1` (versioned, every access guarded); a reload in the same tab therefore keeps the batch, a new tab starts empty, and a bfcache-restored page re-reads the mirror. Camera settings live in `localStorage` `hsv.scan.v1` = `{boxOffsetMm, boxOffsetVMm, fastAdd, mode}` (offsets clamped to ±4 mm, rounded to 0.1; unreadable storage -> defaults).
> - **Payload.** `frontend/public/vendor/scan/`, 15 files, 33,334,315 bytes, plain git (no LFS), with `THIRD_PARTY_NOTICES.txt` and the licence files (ppu-paddle-ocr 6.6.1 is **MIT** as shipped; onnxruntime-web 1.23.2 MIT; Tesseract.js, core and `eng.traineddata` Apache-2.0; the PP-OCRv6 tiny models and dictionary are credited to the PaddleOCR project, licence line unverified). Lazy: nothing under `/vendor/scan/` is requested on `/`, the Vault, the keypad or `/scan/` off the camera route; the Paddle group loads on the camera route and the Tesseract group only at the first fallback need (it fetches one core file).
> - **Reader.** Paddle runs in a module worker (`paddleWorker.ts`): ort `wasmPaths`, the threads rule above, EP `wasm`, the vendored bundle imported (not rebuilt) with `self.window = self`; frames travel as transferable `ImageBitmap`s and the UI thread never waits on OCR; init is bounded at 60 s. Measured on the dev server in Chromium: init 549-608 ms, a synthetic strip reads in 84-89 ms. A failed or timed-out reader never throws into the UI: the screen says "The card reader could not start", gives the reason and offers "Use the keypad".
> - **Catalogue and parser.** The scan catalogue is derived at load from the app's own catalogue (`scanCatalog.ts`, a port of the spike's `build_catalog.py`), so it cannot go stale; vitest proves it equals the spike's `catalog.json` (round trip; and, one-off, from the spike's raw API cache: 2,582 cards / 10,193 printings). The parser and Acceptor are the spike's `scan-core.js` v0.5.5 unchanged (all 53 parser cases and 15 replay scenarios pass).
> - **Thresholds as built.** Sharpness gate: Laplacian variance of the text band >= 14 (meter fill = value / 42; red < 14, amber < 21, green above); glyph floor 22 processed px ("Too small — move closer"); 3 agreeing reads of the last 4 with bars Tesseract 30 / Paddle 60; Paddle first, Tesseract only when Paddle gave no code or number, at most 1 per 2 frames, PSM 6 then 7 inside 700 ms plus a digits pass; no zoom code anywhere.
> - **Guide.** Portrait only (the landscape constants are ported and unused; a viewport wider than 767 px is served the desktop tree by the S1 gate, which has no camera). Crop = group + 3.15 mm each side; box and crop shifted -2.2 mm / +2.1 mm against the outline; the "Align guide" text button opens a "Guide alignment" sheet with the two ±4 mm sliders (live on input, persisted on release, "Reset to 0"). The geometry equals the spike's own functions (vitest reference crop `[188, 934, 576, 301]` for the 1080 x 1920 clip).
> - **Flow.** Searching -> found | pick -> hold. Found shows the keypad's `Identified` panel (shared numbers, BL-191 non-foil default, In vault / After add readout) with Card details (the card layer over the paused camera, same document), Add, and Wrong card (restart, no keypad prefill). Ambiguous reads are an amber pick with the program name per row (SS Store Showdown, RQ Regional Qualifier, PQ Planetary Qualifier, SQ Sector Qualifier, GC Galactic Championship); a pick resolves, then the cue. The Keypad link and the header's keypad toggle open `#/pad?set=<code>&num=<n>` from the last 8 reads, only when the set exists.
> - **Hold and suppression.** An Add (prompt or Fast add) starts the 1.5 s hold ("Fast add · next card in 1.5 s", "In batch n", Add hidden); the 3 s same-key suppression is counted from the resume; after an automatic add the key is also held until the card leaves the frame; a Fast add read that needs a pick falls back to the prompt; Wrong card inside the hold takes that copy back out.
> - **Cue.** One beep (1320 Hz, gain 0.0001 -> 0.2 in 10 ms -> 0.0001 at 80 ms) plus a full-screen green flash (`#178a3a`, .45, 180 ms on, .35 s fade) on every recognition; the `AudioContext` is created inside a user gesture (camera-mode tap, Start, any pointerdown on the screen); `navigator.vibrate` is never called.
> - **Analytics.** `screen_viewed {screen: camera}`, `scan_recognised`, `scan_decision`, `scan_pick_shown`, `scan_fallback_keypad`, and `add_cards_committed.method` `camera` / `camera_fast_add` with `fast_add` (registry rows in §22). Never raw OCR text, keys, card names or images (guard test).
> - **Not built / not ported.** The spike's research machinery (crop capture/export, review/truth screens, condition select, continuous mode, Photo, Setup, event log, `window.__bl238`), guide v1, the orientation toggle, the optional zoom / focus / torch / lens controls, and the `?debug=1` raw-text overlay.
> - **Provisional copy.** The camera's stream-state sentences ("Camera access is off", "Camera stopped by the phone", "Camera paused", "No camera found") and the generic pick question for non-collision picks ("This code matches more than one card. Pick the card you have.") are accepted provisionally; the owner adjusts them in the LAN round.
> - **Harness.** Playwright project `scan` (Chromium with `--use-fake-device-for-media-stream`; `e2e/mobile/clip-helpers.ts` launches one browser per clip with `--use-file-for-fake-video-capture`) drives the BL-238 spike's MJPEG clips (`e2e/mobile/clips/`, 9 files, 13 MB) through the **real** reader on a scan catalogue extended to a SOR main size of 252 (`e2e/mobile/scan-fixture.ts`); the other phone projects ignore `s7-` specs. Vitest sits beside the code in `frontend/src/mobile/camera/`.
