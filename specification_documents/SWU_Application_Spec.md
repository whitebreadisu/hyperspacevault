# SWU Application Spec — As-Built Application Reference

> **Status:** Authoritative — current as-built reference for the application domain (catalog, variants, inventory, and their UX).
> **Supersedes:** `SWU_ClaudeCode_Spec.md` (frozen — original V1 design) for **all application domains** — data model, UX, API, ingestion, architecture, and environment.
> **App milestone:** v1.0 shipped 2026-07-14; pricing + deck-check arc shipped 2026-07-22; import/export (§17) and precon bulk-add (§18) shipped 2026-07-24; foreign-format imports + release-notes system shipped in v1.3 (2026-08-07); **sharing + the v1.4 Vault batch shipped in v1.4 (2026-08-16, §19–§21)**.
> **Last updated:** 2026-10-02 (v1.5 as-builts: §23 Homeworlds onboarding, §3.3/§10.6 exceptions now zero, §16 pricing scope; no as-built passes outstanding). Previously 2026-08-16 (v1.4 as-builts: §19 sharing shipped-status, §20 release-notes system, §21 v1.4 Vault batch, §12 adjust + shares endpoints; same-day follow-up: §5.16 v1.3 scoped-affordance cluster + §5.15 supersession note — no as-built passes outstanding).
> **Consumer-facing name:** renamed to **HyperspaceVault** 2026-07-20 (BL-138). This document, the repo, and other `SWU_*` artifacts keep the historical internal naming.

**Scope & authority.** The authoritative as-built reference for the **application**: the catalog/variant/inventory **data model** (§4, §10), the **UX / interaction model** (§5), **completion, limits, and currency** (§6, §7), the **backend architecture & tech stack** (§11), the **API surface** (§12), the **ingestion pipeline** (§13), and the **environment** (§14). For the variant *mechanism* (`variant_of_uuid`) see `SWU_Standard_Variant_Mapping_Spec.md`; for **platform / auth / CI / infra** see `SWU_Platform_Spec.md`; for **local setup & the full env-var table** see `README.md`. The original V1 design lives in the frozen `SWU_ClaudeCode_Spec.md` (historical only).

**Origin.** Produced in the Opus design session for `SWU_Backlog.md` Open Question E (the "swuapi-first counterfactual") and built + deployed to prod 2026-06-21 (commits `e1832c0`..`8d33e86`). Originally written as a forward-looking *target-design* spec ("the redesign"); the system it describes is now deployed, so it serves as the as-built reference. The variant-identity layer converged on BL-33's `base_cards`/`card_variants` split; user-experience intent drove the finish-vs-provenance separation and base-set anchoring. Remaining sequenced work and post-ship follow-ups are tracked in `SWU_Backlog.md` (BL-33 step 4; BL-44/45/46; BL-32/39/40).

**Related:**
- [`SWU_Standard_Variant_Mapping_Spec.md`](SWU_Standard_Variant_Mapping_Spec.md) — the data mechanism (`variant_of_uuid`) this design rests on.
- [`swuapi_standard_variant_exceptions.md`](swuapi_standard_variant_exceptions.md) — current standard-anchor exceptions.
- [`SWU_Backlog.md`](SWU_Backlog.md) — BL-33 (execution/sequencing), BL-24/27/29/31/32/35/36/37 (discrete work), Open Questions D/E.
- [`SWU_ClaudeCode_Spec.md`](SWU_ClaudeCode_Spec.md) — **frozen** original V1 design spec; historical only (all application domains now absorbed into this document — BL-49).

---

## 1. Why this document exists

BL-28's analysis found swuapi.com substantially richer than the original TCGPlayer CSV pipeline assumed. Open Question E asked whether designing *swuapi-first* — from the data source's real shape plus the application's actual goals — would land on a different system than the one retrofitted onto a CSV-shaped schema.

This session ran that question, **app-goals first**. The net finding matches Open Question E's hypothesis: the **variant-identity layer converges** on BL-33's `base_cards`/`card_variants` split, but **user-experience intent drove real refinements** that pure data analysis hadn't surfaced — chiefly the separation of *finish* from *provenance* and the *base-set anchoring* of the whole UX. This document is the consolidated target design those decisions produced.

Under the three-tier documentation regime ([ADR-0020](../docs/decisions/0020-three-tier-documentation-regime.md)) this is a **Tier-1 current-state** document: decision rationale lives in `docs/decisions/` (ADRs), and superseded text moves verbatim — with a dated tombstone here — to `SWU_Application_Spec_Archive.md`.

---

## 2. Product frame (requirements that drive the design)

Decisions made this session, treated here as fixed requirements:

- **Multi-user inventory tracker** — many isolated collectors over one shared catalog. No decks, trading/sharing, or valuation (explicitly scoped out). [Open Q E] **Superseded in part:** Pricing (§16) and Deck Check (§5.11) shipped 2026-07-22 — this framing records the session's original decisions, not a current scope boundary.
- **Full long-tail variant tracking** — every variant swuapi exposes (~58 types), not just the original 8.
- **Base-set anchoring** — the experience is organized around the base sets (11 as of Homeworlds); long-tail provenance is a secondary, toggleable dimension.
- **Completion is base-card-level and variant-agnostic** (playset / owned) — already built; unchanged. [§6]
- **Per-variant, per-tenant configurable keep-limits** — advisory policy, never DB constraints. [BL-24, BL-35]
- **Approximately-current catalog** — daily detection + operator-gated apply. [BL-33 step 7, BL-36, BL-37]
- **Public catalog, auth-gated inventory.** [Open Q D, BL-17]
- **One user per tenant — permanent** (owner decision 2026-07-30, public-release review; retired BL-89). Every account is the sole member of its own auto-provisioned tenant; shared/household tenants, invitations, and ownership transfer are permanently out of scope. `DELETE /api/account`'s whole-tenant purge semantics are correct by construction under this model.

---

## 3. Core concepts

### 3.1 Base-set anchoring

Every variant resolves to exactly one **base card** in a **base set**, via swuapi's `variant_of_uuid` (see the mapping spec). Container-set variants — Weekly Play (OP), Judge, Convention, Promo, etc. — anchor *cross-set* into a base-set root; the data already expresses this. Other inventory tools show these as disconnected separate sets only because they render swuapi's sets verbatim instead of resolving the variant graph. Eliminating that friction is the central goal of the redesign.

### 3.2 Finish vs. provenance — two orthogonal axes

The original 8-variant model conflated two independent dimensions:

- **Finish** — the visual treatment: Standard, Foil, Hyperspace, Hyperspace Foil, Prestige, Prestige Foil, … (swuapi's `variant_type`).
- **Provenance** — where/how the printing was obtained: the base set itself, vs. Weekly Play (OP), Judge, Convention, etc. (swuapi's *set*).

"OP" and "OP Foil" in the old model were never finishes — they were *(provenance = Weekly Play) × (finish = Standard/Foil)*. The redesign models the two axes separately: `card_variants.variant_type` (finish) and `card_variants.source_set_code` (provenance).

> **Resolved by BL-27 (2026-06-21) — see §10.** The vocabulary is now frozen. `variant_type` is stored **raw** (swuapi's verbatim label), with a **curated classification** mapping each value to `finish` / `channel` / `stamped` / `stamp_family`. The 8 finishes are frozen (§10.3); provenance (`channel`) is **derived from `variant_type` + `source_set_code`** because the encoding is inconsistent (§10.4); nothing is normalized into `source_set_code`.

### 3.3 Standard anchor & exceptions

Per the mapping spec: a **root** has `variant_of_uuid: null` and is the standard-bearing printing within its set. A **standard-anchor exception** is a root whose own `variant_type` is not `"Standard"`. The full census found **15** such roots, but BL-27 determined **14 are swuapi null-errors** that resolve to a base-set Standard via a case-insensitive `(name, subtitle)` fallback (tokens exempt) — leaving at most a handful of genuine exceptions — **currently none** (§10.6). *(Superseded text archived 2026-10-02 — BL-239; see `SWU_Application_Spec_Archive.md`.)* `base_cards.standard_variant_id` must be **nullable** regardless. Exceptions are flagged, never block catalog inclusion.

### 3.4 Tokens — duplicate-per-set

Generic token cards (Battle Droid, Clone Trooper, Experience, Shield, etc.) recur across many products. swuapi gives each set's printing its own `uuid` and independent root — structurally identical to a cross-set reprint (§3.1; mapping spec §5B). They are therefore **not merged**: one `base_cards` row per set (flagged `is_token`, §4.2), consistent with the not-merged-reprint decision and with swuapi's own structure (zero special-casing). A unified cross-set token view ("all my Battle Droids"), if ever wanted, is the same deferred application-layer grouping as the reprint "all printings" feature — a grouping *on top of* the per-set rows, no schema change. Token *treatment* (limits, visuals, aggregate exclusion) is in §6.

---

## 4. Target schema

Table-level model below. Exact column types, constraints, and indexes are settled at BL-33 implementation time; this section is authoritative for *shape and intent*.

### 4.1 `sets` — all sets, base and container

One row per swuapi set, **base and long-tail container alike**.

- `code`, `name`, `release_date`, `total_cards`, `swuapi_updated_at`
- **`is_base_set`** — *curated* boolean. `true` for the base sets (SOR, SHD, TWI, JTL, LOF, SEC, LAW, ASH, HMW, TS26, IBH); `false` for container sets (the 7 Weekly Play sets, Judge Program, Promo, Convention Exclusive, Gamegenic, Gift Box, Movie Promo).

**Rationale:** container sets need real rows so `card_variants.source_set_code` can FK to a named set for the long-tail picker; the base/long-tail toggle is then just a filter on `is_base_set`. The flag is **curated**, not derived from "set contains ≥1 root," because the derived rule misfires on container sets that carry a stray root (C26 held one — the Zam Wesell orphan — until upstream re-anchored it on 2026-10-02). **Resolves mapping spec §4.**

### 4.2 `base_cards` — roots (one per printed card design per base set)

- `set_id` → `sets` (a base set), `base_card_number`
- Shared card data: `name`, `subtitle`, `type`, `type2`, `double_sided`, `rarity`, `cost`, `power`, `hp`, `arena`, `is_unique`, `front_text`, `back_text`, `epic_action`, `artist`
- `swuapi_id` (swuapi UUID, unique-indexed)
- `standard_variant_id` (nullable FK → `card_variants` — nullable is required; see §3.3)
- `is_token` (boolean — marks generic token cards; sourced from swuapi's token designation, exact field to verify in BL-27/BL-29; drives the token treatment in §6)
- **No reprint-lineage column.** Live API check (2026-06-20) found swuapi exposes no reprint field — `reprintOf`/`reprints` appear in the docs but are **absent from live `/cards` data**, and cross-set printings (e.g. Corellian Freighter SOR vs JTL) are fully independent with zero cross-reference. The deferred cross-set "all printings" view is therefore **derived at query time via `(name, subtitle)` case-insensitive matching** (mapping spec §7), not a stored column.
- `card_aspects` / `card_traits` / `card_keywords` move here, keyed on `base_card_id` — collapses today's per-variant duplication.

### 4.3 `card_variants` — printings (replaces the old boolean flag columns)

- `base_card_id` FK (resolved via `variant_of_uuid`)
- **`variant_type`** — swuapi's **raw** label, stored verbatim (58 values). A curated classification (§10.2) derives `finish` (8 frozen values, §10.3), `channel` (provenance, §10.4), and stamp metadata. Not normalized into `source_set_code`.
- **`source_set_code`** — provenance (FK → `sets.code`; may be a base or container set)
- `card_number`
- `front_image_url`, `back_image_url`
- `swuapi_id` (swuapi UUID, unique-indexed — the upsert key for the ongoing-sync thread)
- `stamp_group` (nullable — consolidation key for same-art/same-finish stamp variants: `(base_card, finish)` with a stamped member, §10.5. Confirmed families: Prestige Foil (Foil Prestige + Serialized Prestige) and the PQ/SQ/RQ/GC/SS tournament tiers. Judge/Prerelease deferred to BL-39; a broader group-by-art model is BL-40.)

**The `is_organized_play` boolean is retired** — OP becomes ordinary variants with `source_set_code` = a Weekly Play set, anchored by `variant_of_uuid`. This removes the old OP card-number-collision handling. **Keying:** `card_variants` is uniquely keyed on `swuapi_id` (uuid); `(base_card_id, variant_type)` is **not** unique — Serialized Prestige collides (§10.8).

### 4.4 `inventory`

- `variant_id` FK → `card_variants.id` (renamed from `card_id`)
- `quantity` — **never** capped at any keep-limit by a DB constraint; keep-limits are application policy (§6)
- Unique `(tenant_id, variant_id)`

### 4.5 Tenant settings & limits

**Decided & built 2026-07-12 (BL-24, backend).** Keep-limits are keyed by **type-category × limit bucket**, where a variant's *limit bucket* is its `finish` if it has one, else its `channel` — both from the curated classification layer (`swuapi_classify.py`, §10), giving ~15 canonical buckets (8 frozen finishes + 7 channels) instead of the ~58-value raw `variant_type` vocabulary. *This resolves the former open question* (per-`variant_type` vs. `stamp_group`-level): all stamp-only tournament tiers collapse into the Promo/Tournament-tier channel bucket, so the stamp_group question never arises for limits. New variant_types added by ingestion automatically land in a bucket — the settings surface never grows with the vocabulary.

- **Store:** `tenant_card_limits` (migration 0025) — override rows only, PK `(tenant_id, type_category, limit_bucket)`, tenant-scoped RLS + FORCE (post-0023 NULLIF pattern). Code defaults (singleton 1 / standard 3) are *not* provisioned as rows; absence of a row = default applies.
- **"No limit" is a first-class value:** `max_quantity NULL` on an override row means the tenant explicitly opted out of any cap for that cell — no block, and (in BL-35 soft mode) no flag either, because there is no boundary to be over. Distinct from soft mode, which flags overages against a limit that still exists.
- **Technical ceiling:** 999 copies per variant, enforced unconditionally in the service layer before any limit resolution, with its own blocked reason (`"ceiling"`, vs. the keep-limit's `"trade_sell"`) so the UI never attributes it to user policy. It protects the application (display widths, runaway input), not data validity — `inventory.quantity` still carries no cap constraint (§4.4).
- **Endpoints:** `GET /api/settings/limits` (full effective matrix — every cell with `max_quantity` and `is_default`) and `PUT /api/settings/limits` (full replacement of the tenant's override set; 422 on unknown bucket/category, out-of-range values, duplicate cells). Auth + tenant-scoped via `get_db`; `tenant_no_store`. PUT is *not* gated on verified email (BL-16 scopes that gate to inventory mutations) — deliberate, revisit if settings mutations ever warrant it.

**BL-25 (built 2026-07-12; trimmed 2026-07-13 per [ADR-0013](../docs/decisions/0013-limits-ui-build-then-trim.md)):** a full-page **Settings** pane (App-state pane like Cards — the app has no router; reachable only from the authenticated avatar menu). The original 15×2 per-bucket grid was built, dev-verified, and then **deliberately removed before prod** — the settings surface is now a single three-way **"Keep-limit enforcement"** control: **Hard cap** (default) / **Soft cap** / **No limits**, with explicit Save/Discard. "No limits" is expressed through the unchanged backend contract as the all-null override set (+ cap_mode hard); a fetched all-null matrix displays as "No limits" regardless of cap_mode. Saving the control deliberately resets any per-bucket overrides only the API could create — the control owns the override contract. The fetched matrix still feeds the frontend's enforcement pre-checks — `maxCopies()` (Add Cards) and the inventory popup's per-variant stepper disable — via `LimitsProvider`; anonymous/unfetched/fetch-failure states degrade to the code defaults (backend remains the enforcer of record). Completion visuals stay on the fixed playset constants, per the §6 decoupling. **The per-bucket precision UI remains one git-revert away, anchored by the fully-tested API contract — see ADR-0013 for the rationale, debt analysis, and re-enable path.**

**BL-182 (shipped 2026-08-01, first post-announcement user feedback; [ADR-0018](../docs/decisions/0018-category-level-cap-precision-restore.md)):** numeric precision returns to the Settings surface at **category granularity** — a dedicated **"Keep-limits"** section (concept explainer: per *variant*, not per card) above the enforcement control, holding two cap steppers in the card-popup stepper's visual language: **Leaders & Bases** (floor 1) and **All other cards** (floor 3), both ceilinged at the 999 technical ceiling. The backend contract is untouched: a category whose cap differs from its default saves as 15 uniform per-bucket override rows through the full-replacement PUT; a category at its default saves no rows (untouched steppers round-trip as `overrides: []`, byte-identical to the ADR-0013-era payload); "No limits" stays the all-null set (+ cap_mode hard) with the steppers inert. Load derives a stepper value only from a uniform non-null category matrix — partial/mixed/out-of-bounds API-written shapes display as the category default and normalize on the next save (the control still owns the contract; floors are control-enforced, not API-enforced). Enforcement, the popup incrementor, and Add Cards needed zero changes — they already resolve effective limits dynamically. Completion/playset semantics unchanged (§6 decoupling; fixed 3-total / first-copy).

**BL-35 (built 2026-07-12/13, same arc):** universal per-tenant enforcement mode in `tenant_settings.cap_mode` (`hard` default | `soft`; migration 0026, one lazy row per tenant — no row = hard; same RLS pattern as 0025). **Hard** blocks at the effective limit (`blocked: true, reason: "trade_sell"` — pre-BL-35 behavior). **Soft** commits the increment and flags it (`over_limit: true` whenever the post-increment quantity exceeds the effective limit — including quantities stranded above a *lowered* limit). Interaction rules: a "No limit" bucket never blocks *or* flags in either mode; the 999 ceiling blocks in both. Round-trips on the same `GET/PUT /api/settings/limits` payload (`cap_mode` field; PUT's is optional = leave unchanged). UI: hard/soft are two of the three-way control's options (ADR-0013, § above); Add Cards verification gains an **amber** "over your keep-limit — will still be added" state (soft mode keeps those rows in *will add*; red remains "genuinely blocked" in both modes); popup steppers stay enabled past the limit in soft mode (ceiling-only disable) with a per-row over-limit indicator derived from live state, not the transient response flag.

### 4.6 `feedback` — anonymous-first user feedback (BL-126, shipped 2026-07-14)

**Migration 0027.** The app's **first tenant-optional table** — every table before it (`inventory`, `tenant_card_limits`, `tenant_settings`, even `users`/`tenants` themselves) assumes a row belongs to exactly one real tenant. `feedback` does not: an anonymous submission is a first-class case, not a degraded fallback.

- `message` (required, ≤5000 chars), `contact_ok` (bool, default false), `contact_email` (nullable, only ever populated when `contact_ok`), `tenant_id` (nullable FK → `tenants`), `commit_sha` (nullable, server-derived), `created_at`.
- **Consent semantics, enforced server-side** (`app/services/feedback.py`): `contact_ok = false` → the row is genuinely anonymous **even for a signed-in submitter** — no `tenant_id`, no email stored at all. `contact_ok = true` → email is always stored, and `tenant_id` only when the caller was authenticated. The caller's auth state alone never determines what's stored — consent does.
- **RLS — three command-specific policies, not the single blanket `tenant_isolation` pattern** every prior tenant-scoped table (0018/0021/0025/0026) reused verbatim: `feedback_insert` (`WITH CHECK`: allows `tenant_id IS NULL` unconditionally, or the caller's own current tenant), `feedback_select_own_tenant` (own-tenant-only), `feedback_purge_delete` (own-tenant-only). The SELECT policy exists **solely so DELETE can locate rows to act on** — discovered empirically while building this migration: PostgreSQL RLS requires SELECT-policy visibility for `UPDATE`/`DELETE` to find a row at all, even with a correct, matching command-specific policy of its own, and even with no `RETURNING` clause in play. Without it, the account-purge `DELETE` silently matched zero rows — not an error, just a no-op — surfacing one step later as a foreign-key violation on the subsequent `tenants` delete. **FORCE RLS is on** — even the owner/migration role can't read rows casually. No `UPDATE` policy exists (no endpoint ever mutates an existing row); the `INSERT` path carries no `RETURNING` clause for the same visibility-asymmetry reason.
- **Anonymous rows are invisible to every session, forever.** No policy ever grants a non-owning (or anonymous, which owns nothing) session `SELECT`/`DELETE` on a `tenant_id IS NULL` row. They also **survive account deletion by design**: `DELETE /api/account`'s purge (§12) removes only **consented** feedback rows carrying the deleting tenant's id — an anonymous row has no tenant to purge against. Regression coverage: `test_purge_deletes_consented_feedback_but_preserves_anonymous` (`backend/app/tests/test_account_deletion.py`) — added to `purge_tenant` (§12) the same day the table shipped, per the "every future tenant-owned table must be added to `purge_tenant`" rule that endpoint established.
- **Server-side metadata only** (owner decision #4) — `commit_sha` comes from the backend's own `COMMIT_SHA` env var (wired from Terraform's `var.backend_image_tag`; `SWU_Platform_Spec.md` §3.5), `created_at` is the DB's own clock. No client fingerprinting.

---

## 5. UX / interaction model

### 5.1 Set pickers — base/long-tail toggle

Everywhere a set is chosen (FilterPanel's Set multiselect; `AddCardsSetBar`), the picker defaults to **base sets only** (`is_base_set = true`). A header toggle button — styled like the existing dropdown header buttons (select-all/clear) — expands the list to **all sets**, including the long-tail container sets.

**Set order — newest first (BL-258, owner 2026-10-12, [ADR-0031](../docs/decisions/0031-set-order-newest-first.md)).** Everywhere a set order appears, desktop and phone (pickers, the Vault's rows and Set sort, completion-by-set, precon deck lists, the export and reference files), the main-release sets run **HMW, ASH, LAW, SEC, LOF, JTL, TWI, SHD, SOR**; Intro Battle: Hoth and Twin Suns keep their place after that block; each Weekly Play set follows its base; every other set keeps its place. Card numbers stay ascending inside a set. One frontend definition (`SET_CANONICAL` in `utils/setGrouping.ts`, which `setReleaseRank` in `utils/catalog.ts` ranks from) and one backend list (`services/set_order.py`); a new main set is added at the **front** of each. `Set` ascending is this default; `Set` descending shows oldest first. Out of scope: the printings lists (home set first, then alphabetical) and the `/api/sets` response order.

### 5.2 Catalog / Inventory filter semantics

- **Variants always travel with their base card.** Selecting a base set shows that set's base cards, each displaying *all* of its variants (including OP/Judge/Convention/etc.), regardless of which source set those variants came from.
- **Selecting a long-tail set is a provenance filter layered on top** — "show base cards that have a printing from that source." It is *not* a separate flat list of loose variants.

### 5.3 Card detail / inventory popup (S6)

**BL-111 F5 (2026-07-13):** the read-only card-detail popup and the editable card-inventory popup described below were **merged into one component** (`frontend/src/screens/cards/CardPopup.tsx`, console "selected-panel" restyle) — every opener (table name click, table Inventory-cell click, gallery cell click) now opens the same popup; there is no longer a separate inventory-only popup. Signed-in users get a per-selected-printing +/- stepper inline; signed-out users see a "Sign in to manage inventory" plate instead of being bounced elsewhere (see §5.5's anonymous behavior below). The variant-selection/representative-image behavior described here is unchanged by the merge.

- Variant buttons span the **full long tail** (all provenance × finish combinations that exist for the card), not just the 8. Default to the Standard variant image; leaders get a front/back flip.
- **Initial selection defaults to the Standard/base variant** (shipped 2026-07-11, rider on BL-76 Phase 3 / PR #211) — previously first-in-array order, which felt random. Same representative rule as the gallery.
- Because the long tail includes many near-identical **stamp-only tournament tiers** (e.g. Rey's 6 RQ tiers), `stamp_group` consolidation (BL-31) is **load-bearing here**, not optional polish: group look-alikes under one representative image, with per-variant inventory tracking preserved underneath. See `SWU_ClaudeCode_Spec.md` §9.2 and BL-31/BL-32.

### 5.4 Add Cards — four-axis, ambiguity-gated resolver

*Shipped 2026-07-05 (BL-46). This supersedes the earlier "two-axis provenance × finish" design — that framing surfaced an abstract "provenance" control the user couldn't reason about, and let a raw source label ("Weekly Play", "SS Top 8") leak into the finish picker. The redesign came out of hands-on iteration and is implemented in `frontend/src/utils/addCardsResolver.ts` (+ `AddCardsKeypad.tsx`).*

**Set selection scopes to the set *family*.** The user picks a set (base set by default; toggle to a long-tail source). A selected set **S** gathers a printing when `set_code === S` (S is the printing's home base set — so a base-set selection reaches its companion-set printings, e.g. SEC reaches Cantwell Arrestor Cruiser's SECP Weekly Play printing whose home base card is SEC #37) **or** `source_set_code === S` (S is where it was released — a long-tail selection then sees only its own printings, so card# + SECP resolves with no picker). This replaces strict source-set scoping, which silently missed companion printings (the "SEC #1 shows Palpatine but not Cantwell" gap).

**The typed number then resolves along four axes, each surfaced as a control only when genuinely ambiguous:**

1. **Card** — which physical card the number refers to. Base sets reused low numbers across printing programs (SOR/SHD/TWI collisions) and companion sets reuse them again (SEC #1 = Palpatine *or* Cantwell), so a number can map to several distinct cards. **Defaults to the base-set card** (the candidate whose decomposed *event* is "Base Set"), shown and overridable via a full-width "Which card?" picker; **blocks** on an explicit pick only when no base-set card exists at that number (two companion-only printings). The default keys off the Base Set *event*, not channel `Retail` — base-set tournament tiers also classify as `Retail`, so a channel-based default would wrongly land on Mace Windu instead of Iden Versio at SOR #2.
2. **Set** — the card's *event / provenance*, decoded from `variant_type` (Base Set, Weekly Play, Store Showdown, Planetary Qualifier, …). Read-only except the ~4 Base-Set-vs-Prerelease cases; defaults to Base Set, overridable.
3. **Stamp** — the tournament achievement / sub-variant (Top 8, Champion, Judge, …). **Hidden entirely** unless the card carries stamps; a required pick when the event holds more than one (Mace Windu's Store Showdown tiers).
4. **Finish** — real finishes only (Standard, Standard Foil, Hyperspace, Hyperspace Foil, the prestiges, Showcase). A required pick when a number maps to more than one (the SOR/SHD/TWI shared standard/foil-number case).

**Decomposition mechanism.** Each variant's `variant_type` is split into `{event, stamp, finish}` by `decompose(variant_type, channel)`:
- **Finish** — the frozen finish if `variant_type` is one; else `Standard Foil` when it contains "Foil"; else `Standard`.
- **Event (Set)** — a tournament prefix (`SS`→Store Showdown, `PQ`→Planetary Qualifier, `RQ`→Regional Qualifier, `GC`→Galactic Championship, `SQ`→Sector Qualifier) or `Prerelease`; a standalone name (Judge Program→Judge, Convention Exclusive→Convention, Movie Promo, Event Exclusive); otherwise the provenance **channel** (so a SORP "Hyperspace" Weekly-Play promo reads as Weekly Play, not Base Set — the channel already folds in `source_set_code`).
- **Stamp** — the remainder after a tournament/Prerelease prefix (Top 8, Champion, Judge, Promo, …); null otherwise.

**Language:** the provenance term is **Weekly Play** (not "OP"/"Organized Play") — see BL-80 for the codebase-wide reconciliation.

**Deferred (BL-31/40):** the 21 SEC "Serialized Prestige" senator cards are three physical finishes (Carbonite / Gold / Rose Gold) sharing one `variant_type`, distinguishable only by image-filename suffix — they collapse to one representative for now. When parsed out, those three values belong in the **Finish** axis, not Stamp (Jeremy's 2026-07-05 call).

**Cross-set batch (BL-61, shipped 2026-07-06).** The set picker at the top of the modal is a per-*entry* affordance, not a per-*batch* one: each `Row` carries its own `setCode` (the set it was resolved against), and the modal separately tracks the *active* set new entries attach to. Changing the active set — including via "Change set" — never clears `rows`, so a single batch can span multiple sets and is only ever cleared by delete or commit. Both the keypad's "Cards in this batch" chip list and the verification table group their rows by `setCode` and label each group with the set (code + name), so a mixed-set batch stays legible before commit.

**Live card-image preview (BL-62, shipped 2026-07-11).** The resolve panel shows the **front image of whatever variant the resolver currently points at**, live as the number is typed — an axis pick (Which card / Set / Stamp / Finish) swaps the art to that actual printing. The image renders only at `status === "resolved"`; empty/invalid/pending-pick states show a persistent card-shaped placeholder frame (no panel reflow while typing), which is also how the BL-46 ambiguity question resolves: no image until the resolver has a concrete variant. A 180 ms debounce (`CardImagePreview`, `AddCardsKeypad.tsx`) keeps typing "172" from requesting the transient "1"/"17" images. Editing phase only (the verification table stays text). Images are hotlinked from the official CDN and sized by CSS (`object-fit: contain` letterboxes landscape leaders/bases); self-hosting and true thumbnails remain **BL-76**'s decision. BL-63 (image as the add/won't-add cue) is a follow-on, slated for Claude Design exploration.

**Console restyle + inventory readout + close guard (BL-111 F7, 2026-07-13, PR #263).** The modal adopts the arc's console shell (angled clip, steel ring, tile body); after set selection the set bar backgrounds with that set's starfield (weekly-play codes borrow their base set's art, e.g. SORP→SOR). The old green/red resolution dot and the "Headroom:" hint are replaced by a **two-line inventory readout** beside the number input — `IN INVENTORY x/y` and `AFTER ADD a/y` (a = owned + earlier same-printing batch copies + 1; reaching y exactly is green — playset completed; at/over limit collapses to a single red `(AT LIMIT)` line). `y` is the printing's configured keep-limit (`effectiveLimit`); a "No limit" cell shows owned-only lines with no `/y` and no red states; enforcement behavior itself (hard-block vs soft-commit) is unchanged. Leaders preview their **portrait back side**. New behavior: a **close guard** — Cancel/X/Escape/backdrop-click with a non-empty batch raises a confirm ("Return to Batch" / "Discard & Close"); a close right after a successful commit skips it.

**Locked-header base-set logo derivation (BL-180, 2026-07-30).** The locked set bar's logo is always a **base set's** mark (logo assets exist per base set only — previously any non-base selection rendered a broken image): a base set shows itself; a Weekly Play companion shows its base set (categorical base+"P" convention, mirroring the starfield borrow above); any other non-base set (Exclusives) shows the distinct **home base sets** (`set_code`) of the printings it released (`source_set_code = selected`), side by side in canonical display order (newest main set first) — one logo when the container maps to a single base set (e.g. MV26→ASH), several when it spans base sets (e.g. C24→SOR SHD TWI; P25 spans six). A printing whose home is not a base set (some C26/GG/G25 items root in the exclusive itself) contributes no logo; a selection mapping to nothing (G25) shows no logo at all — the code+name text beside it already identifies the set. Derivation: `headerLogoCodesFor` (`utils/setGrouping.ts`, unit-tested), wired in `AddCardsSetBar`. *(Order superseded 2026-10-12, BL-258 — prior wording in the Archive.)*

The separate Catalog and Inventory tabs collapse into a single **Cards** list (nav relabeled "Inventory" as of BL-129 R3 — owner-decided, low-cement, may rename again as features grow; the tab bar collapses to one entry regardless of label). **Superseded — see §5.11:** the nav item was renamed again to "Vault" with the BL-142/BL-143 arc (shipped prod 2026-07-22); this paragraph's "Inventory" label is historical. Catalog and inventory are the *same* base-card list viewed with or without ownership data — one table structure, inventory data layered on by auth state, not a second view.

**Columns — one order for everyone:**

`# · Name · Variants · Inventory · Playset · Rarity · Aspect · Type · Cost · Power · HP · Trait · Keyword · Arena · Set`

**Superseded — see §5.13:** BL-162 (2026-07-26) removed the Inventory column (the merged Playset cell absorbs its affordances); the live order is the 14-column list there. The Variants hover button moves to immediately right of Name; the remaining columns keep today's catalog order.

- **Authenticated** — full interactivity: Inventory/Playset populated and editable, the completion summary bar live, Add Cards active, the "show only incomplete playsets" toggle active.
- **Anonymous** — identical layout, every inventory-managing affordance **present but inert**, as a signup teaser:
  - Inventory/Playset cells render empty; Name, Variants, and the card popup stay fully interactive.
  - The completion summary bar shows with null values; Add Cards and the incomplete-playset toggle render disabled/greyed.
  - A click on Add Cards or the incomplete-playset toggle opens a lightweight **"Sign in or sign up to manage card inventory"** prompt that routes into the sign-in modal. BL-57 later upgrades this prompt into the full value-prop popup.
  - **BL-111 F5 (2026-07-13):** an Inventory-cell click is no longer part of that bounce-to-sign-in group — it opens the unified card popup (§5.3) the same as a signed-in click does, and the popup's own inventory plate is the nudge ("Sign in to manage inventory" in place of the stepper). This reads as more informative than a modal bounce with no card context.

**Auth entry.** The full-screen `AuthScreen` becomes a **modal** (sign in + create account). The header's top-right slot shows a **Sign In** button when anonymous, replaced by the account email + Log Out when authenticated.

**Supersedes** BL-17's two-tab UI and inherits its access model (public catalog reads, auth-gated inventory + mutations). The anonymous read path is served by a **tenant-less catalog DB session** for `/api/cards`/`/api/sets`, and an **optional-auth session** for the base-card detail popup's `quantity` field (real quantity when signed in, 0 when anonymous) — see §7, §12, and [ADR-0008](../docs/decisions/0008-anonymous-catalog-reads.md). This view also pulls the inert-teaser mechanism forward from BL-60, which then retains only its net-new "show only cards I own" toggle.

---

### 5.6 Faceted filters (BL-70)

**Layout (BL-111 F6, 2026-07-13, PR #265):** FilterPanel is a **collapsible console-styled sidebar floating over the table/gallery** (not the earlier top panel): compact search, aspect chit row (incl. an inline "no aspects" chit), the faceted multi-selects below, the cascade/show-all checkboxes, and an SWUButton "Reset all filters". Collapsing it to a slim edge rail (which surfaces an active-filter count badge) lets the table/gallery reclaim full width; filter state survives collapse/expand. The sidebar no longer carries a Table↔Gallery toggle — that control lives in InventorySummary's actions slot, left of Add Cards (BL-111 F3). The design's "Only cards with no inventory" checkbox is wired (BL-115, 2026-07-13): inverse of "show only cards I own" (mutually exclusive; anonymous clicks route to the sign-in prompt). **Vertical behavior (BL-121, 2026-07-13, PR #284):** the sidebar is height-responsive via discrete tiers driven by viewport height (`utils/filterPanelTiers.ts`, `data-vtier`) — FULL, COMPACT (density deltas), TWO-COL (452px designed grid: Card+Collection left, Gameplay right, search/aspects spanning, cascade+Reset footer row), and a pinned-scroll fallback only below ~600px viewport height; no internal scrollbar in the normal tiers. Everything below — the faceting *semantics* — is unchanged by the restyle:

**Aspect matching modes (BL-130, 2026-07-14, issue #306).** The Aspects group carries its own three-way segmented control — **Any / Within / Exact** — in the group header, governing how a multi-aspect selection is evaluated against a card's own aspect set (visual precedent: the ADR-0013 segmented control; active segment takes the standard steel-blue fill). **Any** is the historical OR match — a card passes if it carries any selected aspect. **Within** is a subset match — no card carrying an aspect *outside* the selection passes (the deckbuilder question: what fits an Aggression/Villainy deck → mono-Aggression, mono-Villainy, and Aggression+Villainy all pass). **Exact** requires the card's own aspect set to equal the selection exactly (only the Aggression+Villainy card passes). Single-aspect selections collapse Within and Exact to the same mono-<aspect> result. **Default is Exact** — a deliberate owner call that changes the out-of-the-box matching behavior away from the historical Any default. BL-90's empty-selection semantics (below) hold across all three modes unchanged: an empty aspect selection is unfiltered regardless of mode. Faceting evaluates other fields' candidate values against the active aspect selection *through* the active mode, so option counts stay truthful to what's actually showing; faceting the aspect field against itself is unaffected (its own selection is reset to empty for that computation, same dead-end-prevention rule as every other field, which makes the mode a no-op there by the same empty-selection invariant).

FilterPanel's dropdowns (Set, Type, Rarity, Finish, Keywords, Traits, Arenas, **and, since BL-90, Aspects**) are faceted against the current selection rather than showing a fixed universe:

- **Dead-end-prevention.** Each field's addable values are computed by re-running `applyFilters` with *that field's own selection reset to empty* but every other field (and the `costRange`/`powerRange`/`hpRange` narrowing) applied as-is. Since every faceted field is a bare `Set<string>` that defaults empty, "ignore this field" is just "swap in an empty Set" — no per-field default lookup needed. This guarantees a field never facets itself into a dead end: its own alternatives are always still offered.
- **Hide-by-default + show-all toggle.** A value not reachable given the other active filters is hidden unless the panel-level "Show all values" toggle is on, in which case it renders greyed/"(0)"-suffixed and (if not already selected) not clickable.
- **Never silently drop a selection.** A value already selected always stays in its dropdown, even once it becomes facet-invalid — flagged inert (greyed, "(0)", still removable) instead of disappearing. This is what makes keywords/traits safe to combine as OR: picking a second value that conflicts with the first doesn't erase the first, it just marks it inert until the conflict clears (re-evaluated live every render, no separate reactivation logic needed).
- **Toggles fold in before faceting.** CardsPage computes a `toggleNarrowed` card list (the `ownedOnly`/`incompleteOnly` toggles applied, but not the FilterPanel filters) and passes *that* to `FilterPanel` as its `cards` prop — the same list `applyFilters` then narrows further into `filtered`. This is why BL-60 shipped first: without it, "show only cards I own" would narrow the table but leave the dropdowns offering values from unowned cards.
- **Scope.** Applies to the seven dropdown fields plus Aspects; the three range sliders (Cost/Power/HP) remain unchanged — continuous controls don't fit the same "hide unreachable values" model and weren't part of BL-70's ask.
- **Empty-data guard.** If the (toggle-narrowed) card list is empty, faceting is skipped entirely (treated as "no restriction") rather than hiding every option — an empty list usually means data hasn't loaded yet, not that every value is invalid.

---

### 5.7 Gallery view — stage 1 (BL-73, shipped 2026-07-11)

A **Table ↔ Gallery toggle** (since BL-111 F3/F6 it lives in InventorySummary's actions slot, left of Add Cards — FilterPanel no longer renders one) swaps the Cards table for a virtualized grid of card images — originally "nothing more than a catalog viewer affected by the filters" (Jeremy's stage-1 carve-out). The grid renders the **same `filtered` array** the table renders, so filters, sort, and the owned/incomplete toggles apply identically; sort order flows left→right, top→bottom.

- **Cells are image-only** (no name/fields), uniform portrait 140×196; click → the unified card popup (§5.3, BL-111 F5). Signed-in inventory editing happens in that popup, not inline in the cell — see BL-111 F4 for the console-plate ownership readout the cell itself does show (playset pips + owned/limit). Anonymous users get the identical view.
- **Representative image per base card:** the Standard-finish variant by default. **Finish-filter-aware (Jeremy, 2026-07-11):** with a Finish filter active, the cell shows a matching variant's art instead — multi-finish overlaps resolve to the lowest numeric `card_number`, residual ties to first-in-array (explicitly "don't care").
- **Orientation rule — no card displays landscape:** Leaders show their **back image** (the portrait deployed side); Bases — and any Leader without a back image — show the front **rotated 90° counter-clockwise** (a 196×140 absolutely-centered box, so the landscape 3.5:2.5 art fills the portrait cell with no letterboxing); all other types show the front unrotated. Cards with no usable image keep a placeholder cell so sort positions stay stable.
- **Performance:** rows-of-N virtualization (`@tanstack/react-virtual`, the CardsTable pattern; N derived from measured container width and reused for both row-slicing and CSS columns), native lazy-loading, and `srcset` renditions (320/640 WebP via ADR-0012's self-hosted serving — see `docs/decisions/0012-card-image-self-hosting.md`; graceful fallbacks: stale-cached API shapes fall back to the hotlinked URL, and every card `<img>` carries a one-shot `onError` swap to its stored URL).
- **Stage 2 (BL-111 F4, 2026-07-13, PR #260 — Option D "Plate + hover dossier"):** each cell carries a 24px corner-cut **console plate** under the art — playset pips + an `owned/playset` readout (completion semantics, fixed 1/3, deliberately *not* the configurable keep-limits — the two systems stay separate by doctrine) — and, signed-in on hover, a **dossier tooltip** listing owned copies per finish. Signed-out plates read "SIGN IN TO TRACK" (no dossier); touch devices rely on tap-through to the popup. From the original stage-2 sketch, fields-under-images was superseded by the plate, and toggle persistence remains unbuilt (no design support — file separately if wanted).

*(Component: `frontend/src/screens/cards/GalleryGrid.tsx`; view-mode state lives in CardsPage; the toggle control renders in InventorySummary since BL-111 F3/F6.)*

See `frontend/src/components/FilterPanel.tsx` (`facetValidValues`, `facetedOptions`) and `learning_journal/Session_Notes_BL70_FacetedFilters_2026-07-06.md`. BL-71 (later) adds a per-filter AND/OR toggle for keywords/traits; BL-70 is OR-only.

---

### 5.8 About & Legal (BL-125, shipped 2026-07-14)

A single App-owned modal (`frontend/src/screens/about/AboutModal.tsx`) reachable two ways: the header's clickable "Unofficial Fan Project" brand-line microcopy (visible to anonymous and signed-in visitors alike) and, signed-in only, an "About & Legal" item in `UserMenu`. Both open the same modal — App owns the open/close state, same pattern as `AuthModal`/`ChangePasswordModal`.

Visually a compact ~520px console panel following the `CardPopup` steel-ring idiom (angled-clip double border, tile body) rather than `AuthModal`'s plain rounded-card family — the design record (issue #287) called this out explicitly. Esc, backdrop click, and the Close button all dismiss.

Three sections, copy owner-approved verbatim:
- **Disclaimer** — non-affiliation with Disney, Lucasfilm Ltd., Fantasy Flight Games, or the Asmodee Group.
- **Privacy** — the four BL-104/RR-12 points (what's stored: account email + card collection; where it lives: GCP `us-central1`; leaving: self-service via Delete Account; tracking — originally "none", superseded 2026-08-26 by BL-235's usage-analytics disclosure bullet: anonymous, inputs masked, opt-out in Settings, processed by PostHog, see §22), plus a fifth point BL-126 added the same session: feedback messages are stored, and email only when contact is opted in.
- **Attribution** — swuapi.com sourcing of catalog data and images.

This is the shipped resolution of **RR-13** (IP/affiliation disclaimer) and completes the privacy floor **RR-12/BL-104** first argued for — both close out via this one modal (`SWU_Backlog.md`/archive has the full BL-104/BL-125 disposition).

### 5.9 Feedback (BL-126, shipped 2026-07-14)

A "Leave Feedback" header button, visible unconditionally (anonymous and signed-in), opens `frontend/src/screens/feedback/FeedbackModal.tsx` — an App-owned modal following the same compact console-panel shell as About & Legal (§5.8).

- **Fields:** a free-form message textarea (5000-char cap, matching the backend's own limit — §4.6/§12), a contact-consent checkbox ("Is it OK if we contact you to learn more?"), and a conditional email field that renders only once consent is checked — prefilled from the signed-in Firebase user's email when available, empty when anonymous, always editable either way.
- **Anti-abuse:** a visually hidden, `aria-hidden`, tab-order-excluded honeypot field (`website`) submits alongside every request; a non-empty value marks the submission as a bot server-side (§12) — the response looks identical to a real success (nothing tips the bot off), but nothing is stored and no notification fires.
- **Submit enablement:** message non-empty **AND** (consent unchecked **OR** (consent checked **AND** the email passes a "looks like an email" format check the backend independently re-validates).
- **Fine print:** discloses that the app version (commit) and submission time are recorded alongside the message, and that email is stored only on opt-in.
- **Flow:** in-modal success message, then auto-close after ~1.5s; Cancel/X/Escape close normally (Escape is suppressed mid-submit, matching the close-guard discipline other console modals in this app use).
- **Client:** `frontend/src/api/feedback.ts`'s `submitFeedback()` routes through `authedFetch` (not a plain `fetch`) — a signed-in caller's Firebase token attaches automatically; an anonymous caller sends no token and the backend treats the submission as tenant-less by construction, not as a degraded path (§4.6/§12).

Backend + data model: §4.6. API contract: §12. Platform-level secret/env wiring for the GitHub-issue notification: `SWU_Platform_Spec.md` §3.5/§3.7.

**Known limitation — CLOSED 2026-07-31 (BL-128).** Originally (owner-accepted 2026-07-14, issue #289): no notification *email* ever arrived — GitHub suppresses notifications for one's own actions, and the notifier's PAT was the owner's own. BL-128 fixes it in two parts, both required. (1) The issues are authored by a dedicated read-only bot collaborator (`hyperspacevaultbot-png`; classic PAT, `repo` scope — fine-grained can't target repos the token's account doesn't own, and the account's entire world is this one repo); token-owner swap only — new `feedback-github-pat` version per env, out-of-band, backends bounced (env-var secrets resolve at instance start). (2) That alone proved insufficient: live channel-isolation testing (2026-07-31) showed GitHub's **Watching-class emails silently not delivering** for the bot-authored issues (web notifications only, settings correct), while a Participating-class @mention email delivered in minutes — so `github_notify.py` appends `cc @<owner>` (owner parsed from `FEEDBACK_GITHUB_REPO`, no new config) to every issue body, putting each notification on the Participating channel. Live-verified end-to-end on dev; prod carries part 1 live and picks up part 2 at the next promote. The transactional-email path remains a recorded future alternative.

### 5.10 Pricing surfaces (BL-140, shipped prod 2026-07-22)

**Scope decision (Jeremy, 2026-07-21): popups ONLY in v1** — the card detail/inventory popup (§5.3) is the only surface that renders prices. No table column, no gallery badge, no completion-header integration; those designed-but-deferred surfaces are BL-141 (the `list-gallery-price` prototype exists in Claude Design). **Partially superseded (2026-07-26, BL-163 — §5.13):** the completion panel now renders **Collection value**; the table-column and gallery-badge surfaces remain deferred under BL-141.

On the popup, for the **selected printing**:
- A **price block** showing Market and Low (from the variant's `price: PriceInfo` — §12/§16). Unpriced variants (unmapped, or mapped-but-never-synced) degrade gracefully — no price block, never a zero or a blank shell.
- An **embedded price-history panel** — the daily market series for the selected variant with a crosshair reading, range-selectable (`30d`/`90d`/`1y`/`all`), fed by `GET /api/base-cards/{id}/price-history` (§12). This is the ecosystem differentiator: no competing SWU tool shows price history.
- **Attribution is mandatory on every priced surface** (decided policy): "Prices via TCGplayer" + the as-of date. USD only in v1 (Cardmarket recorded as a real future second source, not started).

### 5.11 Deck Check (BL-142/BL-143, shipped prod 2026-07-22)

A **top-level navigation item** — Deck Check is a peer of the catalog/inventory views, not a popup or sub-tab. In the same navigation pass, the personal-inventory view was renamed **"Vault"** (nav-only rename; no route or data change).

Two screens (Claude Design templates, Jeremy's saved defaults authoritative):
- **Entry** — paste the de facto deck JSON (the §15.5 interchange shape) *or* a provider URL (server-fetched against the swubase.com / sw-unlimited-db.com allowlist — §12). Auth-only: the whole feature answers "can I build this from *my* inventory," so there is no anonymous mode.
- **Result** — the three-scope diff (`main` / `side` / `together`, §16.4 math) with, per scope: buildability, the missing list with unit prices and a missing-cost subtotal, an **ALL CARDS toggle** (the complete decklist with owned rows included), the scope's total **deck value**, unpriced-card counts (excluded from sums with a visible count, never silently zeroed), and a **TCGplayer Mass Entry cart link** for the viewed scope. The cart link carries a name-based printing-fidelity caveat at the CTA (cart lines are name-matched, not variant-exact). Cart-URL format is load-bearing and was owner-click-through-verified through three real bugs: separator encoding, `productline` must be the internal name `"Star Wars Unlimited"` (not the slug), and subtitled cards require `"Name - Subtitle"` lines (PRs #373/#374/#375).
- Unrecognized deck rows render as a partial result, **reported, never guessed** — same discipline as Add Cards (§5.4) and deck import (§15.5).

### 5.12 Shell changes shipped with the arc (BL-144/BL-147/BL-148, prod 2026-07-22)

- **Global 125% scale (BL-147):** the default view now renders at what was previously 125% zoom (owner finding: the app was only comfortable zoomed). Systemic change, not a font bump — every viewport-conditional breakpoint was rescaled ×1.25 in the same pass (docked-filter threshold now 2833px, BL-121 sidebar tiers, phone passes), and the JS twin constants are pinned to their CSS values by tests.
- **FilterPanel collapsed by default (BL-144)** below the side-by-side breakpoint — the filter no longer eats the first screenful on smaller viewports.
- **Popup prev/next navigation (BL-148):** from the card popup, navigate to the previous/next card **in the current filtered+sorted result list** without closing — the filter-then-browse loop. Deliberately subtle chevron affordances (owner-explicit: not the standard SWUButton). Works from both table and gallery; per-card popup state (selected printing, history panel) resets on navigation.

### 5.13 Cosmetics batch (BL-155/161/162/163/164, merged 2026-07-26)

Full decision record: `planning/Definition_CosmeticsBatch_2026-07-26.md` (+ `planning/Set_Grouping_Context_2026-07-26.md` for the set-grouping model, adopted app-wide). As-built summary:

- **CardPopup decomposed (BL-155):** the 1,124-line monolith split along its recorded seams into `CardPopupRail` / `CardPopupPriceHistory` / `CardPopupNav` / `CardPopupInventory` + a `cardPopupShared` formatter module, `CardPopup.tsx` remaining as the composition shell. Zero behavior change; the 1,599-line test file needed zero edits (DOM-only assertions).
- **Rarity renders as image + colored label (BL-161):** shared `RarityBadge` component (raw 20px webp symbol + 14px `--font-ui` label colored per rarity; assets bundler-owned under `frontend/src/assets/rarity/`) in the table's Rarity column AND the popup's info row. Rarity code `S` relabeled **"Special"** (was "Starter" — owner correction 2026-07-26); catalog codes and faceting untouched.
- **Inventory column removed (BL-162):** the table is **14 columns** — `# · Name · Variants · Playset · Rarity · Aspect · Type · Cost · Power · HP · Trait · Keyword · Arena · Set`. The Playset cell absorbs the always-on count chip (Russo One, left of pips, green at complete), the click-to-edit affordance, and a hover per-finish dossier (shares `ownedFinishBreakdown` + `.gallery-dossier` visuals with the gallery — single source). Signed-out: em-dash chip, empty pips, click/hover disabled.
- **Completion panel rebuilt (BL-163):** four clipped-corner blocks — Playset complete %, Set complete %, Cards (+unique), **Collection value** — with blue tick progress, per-block click "by set" breakdown popovers (set-logo rows, newest main set first, then Intro Battle: Hoth and Twin Suns), and a **Filtered/All scope toggle** rendered only when the visible list is narrowed. Calc rules (§6 token exclusion preserved; universe = the ten base sets; any-variant ownership; orphan roots out of %s, in Cards/Value; value = per-variant price × qty with Standard-price fallback, Market default + Market/Low toggle in the popup rail's idiom) are locked in the Definition doc §3–§4. To feed the value calc, per-variant `price` was **re-attached to the list endpoint** (see §8 API note). *(Order superseded 2026-10-12, BL-258 — prior wording in the Archive.)*
- **Owner dev-review rounds 1–8 (same day, PRs #490–#497):** the arc's polish pass, all dev-verified. Notables that refine the above: aspect icons 24px with console-styled name tooltips (opt-in `AspectIcon` prop; table + popup only); stat-badge numerals recalibrated (anchor bracket 44–52.5 recorded in `StatBadge.tsx`; settled via visible-step tuning); popup rarity plate = 34px symbol left of the set/rarity text stack (`RarityBadge` `iconOnly`/`labelOnly` modes); hover dossiers trigger on the count chip (table) / inventory plate (gallery) only; completion blocks uniform height, popovers enlarged with fixed two-column count/sub alignment and green ticks at 100%; summary strip at a constant 20px inset; table/gallery capped at the table's natural **1526px** (columns never stretch; the three synced values carry a `COLUMN_WIDTHS` sync rule); expanded filter pins to the layout's left edge with centering compensation so the table never moves; **all header labels white** (BL-165's rotating starfields); verify screens unified further (precon rows show subtitles; manual rows show `current → resulting` inventory); plus two BL-153 overlay stragglers fixed (sign-in/change-password primary renders).
- **Add Cards dropdowns (BL-164):** both pickers replaced by portaled logo-rail custom listboxes (`SetDropdown` / `PreconDropdown`; `aria-label="Set"` / `"Precon Deck"` contract preserved on trigger and listbox). Set list per the locked grouping model (`frontend/src/utils/setGrouping.ts`): canonical rail groups, **newest main set first** (HMW … SOR) → divider → IBH/TS26; all-sets adds weekly-play rows per group + labeled Exclusives subgroups; "Show all sets" lives in the panel footer. Precon rows hover a **preview panel (beside-left)**: leader front full with the deck's base title-bar-peeking behind (Twin Suns: both leaders side by side, one base centered behind; IBH box: both halves, each with its own base), text block beneath; leaders/bases resolved from the live catalog (`utils/preconPreview.ts` — structural dual-leader detection, unresolved rows reported never dropped). FilterPanel's Set field gains the same guaranteed ordering + canonical/secondary divider (labeled headers deferred). *(Order superseded 2026-10-12, BL-258 — prior wording in the Archive.)*

### 5.14 Variant scope + the Value column (BL-173/BL-181 — build record archived 2026-08-17, BL-233)

- **Value column** (between Playset and Rarity): two `ValueSwitch` controls stacked in the header — **UNIT/COLLECTION** on top, **MARKET/LOW** beside a static "Value" label; both persisted in localStorage (`swu.cardsValue.display`, default UNIT; `swu.cardsValue.kind`, default Market). `ValueSwitch` (track-and-thumb, active-state label only, `role="switch"`) is the app-wide Market/Low idiom — the same control serves the completion panel's value block and the card popup rail (`CardPopupRail`).
- **UNIT mode:** the unit price of the relevant printing — the scoped variant while a scope is active, else the Standard printing with min-of-active-kind fallback; ≥$100 renders whole-dollar; unpriced = em-dash.
- **COLLECTION mode** (`cardCollectionValue`, `utils/variantScope.ts`): the viewer's owned copies' value per row — Σ qty × each owned variant's own price (active kind), unpriced variants falling back to the card's Standard price (the §5.12 chain at row grain, so the column visibly decomposes the Collection-value block's total). Em-dash for unowned rows AND owned-but-unpriced rows (never a fabricated $0.00). Scoped: scoped finish's owned qty × that finish's own price, **no fallback** — mirroring scoped UNIT mode and the scoped pips.
- **Variant-scope control** in the Playset header (trigger reads **ALL FINISHES** unscoped / `PIPS · <finish>` scoped): single-select menu built from the FinishFilter's control anatomy, order mirroring the sidebar Finish filter (pair chips; Prestige as a pinned chip row; expander rows for Convention/Event/Prerelease/Movie; **Showcase deliberately excluded** — a leaders-only playset-1 finish is not a pip scope; 13 scopes total).
- **Scoped state semantics:** picking a scope REPLACES `FilterState.finish` with the single raw value (rows narrow via the existing filter engine); a direct FinishFilter panel edit or Reset All Filters disengages it ("scope drives filter, never vice versa"); unrelated facets don't. Pips fill from the scoped variant's owned count only — amber below the variant playset (no outline); at scoped-complete the pips turn green inside an amber-outlined plate. The count chip NEVER changes (total across variants, green at total playset). Scope-mapping visuals: in-header amber bracket spanning Playset + Value, faint amber wash on both columns' cells, dossier head "OWNED — ALL VARIANTS" with a `◂ scope` marker on the scoped finish's row. Anonymous: scope + Value fully functional; pips stay signed-out-empty. Scope follow-through (`#` column, click-through, collection filters): §5.16.
- **Filter-panel normalization** (shipped with this arc): FinishFilter renders Prestige as a 3-chip row (presentation-tier only — the tree still models a group); Finish/Set menus open at a 320px floor; the Set menu's values follow the Add Cards grouping logic and have no redundant "All" button (Clear suffices).
- **Card popup set row:** card type + aspect icons sit right-aligned on the set row (aspect icons at 46px, matching the stat badges); no standalone aspects/type line.
- **Geometry:** the hover inventory dossier hugs its content; this arc's fixed natural-width / cap-trio / docking-breakpoint numbers were superseded by BL-226's width tiers (§21).

> **Archived (2026-08-17, BL-233):** the BL-173/BL-181 round-by-round build record and owner-dialed pixel geometry moved verbatim to `SWU_Application_Spec_Archive.md`; the behavior + owner-locked design record remains `planning/Definition_VariantScope_2026-07-26.md`.

### 5.15 Completion-panel set selection + filter-panel UX (BL-179 — build record archived 2026-08-17, BL-233)

- **Popover set rows are a filter control** on the sidebar's own Set facet (`filters.set` — one selection, one language, since BL-224 unified the dimensions, §21). Rows ignore their own dimension (the menu never filters itself — same shape as `facetValidValues`) while respecting every other filter; zero-universe rows are inert; an already-selected row is always deselectable. Selected rows: steel-blue band + accent edge (green stays reserved for 100%); hover lift; the popover hover-dismisses (armed after pointer entry; wrap-level boundary with a transparent gap bridge).
- **Totals scope** is the FILTERED/ALL `ValueSwitch` beside the blocks (BL-223, §21 — replaced this arc's original three-way toggle).
- **The three Collection checkboxes** (incomplete playsets / cards I own / no inventory) are first-class applied filters: they count toward the collapsed rail's badge, activate Reset All Filters, and are cleared by it.
- **Filter panel:** facet dropdown menus hover-dismiss (armed; trigger gap bridged; leaving back onto the control exempt). The docked state is self-asserting — one-column tier (viewport ≥ `DOCKED_MIN_HEIGHT`) AND side-by-side width auto-expands the panel in-flow against the table's left edge, pair centered; only the « button collapses it there. Everywhere else the panel is the floating overlay: collapsed by default, auto-collapsing once the pointer settles outside it (document-`mouseover`, armed per open; drags and portaled menus guarded). Label: **"Filters"**.
- **Table scrollbar allowance:** `scrollbar-gutter: stable` reserves the vertical scrollbar's width by construction (the fix for the sliver-scrollbar / virtualizer row-shake bug this arc closed); the specific width-cap numbers were superseded by BL-226's tiers (§21).

> **Archived (2026-08-17, BL-233):** the BL-179 ten-round build record — including the retired home-base-set dimension and three-way scope toggle (removed by BL-224/BL-223 in v1.4) — moved verbatim to `SWU_Application_Spec_Archive.md`.

### 5.16 Finish-scope follow-through + busy overlay (BL-187/191–196 — shipped prod 2026-08-07, v1.3)

The v1.3 scoped-affordance cluster: six features completing §5.14's finish scope into a whole-Vault lens, plus the busy overlay. Feedback-sourced (announcement-thread requests from u/EmanantVolition and u/soccerholic1816) and owner-filed refinements; execution detail in the archived BL entries + PRs hyperspacevault#52/#53/#54/#57/#61/#69. As-built:

- **Scoped `#` column + row order (BL-187):** while a scope is active, the `#` column shows the **scoped variant's own card number** (early sets number finishes independently) and the list re-orders by base-set order → scoped number — the Vault mirrors how a physical single-finish collection is sorted. Mechanics: `scopedCardNumber`/`sortCardsByScope` (`utils/variantScope.ts`) — the same set-order (newest main set first)/tokens-last precedence as `sortBaseCards`, with the final tiebreak swapped to the scoped variant's `card_number`; a card without the scoped finish falls back to its `base_card_number` (comparator stays total even though such cards are normally filtered out while scoped). *(Order superseded 2026-10-12, BL-258 — prior wording in the Archive.)*
- **Scoped click-through (BL-193):** opening a card popup while scoped selects the **scoped printing** in the rail (not the Standard-representative pick), and prev/next card navigation keeps landing on each card's scoped printing; a card without the finish keeps the representative pick. Companion rails: **up/down arrows cycle the printings with wrap-around (BL-192)** — a deliberate asymmetry vs. BL-148's left/right disable-at-boundary (cards are a list with edges; a card's printings are a closed loop).
- **Scoped collection filters (BL-195):** own / don't own / incomplete-playsets evaluate against the **scoped finish alone** while scoped (`scopedOwnedCount`; completeness via `scopedPlaysetComplete` — the SAME helper the scoped pips use, single source by construction). **Owner ruling (test-pinned):** keep-limits stay entirely out of playset completeness — "the playset complete flag only cares about playset"; the owner's worked example (3 Standard Vader + 0 Hyperspace, scope=Hyperspace ⇒ "cards I don't own" includes Vader) is the integration test verbatim. Scope null = pre-cluster behavior, unchanged. The three toggles carry the scope control's amber family while scoped, and the **`#` header takes the full scope-control treatment (BL-194)** — amber outline via inset box-shadow (no width change, SYNC RULE), amber text, subtle wash.
- **Add Cards shared-number default (BL-191):** early-set numbers shared across finishes (SOR/SHD/TWI) default the finish dropdown to the **non-foil member of the resolver's natural option set** (Standard or Hyperspace — foils exist at far lower quantities, so non-foil is the probable intent), with the dropdown highlighted + "shared across variants — verify selection" helper text; Enter accepts the default. No number-band math: the option set is naturally Std/Std-Foil OR HS/HS-Foil for these cards, and a conservative guard keeps required-pick whenever a set lacks that pair. Explicit selection unchanged.
- **Busy overlay (BL-196):** a blocking, console-themed overlay over the three heavy apply paths (import commit — canonical and foreign formats, large Add Cards batches, precon adds) with **staged status tied to the real phases** ("Applying N cards…" during the commit transaction → "Refreshing your Vault…" through refetch/re-render) and the owner-picked **ORBIT aspect-glyph animation** (comet-tail fade; two live mod rounds; losing variants + dev switcher stripped at the pick — 6 recorded test RETIREs); `prefers-reduced-motion` gets a quiet static treatment. Dismissal waits for the table to settle (double-rAF) — the overlay's job is to cover the re-render jank, not stutter through it; Escape is guarded; export buttons gained busy states. **No percentage progress by design** — the commit is §17.2's single transaction, so staged indeterminate messaging is the honest size. Rode along: the latent import-refresh fix (import commits now refresh the mounted Vault's quantities — a ref bridge; previously they silently didn't).

---

## 6. Completion, limits, enforcement (cross-reference)

Three decoupled axes — see `SWU_Backlog.md` for detail:

- **Completion** — base-card-level and variant-agnostic: *playset* = 3 total copies (1 for Leader/Base), *owned* = ≥1. Already built (`InventorySummary`); unchanged by the redesign.
- **Keep-limits** — per-variant, per-tenant, configurable, **advisory** (BL-24, built 2026-07-12): each variant's own quantity vs. the effective limit for its (type-category × limit-bucket) cell — override if one exists (NULL = no limit), else the code default (singleton 1 / standard 3). **Independent per variant — no cross-variant summing** (the pre-BL-24 shared pool of 3 across a card's variants is retired). Decoupled from completion *and* from stored `quantity`; only the unconditional 999-per-variant technical ceiling sits above it (§4.5).
- **Enforcement mode** — universal per-user hard (block) vs. soft (commit-and-flag) (BL-35, built 2026-07-12/13); default hard. A "no limit" bucket makes the mode irrelevant for that bucket — nothing to block or flag; the 999 ceiling blocks in both modes.

**Token cards (special class).** Tokens (`base_cards.is_token`, §4.2; identity per §3.4) behave like normal cards at the **row level** — the keep-limit applies (default 3 or the user's override) and the inline 3-pip `PlaysetCell` visual renders for them. But they are **excluded from every `InventorySummary` aggregate** at the top of the screen — both completion percentages (Playset complete %, Set complete %) *and* the raw counts (`N cards`, `N unique`) — so a token pile never distorts the collection-completion picture.

---

## 7. Access & currency (cross-reference)

- **Access** — public **Cards** list + card detail popup ([ADR-0008](../docs/decisions/0008-anonymous-catalog-reads.md)): the catalog reads (`/api/base-cards` list since BL-101, `/api/sets`; the `/api/cards` family was retired in BL-102) are served by a strictly tenant-less catalog session (and CDN-cached, Platform Spec §3.14); the card detail popup (`/api/base-cards/{id}`) is optional-auth, so its `quantity` field is real for signed-in callers and 0 for anonymous ones; the Cards list's quantities come from the auth-only `GET /api/inventory/quantities`, merged client-side. Inventory + mutations stay auth-gated, tenant-scoped. Anonymous users see the unified list (§5.5) with inventory columns present-but-inert as a signup teaser — not a separate empty-state tab. (Open Q D resolved; BL-17 → superseded by BL-56.) **`POST /api/feedback` (BL-126, §4.6/§5.9/§12) is a third optional-auth consumer**, but unlike the catalog's use of the pattern (a real value vs. a degraded `0`), anonymous submission there is a fully first-class, intentionally-supported case, not a stand-in for a signed-in view.
- **Currency** — Cloud Scheduler → Cloud Run, daily detection, operator-gated apply (later full auto-apply, BL-37); public catalog shows pre-release/preview content with the gate as the quality check. New-set onboarding in BL-36. **Deletions:** the sync consumes swuapi `/deletions` tombstones (not just upserts) via the documented `since` + `after`/`next_cursor` cursor contract; deletions are surfaced in the operator gating review before apply, with explicit attention to deleting a card that already has inventory rows (rare, must not silently orphan a tenant's inventory). swuapi "card merges never emit," so no card-merge handling is needed. (BL-33 step 7; BL-36.)

---

## 8. Test Strategy

BL-33 is a clean **drop-and-recreate** of the catalog tables, so every test touching the old shape (`cards.is_foil`, `inventory.card_id`, `is_organized_play`, the OP-flag resolver, `groupWithInventory`'s variant keys, the cap rules) breaks at once. The risk is **silent coverage erosion** — broken legacy tests deleted or skipped to reach green while coverage % stays above the CI threshold. This section is the contract the implementation executes against and a reviewer checks against; it is *not* optional polish for a rewrite of this size.

### 8.1 Coverage disposition mandate

The BL-33 drop-and-recreate breaks every test touching the old shape at once. **Each broken legacy test gets a deliberate disposition — never an unreasoned delete-to-go-green:**

- **Port** — the behavior still exists; re-express the test against the new schema. *Survives conceptually and must retain coverage:* completion math (playset / owned, base-card-level, token exclusion from aggregates), limit enforcement (per-variant, default + override, hard vs. soft), increment/decrement caps and signals, every API endpoint (happy + error path, per `SWU_ClaudeCode_Spec.md` §8.3), snapshot integrity & reconstruction (**update, 2026-07-24:** this coverage is no longer permanent — the snapshot-restore behavior itself is slated for retirement under BL-93 once the owner's collection is imported through §17, at which point its test retires with a recorded reason rather than porting forward again), RLS / tenant isolation.
- **Replace** — the behavior survives but is expressed differently; write a new test for the new behavior, superseding the old assertion. *E.g.* the Add Cards resolver (old OP-flag/finish logic → the four-axis Card → Set → Stamp → Finish model, §5.4), `groupWithInventory`'s variant-key derivation.
- **Retire** — the behavior is designed away; delete the test **with a recorded reason** tying it to the redesign decision that eliminated it. *E.g.* the `is_organized_play` flag + OP card-number-collision tests, the boolean variant-flag tests, `has_unique_variant_numbers` resolver tests, the F3 CSV-ingestion tests if BL-29 removes that pipeline.

The only forbidden path is the fourth: deleting or `skip`ping a red test because porting is effort, with no reasoning. **Retiring an obsolete test is correct; abandoning a still-valid one to reach green is the coverage erosion this guards against.**

**Tests encode hard-won bug knowledge — carry the intent, not just the shape.** Where a legacy test guards a specific past bug (the F4 ingestion fixes, diacritic migrations 0007/0009, the RLS `WITH CHECK` bug, OP card-number collisions), record which — so a *port* preserves it and a *retire* is a conscious "this bug class no longer exists," not an accidental loss.

**Deliverable — the disposition log.** The rewrite produces a log mapping each legacy test area to its disposition (port / replace / retire) + reason. This is the auditable record that coverage was *preserved or deliberately reduced*, never silently eroded — produced during BL-33, not as a deferred cleanup item. **Step 1's log:** [`BL33_Step1_Test_Disposition_Log.md`](analysis/BL33_Step1_Test_Disposition_Log.md).

### 8.2 New invariants the redesign introduces (must have tests)

- **`variant_of_uuid` graph integrity** — the large invariant test (mapping spec §8, BL-34): every card is a root or resolves to exactly one root *within its own set*; no multi-hop chains; every non-`"Standard"` root is present in the exceptions file.
- **Base-card anchoring/resolution** — cross-set container variants resolve to a base-set root; reprints are **not** merged (independent roots per set).
- **Finish vs. provenance separation** — `variant_type` vs. `source_set_code` modeled and queried independently.
- **Base/long-tail set picker logic** — `is_base_set` default + toggle; a long-tail selection filters by provenance layered on the base-card view (not a flat variant list).
- **Two-axis Add Cards resolver** — provenance pre-set by source-set selection; provenance checkboxes appear *only* when the number is ambiguous on provenance; finish picker appears *only* when ambiguous on finish.
- **Token treatment** — limits apply, the inline 3-pip visual renders, and tokens are excluded from *all* `InventorySummary` aggregates.
- **Standard-anchor exception** — a Zam-type root (non-`"Standard"` `variant_type`) is flagged, not blocked.
- **Ingestion** — upsert-by-`swuapi_id` idempotency (re-running yields the same result); new/changed detection for the sync thread.

### 8.3 Levels & fixtures

- **Unit** — pure functions (resolver, completion/limit services), DB-free.
- **Integration** — DB + migrations + RLS.
- **Fixture-based for swuapi** — a captured `/export/all` snapshot plus the named examples (mapping spec §5/§9). **No live `api.swuapi.com` calls in CI**; live queries are for manual re-verification only (mapping spec §8).
- **CI gates** — keep (or raise) the existing backend/frontend coverage thresholds; the variant-graph invariant test runs in CI.

### 8.4 Test-first where it pays

Write the variant-graph invariant and the resolver tests against captured fixtures **before/with** the migration (BL-34 is explicitly writable test-first). Red-green the invariants rather than retrofitting tests after the schema lands.

### 8.5 Cutover safety (historical — retired 2026-07-25, replaced by §17 import/export, BL-93)

~~Inventory is wiped and regenerated from the F5 snapshot against new `card_variants.id` values (matched by `set_code` + `card_number`). An explicit **snapshot-reload test must prove the regenerated snapshot restores correctly** to the new variant rows — extending `test_inventory_snapshot_reconstruction.py`.~~ This was the safety net for Jeremy's "comfortable losing inventory as long as it reloads" tolerance (BL-33), covering the era before user-facing import/export existed.

**Retired 2026-07-25 (BL-93):** the owner proved the §17 import/export round-trip on his real collection (export → delete account → new account → import → all inventory present), superseding the snapshot-reload tolerance outright. `test_inventory_snapshot_reconstruction.py` was **retired** (CLAUDE.md testing-disposition rule) — reason: the behavior it proved ("inventory survives a wipe+reload") is designed away by the BL-54 import/export surface and re-verified at the API level by that suite (`test_inventory_import_api.py`), not by a snapshot-file replay. `regenerate_inventory.py`, `apply_inventory_snapshot.py`, and the archived `db/snapshots/archive/inventory_snapshot_pre_redesign_2026-06-21.sql` were deleted in the same PR — git history preserves them.

---

## 9. Relationship to backlog (which items execute which parts)

| Item | Role in this design |
|------|---------------------|
| **BL-33** | Master execution + sequencing: schema migration (§4), ingestion ordering, snapshot regeneration, cutover. Points here for the design. |
| **BL-27** | ✅ Resolved 2026-06-21 — census + classification (§10): vocabulary frozen, finish/channel/stamp rules, exception resolution, `is_token`, keying. |
| **BL-29** | Ingestion from swuapi, upsert-keyed on `swuapi_id`. |
| **BL-24 / BL-25 / BL-35 / BL-22** | Keep-limits, settings UI, hard/soft mode, settings page (§4.5, §6). |
| **BL-31 / BL-32** | `stamp_group` consolidation — popup (§5.3) and inline editing. |
| **BL-36 / BL-37** | New-set onboarding considerations; gated → full auto-apply (§7). |
| **BL-34** | Mapping-spec test suite (validates §3 mechanism). |
| **BL-30** | Bulk-add precon products (independent; blocked on a decklist source). |
| **BL-136 / BL-139 / BL-146** | ✅ Pricing: backend + jobs + snapshot + full history, prod 2026-07-22 (§16, §12). Dev-side reconciliation tail → BL-149. |
| **BL-137 / BL-142 / BL-143** | ✅ Deck check: API + UI + top-level nav ("Vault" rename), prod 2026-07-22 (§5.11, §12); ephemeral precursor of §15. |
| **BL-140 / BL-144 / BL-147 / BL-148** | ✅ Pricing UI (popups-only scope — deferred surfaces → BL-141) + filter default + 125% scale + popup prev/next, prod 2026-07-22 (§5.10, §5.12). |

---

## 10. Variant Census & Classification (BL-27 — resolved 2026-06-21)

Resolved in an Opus session against the captured full export (`swuapi_export_2026-06-21.json` — 8,353 cards, 27 sets; the capture now lives in the private repo-assets bucket (BL-170), fetched by the realdata test tier rather than tracked in git), analyzed **programmatically** (not via WebFetch). This freezes the `variant_type` vocabulary and the §3.2 / §4.3 classification.

### 10.1 The graph (base_cards count + resolution)

**2,319 roots** (= `base_cards`). `variant_of_uuid` chains resolve in **≤2 hops** (5,891 one-hop, 143 two-hop), **0 cycles, 0 dangling**. Resolution must **walk to the ultimate root** (the mapping-spec 2026-06-21 correction); the invariant test asserts termination within a small bounded hop count.

### 10.2 Variant model — raw + curated classification

- `card_variants.variant_type` stores swuapi's **raw label verbatim** (58 values) — faithful, human-readable, clean uuid upsert. Not normalized into `source_set_code`.
- A **curated classification** maps each `variant_type` → `finish`, `channel` (provenance), `stamped` (bool), `stamp_family`. This is the interpretation layer the app uses for grouping, limits, and consolidation; maintained centrally, grows as new variant_types appear.

### 10.3 Finish vocabulary (8, frozen)

Standard · Standard Foil · Hyperspace · Hyperspace Foil · Standard Prestige · Foil Prestige · Serialized Prestige · Showcase. (Overwhelmingly base-set; the remaining 50 variant_types are channel or tournament-tier labels.)

### 10.4 Channel (provenance) — derived from `variant_type` + `source_set_code`

Provenance is **inconsistently encoded** (confirmed): early Weekly Play sits in the base set as `variant_type` "Weekly Play" while `SORP/SHDP/TWIP` hold only 10 Hyperspace promos each; later Weekly Play sits in dedicated `*P` containers. So `channel` is derived from **both** signals:

- `*P` set OR `variant_type` "Weekly Play"/"Weekly Play Foil" → **Weekly Play**
- J24/J25 or "Judge Program"/"* Judge" → **Judge**
- C24/C25/C26 or "Convention Exclusive" → **Convention**
- P25/P26 → **Promo / Tournament-tier**
- MV26 or "Movie Promo" → **Movie**; "Prerelease *" → **Prerelease**
- else (a finish variant in a base set) → **Retail**

### 10.5 `stamp_group` — finish + stamp

A `stamp_group` consolidates variants sharing the **same base art AND the same finish**, differing **only by a stamp**, including the ≤1 same-finish *unstamped* variant. Mechanized: `stamp_group = (base_card, finish)` for any (base_card, finish) with a stamped member.

- **Prestige Foil family (confirmed):** finish "Prestige Foil" → { **Foil Prestige** (unstamped anchor) + **Serialized Prestige** (stamped; Carbonite/Gold/Rose Gold tiers, distinguished by image-filename suffix `_Gold` / `_Rose_Gold` / plain — filenames decode `Carb_A`=Standard Prestige, `Carb_B`=Foil Prestige, `Carb_C`=Serialized) }. **Standard Prestige is separate** (non-foil — a finish difference, like Standard vs Foil).
- **Tournament-tier family (confirmed):** each card's PQ/SQ/RQ/GC/SS tier set is one promo finish, all stamped, no unstamped anchor → one group. Presentation-only consolidation; per-`uuid` images and inventory are preserved, and selecting a tier shows its real image — so pixel-identity is *trusted* from BL-28's sampled inspection, not re-verified per card.
- **Judge / Prerelease Judge / Prerelease Promo:** a varied lot (some stamped, some not) — **deferred to BL-39** (visual set-by-set analysis); **default ungrouped** for now.
- **Group-by-art alternative:** the whole finish+stamp model is a deliberate *starting point*; a broader "group by base art regardless of finish" model (Standard+Foil, Hyperspace+HS Foil, all prestiges, …) is **deferred to BL-40**.

### 10.6 Exceptions — structural 15 → fallback → genuine exceptions

- **15 roots** have a non-`"Standard"` `variant_type` (the structural definition). The earlier "1 (Zam)" was the old name-match result.
- **14 are swuapi null-errors** (the `variant_of_uuid` should not have been null): each resolves to a unique base-set Standard via case-insensitive `(name, subtitle)` fallback — confirmed in the census (e.g. C25 BB-8 → JTL_145, J25 Luke → JTL_94, Grogu → ASH_18). Ingestion applies this fallback to re-anchor them.
- **Tokens are exempt** from the fallback: `GG_5 Experience` matched **7** base-set Standards (duplicate-per-set tokens) — it stays its own `base_card` per §3.4, not force-matched. **If the fallback ever returns 0 or >1 non-token matches for a future card, stop and decide manually** (don't guess).
- **Genuine no-anchor exceptions: none currently.** The exceptions file lists zero. A root the fallback cannot match (0 matches) is flagged there, never blocked. When upstream later re-anchors such a card, additive ingestion re-points its variant and strands the old root's `base_cards` row with zero variants — remove it with the content runbook's Deletions procedure ([ADR-0004](../docs/decisions/0004-catalog-bootstrap-from-swuapi-export.md), 2026-10-02 amendment). *(Superseded text archived 2026-10-02 — BL-239; see `SWU_Application_Spec_Archive.md`.)*

### 10.7 `is_token`

Derived from the `type` field containing **"Token"** — `Token Unit` (21), `Token Upgrade` (28), `Credit Token` (2), `Force Token` (2). Drives §6 token treatment and the §10.6 fallback exemption.

### 10.8 Keying & data-quality

- `card_variants` is uniquely keyed on **`swuapi_id` (uuid)** — `(base_card_id, variant_type)` is **not** unique. Serialized Prestige collides: 23 `(set, number)` groups have multiple rows; SEC senators carry 3 same-`variant_type` rows distinguished only by image-filename suffix.
- **Identical-image collisions** (e.g. LAW_865/866 Serialized Prestige ×2 with the same image hash) are flagged as **suspected swuapi duplicates** to surface at ingestion — not silently kept or merged.

### 10.9 Aspect multiplicity — confirmed flattened

**0 of 8,353 cards** carry a duplicated aspect; `aspectDuplicates` does not exist in live data. swuapi flattening confirmed on raw JSON (the 5 physical double-pip examples all return single-element `aspects`). Accepted; tracked in **BL-38**.

### 10.10 Remaining open

- **Judge / Prerelease stamp classification** — visual set-by-set analysis → **BL-39**.
- **Group-by-art grouping revisit** — finish+stamp vs. broader art-based grouping → **BL-40** (BL-39's visual pass is an input).
- **Limit configuration granularity** — per `variant_type` vs. per `stamp_group`/finish family (§4.5; tied to BL-31/32 and BL-40).
- **Additional swuapi fields** beyond §4 (e.g. `rules`/`additionalRulings`) — deferred, no current consumer.
- **Exact column types / constraints / indexes** — settled at BL-33 implementation.

---

## 11. Backend architecture & tech stack

*Added 2026-06-24 (BL-49) — absorbed and code-verified from the frozen `SWU_ClaudeCode_Spec.md` §2–§3.*

**Three-tier.** React (Vite) SPA → FastAPI REST backend → PostgreSQL 16. The frontend talks only to the API; it never queries the database directly.

**Backend module structure** (`backend/app/`), each layer independently testable:
- `routers/` — FastAPI route handlers: `account`, `base_cards`, `catalog`, `deck_check`, `feedback`, `images`, `inventory`, `sets`, `settings`, `shares` (no `cards.py` — retired BL-102); no business logic. Registered in `main.py` (`shares.py` registers twice: the authed `/api/shares` owner router and the anonymous `/api/shared` viewer router — BL-205). Unauthenticated surface: `/health`, the tenant-less catalog reads (`/api/base-cards`, `/api/sets`), `/images/cards/*`, `/api/catalog/reference.csv`, and anonymous `POST /api/feedback` (optional-auth) — see §12 for the full access breakdown; `/health` is not the only one.
- `services/` — business logic (completion, limits, classification-on-read); no direct DB access.
- `repositories/` — SQL / ORM query logic only.
- `models/` — SQLAlchemy ORM (`base_card`, `card_variant`, `set_model`, `inventory`, `card_aspect`/`trait`/`keyword`, `tenant`, `user`).
- `schemas/` — Pydantic request/response models (§12).
- `ingestion/` — the swuapi pipeline + catalog bootstrap (§13; the inventory-snapshot apply path was retired 2026-07-25, replaced by §17 import/export — BL-93).
- `auth.py` + `database.py` — `get_db()` wires Firebase token verification and the RLS tenant context onto every authenticated request (catalog reads run tenant-less via `get_catalog_db`/`get_optional_db`; BL-205 share-token reads scope via `get_shared_db`, §19.1) (see `SWU_Platform_Spec.md` §1 — authoritative for auth/tenancy; not duplicated here). `middleware.py` — structured request logging. `main.py` — app entry, startup lifespan (catalog bootstrap only, §13 — the inventory-snapshot apply call was removed 2026-07-25, BL-93), router registration, prod `/docs` gating.
- `tests/` — pytest suite mirroring the structure.

**Tech stack** (code-verified versions as of 2026-07-24; full table + local setup in `README.md`):
- Backend — Python 3.12, FastAPI 0.138, SQLAlchemy 2.0, Alembic, Pydantic 2.13, `psycopg2`, `firebase-admin` 6.5, uvicorn; pytest. PostgreSQL 16.
- Frontend — React 19.2 + Vite 8, TypeScript, Firebase JS SDK 12; Vitest 4, ESLint 9 + Prettier.
- Platform (GCP / Cloud Run / Cloud SQL / Terraform / CI) — authoritative in `SWU_Platform_Spec.md`.

---

## 12. API reference

*Added 2026-06-24 (BL-49) — verified against `backend/app/routers/` + `schemas/`. Supersedes the frozen spec's §6, which described the pre-redesign `cards`/`card_id` model.*

**Auth & docs.** Most `/api/*` routes require a Firebase ID token (`Authorization: Bearer …`) and are tenant-scoped via RLS (Platform Spec §1). **Exception (BL-56):** the catalog read endpoints are **publicly readable**, no token required ([ADR-0008](../docs/decisions/0008-anonymous-catalog-reads.md)), but not via the same mechanism:
- `GET /api/base-cards` (list, since BL-101), `GET /api/sets`, `GET /api/sets/{set_code}` — **strictly tenant-less** (`get_catalog_db`). These carry no tenant-scoped data at all, so no `Authorization` header is ever inspected.
- `GET /api/base-cards/{id}` — **optional auth** (`get_optional_db`), a build-time refinement over the original tenant-less design: this endpoint's `inventory`-derived `quantity` (§ below) must reflect the *caller's own* holdings when they're signed in, not always read as 0. No `Authorization` header → tenant-less session → `quantity: 0` for every variant (RLS returns no rows without a tenant). A **valid** token → real tenant resolved exactly like `get_db` → real per-tenant quantities. A **present but invalid/expired** token → `401`, same as every authed route — a bad token is never silently treated as "no token."

**Retired (BL-102, 2026-07-10):** `GET /api/cards`, `GET /api/cards/{variant_id}` (the flat ~8,353-row variant list) and `GET /api/inventory` (the heavy `CardResponse`+`quantity` list) — all runtime-dead since BL-56/BL-44 replaced them with the base-cards list (+ BL-101's `/quantities`). Removed rather than left as zombie public surface; git history has them if a flat variant read API is ever wanted.

All `/api/inventory` routes and every mutation remain auth-gated via `get_db` (no optional path). `/health` is open. `/docs`, `/redoc`, `/openapi.json` are enabled in dev/CI and **disabled in production** (`ENVIRONMENT=production`).

**The ID shift.** Card/variant endpoints key on **`variant_id`** = `card_variants.id` (the old `card_id` is retired). The curated classification (`finish`, `channel`, `stamped`, `is_token`) is **derived on read** by `app.ingestion.swuapi_classify.classify_variant` — the same function ingestion uses, so there is one source of truth — and is **not** stored.

### Sets — `/api/sets`
| Method | Path | Response |
|--------|------|----------|
| GET | `/api/sets` | `list[SetResponse]` |
| GET | `/api/sets/{set_code}` | `SetResponse` (404 if unknown) |

`SetResponse`: `id, code, name, is_base_set, release_date?`.

### Base cards (list + detail) — `/api/base-cards`
| Method | Path | Response |
|--------|------|----------|
| GET | `/api/base-cards` | `list[BaseCardCatalogResponse]` — query params `set_code`, `type`, `rarity`, `pricing` (`standard`\|`cheapest`, default `standard`) |
| GET | `/api/base-cards/{base_card_id}` | `BaseCardDetailResponse` (404) |
| GET | `/api/base-cards/{base_card_id}/price-history` | `PriceHistoryResponse` — query params `variant_id` (required), `range` (`30d`\|`90d`\|`1y`\|`all`, default `90d`); 404 if `variant_id` isn't a variant of `base_card_id` |

The **list** endpoint (BL-44 Slice A, shipped 2026-07-05) is the unified Cards view's single data source: one row per base card with variants nested — ~2,306 rows vs. the ~8,353 of flat `/api/cards` (a ~3.6× payload-shrink verified in prod, since flat `/api/cards` duplicates every base-card field across all of its variant rows). **Since BL-101 (catalog/quantity split) the list is catalog-only and strictly tenant-less** (`get_catalog_db`, same family as `/api/sets` — the family's original `/api/cards*` members were retired in BL-102 — CDN-cacheable per Platform Spec §3.14). **BL-146 (2026-07-25, sparse list split, shipped to dev — PR #442):** a field census of every list consumer (filters/sort/table/gallery/Add Cards resolver) found zero reads of a set of detail-only fields, so the list payload is now **SLIM**: `BaseCardCatalogResponse` = `{ id, set_code, base_card_number, name, subtitle?, type, rarity, cost?, power?, hp?, arena?, is_token, aspects[], keywords[], traits[] }` + `variants: list[CardVariantCatalogResponse]`, each `{ variant_id, variant_type, finish?, channel, source_set_code, card_number, front_image_url?, back_image_url? }` — **no `quantity`**. Dropped from the base-card shape: `set_name, type2, double_sided, is_unique, front_text, back_text, epic_action, artist`. Dropped from each variant: `stamped, source_set_name, stamp_group, price, front_images, back_images`. `front_images`/`back_images` (the 3 same-origin rendition URLs, ADR-0012) are no longer server-constructed on the list — the frontend derives them client-side from `front_image_url`/`back_image_url` (`frontend/src/utils/cardImages.ts`'s `deriveRenditions`, a line-for-line port of the backend's `same_origin_renditions`) instead. Every dropped field still ships, unchanged, on the detail endpoint below — the detail response's actual JSON shape is byte-identical to before this split. The frontend merges quantities from `GET /api/inventory/quantities` client-side.

**Prices are embedded, additively (BL-136 P4, prod 2026-07-22 — §16):** the list's `BaseCardCatalogResponse` carries `display_price: DisplayPrice | null` — the one-price-per-card aggregate computed per the `pricing` param (`standard` = the Standard printing's market price; `cheapest` = min(`low`) across ALL of the card's priced variants, any printing — the owner-decided "least money out the door" definition), `{ value, as_of }`, null when the card has no priced variant under the selected mode (tokens always null). `display_price` stayed on the list through BL-146 (BL-141's list/gallery price display is designed against it). Detail variants each carry `price: PriceInfo | null` = `{ market, low, as_of }` — null when the variant is unmapped or never synced; `market`/`low` individually stay nullable even when a row exists (tcgcsv occasionally omits a tier for a day — the price still ships with its `as_of`, never blanked wholesale). ~~**Since BL-146, per-variant `price` is detail-only** — it moved off the list's `CardVariantCatalogResponse` in the same split as the other dropped fields above.~~ **Reversed for `price` only (2026-07-26, BL-163 — §5.13):** per-variant `price: PriceInfo | null` is **re-attached** to the list's `CardVariantCatalogResponse` to feed the completion panel's Collection-value calc — the service computed this per-variant `PriceInfo` on every list request all along (it feeds `display_price`'s aggregation); BL-146 had dropped only the response field, so re-adding costs no query. Every other BL-146 drop stands. The **price-history** route is tenant-less catalog data (`get_catalog_db` family, publicly cacheable) returning `points: [{ as_of, market }]` for one variant; its cost is independent of total history depth (index-scoped by variant — §16.5).

The **detail** endpoint serves the unified card popup's read-and-edit view (§5.3, BL-111 F5 — one popup covers both what was previously a read-only card-detail popup and a separate editable card-inventory popup): one base card plus its **full variant long tail**, and remains **optional-auth** (`get_optional_db`) because its variants *do* carry `quantity` (`CardVariantDetailResponse` = catalog variant + `quantity`; `BaseCardDetailResponse` = catalog row with that variant shape). A signed-in caller sees their real per-tenant quantity on every variant; an anonymous caller sees `0` ([ADR-0008](../docs/decisions/0008-anonymous-catalog-reads.md)); a present-but-invalid token still `401`s. The frontend distinguishes "0 because anonymous" from "0 because you truly own none" using auth state, not the response body alone. **Detail content is unchanged by BL-146** — `CardVariantDetailResponse`/`BaseCardDetailResponse` now re-declare every field directly (pure schema restructuring, since the slim catalog schemas they used to extend can no longer supply the full set) rather than inherit from the catalog shapes above, but the wire response is byte-identical to pre-BL-146.

### Inventory — `/api/inventory`
| Method | Path | Response |
|--------|------|----------|
| GET | `/api/inventory/quantities` | `list[VariantQuantityResponse]` — BL-101, sparse `{ variant_id, quantity }` rows for the caller's tenant |
| POST | `/api/inventory/{variant_id}/increment` | `IncrementResponse` (404) |
| POST | `/api/inventory/{variant_id}/decrement` | `DecrementResponse` (404) |
| POST | `/api/inventory/{variant_id}/adjust` | `AdjustResponse` (404) — body `{ delta: int }` (BL-219, v1.4) |
| GET | `/api/inventory/export?format=json\|csv` | File download (`swu-inv/1`, §17) — verified-email-gated |
| POST | `/api/inventory/import` | `ImportReport` (§17) — multipart, verified-email-gated, dry_run/commit |

`/quantities` (BL-101) is the per-tenant half of the catalog/quantity split: the Cards view fetches the publicly cached catalog list plus this lean auth-required list, and treats any `variant_id` absent here as quantity 0. It is a read — auth-gated via `get_db` but not gated on email verification (the BL-16 gate covers inventory **data writes** — increment/decrement plus, since BL-54, import *and* export; see the Platform Spec's gate-boundary doctrine). *(The heavy `GET /api/inventory` list it replaced was retired in BL-102.)*

`GET /api/catalog/reference.csv` (BL-54, §17) is the one route under `/api/catalog`: the public, tenant-less resolution-key download (same exposure class as `/api/sets`).

`IncrementResponse`: `{ variant_id, quantity, playset_complete, blocked, reason?, over_limit }` where `reason ∈ {"trade_sell", "ceiling"}`. `DecrementResponse`: `{ variant_id, quantity }` (floor 0).

**`adjust` (BL-219, v1.4):** the card popup's rapid-click `+`/`−` stepper batches clicks client-side (debounced delta) and commits them in ONE call instead of N serialized `increment` round trips. `AdjustResponse`: `{ variant_id, quantity, applied, requested, blocked, reason?, over_limit, playset_complete }` (body validates `delta != 0`) — `applied` is the delta actually committed: same sign as `requested`, clamped by the effective keep-limit (hard mode), the 999 ceiling, or the 0 floor; `reason` populates on any truncation, while `blocked` is reserved for the zero-applied case (same meaning as on `increment`). A partially-honored batch is reported honestly, never errored.

**Increment caps** (BL-24/BL-35 behavior, 2026-07-12/13):
1. **Ceiling first** — at quantity ≥ 999 (`QUANTITY_CEILING`), returns `{ blocked: true, reason: "ceiling" }` regardless of any setting, including "no limit" and soft mode.
2. **Effective keep-limit, per variant** — the variant's own quantity vs. its (type-category × limit-bucket) effective limit (§4.5: tenant override, NULL = unlimited, else code default 1/3). At/over limit: **hard mode** (default) returns `{ blocked: true, reason: "trade_sell" }` (HTTP 200); **soft mode** (BL-35) commits and returns `{ blocked: false, over_limit: true }`. **No cross-variant summing** — two variants of the same card each get their own cap.
3. **Completion signal decoupled** — `playset_complete` still means the base card reached 3 total across all variants (`COMPLETION_PLAYSET_SIZE`; singletons: first copy acquired) and does not track the configurable limit.

### Settings — `/api/settings`
| Method | Path | Response |
|---|---|---|
| GET | `/api/settings/limits` | `LimitsResponse` — full effective matrix: every `(type_category × limit_bucket)` cell as `{ type_category, limit_bucket, max_quantity (int\|null), is_default }` |
| PUT | `/api/settings/limits` | Same shape; body = the tenant's complete override set (full replacement; empty list = reset all to defaults). 422 on unknown bucket/category, out-of-range (`0–999`/null), or duplicate cells |

Both auth-gated + tenant-scoped via `get_db`, `tenant_no_store`. PUT deliberately not gated on verified email (BL-16 gates inventory mutations only — §4.5).

### Shares — `/api/shares` (owner CRUD) + `/api/shared` (token-scoped public reads) — BL-205, v1.4

| Method | Path | Response |
|---|---|---|
| POST | `/api/shares` | `ShareResponse` (201) — body `{ name }`; enforces one active share per scope target (§19.1) |
| GET | `/api/shares` | `list[ShareResponse]` |
| PATCH | `/api/shares/{share_id}` | `ShareResponse` — rename |
| POST | `/api/shares/{share_id}/rotate` | `ShareResponse` — new token, old dies instantly |
| DELETE | `/api/shares/{share_id}` | `204` — revoke |
| GET | `/api/shared/{token}` | `SharedResolveResponse` — `{ name, scope }` (validity is the HTTP status: 200 vs 404; no `valid` field) |
| GET | `/api/shared/{token}/quantities` | `list[VariantQuantityResponse]` — the owner-tenant rows |
| GET | `/api/shared/{token}/limits` | `LimitsResponse` — display-affecting subset |

The `/api/shares` family is auth-gated via `get_db` like every mutation. The three `/api/shared/{token}` routes are the platform's first unauthenticated tenant-data reads — token-validated, then run under the **owner-tenant RLS context** (`get_shared_db`) on the existing repository paths (no RLS bypass; FORCE RLS untouched); `no-store` response headers; invalid and revoked tokens are indistinguishable 404s. Design authority: §19.1 (the read-surface list there is exactly this table's public half).

**Retired vs. the frozen spec:** `PUT /api/inventory/{id}`, `GET /api/inventory/missing`, and `GET /api/cards/lookup` (frozen §6.4) are **not implemented** — playset gaps and card-number resolution are computed client-side against the already-loaded base-cards data (BL-102 also retired the once-implemented `GET /api/inventory` and `GET /api/cards*`, § above).

### Deck check — `/api/deck-check`
| Method | Path | Response |
|---|---|---|
| POST | `/api/deck-check` | `DeckCheckResponse` — query param `mode` (`standard`\|`cheapest`, default `standard`) |

BL-137 (backend, merged 2026-07-16) + BL-142's additive full-list extension; prod 2026-07-22. **Auth-only via `get_db`, but NOT verified-email-gated** — deck check mutates nothing (it reads the caller's own inventory through RLS), so `require_verified_email` (which gates inventory mutations, BL-16) doesn't apply; every response is per-tenant, so `tenant_no_store` applies router-wide.

**Request** (`DeckCheckRequest`): exactly one of `url` (server-side fetch against the swubase.com / sw-unlimited-db.com **allowlist** — any other host is a typed `unsupported_url` error, deliberately not open fetch surface) or `deck_json` (the §15.5 de facto interchange shape). The XOR is enforced in the router, not pydantic, so a violation yields the same typed error shape (`{error, message}`) as structural parse failures — and `deck_json = {}` counts as *provided* (it then fails structural checks), never as absent. **Ephemeral by design**: nothing is persisted — the parsed-deck shape deliberately matches what a future `decks` table needs (§15.2), but v1 stores nothing.

**Response** (`DeckCheckResponse`): `deck` (name/author/source + leader/second-leader/base summaries + main/side counts), `unrecognized` (unresolved `SET_NUM` ids with counts — partial result, never a guess), `scopes` (`main`/`side`/`together`, each a `ScopeResult`), `pricing` (`mode`, `source`, `as_of`).

**Scope math (owner-decided, sequential three-scope):** `main` checks the main deck against inventory; **`side` checks against inventory MINUS the main deck's full requirement** — the reservation is the main's *need*, not just what's owned, so an unmet main need never frees phantom copies for the side; `together` = main + side combined. Named acceptance case: 2 main + 1 side of a card, own 2 → main buildable, side NOT, together NOT. An empty inventory is not an error — everything simply comes back missing.

**`ScopeResult`:** `buildable`, `missing[]` (per card: `need`/`have`/`unit_price`/`price_basis`), `missing_total`, `unpriced_count`, `cart_url` (TCGplayer Mass Entry for the scope's missing list, null when nothing is missing), plus the BL-142 extension: `all_cards[]` (the complete list including fully-owned rows, each with `line_value = unit_price × need`), `deck_value` (complete-decklist market value), `unpriced_value_count`. Unpriced cards are excluded from every sum and surfaced as counts — never silently zeroed. Cost modes: `standard` prices each card at its Standard printing's market (falling back to the cheapest priced printing's market when the Standard printing itself is unpriced); `cheapest` = min(`low`) across all priced printings.

### Account — `/api/account`
| Method | Path | Response |
|--------|------|----------|
| DELETE | `/api/account` | `204 No Content` |

BL-87: permanently purges the caller's own tenant — every `inventory` row, the tenant's `tenant_card_limits` and `tenant_settings` rows (BL-24/BL-35; added 2026-07-13 after live dev verification caught the FK 500 the arc had introduced — **every future tenant-owned table must be added to `purge_tenant` and its regression test**), **the tenant's consented `feedback` rows** (BL-126, added 2026-07-14 the day that table shipped, per the same rule — anonymous `feedback` rows carry no `tenant_id` and are therefore untouched by this purge, surviving deletion by design, §4.6), the tenant's `users` row(s), and the `tenants` row itself, in FK-safe order inside one transaction, so a partial purge is impossible. Auth-gated via `get_db` like every other mutation (§ above); the tenant purged is always derived from the verified token's `app.current_tenant_id`, never a request parameter — there is no request body and no query/path params. **Idempotent**: a tenant with nothing left (already purged) still returns `204` — zero rows affected is success, not an error. Every `DELETE` statement filters explicitly by `tenant_id`/`id`; RLS (`tenant_isolation` on `inventory`, `user_self_access` on `users`, the three command-specific policies on `feedback`) is a backstop that happens to agree, not the mechanism — `tenants` carries no RLS at all, so its deletion is scoped purely by the explicit, server-derived filter (`SWU_Platform_Spec.md` §1.5, migration `0024_grant_account_deletion_to_swu_app`). This is a backend-only purge; deleting the Firebase auth identity itself (`deleteUser()`) is a client-side follow-up call the frontend makes only *after* this endpoint succeeds — see `DeleteAccountModal.tsx`.

### Feedback — `/api/feedback`
| Method | Path | Response |
|---|---|---|
| POST | `/api/feedback` | `FeedbackSubmitResponse` (201) |

BL-126, optional-auth via `get_optional_db` (the same family as `/api/base-cards/{id}`, [ADR-0008](../docs/decisions/0008-anonymous-catalog-reads.md)) — anonymous submission is a first-class case here, not a degraded fallback (§4.6). Request (`FeedbackSubmitRequest`): `message` (required, 1–5000 chars, server-rejects blank/whitespace-only), `contact_ok` (bool, default false), `contact_email` (required only when `contact_ok`; format-validated server-side against a simple "looks like an email" pattern — not RFC-5322-grade, since the address is never used to actually send mail, only to appear in a notification issue body), `website` (honeypot, default empty string). A non-empty `website` returns the **identical** 201 `FeedbackSubmitResponse` but stores nothing and fires no notification (`app/services/feedback.py`). `FeedbackSubmitResponse` is minimal by design (owner spec): `{ status: "ok" }` — no submission id, nothing for a caller to enumerate.

**Rate limiting.** A per-client-IP, in-memory, per-Cloud-Run-*instance* cap — 5 submissions/hour (`app/rate_limit.py`), `429` past the cap; runs before the DB write so a limited caller never consumes a round trip, and does not special-case the honeypot path (a bot retrying past it is exactly the traffic the limiter exists to blunt too). Deliberately the cheapest tier: state resets on every cold start/restart and is blind to traffic split across instances — not a defense against a distributed or persistent attacker. Real rate limiting is tracked separately (`SWU_Backlog.md` BL-53).

**Notification.** A best-effort GitHub issue, created *after* the DB write commits (`app/services/github_notify.py`) — a notification failure can never turn a persisted submission into an error response; every failure mode (missing/placeholder token, network error, GitHub 4xx/5xx) is caught and logged, never re-raised. Issue title = the message (whitespace-collapsed, truncated to 60 chars); body = message + commit SHA + submission timestamp, plus contact email **only** when consent was given. Token/repo come from the `FEEDBACK_GITHUB_PAT`/`FEEDBACK_GITHUB_REPO` env vars (`SWU_Platform_Spec.md` §3.5/§3.7); a missing or still-placeholder token is treated identically to "not configured" — the submission still succeeds, the notification silently skips.

---

## 13. Ingestion pipeline

*Added 2026-06-24 (BL-49) — verified against `backend/app/ingestion/`. Supersedes the frozen spec's §5.2–§5.3 (the retired TCGPlayer-CSV + Excel pipeline); the seed/snapshot model in §5.4–§5.5 held until BL-93 retired the inventory half 2026-07-25 (below).* See [ADR-0002](../docs/decisions/0002-csv-to-swuapi-rewrite.md) for *why* the source changed.

**Catalog source: swuapi.** `run_swuapi_ingestion.py` is the CLI — `--file <export.json>` (a captured export) or `--live` (pulls from `api.swuapi.com` via `swuapi_client.fetch_export`).
1. `transform()` (`swuapi_transform.py`, DB-free) does root-resolution (via `variant_of_uuid` — see Variant Mapping Spec) and curated classification → `IngestionResult(sets, base_cards, card_variants, aspects, keywords, traits, exceptions, duplicate_image_warnings)`.
2. The upsert layer writes `sets`, `base_cards`, `card_variants` (each **`ON CONFLICT (swuapi_id) DO UPDATE`**), sets `base_cards.standard_variant_id`, and inserts `card_aspects`/`card_keywords`/`card_traits`.

**Idempotent by construction:** every table is keyed on `swuapi_id`, so re-running an export yields the same rows — this is also the ongoing-sync mechanism (an ID upsert, not fuzzy re-matching). Classification (`finish`/`channel`/`stamped`) comes from `swuapi_classify.classify_variant`, shared with the API read path (§12).

**Catalog bootstrap** (as-built; supersedes the retired seed model — [ADR-0004](../docs/decisions/0004-catalog-bootstrap-from-swuapi-export.md)): on container startup, `main.py`'s lifespan calls `bootstrap_catalog()` (`app/ingestion/bootstrap.py`), which idempotently loads the catalog from the **committed swuapi export** (`app/ingestion/data/swuapi_export_2026-07-14.json` by default, `SWUAPI_EXPORT_PATH`-overridable; skips once `base_cards` is populated). The retired CSV-era `apply_seed()` / `db/seeds/catalog_seed.sql` path (deleted, BL-33 step 1) no longer exists; `db/seeds/` is gone from the repo. **This catalog machinery is durable and out of BL-93's scope** — it is separate, swuapi-sourced infrastructure, not personal-inventory scaffolding.

**Inventory snapshot — retired 2026-07-25, replaced by §17 import/export (BL-93).** Earlier revisions of this section described a second startup step, `apply_inventory_snapshot()` (`app/ingestion/apply_inventory_snapshot.py`), which read a personal-inventory snapshot file (`db/snapshots/inventory_snapshot.sql`) if present — plus the CLI remap tool `regenerate_inventory.py` and the archived `db/snapshots/archive/inventory_snapshot_pre_redesign_2026-06-21.sql` it consumed. That machinery was always throwaway scaffolding scoped to "load Jeremy's own collection once" (v1.0 decision, BL-33 step 4). The owner proved the §17 import/export round-trip on his real collection (export → delete account → new account → import → all inventory present, 2026-07-25), superseding it; the lifespan call, both modules, the archived snapshot file, and the §8.5 cutover-safety test were all removed in the same PR. Git history preserves everything.

---

## 14. Environment

*Added 2026-06-24 (BL-49).* Local config is a gitignored `.env` copied from `.env.example` (defaults work out of the box). Key variables: `POSTGRES_DB/USER/PASSWORD/PORT`, `APP_DB_PASSWORD`, the derived `DATABASE_URL` (admin / migrations) and `APP_DATABASE_URL` (the RLS-enforced app role), and `ENVIRONMENT` (set to `production` on Cloud Run; disables `/docs`). Docker Compose exposes backend `8000`, frontend `5173`, PostgreSQL `5432`, and the Firebase Auth Emulator `9099` (local-only).

- Full variable table & local setup → `README.md`.
- Production secret injection (GCP Secret Manager → Cloud Run) → `SWU_Platform_Spec.md`.

---

## 15. Decks (v1 design — 2026-07-13; UI/UX deferred to Claude Design)

*Designed from the BL-110 research report (`analysis/BL110_Deck_Format_Research_2026-07-13.md`) plus a same-day empirical resolution pass against the live catalog. Scope decisions (Jeremy, 2026-07-13): full feature spec minus UI; clipboard-JSON interop (not provider status); read-only inventory overlay; bidirectional paste-JSON import. Structural calls recorded in [ADR-0014](../docs/decisions/0014-deck-card-level-references.md) and [ADR-0015](../docs/decisions/0015-deck-interop-de-facto-json.md).*

***Shipped precursor (2026-07-22):*** *Deck Check (§5.11, `/api/deck-check` in §12) is live in prod as a deliberately **ephemeral** slice of this design — it consumes §15.3's resolution rule and §15.5's interchange shape, and its parsed-deck shape matches what the `decks` table here will need, but nothing described in §15.2/§15.8 (persistence, CRUD) is built yet. This section remains the design of record for the future persisted deck builder.*

**Confidence labels used below:** `[verified-live]` raw bytes captured; `[verified-source]` read from a platform's open-source code; `[secondary]` credible description, no raw bytes; `[gated]` unverifiable without an account — awaiting Jeremy's capture.

### 15.1 Product frame & non-goals

A deck is a **gameplay list linked to the catalog**, and this app's differentiator is that it is *inventory-aware*: the deck view can show what you own toward the deck. Non-goals for v1: gameplay/simulation, meta statistics, deck sharing between tenants, public deck pages, tournament submission (Melee/official builder are programmatically closed today — BL-110 §2c/2d), and being a Karabast *provider* (public deck URLs + their registry; recorded as a deliberate later-option in ADR-0015).

### 15.2 Data model

- **`decks`** — `id`, `tenant_id` (FK, RLS + FORCE per the 0025/0026 pattern), `name` (req), `author` (nullable — populated from import metadata, not an FK), `format` (`premier` default | `twin_suns`), `created_at`/`updated_at`. Tenant-scoped private objects; **added to `purge_tenant` + its regression test on creation day** (the BL-24/35 lesson, spec'd here so it cannot be missed).
- **`deck_cards`** — `deck_id` (FK, cascade on deck delete), `base_card_id` (FK → `base_cards`; **card-level, never a variant reference** — ADR-0014), `slot` (`leader` | `secondleader` | `base` | `main` | `sideboard`), `count` (≥1; CHECK), PK `(deck_id, base_card_id, slot)`.
- `secondleader` exists in the model because Twin Suns is a real official format (min. 80 cards, two aspect-sharing leaders — `[verified-live]` starwarsunlimited.com/articles/twin-suns) and the de facto interchange carries it; whether v1 *UI* exposes Twin Suns is a Claude Design decision. The model costs nothing now; retrofitting a slot later costs a migration.

### 15.3 Card-reference semantics (the load-bearing design)

Deck rows reference the **card design** (`base_cards` row), never a printing — every external deck format inspected identifies cards as `"SET_NUM"` strings with no finish/variant field anywhere (`[verified-live]` ×2 + `[verified-source]` Karabast's `IDeckCard`).

**Inbound resolution rule (`SET_NUM` → `base_cards`), established empirically 2026-07-13 against the full live catalog:**
1. Parse `SET_CODE` + integer number (accept unpadded and zero-padded).
2. Match against **non-token base cards' root numbers** (`base_cards.base_card_number`). Evidence: zero collisions exist among non-token Standard roots (query over all 8,3xx variants — collision groups: 83 total, 45 non-token, **0 non-token-Standard-root**); every residual collision lives in variant number ranges (Prestige/foil high numbers) or judge/promo stamps, which deck lists never reference. Foil pairs share the root's printed number; distinct finishes (Hyperspace etc.) carry their own numbers — this resolves BL-110 §2e's flagged swuapi-docs "contradiction": both claims were true of different variant classes.
3. No match → try the exceptions-list roots (`swuapi_standard_variant_exceptions.md`, **1** entry — the 14 other structural roots re-anchor via step 2's fallback and never reach this file, §3.3/§10.6).
4. Still no match → the row is **reported unresolved, never guessed** (same discipline as Add Cards §5.4).

**Outbound id generation:** `set_code + "_" + zero-padded-3 base_card_number` (matches observed convention, e.g. `SOR_024` `[verified-live]`).

### 15.4 Validation & legality (advisory, computed — never a save constraint)

Same philosophy as keep-limits (§6): users must be able to save work-in-progress decks, so legality is a **computed status**, not a write gate. v1 rules: exactly 1 leader + 1 base (2 aspect-sharing leaders in `twin_suns`); main deck minimum 50 (`premier`) / 80 (`twin_suns`); per-card copy maximum 3 across main+sideboard; sideboard ≤ 10. *(Rule values to be confirmed against current official comprehensive rules during build — flagged, not `[verified-live]` in this pass.)* The deck view surfaces a legality badge + itemized violations.

### 15.5 Import (paste JSON — bidirectional with §15.6)

- Accepts the **de facto interchange shape**: `{metadata?, leader, base, secondleader?, deck[], sideboard[]}` of `{id: "SET_NUM", count}` (`[verified-live]` SWUBase + sw-unlimited-db.com; `[verified-source]` Karabast normalizes 14 providers to exactly this). Unknown keys ignored (observed in the wild: sw-unlimited-db's extra per-card `unit` tag).
- This one shape covers: decks copied from **SWUDB** (its clipboard export is this shape — `[secondary]`; exact affordance `[gated]`, on Jeremy's capture list), **SWUBase**, **sw-unlimited-db.com**, and anything else in the Karabast provider family.
- Resolution per §15.3 runs **client-side against the loaded catalog** (the established S3/S4/Add-Cards pattern — no new lookup endpoints); unresolved rows render in a verification view (resolved / unresolved split, same interaction grammar as Add Cards) before the deck is committed via the CRUD API. The server independently validates every `base_card_id` FK on write.
- URL-fetch import (SWUBase/sw-unlimited-db public APIs) is deliberately out of v1 (owning third-party fetch surface — ADR-0015); the paste path serves the same decks.

### 15.6 Export

1. **Deck JSON (primary):** the de facto shape, composed client-side, copy-to-clipboard. This is the Karabast and Force Table interop in its entirety — both are *consumers* whose paste flows accept this shape (`[verified-source]` / `[secondary]` respectively), and it round-trips into SWUDB-family tools.
2. **Plain text (fallback):** `COUNT NAME (SET) NUMBER` lines grouped by slot — the convention swuapi's own deck-image tooling consumes (`[verified-live]` swuapi.com/docs), and the human-readable/tournament-form answer.

Export requires no versioning of our own — the shape is the community's, not ours; our *canonical inventory* format (BL-109 §5) remains a separate, versioned concern.

### 15.7 Inventory overlay (read-only, v1)

Per deck card: `owned = Σ quantity across ALL variants of that base card` (any printing counts — a deck slot doesn't care which finish you own), rendered as owned/needed against `count`. Pure client-side join of the deck against the already-loaded quantities (§7 catalog/quantity split) — no new endpoints, no writes, anonymous-safe (overlay simply absent when signed out). Explicit non-goal in v1: copy-assignment ("this physical Showcase fills slot 3") — recorded as the natural v2 if wanted.

### 15.8 API surface

Standard tenant-scoped CRUD, nothing exotic: `GET /api/decks` (list, lean), `POST /api/decks`, `GET /api/decks/{id}`, `PUT /api/decks/{id}` (full replacement incl. cards — the settled full-replacement idiom), `DELETE /api/decks/{id}`. Auth via `Depends(get_db)`; mutations follow the BL-16 verified-email posture *decision pending in BL-108* (whichever way BL-108 lands, decks follow the same rule as settings). Import/export have **no endpoints** — they're client-side transforms (§15.5/15.6).

### 15.9 Test strategy hooks (§8 discipline applies)

Unit: SET_NUM parse/resolve incl. exceptions + collision-adjacent fixtures (a token-colliding number, a Prestige-range number, an unpadded id); legality computation per format; JSON round-trip (import → export byte-equivalent modulo key order). Integration: CRUD + RLS isolation (two-tenant), purge_tenant coverage (day-one), FK validation on write. The §15.3 zero-collision claim gets a **catalog invariant test** (fails if a future set introduces a non-token root-number collision — turning today's empirical fact into a monitored assumption).

### 15.10 Open items for review

1. `[gated]` SWUDB deck-import affordance — Jeremy's capture (does its builder accept pasted JSON, exact shape?).
2. Legality rule values vs. current official comprehensive rules (build-time verification task).
3. Twin Suns in v1 UI — Claude Design decision (model supports it either way).
4. Deck limit per tenant (none spec'd; revisit only if abuse surfaces — 999-ceiling philosophy).

---

## 16. Pricing (BL-136/BL-139/BL-146 — shipped prod 2026-07-22)

*Built from `planning/Definition_Pricing_2026-07-16.md` (the PRD of record for policy detail); backend merged 2026-07-16 (PR #335), UI 2026-07-21 (BL-140), full history + prod promote 2026-07-22 (BL-139 transfer — `analysis/BL139_Prod_Price_Transfer_Runbook_2026-07-22.md`). UX: §5.10. API: §12.*

### 16.1 Source & mapping

**tcgcsv.com is the price source of record** — TCGplayer's own API program is closed to new applicants (live-verified post-eBay-acquisition). tcgcsv publishes daily builds ~20:00 UTC (category 79 = SWU) plus **historical archives back to 2024-02-08**, free, no key; our usage is trivially within its published guidelines (10k req/day cap, UA requirement, throttle).

**`tcgplayer_products`** (migration 0028) maps `card_variants` → tcgcsv's `(productId, subTypeName)` price keys — one row per variant (unique FK), built by `app.ingestion.run_tcgplayer_mapping` via a **name+tier join** (never number-based: numbering isn't uniform across set eras; JTL mints 4 productIds per card; tcgcsv names are `"Name - Subtitle"` for subtitled cards). Match rate 94–100% per set; residuals in `analysis/tcgplayer_mapping_exceptions.md`. Two structural facts, learned operationally (BL-149): a tcgcsv product can map to **multiple variants** (shared keys — e.g. IBH's triplicate variants), and the mapping **drifts on a ~week timescale** (products delisted, productIds changed) — mapping runs never delete stale rows, and any cross-environment data transfer must build both mappings same-day (§16.6).

### 16.2 Data model

- **`variant_prices`** — one row per variant per day: PK `(variant_id, as_of)`, `market`/`low`/`mid`/`high` (each nullable — tcgcsv omits tiers some days), `currency` (`USD`). Serves history; the composite PK doubles as the idempotency key for sync and backfill (upsert / insert-or-skip). Global catalog data: no tenant_id, no RLS, same posture as `base_cards`.
- **`variant_latest_prices`** (migration 0029, BL-146) — the **hot-path snapshot**: one row per priced variant (`variant_id` PK, `market`, `low`, `as_of`), ~7.5k rows *forever* — it never grows with history. Every current-price read (list `display_price`, detail `price`, deck check) comes from here, **never** from a scan over `variant_prices`. Kept current by `app.repositories.pricing.upsert_latest_price` in the same transaction as every history write, guarded by `WHERE EXCLUDED.as_of >= variant_latest_prices.as_of` so out-of-order backfill days can never regress it.
- **`pricing_sync_state`** — key/value watermarks (`daily_sync`, `backfill`) making both jobs restartable.

### 16.3 Jobs

- **Daily sync** (`app.jobs.price_sync`) — Cloud Run Job, Cloud Scheduler `30 20 * * *` UTC (after tcgcsv's ~20:00 build), terraformed in both envs. Writes today's row per mapped variant + the snapshot upsert. **Since BL-174 its fetch scope is `ALL_PRICED_GROUP_IDS`** (the 11 root sets + 9 Weekly Play groups, Homeworlds included since v1.5 — the same single map the mapping builder uses, so sync scope can never drift from what's mapped). The sync only writes rows it can join through `tcgplayer_products`; a newly onboarded set collects nothing until the mapping builder is run for it in each environment, and the builder must be re-run as tcgcsv publishes more of the set's price rows (§23).
- **History backfill** (`app.jobs.price_backfill`) — one-time walk of tcgcsv's daily archives (2024-03-08 onward; 4Gi/2vCPU sizing, 6h timeout, watermark-resumable). Run to completion on **dev** (866 days, zero missing days). **Prod never ran it** — see §16.6. Deliberately NOT widened by BL-174 — history backfill for the newly mapped finishes is a recorded optional follow-on.

### 16.3b Mapping scope (BL-174, shipped prod 2026-07-27)

The BL-136 mapping originally targeted only the four booster finishes; every other finish was 0% priced — a scope cut that BL-173's variant-scope picker made prominent (evidence: `analysis/Pricing_Coverage_NonCore_Finishes_2026-07-27.md`). BL-174 widened it two ways: **(A)** the product-name suffix vocabulary now resolves `(Showcase)`/`(Prestige)`/`(Prestige Foil)`/`(Serialized)` → Showcase / Standard Prestige / Foil Prestige / Serialized Prestige (products already fetched in the root groups); **(B)** the 8 Weekly Play tcgcsv groups are fetched and mapped via a deliberately suffix-IGNORING resolver (`resolve_weekly_play_variant_type` — WP groups reuse suffixes as naming footnotes; subTypeName alone is truthful there). Promo/tournament tiers remain out of scope by design. **Post-run coverage (prod, 2026-07-27): 92.9% overall** — Standard/Foil Prestige 99%, Showcase 97%, Serialized 73%, WP 70/61%; the remaining 641 variants are itemized in `analysis/Pricing_Remaining_Unpriced_2026-07-27.md` with the decision framing in `analysis/Pricing_Executive_Overview_2026-07-27.md` (known residuals: ~63 early-era WP variants with divergent typing — recorded recon; SEC-WP/TS26 products tcgcsv hasn't listed yet).

**BL-183 (shipped 2026-08-01): early-era Weekly Play joins the scope.** The first three sets' WP printings carry the ROOT set code in `source_set_code` (SOR/SHD/TWI, 63 variants; swuapi only adopted dedicated "P" codes from JTL onward), so BL-174's WP pass — which sources catalog variants by the P-code — matched zero there despite fetching the right groups. The WP pass now also sources variants from the P-code's root companion (`set_code[:-1]`, era-agnostic); all 63 map and price on dev + prod. The history backfill job's archive-walk scope is likewise widened from the 10 root-set groups to `ALL_PRICED_GROUP_IDS` (18 groups) — a `--start`-forced re-walk adds history only for newly mapped variants (per-(variant, date) inserts are ON CONFLICT DO NOTHING). Caution recorded from the 2026-08-01 walk: near-current days share `variant_latest_prices` rows with the 20:30Z daily sync (deadlock observed) — do not walk near-current days across the sync window.

**Operating procedure:** the mapping run (`python -m app.ingestion.run_tcgplayer_mapping`, DATABASE_URL at the target env via cloud-sql-proxy) creates product links and regenerates `analysis/tcgplayer_mapping_exceptions.md`; the daily sync then prices whatever is mapped. **New TCGplayer listings only price after a mapping re-run — re-run it alongside every content-runbook execution**, then `python -m app.jobs.price_sync --force` if same-day prices are wanted immediately.

### 16.4 Display & aggregation policy (owner-decided)

- **Default mode `standard`:** a card's price is its Standard printing's market price. **`cheapest`:** min(`low`) across ALL priced variants, any printing — Jeremy's explicit definition: a buyer wants the least money out the door, and a foil can genuinely undercut Standard. (Deck check's `standard` mode adds a fallback: cheapest priced printing's market when the Standard printing itself is unpriced — §12.)
- Prices visible on the **anonymous public catalog**; "Prices via TCGplayer" + as-of date required on every priced surface; unpriced cards excluded from sums with a visible count, never blanked or zeroed; USD only (Cardmarket = future second source, not started).
- Coverage is structural, not a bug: ~97% of cards priced (2,247/2,306 prod at ship) — tokens and never-listed promos have no tcgcsv product.

### 16.5 The BL-146 lesson (load-bearing invariant)

**No request-time query may scale with history depth.** The original latest-price read (`SELECT DISTINCT ON (variant_id) … ORDER BY variant_id, as_of DESC`, unscoped) was fine at 87 days and took the entire dev API down at 2.83M rows (requests stacked → every endpoint 503'd, catalog rendered empty). The snapshot table (§16.2) eliminated the class: post-fix measurements are independent of table size (dev gate + prod at parity: list ~2s uncached — Pydantic payload cost, CDN-absorbed — detail 0.2–0.3s, history 0.35–0.39s for a full 2.4-year series, since history reads are index-scoped per variant). Any future feature reading "current price" must read `variant_latest_prices`; anything scanning `variant_prices` unscoped is the incident recurring. Measurement records: issue #368.

### 16.6 History provenance & the prod transfer (BL-139)

Prod's history was **not** re-extracted from tcgcsv (6–10h of degraded db-f1-micro service + ~860 re-pulled archives); it was **transferred from dev** (decided 2026-07-21, issue #351): `app/ingestion/transfer_variant_prices.py` exports dev's history keyed by the portable identity (`productId + subtype + as_of` — variant ids are serial and differ per env), bulk-loads a staging table over cloud-sql-proxy, re-keys against **prod's own** mapping, refreshes the snapshot, and verifies (row counts, per-day counts, md5-hashed spot series, snapshot self-consistency). Executed 2026-07-22: **prod = 3,417,600 rows (2024-03-08 → 2026-07-21, 866 days, zero gaps)** — a strict *superset* of dev's 3,402,194: shared-key products fanned out to all mapped variants (dev's backfill under-wrote those; dev-side reconciliation = BL-149), plus a 914-row `swuapi_id`-keyed top-up for mapping-drift stragglers. Runbook: `analysis/BL139_Prod_Price_Transfer_Runbook_2026-07-22.md`. Storage reality: full history ≈ 0.4 GB (+~1 MB/day) against Cloud SQL's 10 GB allocation floor — keeping all history costs ~$0 and (post-BL-146) no performance.

## 17. Inventory Import/Export (BL-54 — shipped to prod 2026-07-24)

**Build-authoritative detail lives in `planning/Definition_ImportExport_2026-07-22.md`** (policy sheet P1–P12 = the owner decisions; format spec; resolution algorithm; merge/cap math; report schema; UX spec; 13 named acceptance cases). This section is the as-built summary; don't re-derive from code.

### 17.1 Canonical format — `swu-inv/1`

- **JSON (canonical/lossless) + CSV (derived, spreadsheet-friendly)**, both from one internal representation (`app/services/inventory_io.py`). v1 shipped canonical-format-only; the deferred third-party-adapter arc landed 2026-08-03 as **§17.5** (SWUDB CSV + sw-unlimited-db XLSX — BL-185/BL-186).
- **Dual row identity:** `swuapi_uuid` (authoritative) + the human triple `set_code`/`card_number`/`variant_type`, plus `quantity`. Cosmetic `name`/`subtitle` on export, ignored on import. `_derived` (finish/channel/stamped) is export-only — re-derived by `classify_variant()` on import, never imported.
- Forward-compat: unknown columns ignored-and-reported; unknown `format_version` refused (422), never best-effort parsed. CSV accepted with the `# swu-inv-export v1` meta line OR a recognizable header (deviation from the research draft, recorded in the package §3.2 — enables hand-authored files built from the catalog reference).

### 17.2 Resolution & import semantics

- **Resolution order:** uuid wins (disagreeing triple → `uuid_triple_mismatch` warning) → triple fallback (`matched_by_fallback` when a uuid was present-but-unknown) → ambiguous triple (the SEC_1127 Serialized Prestige trio) returns candidates, never guesses → reason-coded unresolved. Duplicates fold (same scheme at parse; cross-scheme post-resolution) with quantities summed.
- **Merge modes (user-picked per import):** `merge_add` (default) / `replace` (file wins per row) / `replace_all` (wipe + load; removals itemized in the preview and confirmation-gated in the UI).
- **Cap handling (user-picked per import):** `add_above` (keep-limits don't clamp; existing over-limit indicators apply after) / `trim` (clamp to the effective keep-limit; **never reduces pre-existing stock in merge_add**; every clamp itemized with copies-not-added). The 999 ceiling applies unconditionally in both. Import deliberately bypasses hard/soft `cap_mode` — the per-import choice IS the enforcement decision.
- **Two-stage, stateless:** `dry_run` returns the full §7.3 report (every row, problem rows + trims + removals itemized); `commit` re-runs the identical computation and applies it in **one transaction** (mid-way failure = full rollback). Commit writes only resolved rows — partial commit is the design, nothing silently dropped. Upload limits: 10 MB / 20,000 rows (422).

### 17.3 Surface & gates

- **Entry:** Import / Export button right of Add Cards on the Vault tab (standard SWU button); opens an app-state pane (`AppView "import-export"`) with a transient header tab that exists only while active (no in-pane heading — the tab names the view, dev-review round 2). Screen: Export downloads (JSON/CSV) · the import stepper (file → mode/cap options → preview → confirm → success), problem-rows-first report with a client-generated reject CSV. The public **catalog reference CSV** (the resolution key space, for hand-authoring) lives inside the Import section's top-right callout behind a standard SWU button; the file-picker is an SWU button fronting a visually-hidden native input (dev-review round 2, 2026-07-23).
- **File order & reference quantity (dev-review round 2, 2026-07-23):** both downloadable files (export §7.1, reference §6) are ordered to read like the Vault — curated set groups (base sets newest first, HMW … SOR, then IBH and TS26 → Weekly Play mirroring that order, HMWP … SORP → Judge/Promo/Convention/Gift Box/Gamegenic/MV26 → unknown future sets last, alphabetically), card_number compared **numerically** within a set, variant_type tiebreak (`app/services/set_order.py`; supersedes the definition package's alphabetical `set_code, card_number, variant_type` order — new sets need the curated list extended, see the content runbook). The reference CSV carries a `quantity` column prefilled `0` in the export's column position — fill in quantities and import the file as-is (untouched 0-rows are no-ops under merge). *(Order superseded 2026-10-12, BL-258 — prior wording in the Archive.)*
- **Gate:** `require_verified_email` on export AND import (P9 — the whole surface; first gated read in the app). Anonymous click → sign-in nudge; unverified → verify-email nudge. Catalog reference stays public (ADR-0008 class). Gate-boundary doctrine (what's deliberately ungated and why) is recorded in the Platform Spec's BL-54 as-built note + `app/routers/settings.py`.

### 17.4 Status & tail

Code-complete on main 2026-07-23 (PRs #388 S1 / #390 S2 +fix round / #393 S3 / #394 polish); owner dev-verified the full export→fresh-account→import round-trip. Dev-review rounds 2–4 (2026-07-24, PRs #399/#400/#401): Vault-matching file order for export + reference (`app/services/set_order.py` — curated set groups, numeric card_number; extend the curated list per the content runbook on new sets), reference CSV gained a prefilled `quantity` column making it directly importable, IE screen layout polish (no in-pane heading, two-column import head with the reference callout, SWU-button file picker). **Shipped to prod 2026-07-24** — rode the same whole-build promote as BL-151/BL-152 (run 30102056055), so S1–S3 + all four dev-review rounds are live. The owner's real collection import round-trip (2026-07-25) proved the replacement, unblocking **BL-93** — the inventory-snapshot scaffolding (§13/§8.5 machinery) was retired the same day; see those sections.

**Format guidance notes (BL-173 review round 4, 2026-07-27):** the Import section's configure step opens with two stacked callouts — a blue-ruled note stating imports use the **HyperspaceVault format** (Export's files, or the catalog reference sheet with quantities filled in), and an amber-ruled **"Coming from another tracker?"** migration tip pointing at the catalog CSV + AI-assisted conversion (amber bold lead-in, muted body — owner-dialed through three styling iterations).

### 17.5 Foreign-format adapters (BL-185 SWUDB · BL-186 sw-unlimited-db — merged to dev 2026-08-03; prod 2026-08-07, v1.3)

Evidence + definition trail: `analysis/BL185_SWUDB_Import_Mapping_2026-08-02.md` and `analysis/BL186_SWUnlimitedDB_Import_Mapping_2026-08-02.md` (owner-captured matrix-driven test exports diffed against the `ImportExport_Test_Card_Matrix_2026-07-21.md` scenarios; definition decisions locked in each doc's closing section). As-built summary; don't re-derive.

- **Zero-selection UX:** the user uploads their file as-is on the existing Import surface — **format detection is server-side and automatic**, in strict order: XLSX by raw-bytes ZIP magic/`.xlsx` extension (checked BEFORE any text decode — binary must never reach the utf-8 sniffs), then the SWUDB header sniff (`Set,CardNumber,Count,IsFoil[,Stamp]`, order-agnostic; the 5th column is SWUDB's export-only enrichment — their own import format is the 4-column subset, both accepted), then the canonical `.json`/`{`/CSV rules unchanged (§17.1). The same preview-then-commit flow (§17.2–17.3) renders everything; file accept + labels read `.json, .csv, .xlsx`.
- **Placement (both adapters):** backend parse paths (`app/services/swudb_import.py` / `swunlimiteddb_import.py`) on the router's format-detection seam. Foreign rows are resolved against the live catalog **at parse time**; verdicts ride three additive `ParsedRow` fields (`preresolved_*`) that are inert for canonical parses — **`compute_import`'s merge/cap/report engine (§17.2) is unchanged**, and a resolved foreign row is indistinguishable from a canonical one downstream.
- **The refusal posture (locked):** all mapping tables are **deliberately partial** — an unmapped set code (`unmapped_set`) or quantity column (`unmapped_column`) becomes an itemized problem row, **never a guess** (a wrong set/column guess silently attributes the wrong printing — the one failure mode worse than refusing). The tables map only swuapi-sourced catalog content.
- **Admission rule (ADR-0028, 2026-10-08):** a set's *printed* codes — the base code and its Weekly Play `<CODE>P` — enter both tables **at onboarding** (runbook Scenario C) behind a 2–3-card `(code, number)` spot-check per tool against the catalog; a tool still carrying pre-release numbering is held until street date and re-checked. Every other code (SWUDB's synthetic/renamed containers, convention/judge/gift-box series) still waits for a real export from that tool. The problem-row copy names an unrecognised set code and asks the user to report it; it does not claim the set is missing from the catalog.
  > **Superseded (2026-10-08, BL-241 / ADR-0028):** the previous evidence-only admission sentence moved verbatim to `SWU_Application_Spec_Archive.md`.
- **SWUDB CSV specifics:** `CardNumber` is swuapi's own zero-padded collector suffix (int-cast strip → our unpadded `card_number`); resolution = set+number candidate lookup, then `IsFoil` foilishness split (Prestige-aware family check — "Serialized Prestige" is foil without saying so), then `Stamp` keyword match where a **blank Stamp itself means "the plain printing"** (the SORPR prerelease pair is separated solely by this). Set table renames: `CE25`→`C25`, `GGTS`→`GG`, synthetic `SORPR`→`SOR`. Irreducible collisions (the SEC Serialized Prestige color trio — which SWUDB cannot even hold two of at entry) land in §17.2's existing `ambiguous` bucket with candidates.
- **sw-unlimited-db XLSX specifics:** only the "Grouped" export exists in practice (their "Detailed" export has 500'd for over a year — the 21-column ceiling is the design target). The wide sheet (one row per base card × fixed quantity columns) is **melted** into candidates; resolution is **base-card-first** (base card by set+de-padded/de-`T`-prefixed number → variant by column family, home-set printing preferred) because promo printings live on the base card's row while carrying different own-numbers/source-sets. Column table: direct 1:1 for Normal/Foil/Hyperspace/HS-Foil/Showcase/Prestige tiers; `Organized Play` → the Weekly Play family (incl. early-era `<set>P` containers); `Event Exclusive` deliberately unmapped in v1 (single observed use is a card-level anomaly). **Positive-only semantics (owner-locked):** blank cells assert nothing — a foreign import can only add/set what it positively claims, never remove.
- **Reason codes:** `unmapped_set` (generalized from the briefly-lived `unmapped_swudb_set`), `unmapped_column`, `unknown_set_and_number`, `unknown_variant_for_column` join the §17.2 taxonomy; the report UI renders unlisted codes via its raw-string fallback (friendly copy = open polish item).

## 18. Precon Bulk Add (BL-151 — shipped to prod 2026-07-24) + BL-152 button glow

**Build-authoritative detail lives in `planning/Definition_BulkAddPrecons_2026-07-24.md`** (owner policy sheet P1–P5, data spec, UX spec, 10 acceptance cases). As-built summary; don't re-derive from code.

- **What (revised S2b/S2c, owner dev-review 2026-07-24):** the Add Cards modal opens with **two labeled drop-downs side by side** — the set selector (individual cards, the pre-existing manual flow, unchanged) and "Add a premade deck" (`AddCardsPreconBar.tsx`) — no segmented mode switch. Picking a value in either **locks the modal to that route** (route locking, `AddCardsModal.tsx`'s `route` derivation) and hides the other drop-down until fully cleared. The premade-deck drop-down lists **24 preconstructed decks** (SOR/SHD/TWI two-player starters ×2, JTL/LOF/SEC/LAW/ASH/HMW Spotlight ×2, IBH Intro Battle ×2, four TS26 Twin Suns); choosing one bulk-adds its full contents (leaders + base + main deck; tokens excluded). Precon confirmation renders through the **same shared Verify Cards component** (`AddCardsVerification.tsx`) the manual flow uses, not a separate precon-only view.
- **Boxed products (owner policy, reverted S2b):** SOR/SHD/TWI starters are sold and picked as **individual decks** — the original Deck A / Deck B / Whole Box choice for these three sets was reverted 2026-07-24 per owner dev-review. **IBH is always the whole box** (one picker entry, no per-deck choice — its 104-variant set partitions exactly into the two decks' 52 rows each). Spotlight/TS26 decks are individually-sold single entries.
- **Cap policy (owner P2):** `cap_mode = hard` users choose per import — "Don't add copies above my keep-limits" (default, → `trim`) vs "Add the full deck" (→ `add_above`); soft/no-limit users get no choice (`add_above`, over-limit indicators communicate after).
- **Architecture:** zero backend changes — a deck is a client-built `swu-inv/1` File driven through §17's import engine (`dry_run` → Verify-Cards-idiom confirmation with current→resulting and itemized trims → `commit`, one transaction). Deck data is static and checked in (`frontend/src/data/preconDecks.json`), every row resolved to `swuapi_id` at prep time; `backend/scripts/verify_precon_decks.py` re-proves catalog integrity on every refresh (runbook step). Data provenance: `analysis/Precon_Deck_Lists_Research_2026-07-15.md`, `analysis/IBH_Intro_Deck_Lists_Research_2026-07-24.md`, `analysis/TS26_Reprint_Resolution_2026-07-24.md` (incl. the TS26 reprint-numbering convention and the "C-3P0"/"Orellios" catalog-spelling gotchas). IBH quirk: collector numbers are per-copy print slots — 52 rows × qty 1 per deck, the 104-variant set partitioning exactly into the two decks.
- **BL-152 (same session):** app-wide SWU button hover animation, owner-designed in Claude Design (option C deep-navy rest `#1e3a8a` + warm edge flare on hover) — CSS-only in `index.css`, `@property`-registered transitions scoped to `.swu-btn`, `aria-disabled` teasers excluded. Owner-validated on dev 2026-07-24.
- **Status:** shipped to prod 2026-07-24 — built via parallel Sonnet agents (data prep + frontend) under orchestrator review, then revised through two owner dev-review rounds (S2b/S2c, above); PRs #406/#407/#408/#410/#411 + #404 (issue #402 closed).

## 19. Collection Lists & Sharing (BL-204 design — 2026-08-11; **§19.1 sharing SHIPPED in v1.4, 2026-08-16**)

Design converged with the owner across the 2026-08-10/11 feature-exploration and work-planning sessions (field log `Session_Notes_Feature_Exploration_2026-08-10.md`); supersedes BL-188's deferred surplus/needs concept. Execution: **BL-205 (sharing) shipped to prod in v1.4 (2026-08-16)** — §19.1 is now as-built (endpoint reference: §12 "Shares"); BL-206 (wanted — deferred from 1.4, pull-forward candidate) and BL-207/208/209 (binders core / lent+surplus / list-scope sharing) remain design-stage. This section stays build-authoritative for BL-206; §19.3 is directional and gets firmed to full resolution before BL-207 starts.

### 19.1 Sharing model (BL-205 — as-built, v1.4)

**Product decision (owner):** sharing a collection means handing someone a **secret link**; the viewer sees the owner's **live Vault at full fidelity** — the exact card list, quantities, prices, value, completion — inside the **viewer's own app chrome**. No viewer accounts, ever (1-user-per-tenant stays permanent). No share-time configuration: prices and collection value are always shown (owner ruling 2026-08-11: per-card prices are public catalog data; a total is just arithmetic — there is no value-hiding switch, and the earlier per-share display-toggles concept is **dead**). Trust-model decision record: [ADR-0019](../docs/decisions/0019-sharing-secret-link-trust-model.md).

- **Share record:** `shares(id, tenant_id, token, scope, name, created_at, revoked_at)`. `token` ≥128-bit URL-safe random, unguessable, the sole credential. `scope` enum `inventory | wanted | list` **from day one** (BL-205 implements only `inventory`; the enum exists so the token table — public-facing — never needs a schema migration). `name` is owner-chosen at creation (≤30 chars, plain text, sanitized): it is the **viewer's header label**, and the only owner identity a viewer ever sees. **Owner-ruled (2026-08-11):** at most **one active share per scope target** (one inventory share per tenant; later, one per binder) — rename and token-rotation cover every use case a second concurrent share would; revoke-and-recreate is the rotation gesture. Multiple named links to identical content add management surface without adding capability.
- **Owner-side management (authed API):** create (with name), rename, rotate token, revoke, list. UI lives in the Vault header area (share affordance) — final placement is a build-time HMR-round call, not a spec constraint.
- **Viewer-mode principle — owner's data, viewer's chrome:** the shared view renders the Vault content pipeline (catalog + owner quantities + owner keep-limit-derived display math) with **mutation affordances removed** (Add Cards, import/export, card-detail quantity editing) and **owner chrome never in the payload** — the owner's account menu/email, Settings, Updates state, and feedback context are the viewer's own (or the anonymous experience). Anonymous viewers get the existing signup nudges in situ; signed-in viewers keep full use of their own app and flip between their Vault and the share.
- **Header & session UX (owner-specified):** the share's name appears as a header item alongside `Vault` and `Deck Check` (e.g. `Bobs big vault`). It is **tab-session-scoped** (sessionStorage): it survives navigation, dies with the tab, and reappears whenever the link is opened. **Newest share replaces the previous** (no multi-share list), there is **no saved-shares list** (re-access = the link), **no view tracking** (owner ruling: the owner does not learn who viewed), and the viewer's own-Vault filter/scroll state is **independent** of the shared view's.
- **Read surface (the security list — complete):** the catalog family (`/api/base-cards`, `/api/sets`, card detail, prices, images) is **already anonymous** (BL-56 / ADR-0008) and unchanged. The new public surface is exactly three token-scoped endpoints: **resolve** (`token → {name, scope}`; validity is the HTTP status), **shared quantities** (the owner-tenant rows `/api/inventory/quantities` returns for the owner), and **shared limits** (the display-affecting subset of `/api/settings/limits` the Vault needs for playset/keep-limit rendering). Nothing else. Token-scoped reads resolve the share row, then run the existing repository paths **under the owner-tenant RLS context set explicitly after token validation** — same RLS rails, no bypass, FORCE RLS untouched.
- **Security posture:** invalid and revoked tokens are indistinguishable (404); per-IP rate limiting on the token-scoped endpoints (reusing the BL-53 sliding-window limiter, `check_tenant_rate_limit` — not BL-126's feedback-only `is_rate_limited`); short-lived private cache headers on shared reads (live data, no CDN persistence); revocation is immediate; no token appears in any log line. **This is the platform's first unauthenticated read of tenant data:** BL-205's definition of done includes the security review checkpoint (owner reads the token design before merge) and the CLAUDE.md enforcement-behavior **doc grep sweep** (every "requires auth"/"401"/"all /api" claim re-audited).
- **Deliberately out (recorded):** QR delivery (owner 2026-08-11 — revisits with mobile, BL-190); view analytics; share persistence for viewers; viewer accounts; snapshot shares (shares are live views, not point-in-time exports).

### 19.2 Wanted list (BL-206 — full resolution, deferred from v1.4)

- **Entity:** `wanted_items(tenant_id, base_card_id, variant_id NULLABLE, quantity_wanted)`. Two first-class want shapes (owner 2026-08-11): **any printing** (`variant_id NULL` — "I need one more for the playset") and **specific variant** (`variant_id` set — "the Prestige one"). Not a state on inventory: wants reference cards the user does not own.
- **UI:** owner CRUD from catalog/card-detail surfaces ("want this"), a wanted-list view using the shared list-rendering spine; exact affordances are build-time HMR-round territory.
- **Sharing:** `scope = wanted` on the §19.1 platform — additive, no platform rework (this is why deferral from v1.4 costs nothing technically).

### 19.3 Binders & allocations (BL-207/208/209 — directional; firm before BL-207)

- **One allocation model, type-driven skins (owner):** quantity allocations split a variant's copies across storage and named lists — `N copies: 2 storage, 1 in "Sabine deck", 1 lent`. List types `binder | deck | lent | surplus` are **presentation skins over one schema**, not separate features. **"Binders"** is the product name (owner 2026-08-11).
- **Deck = skin only in v1** (a named list; no leader/base/50-card rules awareness — future deck-check integration is explicitly out of v1 scope).
- **Lent = per-loan lists** (counterparty/date, optional free-form note, return flow); track-by-friend accumulation deliberately unsettled.
- **Surplus = single bucket per tenant** with a Settings **eligibility matrix** (rarity × standard/non-standard variant) governing auto-overflow marking — defaults (owner-confirmed): **Rare/Legendary ON, Common/Uncommon OFF, non-standard variants ON regardless of rarity**; manual add always allowed. Surplus copies are exempt from keep-limit warnings (surplus IS the sanctioned overflow home).
- **Math rules (owner-ruled, test-bearing):** lent and deck-pulled copies **still count** in collection totals and Deck Check (they're owned); collection totals/value gain an **include/exclude-surplus toggle rendered only when surplus is non-empty**. Touches the 3-scope pricing math — BL-208 carries its own disposition-logged test pass.
- **List-scope sharing (BL-209):** any binder (including surplus — the "trade binder at the table" payoff) shareable via `scope = list`; same viewer-mode principle, list-scoped instead of whole-vault.

### 19.4 Decisions record

Sharing-model decisions (2026-08-10/11) are recorded in [ADR-0019](../docs/decisions/0019-sharing-secret-link-trust-model.md); the original full ledger is preserved verbatim in `SWU_Application_Spec_Archive.md` (extracted 2026-08-17, BL-233). Design-stage rulings for the unshipped list features:

| Decision | Ruling | Owner date |
|---|---|---|
| Product name for lists | **Binders** | 2026-08-11 |
| Wanted granularity | Any-printing OR specific-variant, both first-class | 2026-08-11 |
| Surplus defaults | R/L auto-overflow ON, C/UC OFF, non-standard ON | 2026-08-11 |
| Deck lists | Skin only in v1 | 2026-08-10 |

## 20. Release-notes system (BL-184, v1.3) + promote gate & Releases mirror (BL-210, v1.4)

As-built summary; content lives in code, process detail in the Platform Spec.

- **Content module:** `frontend/src/content/releaseNotes.ts` — pure data, newest-first `RELEASE_NOTES: ReleaseNotesEntry[]`; `release` entries `{ key = version, version, date, title, sections[{heading?, emoji?, items[{title, body}]}] }` plus a reserved `announcement` variant (dated, unversioned — none exist yet). `key` is the identity `utils/releaseNotesSeen.ts` tracks unread state against.
- **Surface:** an `[HSV] Updates` nav tab appears while the newest entry is unseen (amber cue) and steps aside once read; the header's version label (rendered from `frontend/package.json` via `utils/version.ts`'s `formatVersionLabel` — `1.4.0` → `v1.4`) reopens the notes anytime. Rendering: `screens/notes/NewArrivalsPage.tsx`.
- **Promote gate (BL-210, first enforced pass = the v1.4 promote):** `promote-prod.yml` runs `.github/scripts/release_notes.mjs gate` — the promote fails unless the newest entry matches `package.json`'s version AND carries the promote-day America/Chicago date (`allow_stale_notes` dispatch input = the rollback/re-promote escape hatch, date check only). The ritual: entry lands by PR with the intended date; date finalized at promote.
- **Releases mirror (BL-210):** after a successful promote, the same script's `markdown` mode renders the entry and the workflow creates/updates the annotated tag + GitHub Release (`continue-on-error` — a mirror failure never fails a shipped promote; its first live run did fail silently on runner git-identity, fixed in PR #149 after the v1.4 tag/Release were created manually).

## 21. v1.4 Vault batch (shipped prod 2026-08-16 — "Your Vault, shareable")

As-built summaries; each item's build-authoritative detail lives in its PR + the 2026-08-15/16 field logs. All are feedback-sourced (📣 backlog convention) unless noted.

- **BL-213 — column sorting (PR #133):** every Vault table header sorts (value follows the live MARKET/LOW + UNIT/COLLECTION switches; name, rarity, cost, power, HP, playset progress, …). Sets never interleave — `#`/Set sorts keep sets grouped (binder order; the default and `Set` ascending are newest main set first, `Set` descending is oldest first with numbers still ascending); `#` restores the classic order. Gallery reuses the same comparators via §5's shared sort spine. *(Order superseded 2026-10-12, BL-258 — prior wording in the Archive.)*
- **BL-217 — over-keep-limit filter (PR #131):** a Vault filter surfacing every card held past the tenant's effective cap ("trade pile"); follows the playset finish scope like the other ownership filters.
- **BL-219 — stepper responsiveness (PR #132):** popup `+`/`−` decoupled from server round trips via the debounced-delta `adjust` endpoint (§12); Add Cards batch commits ride the same path.
- **BL-222/BL-225 — gallery header parity (PRs #137, rode #139):** the gallery gained the table's full sort header, playset finish filter, value switches, and scoped-amber treatment; card plates' pips follow the finish scope, completed plates light their outline, count chip dropped the "/3".
- **BL-223 — Totals switch (PR #139):** the completion panel's scope control is a FILTERED/ALL `ValueSwitch` beside the fourth block; narrowed-FILTERED carries the amber signal on the switch and all four blocks. (Post-merge polish: the switch top-aligns with the block labels — PR #147.)
- **BL-224 — set-dimension unification (PR #139):** the completion-panel popover set rows and the sidebar set facet are ONE selection (`filters.set` is the single source of truth); BL-179's parallel "home base set" third scope is retired outright.
- **BL-226 — table width tiers (PR #146):** Compact/Standard/Full column sets with live auto-selection (column-at-a-time ladder, Name as slack absorber); override lives inside the Table button as a hover flyout (plain click = Auto). Supersedes BL-214 (customizable views declined).
- **BL-227 — header polish (PR #142):** header version/fan-project links white at rest with the buttons' blue hover glow; nav-tab hover unified. (Related rider, PR #148: `.inv-summary__actions` wraps at narrow widths like the summary blocks.)
- **Catalog:** the P26 2026 tournament-promo wave (+134 variants across 82 base cards) ingested to all envs the same day per `SWU_SWUAPI_Content_Runbook.md` — zero new base cards, zero mapping exceptions.

## 22. Product Analytics (BL-235, 2026-08-26 — PostHog via first-party relay)

Decision + riders: ADR-0027. Tooling comparison + taxonomy definition record: internal repo (learning guide "Product Track addendum: BL-235"; `planning/Definition_Analytics_Taxonomy_2026-08-26.md`). This section is the **registry of record for the live event taxonomy** — a new/changed event lands here in the same PR as the code emitting it.

**Mechanism.** `posthog-js` initializes in `frontend/src/analytics/analytics.ts` — the single seam; components call its typed `capture()` and never import the SDK. Init is hostname-gated to `hyperspacevault.com`/`www.hyperspacevault.com` (dev/CI/preview emit nothing). Events flow same-origin through `/api/relay/*` (`backend/app/routers/relay.py`) to PostHog Cloud US (`static/*` → assets host, everything else → ingest host); the relay is unauthenticated (anonymous visitors are in-scope), forwards only content-type/user-agent/client-IP, and converts upstream failures to quiet 502s — analytics can never break the app. Riders: replay with **all inputs masked**; **anonymous** (`person_profiles: "identified_only"`, `identify()` never called); localStorage persistence (no cookies); autocapture on; `$pageview` off (`screen_viewed` is the SPA navigation signal); super property `app_version`; **opt-out toggle** in Settings (browser-local, immediate).

**Taxonomy rules.** `object_action` snake_case; variation in properties, never names; enums/counts only — no raw user-typed text, no PII (set codes OK, card names not needed); events are deprecated, never renamed.

**Event registry (v1):**

| Event | Properties |
|---|---|
| `screen_viewed` | `screen: vault \| deck_check \| import_export \| settings \| new_arrivals \| shared_view \| password \| delete \| sharing \| camera \| tool \| more \| feedback \| about` — desktop's first six are unchanged; the rest are phone screens (§25): `tool` once per keypad or camera open (§25.3), `camera` once per mount (§25.7), `more`, `about`, `feedback`, `settings`, `password`, `delete`, `sharing` once per open (`password`, `delete`, `sharing` are phone-only layers, §25.5; closing a layer onto the screen beneath it is not a new view, and a redirected signed-out visit sends nothing), `new_arrivals` = the phone's [HSV] Updates, `shared_view` = the shared vault shown (§25.6). `card` and `updates` are declared in the type but not emitted |
| `signup_completed` / `login_completed` | `provider: password \| google` |
| `feedback_submitted` | — |
| `view_mode_changed` | `mode: table \| gallery \| rows_none \| rows_sm \| rows_md \| rows_lg \| gallery_1 \| gallery_2 \| gallery_3` (desktop sends `table` / `gallery`; the phone sends the view + size pair, only on a genuine change, never from a deep-link param) |
| `filter_applied` | `field`, `active_filter_count`, `results_count` — `field` is desktop's name (set, rarity, finish, type, arena, keyword, trait, cost, power, hp, aspect, aspect_mode, completion, owned, no_inventory, over_cap); the phone fires once per user edit, after the change applies |
| `filters_cleared` | — (the phone fires it on the Filters sheet's Reset) |
| `finish_scope_changed` | `finish` (`all` when the scope is cleared; the phone fires only on a scope pick) |
| `search_performed` | `query_length`, `results_count` (never the query text) |
| `sort_changed` | `column`, `direction` |
| `card_popup_opened` | `source: table \| gallery \| deck_check \| new_arrivals \| row \| swipe \| nav`, `set_code` (phone card detail, §25.2: `row` / `gallery` = opened from the Vault list or gallery, `swipe` = reached by swiping to the neighbour, `nav` = a deep link or prev/next) |
| `price_history_opened` | — (the phone fires on the first range tap or chart touch per card) |
| `popup_card_navigated` | `method: prev_next \| rail_cycle \| swipe` (`swipe` is the phone's body swipe) |
| `quantity_changed` | `direction`, `surface: popup \| detail` (`detail` = the phone card detail stepper, §25.2) |
| `add_cards_committed` | `method: keypad \| precon \| camera \| camera_fast_add`, `cards_added`, `distinct_cards`; camera methods also carry `fast_add` (boolean). The phone sends it once per commit path that wrote, with desktop's counting (§25.3) |
| `add_cards_abandoned` | `pending_entries` (the phone: copies in the batch when Discard & Close is confirmed) |
| `import_dry_run` | `format`, `rows`, `error_rows` |
| `import_committed` | `mode`, `rows_applied` |
| `export_performed` | `format: json \| csv` (the phone's catalogue reference download sends no event) |
| `deck_check_run` | `missing_count` |
| `share_created` | — |
| `share_link_viewed` | — (the phone's shared vault, §25.6, also sends `layout: phone` on each successful resolve) |
| `scan_recognised` | `reader: paddle \| tesseract`, `key_strength: weak \| strong`, `time_bucket: <1s \| 1-2s \| 2-5s \| 5-10s \| >10s` (first text to prompt) |
| `scan_decision` | `decision: add \| details \| wrong_card \| pick` |
| `scan_pick_shown` | `reason: printed_code_collision \| small_series_N_of_2 \| several_cards \| number_conflict \| reading_conflict` |
| `scan_fallback_keypad` | `had_partial: boolean` |

**Super properties.** `app_version` (every event) and `layout: phone or desktop` (BL-244, every event; registered at init from the same `max-width: 767px` query as the phone gate and updated when the viewport crosses it). Phone events (§25) also carry `layout: "phone"` explicitly on the event, so the shape is visible at the call site. Phone events reuse the desktop names and property shapes; new enum values are additive, and an event or property is never renamed.

---

## 23. Homeworlds onboarding (BL-239, v1.5 — shipped prod 2026-10-02)

The ninth main-line set, onboarded by the content runbook's new-base-set path. Catalog after the refresh: **31 sets / 2,582 base cards / 10,193 variants**, zero standard-anchor exceptions.

- **Sets.** `HMW` Homeworlds is a canonical base set (`is_base_set = true`; set-grouping model: the first group of the main block (newest first), ahead of Intro Battle: Hoth, with `HMWP` Homeworlds Weekly Play nested under it). `CST` Costco Exclusive is a two-card container set in the "Other promos" Exclusives subgroup. *(Order superseded 2026-10-12, BL-258 — prior wording in the Archive.)*
- **Classification.** The `Costco Exclusive` variant type has no frozen finish and classifies to the **Retail** channel and limit bucket (owner decision 2026-10-02; pinned by `test_costco_exclusive_is_retail`).
- **Key art.** `set_HMW.png` and `starfield_HMW.jpg` ship in `frontend/public/images/`; HMW is in the card popup's art roster and the header starfield pool (ten starfields).
- **Precon bulk add (§18).** The two Homeworlds Spotlight Decks (Chewbacca, Grand Moff Tarkin) are in `preconDecks.json` — 24 decks in all. Reprint rows reference the original set's Standard printing.
- **Pricing (§16).** tcgcsv groups `HMW` 24812 and `HMWP` 24897 are in the fetch scope. The product mapping is partial until tcgcsv publishes the set's price rows — 360 of 944 HMW variants at release, Weekly Play none — and is extended by re-running the mapping builder.
- **Import adapters (§17).** The SWUDB preset (also the path HoloScan's SWUDB-format CSV takes) maps `HMW`, `HMWP`, the Weekly Play codes `ASHP`/`LAWP`/`LOFP`/`SECP`, `CST` and `G25` since 2026-10-08 (BL-240), verified against a real HoloScan export in which every such row resolved 1:1. The sw-unlimited-db preset maps `HMW` since 2026-10-12 (BL-245): its pre-release hold (the 2026-08-03 sample numbered Homeworlds differently from swuapi) ended when a reporter's post-release export matched the catalog's numbering on all 272 rows; `SORP`/`SHDP`/`TWIP` remain unmapped in both — never seen in an export from either tool.
- **Not ingested.** swuapi now carries `upgrade_power` / `upgrade_hp`, `slug` and `art_metadata` on card records; none has a column.


## 24. Card scanning (BL-238 spike — specified 2026-10-10; **built in BL-253, 2026-10-11** — as-built facts in §25.7)

**Status.** Built on the phone behind the centre button's camera mode (ADR-0029, amended 2026-10-11): the isolated `/scan/` document (§25.7) reads the card's strip on-device and feeds the keypad's resolved-card panel. Not build gates, collected on the real app in the owner's LAN rounds: the Stage 3 timed pile against the keypad, ≥ 110 attempts under the final rules, printed-code collision evidence from the community, a second phone. *2026-10-11: the spike-era heading ("NOT BUILT") and Status paragraph (including the "static mock" sentence) are superseded — verbatim in SWU_Application_Spec_Archive.md.*

### 24.1 What it is
Browser camera entry on the phone (no app, no install). The page reads the
card's **bottom strip** — `SET • EN [icon] number[/denominator]` — with an
on-device text reader and validates the triple against the catalogue. It
never recognises artwork, and no frame leaves the phone. The reading fills
the same set + number the keypad resolver takes; finish stays a choice
(non-foil default rule, BL-191).

### 24.2 Flow
- **Default: recognise, then decide.** On a successful read the scanner
  pauses and shows the card exactly as the keypad shows a resolved card
  (art, name/subtitle, set + number, printing, ownership line / IN VAULT ·
  AFTER ADD readout) with **Card details / Add / Wrong card**. Nothing is
  counted until Add. **Wrong card restarts the scan** (owner, 2026-10-10 —
  the error rate is assumed very low); the Keypad stays one tap away via
  the tool's mode toggle.
- **Fast add** (opt-in toggle in the tool header, remembered): a successful
  read adds immediately (one copy), then the scanner **holds ~1.5 s** with
  the card shown before reading again — the guard against double adds.
- **Ambiguous read** (a strip that maps to more than one printing — early
  foils, `N/2` tournament promos, printed-code collisions): amber two-way
  pick with the program names; never auto-resolved.
- **No read**: Keypad is one tap away, prefilled where partly read.
- **Cue:** a short beep plus a brief full-screen green flash. No haptics
  on iPhone (no Vibration API; the switch-control trick is not felt).
- **Guidance:** a live sharpness meter with one-word guidance ("Blurry —
  move back / closer", "Too small — move closer"). **No automatic zoom**;
  distance is the user's control. The optional explicit controls (zoom, focus
  distance, torch, lens) are **not built** in v1; the stream is requested at
  zoom 1.0 and left there. *(2026-10-11: "may exist but default untouched" superseded — archive.)*

### 24.3 Guide geometry (measured on official card images; fractions of card width W / height H)
| Feature | Portrait card (63 × 88 mm) | Landscape leader/base (88 × 63 mm) |
|---|---|---|
| `©LFL ©FFG` | 0.575–0.668 W | — |
| `SET • EN` | starts 0.742 W (3-letter) / 0.728 W (4-letter); ends 0.808–0.815 W | 0.780–0.830 W |
| Rarity / program icon | 0.825–0.854 W | 0.865–0.877 W |
| Number with denominator | 0.868–0.941 W | 0.910–0.958 W |
| Promo number (no denominator) | 0.916–0.930 W, right-aligned | — |
| **Identification group** | **0.728–0.941 W** (13.4 mm) | 0.178 W wide (16.5 mm used) |
| Right margin (group → card edge) | 0.059 W (3.7 mm) | 0.042 W (3.7 mm) |
| Text height | 0.0244 W (1.54 mm); rows 0.950–0.9675 H | — |
| Text centre above bottom edge | 0.041 H (3.6 mm); promos print higher (~4.2 mm) | 0.066 H (4.2 mm) |

The guide draws the card's **bottom-right corner outline** (corner radius
3 mm, assumed) with the group box centred horizontally in the preview,
lower-middle, drawn 15% larger than the group on every side and dimming
the surroundings ~35% for the user only. The OCR crop is the group plus
3.15 mm of padding on every side (as built; no start offset at `©FFG`).
*(2026-10-11: the "starting 0.6 mm right of `©FFG`" clause is superseded by the shipped code — archive.)* **Tuned offsets from the owner's live runs:** box and crop sit
2.2 mm left and 2.1 mm above the nominal position relative to the outline
(his promo card and his holding distance, ~1.15× the assumed 45 px text);
two ±4 mm sliders (step 0.1) sit behind the camera screen's "Align guide" button for on-phone calibration and persist on release (§25.7). The owner expects to keep
refining these values.

### 24.4 Readers and acceptance
- **PaddleOCR** (PP-OCR tiny det + rec on onnxruntime-web, wasm, four
  threads under cross-origin isolation; ~7.6 MB over the wire, cached) is
  the **primary** reader, fed the unprocessed colour crop scaled to ~40 px
  text. **Tesseract.js** (best_int) is the fallback — only when Paddle
  returns no code or number on a sharp frame — on the inverted, stretched
  crop at ~36 px, PSM 6 then PSM 7, at most one run per two frames. No
  cloud reader (ADR-0029).
- Frames below a sharpness threshold (Laplacian variance of the text band)
  are never read; a minimum glyph height blocks acceptance of too-small
  text.
- **Acceptance = 3 agreeing reads of the last 4**, with per-reader
  confidence bars (Tesseract ≥ 30, Paddle ≥ 60, judged as the median of
  each read's ratio to its own bar). Every valid key has a one-digit
  neighbour, so no key is "strong"; cards printed without a denominator
  are the most exposed (795 ↔ 785 observed).
- **Parser rules:** code resolved from the token before `EN` (exact,
  trailing bullet artefact, glued suffix, look-alike swap, one-edit unique
  match); number only from after the code and `EN`; a denominator one digit
  off a known set size is corrected and logged; a second valid number after
  the code makes the read ambiguous; a digits-only second pass that sees a
  longer run than the parsed number rejects the read.
- **Denominator semantics:** `N/<set size>` = main set; `N/20` in
  SOR/SHD/TWI = Weekly Play; `N/2` = tournament tiers (always a pick);
  absent = non-main printings; later-set promo codes (ASHP, P26 …) ignore
  the denominator.

### 24.5 Printed-code collisions
The physical Store Showdown Grogu "Yes. Yes. Yes." (catalogue P26 16)
prints `ASHP • EN 16`, colliding with Weekly Play ASHP 16. The printed-code
table maps `ASHP` → {ASHP, P26}; any read whose candidates span programs is
a pick. Whether LAWP/SECP/LOFP-era Store Showdown cards also print the
Weekly Play code is unknown — the mobile-release Reddit post will ask the
community to check. This is also a hazard for direct printed-code import
mapping (§17.5, ADR-0028).

### 24.6 Evidence (2026-10-09/10, iPhone 16 Pro, owner's mixed cards)
Six runs of the spike page: median first-text → recognition 10.3 s →
0.8 s, p90 52 s → 2.3 s; 0 wrong cards offered under the final rules
(48 prompts/picks); Safari grants a 4K stream, zoom 0.5–10, torch and
focus distance. Full table: `planning/BL238_Results_2026-10-09.md`
(private layer).

## 25. Mobile experience (BL-190 — as built)

The phone layout (BL-190, built as BL-247 … BL-253) is a second UI tree beside the desktop one. This section is its single as-built description: 25.0 is the overview (gate, routes, layers, code map, how it is tested, analytics, known limits); 25.1–25.7 describe each area once and cross-reference by subsection instead of repeating.

*2026-10-11: the slice-by-slice §25 text (and its interim wording) is superseded by this consolidation — verbatim in SWU_Application_Spec_Archive.md, under "Archived 2026-10-11 — §25 slice-by-slice text superseded by the closing consolidation".*

### 25.0 Overview

- **Gate.** `useIsPhone()` = `matchMedia("(max-width: 767px)")`, live. When it matches, `App.tsx` renders `frontend/src/mobile/MobileApp` inside the same providers (`if (isPhone) return <MobileApp />;`), otherwise the desktop tree. Tablets and any viewport >= 768 px — including a phone held in landscape at 768 px or wider — get desktop. Phone CSS is scoped under `.m-app`. The gate is the only desktop-side switch: no desktop screen is edited for the phone beyond additive props (`SWUButton`'s `className`, `ariaLabel` and `size: "touch"`) and additive analytics values (§22).
- **Routes.** Hash routes (`mobile/router.ts`; unknown or empty hash → `#/vault`; back = history back, else `#/vault`), under the pathname the document was loaded on:

  | Hash | Screen | Section |
  |---|---|---|
  | `#/vault` (params `set`, `finish`, `q`, `view`, `size`, `gsize`, `sheet=scope\|sort\|filters\|sets`, `collapsed=1`) | Vault | 25.1 |
  | `#/card/<id>[?v=<variantId>]` | Card detail (a layer over the Vault) | 25.2 |
  | `#/pad` | Keypad tool (a layer) | 25.3 |
  | `#/camera` | Camera mode of the tool; on `/` it hops to the isolated `/scan/` document | 25.7 |
  | `#/more`, `#/about`, `#/more/{about,updates,importexport,feedback}` | More and its sub-pages | 25.1, 25.4 |
  | `#/more/{settings,password,delete,sharing}` | Account screens and layers | 25.5 |
  | `/shared/{token}` (pathname) with `#/vault` … beneath it | The shared vault | 25.6 |

- **Layers.** One shell (`MobileApp`) draws the header slot, the active screen and the bottom bar. Above the screen, in order of appearance: the tool layer (covers the bar; the screen underneath stays mounted and inert), the card layer (hides the bar), the account layers (Change Password, Delete Account, Sharing: a centred card over the screen it was opened from, which stays mounted and inert), the sign-in layer (the desktop `AuthModal`), and sheets (`Sheet.tsx`, portalled to one sheet host above everything). A layer over a screen never unmounts it, so its filters, scope and scroll survive.
- **Two documents.** The main document (`index.html`) and `/scan/` (`scan.html`, a second Vite entry serving the same app bundle, with the camera: §25.7). Only `/scan/` is cross-origin isolated; the main document carries no COOP or COEP.
- **Code map.** `frontend/src/mobile/`: `vault/` (25.1), `card/` and `filters/` (25.2), `tool/` (25.3, plus the camera hop and batch mirror used by 25.7), `more/` (25.4), `account/` (25.5), `shared/` (25.6), `camera/` (25.7). Desktop modules the phone reuses unchanged: `computePanelMetrics`, `buildSetBreakdown`, `sortCards`, `applyFilters`, `resolveRow`, `runImport`, `LimitsContext`, `api/sharedView.ts`, `utils/shareSession.ts`, and the desktop `SettingsPage`, `ChangePasswordModal`, `DeleteAccountModal`, `ShareManageModal` and `VerifyEmailBanner`, and `SWUButton` (with the additive props above). Copies that exist because the desktop code is module-private (tracked in BL-254): the About & Legal body (`more/AboutScreen.tsx`), the Updates page helpers (`more/UpdatesScreen.tsx`) and the import-report helpers (`more/importFork.ts`).
- **Design rules** shared by every screen (the `swu-design-language` skill carries the full set): every control is >= 44 x 44 px (drawn smaller only with an invisible 44 px hit area), an X is always top-right, motion is transform and opacity only (layout properties never animate), inputs are 16 px, colour changes are instant, and there are no toasts (confirmations are inline).
- **Harness.**
  - Playwright, `frontend/e2e/mobile/` (specs named `s<slice>-<nn>-*`; shared helpers beside them; the API is answered by `mock-api.ts` from `fixtures/`, including the share double and the limits, export and import routes; sign-in runs on the Firebase Auth emulator). Every phone spec ends with a health check: each visible control >= 44 x 44, no horizontal overflow, no page error, console error or failed request.
  - Projects (`playwright.config.ts`): `setup` (signs the e2e user in once), `phone-390`, `phone-430`, `scan` (Chromium with a fake camera, driven by the BL-238 spike clips through the real reader; runs only the `s7-` specs, which the other projects ignore) and `desktop-1440` (the phone specs skip themselves there; `s6-11-desktop-smoke.spec.ts` runs: the desktop Vault renders, the Filters panel opens, the card popup opens, Add Cards opens, `/shared/{token}` renders the desktop shared page, and `/` carries no COOP or COEP).
  - Run from `frontend/`: `npm run e2e:mobile` (starts the Auth emulator when port 9099 is free; `E2E_PORT` picks the dev-server port; further arguments go to Playwright, e.g. `node e2e/run-mobile.mjs --project=scan` or `--grep "s6-"`). CI job `frontend-e2e-mobile` runs the whole suite and is required by `ci-ok`.
  - Vitest sits beside the code in `frontend/src/mobile/` (`npx vitest run src/mobile`); the documentation guards live in `src/mobile/docs.test.ts` (this section carries no unfinished-work wording; §22 lists every phone event and property). Three timing tests are known flakes (BL-255): the desktop `CardPopup` timer test (BL-219) and the transform-only motion specs `s2-08-transform-only` and `s2-12-grow-transform-only`; each passes when re-run alone.
- **Analytics.** The `layout` super-property is `phone` or `desktop` (kept current as the viewport crosses the gate), and every phone event also carries `layout: "phone"` explicitly. Phone events are the desktop events with the same property shapes plus additive enum values; the registry, value by value, is §22. Where they fire: `screen_viewed` once per screen; `view_mode_changed`, `search_performed`, `sort_changed`, `finish_scope_changed`, `filters_cleared` and `filter_applied` from the Vault and the Filters sheet; `card_popup_opened`, `popup_card_navigated`, `price_history_opened` and `quantity_changed` from card detail; `add_cards_committed` and `add_cards_abandoned` from the tool; `import_dry_run`, `import_committed` and `export_performed` from Import & Export; `feedback_submitted`; `share_created` (desktop's own call, tagged by the super-property; desktop sends no rotate or revoke event, so none is added); `share_link_viewed` from the shared vault; the `scan_*` events from the camera. Never raw user-typed text, OCR text, scan keys, card names or images.
- **Known limits.**
  - A landscape viewport >= 768 px (large phones in landscape) is served the desktop tree by the width-only gate; the desktop tree has no camera, so the camera is unreachable there. The camera guide is portrait only.
  - Google sign-in cannot run inside `/scan/` (it bounces to `/`, §25.7). The Auth emulator cannot sign in with Google, so Google-only account branches are covered by vitest only.
  - Verified in Chromium and jsdom, owed a real-phone pass: the iOS keyboard in search mode, Safari's camera permission prompt on each hop between documents, the deployed `/scan-workers/**` and `/vendor/scan/**` headers, session restore and Google sign-in on a real Firebase project, and cross-origin isolation with threads and SIMD on a phone.
  - The camera's stream-state sentences and the generic pick question are provisional copy (§25.7).


### 25.1 Shell + Vault (BL-247)

- **Shell.** Three-item bottom bar (Vault, centre SWUButton showing a keypad and a camera glyph, lit for the mode used last, More). Header: `[HSV] Hyperspace Vault` over `Unofficial Fan Project [v#.#.#]`, text Feedback button, account slot (Sign in / avatar menu: Settings, Change Password with a password provider only, About & Legal, Log Out). Title / badge tap opens the About & Legal / [HSV] Updates chooser; the unread release-notes cue glows on the title (badge when collapsed), never on More.
- **Collapse.** The header collapses as the list scrolls; back at the top it stays collapsed; a tap on the strip or a deliberate pull from the top expands. Motion is transform + opacity only; the starfield is clipped, never moved. Strip: badge, amber funnel while the totals are filtered, %, ten ticks, "n cards", value without cents.
- **Completion panel.** Desktop `computePanelMetrics` over the narrowed list (or every card under Totals = All). Totals Filtered / All shows only while narrowed and signed in; Filtered draws the amber ring. Market / Low = desktop's persisted price kind (shared with the rows). Signed out: em dashes, empty ticks, no breakdown. Tapping the body opens **Completion by set**: one row per base set, newest first (`buildSetBreakdown` over every narrowing except the Set facet); a row tap sets the Set facet to that set. *(Order superseded 2026-10-12, BL-258 — prior wording in the Archive.)*
- **Status rows.** Row one: search ("Search the vault"; name, subtitle, card number), Clear (only while narrowed, amber), Filters + active count. Row two: count ("n cards", amber when narrowed, no "of m"), finish-scope chip, icon-only Sort (desktop's sortable columns, `nextSortState`), List / Gallery toggle (List → 4 row sizes incl. no image; Gallery → 1 / 2 / 3 across; remembered per browser session).
- **Search mode.** Focus collapses both headers, the status row and the bottom bar (separators stay); blur restores; clearing the query does not.
- **Finish scope.** Picking a scope writes the Finish facet (so Clear appears); editing the Finish facet disengages it; "All finishes" clears; never persisted. The scope drives row pips, number, price and art, and the sort.
- **Card surfaces.** Rows and gallery plates use desktop's count chip + pips (`cards.css` literals); no "n/m" on any card surface; missing price = "—". Lists are virtualised. Empty state: "No cards match the current filters."
- **Leave Feedback** (`#/more/feedback`): desktop FeedbackModal copy and rules in a steel-ring screen; auto-closes 1.5 s after "Thanks for the feedback!".

### 25.2 Card detail + Filters (BL-248)

**Card detail** (`frontend/src/mobile/card/`, route `#/card/<id>[?v=<variantId>]`):
- Renders as a **layer over the Vault**, so the Vault's filters, scope and scroll position survive a round trip; the bottom bar is hidden under it. X top-right closes it.
- Fixed starfield header that never collapses; the art region collapses on scroll by transform + opacity only (layout probe: 0 layouts / 0 shifts at 390 and 430); scrolling back to the top never re-expands; a tap or a deliberate pull does. Leaders flip (two-phase rotateY); bases show a landscape art box.
- The top bar's "n of m" is amber when the list the card was opened from is narrowed; prev / next open the neighbour on its matching printing (scoped printing from a scoped row, displayed printing from a gallery cell).
- The plate (steel frame, count chip + 10 px pips) describes the **selected printing** (R5-5): chip = that printing's count; pips amber while short of the playset, green inside the amber plate at a playset; no scope marker. Changing the printing in the rail updates the plate, art and price at once.
- The rail is titled "Variants" (desktop label); only the selected printing carries a − / + stepper (desktop `adjustCard` with an optimistic patch); other rows show ×N. Signed out, the stepper is `aria-disabled` and routes to sign-in. Over the limit, the quantity is red/amber with desktop's "Over limit" tag; no "n/m" on card surfaces.
- Price history: desktop ranges 30D / 90D / 1Y / All, line chart; a drag or tap sets the reading (touch replacement for the desktop crosshair); the readout shows the point's real date; empty state = desktop wording.
- Swipe between cards: the body slides as one page under the fixed header (owner switch swipe=body); snap-back under threshold; the route changes after the motion.
- Owned-by-finish sheet (R5-1), opened from a Vault row's price/playset cluster (signed in) or from the detail plate: head = the card's count chip + pips; one row per printing, owned or not, each with its own neutral chip and pips (0 = empty grey; short = amber; playset = green inside the amber plate); "Open card" only when opened from the Vault.
- Aspects sheet: tapping an aspect icon lists the card's aspects with names (touch replacement for the desktop hover name).

**Filters sheet** (`frontend/src/mobile/filters/`):
- **Entry.** The Vault's Filters button opens the Filters sheet (`mobile/filters/FiltersSheet.tsx`). Compact rows, content-fit height (max 86 % of the screen). When content grows (Gameplay opens, chips wrap, a logo loads) the sheet keeps its previous top and slides up with a transform; a shrink snaps. X top-right.
- **Live, not a draft.** Every edit applies to the Vault at once (as on desktop). Filters, search, toggles and scope are plain screen state, never persisted: a fresh open of the app starts unfiltered.
- **Row order:** Set, Rarity, Collection, Finish, then Gameplay (collapsed by default). Set, Collection and Finish rows show the selected values as removable 44 px chips (drawn 30 px). With nothing selected they show desktop's hint text ("All sets" / "Any" / "All finishes"). A tap on the row opens that facet's picker over Filters; a tap on a chip removes that value. Rarity stays inline as five icon-only badges.
- **Badge.** The Filters button badge and the sheet's "n active" use desktop `countActiveFilters` plus the four Collection toggles. Each group counts once, search counts as its own group, and a mode-only Aspects change counts 1 (desktop quirk).
- **Footer.** Reset filters (amber outline; inert and grey at default) = desktop Reset: every facet, the search, the four toggles and the scope. "Show N cards" is live and closes the sheet.
- **Dead ends.** Every facet value is faceted against the other active filters (desktop `facetValidValues` over the toggle-narrowed, searched list). Pickers show their whole universe (`showAllValues` on): a 0-match value reads "(0)", is greyed and cannot be added. A selected value is never hidden and stays removable.
- **Set picker.** Base sets appear as logo chips in desktop order (`BASE_SET_ORDER`: HMW first … SOR, then IBH, TS26). The top bar holds "Show all sets" / "Base sets only" and Clear (no All, as desktop). The long tail (`allSetsGroups`) lists each base set's Weekly Play set in base order (HMWP first), then a divider, then the Exclusives. A selected long-tail set stays visible in base-only view. *(Order superseded 2026-10-12, BL-258 — prior wording in the Archive.)*
- **Collection picker.** Four switches in desktop's order (Only incomplete playsets / Only cards I own / Only cards I don't own / Over my keep limit), with desktop's exclusions applied as a toggle turns on. While scoped, the toggles are amber with a "Scoped: these read your <finish> copies only." note. Signed out, the Collection row reads "Sign in to filter" and a tap opens sign-in (MobileApp `openSignIn`).
- **Finish picker** = desktop FinishFilter's two-tier tree (`buildFinishTree` / `shapeFinishTree`): pair rows (Non-foil / Foil chips), the Prestige row (Std / Foil / Serialized), plain rows, and tournament families. A family header only expands it; a collapsed family with selections shows "· n". A divider follows the pinned block. The top bar holds All + Clear. The value the scope wrote shows amber on the Finish row. Any Finish edit other than exactly the scoped value disengages the scope; edits to other facets keep it.
- **Gameplay** (desktop's Gameplay group, Aspects first). The collapsed head shows "· n active" (one per group). Inside, in order:
  - Aspects: seven chits including No Aspect. Empty = all lit; the first tap narrows to that one aspect.
  - Any / Within / Exact (Exact is the default), with its one-line meaning.
  - Type and Arena chips.
  - Keyword and Trait rows. Each opens a full-height picker with a pinned 16 px search, focused on open, and an All / "All matches (n)" + Clear bar.
  - Cost / Power / HP: one track with two 44 px thumbs and a Russo One readout ("Any" at full range). A narrowed range excludes cards with no value for that stat.
- **Pickers.** A picker stacks over Filters with Done pinned in its foot. Set, Finish, Keyword and Trait pickers are full height; Collection sizes to its four rows. Escape closes only the top sheet. Show-all, expanded families and the search box reset on every open.
- **Motion.** Inside the sheet and pickers only transform and opacity animate. Colour changes are instant.

### 25.3 Keypad, choosers, verify batch, commit (BL-249)

Code: `frontend/src/mobile/tool/`. Route `#/pad` (the bar's centre button).
- **Tool layer.** Opens over the current screen. The screen underneath stays mounted with its state; the bar is covered and inert. The header has the title and an X top-right (44 px). The header carries the keypad | camera mode toggle (camera mode: §25.7). The keypad ignores the Vault's finish scope.
- **Keypad.** Entry row: set button · number display (Russo One, max 4 digits, no system keyboard) · Verify button. Keys: Russo One 0–9, Clear and backspace, 58 px at rest. Hardware digits, Backspace and Enter work too. Resolution uses desktop `resolveRow` over the catalogue; a shared number shows desktop's axes (Which card? / Set / Stamp / Finish) as chips. A miss reads "Not in this set" plus desktop's sentence.
- **Readout.** "In vault n/m" and "After add n/m" for the resolved printing, against its effective keep-limit (`LimitsContext`, hard or soft). At or over the limit the line is red `#ef4444`. "After add" counts owned + copies in the batch + 1. This readout is the only phone surface with an "n/m" fraction.
- **Result layout.** While a card shows, the deck shrinks (44 px keys, 48 px entry row; one class flip, no animation). Card details / Add to batch stays pinned at the bottom of the result zone. A shared number compacts the panel. A finish-only share keeps desktop's non-foil default (BL-191) with the amber cue and a Change link. The deck restores on Clear and after Add.
- **Set / precon selector.** The "Choose a set" sheet has two collapsed choosers, Set and Precon deck. Set = desktop `setGrouping` (Base sets only / Show all sets, with the toggle in the sheet foot). Precon = desktop's 23 entries (22 decks + the Hoth box). The set button shows the base logo + code (a subset reads as its base set) or the code alone for an exclusive. "Change set" reopens the choosers.
- **Precon panel.** Shows the deck name, "N cards · M distinct", Change set and Add deck to batch. Hard-cap users also get desktop's two radios ("Don't add copies above my keep-limits" (default) / "Add the full deck, even above my keep-limits"). The number field reads "Deck" and the keys rest (`aria-disabled`, dimmed). Add deck writes every deck copy to the batch, flagged `force` when the second radio is chosen.
- **Card details** from the keypad opens the card layer (§25.2) on the resolved printing. The tool and its batch stay underneath, with no guard.
- **Batch** (`batch.ts`). One row per copy: the same number three times makes three rows, and a 52-card deck makes 52 rows. It lives in a session-only module store, so it survives closing the tool and opening a card. Admission is computed when the batch is shown, per printing, with desktop's arithmetic (`inventoryStatus`, the same as `splitForVerification`): under a hard cap, copies past the effective limit are "not added" with "Inventory limit already reached."; soft cap and forced copies stay added with desktop's over-limit note; the 999 ceiling blocks in both modes. A deck copy the catalogue does not hold is listed as unresolved.
- **Verify button.** Sits in the entry row and reads "Verify" with a count badge; the amber ring is on the badge only. It is dimmed and `aria-disabled` while the batch is empty. Adding flashes "In batch".
- **Verify cards sheet.** Desktop AddCardsVerification's sections in order: "Unresolved rows — this shouldn't happen with precon data" (only when present), "The following cards will be added to inventory", and "The following cards will not be added" (only when any). Each section shows its count. Columns are desktop's (Card#, Name, Set, Finish, Inventory "owned → after", plus Reason in the not-added section), stacked to fit 390 px and grouped by set ("SOR — Spark of Rebellion"). Each added row has a 44 px "−" quick remove that drops one copy. There are no Keep/Skip toggles and no steppers.
- **Footer.** "N of M cards will be added.", "Discard batch" (red text) and "Add N cards to vault" (SWUButton, inert at 0).
- **Long batches.** When the list overflows and both the added and not-added sections exist, the two headers pin: added at the top, not-added at the bottom with its count. They act as a two-way accordion: the expanded section fills the 86 % sheet and scrolls. The sheet opens with the added section expanded. The only motion is the entering list's opacity + transform. If everything fits, or there is a single section, or the unresolved section is present, the sheet is a plain scroll.
- **Close guard.** The tool's X with a non-empty batch, and "Discard batch", open desktop's confirm: "Discard this batch?", desktop body copy, steel ring, X top-right. **Discard & Close** has the destructive fill `#c0202e` set on the button itself (resting and hovered); Return to Batch is navy. Discard empties the batch and closes the tool (from the X) or the sheet (from Discard batch). Escape, the scrim and the X return to the batch.
- **Commit.** Keypad copies make one `adjustCard(variantId, delta)` per printing with the folded delta. Precon copies rebuild desktop's `swu-inv/1` import file from the admitted copies (merged by swuapi_uuid) and send `runImport(file, "merge_add", capHandling, "commit")`. capHandling is "trim" for hard cap without force and "add_above" otherwise. Keypad copies go first. Desktop's busy overlay ("Applying N cards…" → "Refreshing your Vault…") runs while quantities refresh; then the sheet shows "N cards added." and closes after 1.3 s, and the batch empties.
- **Commit errors.** Errors show inline in the sheet footer: desktop's email-verification copy, the import error message, or "Something went wrong adding those cards. Try again." Copies already written leave the batch; the rest stay.

### 25.4 More, About & Legal, [HSV] Updates, Import & Export (BL-250)


Code: `frontend/src/mobile/more/`. Routes `#/more`, `#/about`, `#/more/about`, `#/more/updates`, `#/more/importexport`; Settings, Change Password, Delete Account and Sharing are §25.5.
- **More** (`#/more`, bar stays, More active). The brand block is one About button; the account slot sits beside it. Groups: Collection (Import & Export, Sharing, and the sentence "Deck Check is on the desktop site." with no entry or route), Account (signed in only: Settings, Change Password with a password provider only), Hyperspace Vault (About & Legal, [HSV] Updates, Leave Feedback), then Log Out, or Sign in when signed out. Rows are 52 px with `#1e2748` hairlines, chevrons on the navigating rows only (Log Out and Sign in have none). No Prototype group.
- **Gating** is desktop's. Import & Export and Sharing stay listed as `aria-disabled` teasers for a signed-out visitor and open sign-in. Import & Export is also inert for a signed-in unverified account and a tap shows "Verify your email to import or export your collection." Desktop's tail "— see the banner above." is dropped: the verify banner lives under the Vault header (§25.5), not on More.
- **About & Legal** (`#/about`, `#/more/about`). Steel-ring full shell (18 / 17 px cuts), title "About This Project", Disclaimer / Privacy (5 bullets) / Attribution verbatim from `AboutModal` at 14 px, desktop's Close button at 44 px. The body JSX is a fork of `AboutModal` (BL-254 folds it back); its CSS is imported unchanged.
- **[HSV] Updates** (`#/more/updates`). `NewArrivalsPage` at phone width: a one-row sideways-scrolling quicklink rail (44 px chips, About & Legal last), then every `RELEASE_NOTES` entry newest first, each with the set starfield band (amber version and date), the circuit seam and its sections verbatim. Desktop's wrapping rail is three sticky rows at 390 px, so the phone rail scrolls instead. The page helpers are module-private on desktop and are forked (BL-254).
- **Unread cue** (`useReleaseCue`: pure `cueStep` + `moreRowPulses`). Mounting the real Updates screen is the only thing that clears the cue (`saveLastSeenKey(latestEntryKey(...))`); the route alone and the chooser's Updates button do not. The title / badge glow is the primary cue; the More tab never glows. If More is reached before the title, the Updates row in More pulses (`d2-cue-glow`, 2 s, opacity-only layer; reduced motion = steady 0.85); a title tap first suppresses the More-row pulse for the session.
- **Back rule.** A More sub-page entered from More shows a left back chevron and returns to `#/more`; entered from the title chooser, the account menu, a rail chip or a deep link it shows the X top-right, which goes back through history, else to the Vault (from a rail chip it returns to Updates). The chevron decision is kept per screen until More or the Vault is next reached, so a history return keeps it. Escape does the same, except while the keypad, a card, a sheet or the sign-in layer is above the screen (the layer takes it) and while Import & Export is previewing or committing (Escape, the X and the chevron do nothing).
- **Leave Feedback** (`#/more/feedback`). Reached from More it shows the left back chevron returning to `#/more`; reached from the Vault header it keeps the X top-right.
- **Import & Export** (`#/more/importexport`, `ImportExportScreen`). Steel-ring full shell, one column. Gate = desktop's view forcing: signed out → back to More with the sign-in prompt; signed in but unverified → back to More with no prompt; verified → the screen. Desktop's configure → preview → success stepper with desktop's copy verbatim.
- **Export.** Download JSON, Download CSV and Download catalog (CSV) call `exportInventory` / `downloadCatalogReference` (`GET /api/inventory/export?format=json|csv`, `GET /api/catalog/reference.csv`) and save the response with `downloadBlob`; each button reads "Preparing…" while it runs. The Export section shows on the configure step only.
- **Configure.** The notes (blue [HSV] format, amber "Coming from another tracker?"), the file field, Merge mode and Keep-limits radios, Preview import. The real `<input type=file>` (16 px) lies invisibly over a 44 px button. Radios are whole-row 48 px `role=radio` buttons with a drawn dot; neither group has a default; "Replace All (destructive)" is in `--color-danger` and outlines red when picked. Preview import is `aria-disabled` until a file and both picks exist.
- **Preview + commit.** `runImport(file, mode, capHandling, "dry_run")` under the busy overlay "Checking your file…". The report is a phone list with desktop's information: totals, ignored columns, the always-visible "Will be removed" section, Problem | Resolved tabs, error + recommendation + possible printings, resolved "n → m" with trim / fallback / mismatch notes, and Download problem rows (CSV). Lists render 100 rows at a time with a 44 px "Show more". Replace All shows "I understand this will permanently remove N cards not in this file." on this preview step (desktop parity); Confirm import stays `aria-disabled` until it is ticked. Confirm runs `runImport(…, "commit")` with the same file under "Applying N cards…" → "Refreshing your Vault…" (`refreshQuantities`), then "Import complete — N rows written." with Import another file and Back to Vault. Errors show inline as on desktop.
- **Report forks.** Reason copy, `cardLabel`, `candidateLabel`, `problemRowsCsv`, the mode / cap option lists and `fileFormat` are module-private on desktop and copied unchanged into `importFork.ts` (BL-254).

### 25.5 Account: Settings, Change Password, Delete Account, Sharing, verify banner (BL-251)

Code: `frontend/src/mobile/account/`. Routes `#/more/settings`, `#/more/password`, `#/more/delete`, `#/more/sharing`. No desktop component is edited or forked; no auth, RLS or visibility behaviour changes (the screens call the same APIs behind the same gates).
- **Settings** (`#/more/settings`, `SettingsScreen`). Desktop `SettingsPage` renders unchanged inside a plain rounded card (1 px border, 4 px radius, 3 px blue top bar, no cut corners) under the shell head: back chevron from More, X top-right from the account menu (§25.4 back rule). Desktop's page heading is hidden because the head already says "Settings". Sections as desktop: keep-limit steppers (floors 1 for Leaders & Bases, 3 for all other cards) drawn at 44 px and stacked, Hard cap / Soft cap / No limits (No limits makes the steppers inert), Save / Discard locked until the form is dirty, the Usage Analytics checkbox, and the Danger Zone. Loading and error states are desktop's own.
- **"Saved."** Desktop's page shows no saved confirmation, so the card wrapper owns it: a Save tap followed by a new limits matrix from `LimitsContext` (the PUT response) shows a status line under the Save row; any other tap in the card clears it. A failed save leaves the context untouched and shows nothing.
- **Change Password** (`#/more/password`). Desktop `ChangePasswordModal`, unchanged, in a centred layer (`AccountLayer`, the sign-in layer's wrapper: card `min(100% - 32px, 420px)`, 16 px inputs, X top-right at 44 px, every control >= 44 px) over the screen it was opened from, which stays mounted and `inert`. Three fields, "New passwords do not match.", silent reauthentication, no reauth note. Closing goes back through history, else to `#/more`.
- **Delete Account** (`#/more/delete`). Desktop `DeleteAccountModal`, unchanged, in the same layer over Settings (which stays mounted). Reached only from Settings' Danger Zone button, plus the deep link; More and the account menu have no entry. Two steps as desktop: warning + current password (a Google-only account sees the Google reauthentication copy instead), then "Are You Sure?" with the DELETE gate and the red confirm. After a successful delete Firebase signs out and the shell returns to the Vault. Closing returns to Settings.
- **Sharing** (`#/more/sharing`). Desktop `ShareManageModal`, unchanged, in the same layer over More (or the Vault, from wherever it was opened). Empty state = the create form (name, <= 30 characters); the active share shows its name with Rename, the secret link with Copy (`navigator.clipboard.writeText` inside the tap handler; if it fails the desktop message appears and the link field selects its text on focus), Rotate Link and Revoke, the last two behind desktop's red confirm gates; at most one active share (§19.1). Loading and error copy are desktop's. Share management needs only a signed-in account (no verified email), as on desktop.
- **Guards** (route-level, additive): signed out at `#/more/settings`, `#/more/delete` or `#/more/password` goes to the Vault; signed out at `#/more/sharing` goes to More with the sign-in layer raised; a Google-only account at `#/more/password` goes to More. A signed-out visitor never sees an account layer mount.
- **Google-only accounts** (`hasPasswordProvider` false): no Change Password row in More or the account menu; Settings, Sharing and Delete Account stay. The emulator cannot sign in with Google, so this branch is covered by vitest only.
- **Verify-email banner.** Desktop `VerifyEmailBanner`, unchanged, is the first child of the Vault's list area (`.m-vault__below`), under the header and above the status rows, full width in `#2a2110` with the `#b45309` rule. It shows for a signed-in, unverified account; it has no close button, "Resend email" has desktop's 30 s cooldown and spam-folder hint, and "I've verified" rechecks. It is content, so it does not collapse with the header; search mode hides it while the search box has focus. Buttons are 44 px. More keeps its shortened unverified sentence (§25.4); the banner lives only on the Vault.

### 25.6 Shared vault (BL-252)

Code: `frontend/src/mobile/shared/` (`useShare.ts`, `SharedStatus.tsx`, `vaultSwitch.ts`, `shared.css`). A share link `/shared/{token}` renders the phone tree at phone width; the token resolves through desktop's `api/sharedView.ts` (`GET /api/shared/{token}`, plus `/limits` and `/quantities`), anonymous viewers are allowed, and no auth, RLS or visibility behaviour changes (§19.1 is the contract; the phone reads exactly what the desktop shared page reads).
- **Route and session.** The hash router works beneath the pathname (`/shared/{token}#/card/<id>`). On a successful resolve the session is saved for the tab (`saveShareSession({token, name})`, as desktop's `shareSession.ts`) and the name reaches the header; a restored session re-resolves on every app mount and emits `share_link_viewed` again (desktop's shared page is mounted whenever a token exists). Reload lands back on the share. The catalogue and sets are fetched per data instance, as desktop's two panes do.
- **Three states.** Loading, rate-limited and invalid-or-revoked links show desktop's three sentences verbatim (`SharedStatus.tsx`, copied from `SharedVaultPage.tsx`) in the normal frame: More's brand header (one About button, the account slot), the circuit seam, then the sentence (`role=status` while loading, `role=alert` otherwise). The bottom bar stays under the status screen (desktop keeps its header tabs); with no name known the Vault tab is plain and takes the viewer to their own vault, and there is no keypad. No token-scoped read starts before the resolve succeeds.
- **Header.** "<Name>'s collection" takes the completion header's title slot (`CompletionHeader` `label`, uppercased by CSS); the wordmark and version line are unchanged and the wordmark never truncates (the shared header sets the wordmark's letter-spacing to 0.06em so the 13 px Sign in link beside Feedback never pushes it past its box). The account slot shows a **Sign in** text link (13 px, 700, 0.04em, 44 px box) for anonymous viewers and the bubble for signed-in ones. Opening Settings or Change Password from the bubble first leaves the share (own vault shown), as the desktop avatar menu switches the pane away from the shared view; About & Legal and Log Out are unchanged. The Totals toggle, Filters and Collection toggles behave as in the own Vault (the share's data instance reports `hasData`, so the Collection toggles are live without sign-in).
- **The Vault button is the switch** (R5-7). While the tab holds a named share the bar is Vault + More (no keypad: `#/pad` and `#/camera` redirect to `#/vault`; the tool layer never mounts in a share). With the shared vault shown, the Vault button is an **amber** pill with the share's name in the icon's place (ellipsis when too wide, no "VAULT" label, amber underline while on). Amber marks the narrowed-to-someone-else's state only: with the own vault shown the button looks like a normal tab but still expands, because that is the only way back to the share. A tap expands the button horizontally within the bar (`.m-vswitch__panel`: scaleX 0.6 → 1 plus opacity, 0.15 s, origin left; none under reduced motion) into two choices — the own Vault icon and label, and an amber icon with the full name — each >= 44 x 44 and `aria-pressed` for the current one. A pick collapses the panel, shows that vault and writes `#/vault`; a tap outside or Escape collapses it. Focus goes to the pressed choice on expand and back to the face on collapse. The expanded panel is left-anchored and, with a long name, covers the More tab until it collapses (an overlay, not a re-flow). The state machine is the pure `switchStep` / `switchFace` in `vaultSwitch.ts`. Anonymous viewers get the same switch (their own Vault is the teaser).
- **Two panes.** On the Vault route both panes are mounted — own (`data-pane="own"`) and shared (`data-pane="shared"`, mounted on first show, then kept); the hidden one is parked (absolute, hidden, inert, `aria-hidden`; not `display: none`, so its scroll position survives). Each keeps its own filters, scope, facets, search and scroll, and each has its own data instance (`useVaultDataSource(isAuthenticated, shareToken)`; the share's reads the token-scoped quantities and limits, `readOnly: true`). `ShareScope` mounts the share's data only once the resolve is `ready`. Switching vaults clears a hash that carries params (a closed Filters sheet leaves `?sheet=filters` behind, which would otherwise open the sheet in the incoming pane).
- **Read-only surfaces.** Card detail from a shared row shows ×N in the rail row (desktop's `cp-rail__item-qty`, green when owned) instead of the stepper; the plate, the Owned-by-finish sheet (opened from a row cluster or the plate) and Filters read the share's quantities; the sheet's "Open card" stays inside the share (`/shared/{token}#/card/<id>`, closing returns to the share).
- **More in a share.** Import & Export, Sharing, Settings and Change Password are absent (and their deep links, `#/more/{settings,delete,password,sharing,importexport}`, land on `#/more` without mounting a layer, so Delete Account is unreachable); the Account group and the "Collection" group label are absent, leaving the Deck Check sentence; About, Updates and Leave Feedback stay; Log Out shows for signed-in viewers, Sign in for anonymous ones.
- **Analytics.** `share_link_viewed {layout: "phone"}` on a successful resolve; `screen_viewed {screen: shared_view}` while the share's pane is the shown Vault (§22).

### 25.7 Camera (BL-253)

Code: `frontend/src/mobile/camera/` (scanner) and `frontend/src/mobile/tool/{cameraHop,cue,batchPersist,scanSettings}.ts` (the parts the main document also loads).
- **Document.** `/scan/` is a second Vite entry (`frontend/scan.html` -> `src/scan.tsx`) serving the **full app bundle**, so Vault, card detail, Verify and More all work inside it; the camera screen is the tool layer's camera mode. The main document never imports `mobile/camera/` (bundle check: `main-*.js` 0.25 kB and `App-*.js` contain none of the scanner, which lives in `scan-*.js` and `scan-workers/`). Dev and `vite preview` rewrite `/scan` and `/scan/` to `scan.html`; Firebase Hosting does the same with two rewrites, `/scan` and `/scan/**` -> `scan.html` (no redirect between the two forms: Hosting matches a redirect glob against the trailing-slash-normalised path, so a `/scan` -> `/scan/` 301 also fires on `/scan/` and loops; found on dev 2026-10-11).
- **Headers.** Only `/scan/**` and `/scan.html` carry COOP `same-origin`, COEP `require-corp`, `Permissions-Policy: camera=(self), microphone=(), geolocation=()` and `Cache-Control: no-cache`; `/vendor/scan/**` is `public, max-age=31536000, immutable` + CORP `same-origin` + COEP; `/scan-workers/**` carries CORP + COEP. COEP is needed on the worker script and the vendored files (without it the Paddle init never answers). The main document gets no COOP/COEP and its Permissions-Policy is untouched, so the Google sign-in popup keeps `window.opener`. One pure `headersFor(path)` feeds the dev middleware and is asserted equal to `firebase.json`.
- **Isolation.** `/scan/` is `crossOriginIsolated`; `window.__scan.isolation` reports `crossOriginIsolated`, `SharedArrayBuffer`, `hardwareConcurrency`, ort threads = `crossOriginIsolated ? min(4, hardwareConcurrency) : 1`, and wasm SIMD (Chromium on the dev server: 12 cores, 4 threads, SIMD on). Phone-device proof is the LAN round's.
- **Auth inside `/scan/`.** An isolated document calls `initializeAuth` with the same persistence stack (IndexedDB, local, session) **without** the popup/redirect resolver, because the auth helper iframe is blocked under COEP; the signed-in session is shared with `/`. Google sign-in cannot run there: any sign-in request inside `/scan/` bounces to `/#/vault` (return URL in `sessionStorage` `hsv.scan.signin`) and returns once signed in.
- **The hop.** Camera mode on `/` navigates (`location.assign`) to `/scan/#/camera`; the entry beneath the tool is first rewritten to the screen under it, so Back never re-hops. Inside `/scan/` the keypad side of the mode toggle switches **in place** (`/scan/#/pad`); closing a hop-entered camera at navigation depth 0 walks back to the screen beneath it; a cold `/scan/` tab closes onto its own Vault. The camera stream is released on leaving the camera mode.
- **State across documents.** The batch, `mode`, set code and precon deck are mirrored to `sessionStorage` `hsv.tool.v1` (versioned, every access guarded); a reload in the same tab therefore keeps the batch, a new tab starts empty, and a bfcache-restored page re-reads the mirror. Camera settings live in `localStorage` `hsv.scan.v1` = `{boxOffsetMm, boxOffsetVMm, fastAdd, mode}` (offsets clamped to ±4 mm, rounded to 0.1; unreadable storage -> defaults).
- **Payload.** `frontend/public/vendor/scan/`, 15 files, 33,334,315 bytes, plain git (no LFS), with `THIRD_PARTY_NOTICES.txt` and the licence files (ppu-paddle-ocr 6.6.1 is **MIT** as shipped; onnxruntime-web 1.23.2 MIT; Tesseract.js, core and `eng.traineddata` Apache-2.0; the PP-OCRv6 tiny models and dictionary are credited to the PaddleOCR project; the notice states Apache-2.0 per the upstream repository, not independently verified for the converted `.ort` files). Lazy: nothing under `/vendor/scan/` is requested on `/`, the Vault, the keypad or `/scan/` off the camera route; the Paddle group loads when the camera screen mounts (the route alone fetches nothing: at >= 768 px `/scan/#/camera` renders the desktop tree) and the Tesseract group only at the first fallback need (it fetches one core file).
- **Reader.** Paddle runs in a module worker (`paddleWorker.ts`): ort `wasmPaths`, the threads rule above, EP `wasm`, the vendored bundle imported (not rebuilt) with `self.window = self`; frames travel as transferable `ImageBitmap`s and the UI thread never waits on OCR; init is bounded at 60 s. Measured on the dev server in Chromium: init 549-608 ms, a synthetic strip reads in 84-89 ms. A failed or timed-out reader never throws into the UI: the screen says "The card reader could not start", gives the reason and offers "Use the keypad".
- **Catalogue and parser.** The scan catalogue is derived at load from the app's own catalogue (`scanCatalog.ts`, a port of the spike's `build_catalog.py`), so it cannot go stale; vitest proves it equals the spike's `catalog.json` (round trip; and, one-off, from the spike's raw API cache: 2,582 cards / 10,193 printings). The parser and Acceptor are the spike's `scan-core.js` v0.5.5 unchanged (all 53 parser cases and 15 replay scenarios pass).
- **Thresholds as built.** Sharpness gate: Laplacian variance of the text band >= 14 (meter fill = value / 42; red < 14, amber < 21, green above); glyph floor 22 processed px ("Too small — move closer"); 3 agreeing reads of the last 4 with bars Tesseract 30 / Paddle 60; Paddle first, Tesseract only when Paddle gave no code or number, at most 1 per 2 frames, PSM 6 then 7 inside 700 ms plus a digits pass; no zoom code anywhere.
- **Guide.** Portrait only (the landscape constants are ported and unused; a viewport wider than 767 px is served the desktop tree by the gate (§25.0), which has no camera). Crop = group + 3.15 mm each side; box and crop shifted -2.2 mm / +2.1 mm against the outline; the "Align guide" text button opens a "Guide alignment" sheet with the two ±4 mm sliders (live on input, persisted on release, "Reset to 0"). The geometry equals the spike's own functions (vitest reference crop `[188, 934, 576, 301]` for the 1080 x 1920 clip).
- **Flow.** Searching -> found | pick -> hold. Found shows the keypad's `Identified` panel (shared numbers, BL-191 non-foil default, In vault / After add readout) with Card details (the card layer over the paused camera, same document), Add, and Wrong card (restart, no keypad prefill). An ambiguous read opens the pick only when two consecutive reads give the same ambiguous key (one noisy frame is superseded by the next clean read, as in the spike); the pick is an amber panel with the program name per row (SS Store Showdown, RQ Regional Qualifier, PQ Planetary Qualifier, SQ Sector Qualifier, GC Galactic Championship); a pick resolves, then the cue. The Keypad link and the header's keypad toggle open `#/pad?set=<code>&num=<n>` from the last 8 reads, only when the set exists.
- **Hold and suppression.** An Add (prompt or Fast add) starts the 1.5 s hold ("Fast add · next card in 1.5 s", "In batch n", Add hidden); the 3 s same-key suppression is counted from the resume; after an automatic add the key is also held until the card leaves the frame; a Fast add read that needs a pick falls back to the prompt; Wrong card inside the hold takes that copy back out.
- **Cue.** One beep (1320 Hz, gain 0.0001 -> 0.2 in 10 ms -> 0.0001 at 80 ms) plus a full-screen green flash (`#178a3a`, .45, 180 ms on, .35 s fade) on every recognition; the `AudioContext` is created inside a user gesture (camera-mode tap, Start, any pointerdown on the screen); `navigator.vibrate` is never called.
- **Not built / not ported.** The spike's research machinery (crop capture/export, review/truth screens, condition select, continuous mode, Photo, Setup, event log, `window.__bl238`), guide v1, the orientation toggle, the optional zoom / focus / torch / lens controls, and the `?debug=1` raw-text overlay.
- **Provisional copy.** The camera's stream-state sentences ("Camera access is off", "Camera stopped by the phone", "Camera paused", "No camera found") and the generic pick question for non-collision picks ("This code matches more than one card. Pick the card you have.") are accepted provisionally; the owner adjusts them in the LAN round.
- **Camera test fixtures.** The `scan` project drives the BL-238 spike clips (`e2e/mobile/clips/`, 9 files, 13 MB) through the **real** reader on a scan catalogue extended to a SOR main size of 252 (`e2e/mobile/scan-fixture.ts`); vitest sits beside the code in `frontend/src/mobile/camera/`.
