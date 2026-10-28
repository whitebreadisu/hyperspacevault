<!-- generated 2026-10-28 by .github/scripts/docs_index.mjs from 99494f7 — do not hand-edit; regenerate with: node .github/scripts/docs_index.mjs --write -->
# Documentation index (generated)

Generated section-level index of the three public specs, for retrieval and for the doc-currency audit: one row per `##` / `###` section, with its starting line, its size (`Bytes (LF)`, LF-normalised UTF-8 so Windows and Linux agree; a `##` row includes its `###` children), the first dated banner line in the section's own text, the ADRs it mentions, the code paths it cites in backticks (historical citations excluded) and the archive headings its tombstones quote. Regenerate with `node .github/scripts/docs_index.mjs --write`; CI fails when the committed file is stale; never hand-edit.

## SWU_Application_Spec.md

Total 251,107 B (LF) · 25 h2 · 77 h3

| § | Section | Line | Bytes (LF) | Dated banner | ADRs | Code paths cited | Archive headings quoted |
|---|---|---|---|---|---|---|---|
| — | (preamble: title and front matter) | 1 | 3,735 | 2026-10-25 Last updated | 0032 | `docs/decisions`, `specification_documents/analysis/BL271_Purity_Dispositions_2026-10-18.md` | "Archived 2026-10-18 — tier purity round 2 (BL-271 Phase C)" |
| h2 | [§1. Status under the documentation regime](SWU_Application_Spec.md#1-status-under-the-documentation-regime) | 22 | 573 |  | 0020 | `docs/decisions` | "Archived 2026-10-18 — tier purity round 2 (BL-271 Phase C)" |
| h2 | [§2. Product frame (requirements that drive the design)](SWU_Application_Spec.md#2-product-frame-requirements-that-drive-the-design) | 30 | 1,611 |  | 0008 |  | "Archived 2026-10-18 — tier purity round 2 (BL-271 Phase C)" |
| h2 | [§3. Core concepts](SWU_Application_Spec.md#3-core-concepts) | 47 | 3,184 |  |  |  |  |
| h3 | [§3.1 Base-set anchoring](SWU_Application_Spec.md#31-base-set-anchoring) | 49 | 523 |  |  |  |  |
| h3 | [§3.2 Finish vs. provenance — two orthogonal axes](SWU_Application_Spec.md#32-finish-vs-provenance--two-orthogonal-axes) | 53 | 1,125 | 2026-06-21 Resolved by BL-27 — see §10 |  |  |  |
| h3 | [§3.3 Standard anchor & exceptions](SWU_Application_Spec.md#33-standard-anchor--exceptions) | 64 | 733 |  |  |  |  |
| h3 | [§3.4 Tokens — duplicate-per-set](SWU_Application_Spec.md#34-tokens--duplicate-per-set) | 68 | 782 |  |  |  |  |
| h2 | [§4. Schema (as built)](SWU_Application_Spec.md#4-schema-as-built) | 74 | 13,509 |  |  | `backend/alembic/versions` | "Archived 2026-10-18 — tier purity round 2 (BL-271 Phase C)" |
| h3 | [§4.1 `sets` — all sets, base and container](SWU_Application_Spec.md#41-sets--all-sets-base-and-container) | 78 | 901 |  |  |  |  |
| h3 | [§4.2 `base_cards` — roots (one per printed card design per base set)](SWU_Application_Spec.md#42-base_cards--roots-one-per-printed-card-design-per-base-set) | 87 | 1,221 |  |  |  |  |
| h3 | [§4.3 `card_variants` — printings (replaces the old boolean flag columns)](SWU_Application_Spec.md#43-card_variants--printings-replaces-the-old-boolean-flag-columns) | 97 | 1,416 |  |  |  |  |
| h3 | [§4.4 `inventory`](SWU_Application_Spec.md#44-inventory) | 109 | 236 |  |  |  |  |
| h3 | [§4.5 Tenant settings & limits](SWU_Application_Spec.md#45-tenant-settings--limits) | 115 | 6,217 | 2026-07-12 Decided & built (BL-24, backend) | 0013, 0018 |  |  |
| h3 | [§4.6 `feedback` — anonymous-first user feedback (BL-126, shipped 2026-07-14)](SWU_Application_Spec.md#46-feedback--anonymous-first-user-feedback-bl-126-shipped-2026-07-14) | 130 | 3,148 |  |  | `backend/app/services/feedback.py`, `backend/app/tests/test_account_deletion.py` |  |
| h2 | [§5. UX / interaction model](SWU_Application_Spec.md#5-ux--interaction-model) | 142 | 50,132 |  |  |  |  |
| h3 | [§5.1 Set pickers — base/long-tail toggle](SWU_Application_Spec.md#51-set-pickers--baselong-tail-toggle) | 144 | 1,421 | 2026-10-12 Set order — newest first ) | 0031 | `frontend/src/utils/catalog.ts`, `frontend/src/utils/setGrouping.ts` |  |
| h3 | [§5.2 Catalog / Inventory filter semantics](SWU_Application_Spec.md#52-catalog--inventory-filter-semantics) | 150 | 1,164 |  |  | `frontend/src/utils/cardSort.ts` |  |
| h3 | [§5.3 Card detail / inventory popup (S6)](SWU_Application_Spec.md#53-card-detail--inventory-popup-s6) | 156 | 1,691 | 2026-07-13 BL-111 F5 |  | `frontend/src/screens/cards/CardPopup.tsx` |  |
| h3 | [§5.4 Add Cards — four-axis, ambiguity-gated resolver](SWU_Application_Spec.md#54-add-cards--four-axis-ambiguity-gated-resolver) | 165 | 11,025 | 2026-07-06 Cross-set batch | 0008, 0031 | `frontend/src/utils/addCardsResolver.ts`, `frontend/src/utils/setGrouping.ts` | "Archived 2026-10-12 — set-order sentences superseded by newest-first (BL-258, ADR-0031)" |
| h3 | [§5.6 Faceted filters (BL-70)](SWU_Application_Spec.md#56-faceted-filters-bl-70) | 216 | 5,507 | 2026-07-13 Layout | 0013 | `frontend/src/utils/filterPanelTiers.ts` |  |
| h3 | [§5.7 Gallery view — stage 1 (BL-73, shipped 2026-07-11)](SWU_Application_Spec.md#57-gallery-view--stage-1-bl-73-shipped-2026-07-11) | 234 | 3,566 |  | 0012 | `docs/decisions/0012-card-image-self-hosting.md`, `frontend/src/components/FilterPanel.tsx`, `frontend/src/screens/cards/GalleryGrid.tsx` |  |
| h3 | [§5.8 About & Legal (BL-125, shipped 2026-07-14)](SWU_Application_Spec.md#58-about--legal-bl-125-shipped-2026-07-14) | 251 | 1,608 |  |  | `frontend/src/screens/about/AboutModal.tsx` |  |
| h3 | [§5.9 Feedback (BL-126, shipped 2026-07-14)](SWU_Application_Spec.md#59-feedback-bl-126-shipped-2026-07-14) | 264 | 3,333 | 2026-07-31 Known limitation — CLOSED (BL-128) |  | `frontend/src/api/feedback.ts`, `frontend/src/screens/feedback/FeedbackModal.tsx` |  |
| h3 | [§5.10 Pricing surfaces (BL-140, shipped prod 2026-07-22)](SWU_Application_Spec.md#510-pricing-surfaces-bl-140-shipped-prod-2026-07-22) | 279 | 1,224 | 2026-07-21 Price surfaces |  |  |  |
| h3 | [§5.11 Deck Check (BL-142/BL-143, shipped prod 2026-07-22)](SWU_Application_Spec.md#511-deck-check-bl-142bl-143-shipped-prod-2026-07-22) | 288 | 1,726 |  | 0015 |  |  |
| h3 | [§5.12 Shell changes shipped with the arc (BL-144/BL-147/BL-148, prod 2026-07-22)](SWU_Application_Spec.md#512-shell-changes-shipped-with-the-arc-bl-144bl-147bl-148-prod-2026-07-22) | 297 | 1,277 |  |  |  |  |
| h3 | [§5.13 Cosmetics batch (BL-155/161/162/163/164, merged 2026-07-26)](SWU_Application_Spec.md#513-cosmetics-batch-bl-155161162163164-merged-2026-07-26) | 304 | 4,895 |  | 0031 | `frontend/src/assets/rarity`, `frontend/src/utils/preconPreview.ts`, `frontend/src/utils/setGrouping.ts` | "Archived 2026-10-12 — set-order sentences superseded by newest-first (BL-258, ADR-0031)" |
| h3 | [§5.14 Variant scope + the Value column (BL-173/BL-181 — build record archived 2026-08-17, BL-233)](SWU_Application_Spec.md#514-variant-scope--the-value-column-bl-173bl-181--build-record-archived-2026-08-17-bl-233) | 315 | 4,820 | 2026-08-17 Archived | 0030 | `frontend/src/utils/variantScope.ts` | "Archived 2026-10-12 — §5.13 / §25.1 scope option set superseded: Showcase returns to the scope picker (BL-259)" |
| h3 | [§5.15 Completion-panel set selection + filter-panel UX (BL-179 — build record archived 2026-08-17, BL-233)](SWU_Application_Spec.md#515-completion-panel-set-selection--filter-panel-ux-bl-179--build-record-archived-2026-08-17-bl-233) | 330 | 2,474 | 2026-08-17 Archived |  |  |  |
| h3 | [§5.16 Finish-scope follow-through + busy overlay (BL-187/191–196 — shipped prod 2026-08-07, v1.3)](SWU_Application_Spec.md#516-finish-scope-follow-through--busy-overlay-bl-187191196--shipped-prod-2026-08-07-v13) | 341 | 4,371 |  | 0031 | `frontend/src/utils/variantScope.ts` | "Archived 2026-10-12 — set-order sentences superseded by newest-first (BL-258, ADR-0031)" |
| h2 | [§6. Completion, limits, enforcement (cross-reference)](SWU_Application_Spec.md#6-completion-limits-enforcement-cross-reference) | 353 | 1,683 |  |  |  |  |
| h2 | [§7. Access & currency (cross-reference)](SWU_Application_Spec.md#7-access--currency-cross-reference) | 365 | 2,176 |  | 0004, 0008 |  | "Archived 2026-10-18 — tier purity round 2 (BL-271 Phase C)" |
| h2 | [§8. Test Strategy](SWU_Application_Spec.md#8-test-strategy) | 372 | 6,768 |  |  |  |  |
| h3 | [§8.1 Coverage disposition mandate](SWU_Application_Spec.md#81-coverage-disposition-mandate) | 376 | 2,685 |  |  |  |  |
| h3 | [§8.2 New invariants the redesign introduces (must have tests)](SWU_Application_Spec.md#82-new-invariants-the-redesign-introduces-must-have-tests) | 390 | 1,368 |  |  |  |  |
| h3 | [§8.3 Levels & fixtures](SWU_Application_Spec.md#83-levels--fixtures) | 401 | 510 |  |  |  |  |
| h3 | [§8.4 Test-first where it pays](SWU_Application_Spec.md#84-test-first-where-it-pays) | 408 | 271 |  |  |  |  |
| h3 | [§8.5 Cutover safety (historical — retired 2026-07-25, replaced by §17 import/export, BL-93)](SWU_Application_Spec.md#85-cutover-safety-historical--retired-2026-07-25-replaced-by-17-importexport-bl-93) | 412 | 1,366 | 2026-07-25 Retired (BL-93) |  |  |  |
| h2 | [§9. Relationship to backlog (which items execute which parts)](SWU_Application_Spec.md#9-relationship-to-backlog-which-items-execute-which-parts) | 420 | 356 |  |  |  | "Archived 2026-10-18 — tier purity round 2 (BL-271 Phase C)" |
| h2 | [§10. Variant Census & Classification (BL-27 — resolved 2026-06-21; §10.11 product-structure facts — BL-160, 2026-10-19)](SWU_Application_Spec.md#10-variant-census--classification-bl-27--resolved-2026-06-21-1011-product-structure-facts--bl-160-2026-10-19) | 428 | 10,865 |  |  |  |  |
| h3 | [§10.1 The graph (base_cards count + resolution)](SWU_Application_Spec.md#101-the-graph-base_cards-count--resolution) | 432 | 354 |  |  |  |  |
| h3 | [§10.2 Variant model — raw + curated classification](SWU_Application_Spec.md#102-variant-model--raw--curated-classification) | 436 | 500 |  |  |  |  |
| h3 | [§10.3 Finish vocabulary (8, frozen)](SWU_Application_Spec.md#103-finish-vocabulary-8-frozen) | 441 | 271 |  |  |  |  |
| h3 | [§10.4 Channel (provenance) — derived from `variant_type` + `source_set_code`](SWU_Application_Spec.md#104-channel-provenance--derived-from-variant_type--source_set_code) | 445 | 734 |  |  |  |  |
| h3 | [§10.5 `stamp_group` — finish + stamp](SWU_Application_Spec.md#105-stamp_group--finish--stamp) | 456 | 1,587 |  |  |  |  |
| h3 | [§10.6 Exceptions — structural 15 → fallback → genuine exceptions](SWU_Application_Spec.md#106-exceptions--structural-15--fallback--genuine-exceptions) | 465 | 1,399 |  | 0004 |  |  |
| h3 | [§10.7 `is_token`](SWU_Application_Spec.md#107-is_token) | 472 | 221 |  |  |  |  |
| h3 | [§10.8 Keying & data-quality](SWU_Application_Spec.md#108-keying--data-quality) | 476 | 521 |  |  |  |  |
| h3 | [§10.9 Aspect multiplicity — confirmed flattened](SWU_Application_Spec.md#109-aspect-multiplicity--confirmed-flattened) | 481 | 297 |  |  |  |  |
| h3 | [§10.10 Remaining open](SWU_Application_Spec.md#1010-remaining-open) | 485 | 639 |  |  | `backend/alembic/versions` |  |
| h3 | [§10.11 Product-structure facts (salvaged from `CARD_RULES.md` — BL-160; verified against the live catalogue 2026-10-19)](SWU_Application_Spec.md#1011-product-structure-facts-salvaged-from-card_rulesmd--bl-160-verified-against-the-live-catalogue-2026-10-19) | 492 | 3,833 |  | 0002, 0014 |  |  |
| h2 | [§11. Backend architecture & tech stack](SWU_Application_Spec.md#11-backend-architecture--tech-stack) | 505 | 2,830 |  |  | `backend/app`, `backend/app/db_url.py` |  |
| h2 | [§12. API reference](SWU_Application_Spec.md#12-api-reference) | 528 | 21,920 | 2026-07-10 Retired | 0008 | `backend/app/routers` |  |
| h3 | [§Sets — `/api/sets`](SWU_Application_Spec.md#sets--apisets) | 542 | 256 |  |  |  |  |
| h3 | [§Base cards (list + detail) — `/api/base-cards`](SWU_Application_Spec.md#base-cards-list--detail--apibase-cards) | 550 | 5,563 | 2026-07-22 Prices are embedded, additively | 0008, 0012 | `frontend/src/utils/cardImages.ts` |  |
| h3 | [§Inventory — `/api/inventory`](SWU_Application_Spec.md#inventory--apiinventory) | 563 | 3,261 |  |  |  |  |
| h3 | [§Settings — `/api/settings`](SWU_Application_Spec.md#settings--apisettings) | 586 | 664 |  |  |  |  |
| h3 | [§Shares — `/api/shares` (owner CRUD) + `/api/shared` (token-scoped public reads) — BL-205, v1.4](SWU_Application_Spec.md#shares--apishares-owner-crud--apishared-token-scoped-public-reads--bl-205-v14) | 594 | 1,739 |  |  |  |  |
| h3 | [§Deck check — `/api/deck-check`](SWU_Application_Spec.md#deck-check--apideck-check) | 611 | 2,910 |  | 0015 |  |  |
| h3 | [§Account — `/api/account`](SWU_Application_Spec.md#account--apiaccount) | 626 | 1,860 |  |  |  |  |
| h3 | [§Feedback — `/api/feedback`](SWU_Application_Spec.md#feedback--apifeedback) | 633 | 2,514 |  | 0008 | `backend/app/rate_limit.py`, `backend/app/services/feedback.py`, `backend/app/services/github_notify.py`, `specification_documents/backlog` |  |
| h3 | [§Analytics relay — `/api/relay` (BL-235, v1.4.2)](SWU_Application_Spec.md#analytics-relay--apirelay-bl-235-v142) | 644 | 602 |  | 0027 |  |  |
| h2 | [§13. Ingestion pipeline](SWU_Application_Spec.md#13-ingestion-pipeline) | 653 | 3,108 | 2026-07-25 Inventory snapshot — retired , replaced | 0002, 0004 | `backend/app/ingestion`, `backend/app/ingestion/bootstrap.py` |  |
| h2 | [§14. Environment](SWU_Application_Spec.md#14-environment) | 669 | 663 |  |  |  |  |
| h2 | [§15. Decks (design-stage — not built)](SWU_Application_Spec.md#15-decks-design-stage--not-built) | 678 | 944 |  | 0014, 0015, 0020 | `specification_documents/planning/design/AppSpec_15_Decks_design_2026-07-13.md` |  |
| h2 | [§16. Pricing (BL-136/BL-139/BL-146 — shipped prod 2026-07-22)](SWU_Application_Spec.md#16-pricing-bl-136bl-139bl-146--shipped-prod-2026-07-22) | 684 | 10,322 |  |  |  |  |
| h3 | [§16.1 Source & mapping](SWU_Application_Spec.md#161-source--mapping) | 688 | 1,229 |  |  |  |  |
| h3 | [§16.2 Data model](SWU_Application_Spec.md#162-data-model) | 694 | 1,075 |  |  |  |  |
| h3 | [§16.3 Jobs](SWU_Application_Spec.md#163-jobs) | 700 | 1,103 |  |  |  |  |
| h3 | [§16.3b Mapping scope (BL-174, shipped prod 2026-07-27)](SWU_Application_Spec.md#163b-mapping-scope-bl-174-shipped-prod-2026-07-27) | 705 | 2,737 | 2026-08-01 BL-183 : early-era Weekly Play joins the |  |  |  |
| h3 | [§16.4 Display & aggregation policy (owner-decided)](SWU_Application_Spec.md#164-display--aggregation-policy-owner-decided) | 713 | 1,761 |  |  | `backend/app/services/pricing.py` |  |
| h3 | [§16.5 The BL-146 lesson (load-bearing invariant)](SWU_Application_Spec.md#165-the-bl-146-lesson-load-bearing-invariant) | 720 | 852 |  |  |  |  |
| h3 | [§16.6 History provenance & the prod transfer (BL-139)](SWU_Application_Spec.md#166-history-provenance--the-prod-transfer-bl-139) | 724 | 1,196 |  |  | `backend/app/ingestion/transfer_variant_prices.py` |  |
| h2 | [§17. Inventory Import/Export (BL-54 — shipped to prod 2026-07-24)](SWU_Application_Spec.md#17-inventory-importexport-bl-54--shipped-to-prod-2026-07-24) | 728 | 11,218 | 2026-07-22 Build-authoritative detail lives in `pla |  |  |  |
| h3 | [§17.1 Canonical format — `swu-inv/1`](SWU_Application_Spec.md#171-canonical-format--swu-inv1) | 732 | 984 |  |  | `backend/app/services/inventory_io.py` |  |
| h3 | [§17.2 Resolution & import semantics](SWU_Application_Spec.md#172-resolution--import-semantics) | 738 | 1,420 |  |  |  |  |
| h3 | [§17.3 Surface & gates](SWU_Application_Spec.md#173-surface--gates) | 745 | 2,157 |  | 0008, 0031 | `backend/app/routers/settings.py`, `backend/app/services/set_order.py` | "Archived 2026-10-12 — set-order sentences superseded by newest-first (BL-258, ADR-0031)" |
| h3 | [§17.4 Status & tail](SWU_Application_Spec.md#174-status--tail) | 751 | 1,489 | 2026-07-27 Format guidance notes |  | `backend/app/services/set_order.py` |  |
| h3 | [§17.5 Foreign-format adapters (BL-185 SWUDB · BL-186 sw-unlimited-db — merged to dev 2026-08-03; prod 2026-08-07, v1.3)](SWU_Application_Spec.md#175-foreign-format-adapters-bl-185-swudb--bl-186-sw-unlimited-db--merged-to-dev-2026-08-03-prod-2026-08-07-v13) | 757 | 4,793 | 2026-10-08 Superseded | 0028 | `backend/app/services/swudb_import.py` | "Archived 2026-10-08 — §17.5 refusal-posture admission sentence (BL-241, ADR-0028)" |
| h2 | [§18. Precon Bulk Add (BL-151 — shipped to prod 2026-07-24) + BL-152 button glow](SWU_Application_Spec.md#18-precon-bulk-add-bl-151--shipped-to-prod-2026-07-24--bl-152-button-glow) | 770 | 3,358 | 2026-07-24 Build-authoritative detail lives in `pla |  | `backend/scripts/verify_precon_decks.py`, `frontend/src/data/preconDecks.json` |  |
| h2 | [§19. Collection Lists & Sharing (§19.1 sharing as built, v1.4; lists and binders design-stage)](SWU_Application_Spec.md#19-collection-lists--sharing-191-sharing-as-built-v14-lists-and-binders-design-stage) | 781 | 5,783 |  | 0019, 0020 | `specification_documents/planning/design/AppSpec_19_Lists_Binders_design_2026-08-11.md` | "Archived 2026-10-18 — tier purity round 2 (BL-271 Phase C)" |
| h3 | [§19.1 Sharing model (BL-205 — as-built, v1.4)](SWU_Application_Spec.md#191-sharing-model-bl-205--as-built-v14) | 785 | 4,693 |  | 0008, 0019 |  |  |
| h3 | [§19.4 Decisions record](SWU_Application_Spec.md#194-decisions-record) | 797 | 271 |  | 0019 |  |  |
| h2 | [§20. Release-notes system (BL-184, v1.3) + promote gate & Releases mirror (BL-210, v1.4)](SWU_Application_Spec.md#20-release-notes-system-bl-184-v13--promote-gate--releases-mirror-bl-210-v14) | 801 | 1,722 |  |  | `frontend/package.json`, `frontend/src/content/releaseNotes.ts`, `frontend/src/screens/notes/NewArrivalsPage.tsx`, `frontend/src/utils/releaseNotesSeen.ts`, `frontend/src/utils/version.ts` |  |
| h2 | [§21. v1.4 Vault batch (shipped prod 2026-08-16 — "Your Vault, shareable")](SWU_Application_Spec.md#21-v14-vault-batch-shipped-prod-2026-08-16--your-vault-shareable) | 810 | 483 |  |  |  | "Archived 2026-10-18 — tier purity round 2 (BL-271 Phase C)" |
| h2 | [§22. Product Analytics (BL-235, 2026-08-26 — PostHog via first-party relay)](SWU_Application_Spec.md#22-product-analytics-bl-235-2026-08-26--posthog-via-first-party-relay) | 814 | 6,540 |  | 0027, 0030 | `backend/app/routers/relay.py`, `frontend/src/analytics/analytics.ts` | "Archived 2026-10-12 — round 2: phone gate and landscape (BL-257, F-18)" |
| h2 | [§23. Homeworlds onboarding (BL-239, v1.5 — shipped prod 2026-10-02)](SWU_Application_Spec.md#23-homeworlds-onboarding-bl-239-v15--shipped-prod-2026-10-02) | 857 | 2,705 |  | 0031 | `frontend/public/images`, `frontend/public/images/starfields` | "Archived 2026-10-12 — set-order sentences superseded by newest-first (BL-258, ADR-0031)" |
| h2 | [§24. Card scanning — rules and geometry (as built; mechanics in §25.7)](SWU_Application_Spec.md#24-card-scanning--rules-and-geometry-as-built-mechanics-in-257) | 870 | 8,667 |  | 0029 |  | "Archived 2026-10-18 — tier purity round 2 (BL-271 Phase C)" |
| h3 | [§24.1 What it is](SWU_Application_Spec.md#241-what-it-is) | 874 | 734 |  |  |  | "Archived 2026-10-13 — camera Fast add, hold and suppression (BL-262)" |
| h3 | [§24.2 Rules](SWU_Application_Spec.md#242-rules) | 884 | 2,562 |  | 0029 |  | "Archived 2026-10-18 — tier purity round 2 (BL-271 Phase C)" |
| h3 | [§24.3 Guide geometry (measured on official card images; fractions of card width W / height H)](SWU_Application_Spec.md#243-guide-geometry-measured-on-official-card-images-fractions-of-card-width-w--height-h) | 898 | 1,796 |  |  |  | "Archived 2026-10-11 — §24 / §25.1 spike-era and interim wording superseded by the camera build (BL-253)", "Archived 2026-10-18 — tier purity round 2 (BL-271 Phase C)" |
| h3 | [§24.4 Readers and acceptance](SWU_Application_Spec.md#244-readers-and-acceptance) | 919 | 1,642 |  | 0029 |  |  |
| h3 | [§24.5 Printed-code collisions](SWU_Application_Spec.md#245-printed-code-collisions) | 946 | 700 |  | 0028 |  | "Archived 2026-10-18 — tier purity round 2 (BL-271 Phase C)" |
| h2 | [§25. Mobile experience (BL-190 — as built)](SWU_Application_Spec.md#25-mobile-experience-bl-190--as-built) | 957 | 76,252 |  |  |  | "Archived 2026-10-11 — §25 slice-by-slice text superseded by the closing consolidation (BL-252 S6-09)" |
| h3 | [§25.0 Overview](SWU_Application_Spec.md#250-overview) | 963 | 13,176 |  | 0030 | `frontend/e2e/mobile`, `frontend/e2e/report-flaky.mjs`, `frontend/src/api/sharedView.ts`, `frontend/src/mobile`, `frontend/src/mobile/MobileApp`, `frontend/src/mobile/docs.test.ts`, `frontend/src/mobile/router.ts`, `frontend/src/mobile/useIsPhone.ts`, `frontend/src/utils/shareSession.ts` | "Archived 2026-10-12 — round 2: phone gate and landscape (BL-257, F-18)" |
| h3 | [§25.1 Shell + Vault (BL-247)](SWU_Application_Spec.md#251-shell--vault-bl-247) | 1004 | 7,481 |  | 0030, 0031 | `frontend/src/utils/cardSort.ts`, `frontend/src/utils/variantScope.ts` | "Archived 2026-10-12 — set-order sentences superseded by newest-first (BL-258, ADR-0031)", "Archived 2026-10-12 — round 2: phone Sort sheet (BL-257, F-17)", "Archived 2026-10-11 — §25.1 shared-link interim sentence superseded by slice 6" |
| h3 | [§25.2 Card detail + Filters (BL-248)](SWU_Application_Spec.md#252-card-detail--filters-bl-248) | 1017 | 9,462 |  | 0030, 0031 | `frontend/src/mobile/card`, `frontend/src/mobile/filters`, `frontend/src/mobile/filters/FiltersSheet.tsx` | "Archived 2026-10-12 — §25.2 plate idiom and limit colour superseded by the owner finish round (BL-257)", "Archived 2026-10-12 — set-order sentences superseded by newest-first (BL-258, ADR-0031)" |
| h3 | [§25.3 Keypad, choosers, verify batch, commit (BL-249)](SWU_Application_Spec.md#253-keypad-choosers-verify-batch-commit-bl-249) | 1054 | 12,323 |  | 0030, 0032 | `frontend/scripts/measure-set-logos.mjs`, `frontend/src/mobile/SetLogo.tsx`, `frontend/src/mobile/setLogoArt.ts`, `frontend/src/mobile/tool` | "Archived 2026-10-17 — phone keypad keeps its size (BL-270)", "Archived 2026-10-12 — §25.2 plate idiom and limit colour superseded by the owner finish round (BL-257)" |
| h3 | [§25.4 More, About & Legal, [HSV] Updates, Import & Export (BL-250)](SWU_Application_Spec.md#254-more-about--legal-hsv-updates-import--export-bl-250) | 1078 | 5,786 |  |  | `frontend/src/mobile/more` | "Archived 2026-10-11 — §25.4 slice-4 interim wording superseded by slice 5 (§25.5)" |
| h3 | [§25.5 Account: Settings, Change Password, Delete Account, Sharing, verify banner (BL-251)](SWU_Application_Spec.md#255-account-settings-change-password-delete-account-sharing-verify-banner-bl-251) | 1096 | 4,156 |  |  | `frontend/src/mobile/account` |  |
| h3 | [§25.6 Shared vault (BL-252)](SWU_Application_Spec.md#256-shared-vault-bl-252) | 1108 | 5,515 |  |  | `frontend/src/api/sharedView.ts`, `frontend/src/mobile/shared` |  |
| h3 | [§25.7 Camera (BL-253)](SWU_Application_Spec.md#257-camera-bl-253) | 1120 | 17,699 |  | 0030 | `frontend/e2e/mobile/scan-fixture.ts`, `frontend/public/vendor/scan`, `frontend/scan.html`, `frontend/src/mobile/camera`, `frontend/src/scan.tsx` | "Archived 2026-10-12 — round 2: phone gate and landscape (BL-257, F-18)", "Archived 2026-10-13 — camera Fast add, hold and suppression (BL-262)", "Archived 2026-10-12 — §25.2 plate idiom and limit colour superseded by the owner finish round (BL-257)" |

## SWU_Platform_Spec.md

Total 122,384 B (LF) · 6 h2 · 43 h3

| § | Section | Line | Bytes (LF) | Dated banner | ADRs | Code paths cited | Archive headings quoted |
|---|---|---|---|---|---|---|---|
| — | (preamble: title and front matter) | 1 | 96 | 2026-06-14 Version 1.0 \| Created |  |  |  |
| h2 | [§Purpose & How to Use This Document](SWU_Platform_Spec.md#purpose--how-to-use-this-document) | 7 | 2,359 |  | 0020 | `backend/app/tests/test_route_registry.py`, `docs/decisions` | "Archived 2026-10-18 — tier purity round 2 (BL-271 Phase C)" |
| h2 | [§1. Auth & Tenancy Architecture](SWU_Platform_Spec.md#1-auth--tenancy-architecture) | 30 | 24,854 |  |  |  |  |
| h3 | [§1.1 Overview](SWU_Platform_Spec.md#11-overview) | 32 | 4,860 |  | 0008, 0019, 0027 | `backend/app/auth.py`, `backend/app/database.py`, `backend/app/routers/relay.py`, `backend/app/services/feedback.py` | "Archived 2026-10-18 — tier purity round 2 (BL-271 Phase C)" |
| h3 | [§1.2 Where the token is verified — `app/auth.py`](SWU_Platform_Spec.md#12-where-the-token-is-verified--appauthpy) | 64 | 4,325 |  | 0034 | `backend/app/auth.py`, `frontend/src/components/VerifyEmailBanner.tsx` |  |
| h3 | [§1.3 The `Depends` chain and the route registry](SWU_Platform_Spec.md#13-the-depends-chain-and-the-route-registry) | 72 | 3,992 |  |  | `backend/app/database.py`, `backend/app/tests/test_route_registry.py` | "Archived 2026-10-18 — tier purity round 2 (BL-271 Phase C)" |
| h3 | [§1.4 `get_db` step by step — `app/database.py` (`get_db` → `_open_authenticated_session`)](SWU_Platform_Spec.md#14-get_db-step-by-step--appdatabasepy-get_db--_open_authenticated_session) | 123 | 2,279 |  | 0001 | `backend/app/database.py`, `backend/app/middleware.py` |  |
| h3 | [§1.5 Row-Level Security policies](SWU_Platform_Spec.md#15-row-level-security-policies) | 139 | 5,694 |  |  |  |  |
| h3 | [§1.6 The two-engine pattern](SWU_Platform_Spec.md#16-the-two-engine-pattern) | 156 | 1,175 |  | 0001, 0004 | `backend/app/database.py` |  |
| h3 | [§1.7 Design Rationale — extracted to ADRs (2026-08-17, BL-233)](SWU_Platform_Spec.md#17-design-rationale--extracted-to-adrs-2026-08-17-bl-233) | 169 | 919 |  | 0001, 0020, 0024, 0026 |  |  |
| h3 | [§1.8 Client auth start-up (frontend)](SWU_Platform_Spec.md#18-client-auth-start-up-frontend) | 178 | 1,575 |  |  | `frontend/src/firebase.test.ts`, `frontend/src/firebase.ts`, `frontend/src/utils/googleAuth.ts` |  |
| h2 | [§2. CI/CD Pipeline](SWU_Platform_Spec.md#2-cicd-pipeline) | 184 | 34,002 |  |  |  |  |
| h3 | [§2.1 Overview](SWU_Platform_Spec.md#21-overview) | 186 | 14,199 |  | 0007, 0022, 0033 | `.github/scripts/ci_gate.sh`, `.github/scripts/docs_audit.mjs`, `.github/scripts/docs_check.mjs`, `.github/workflows/ci.yml`, `.github/workflows/docs-audit.yml`, `.github/workflows/docs-check.yml`, `backend/app/auth.py`, `backend/app/tests/test_route_registry.py`, `frontend/e2e-results/report.json`, `frontend/e2e/report-flaky.mjs`, `frontend/src`, `frontend/src/content/releaseNotes.ts`, `frontend/src/mobile/docs.test.ts`, `specification_documents/INDEX.md` | "Archived 2026-10-18 — tier purity round 2 (BL-271 Phase C)", "Archived 2026-10-12 — mobile e2e sharding (BL-260)" |
| h3 | [§2.2 `backend` job](SWU_Platform_Spec.md#22-backend-job) | 219 | 659 |  |  | `backend/requirements.txt` |  |
| h3 | [§2.3 `frontend` job](SWU_Platform_Spec.md#23-frontend-job) | 224 | 465 |  |  | `frontend/package-lock.json`, `frontend/vite.config.ts` |  |
| h3 | [§2.4 `build-and-push` job](SWU_Platform_Spec.md#24-build-and-push-job) | 229 | 614 |  |  |  |  |
| h3 | [§2.5 `check-risk-level` and `deploy-dev` jobs](SWU_Platform_Spec.md#25-check-risk-level-and-deploy-dev-jobs) | 235 | 1,418 |  | 0017 | `terraform/environments/dev` |  |
| h3 | [§2.6 Prod promotion: `promote-prod.yml` dispatch + `promote-prod-fast`](SWU_Platform_Spec.md#26-prod-promotion-promote-prodyml-dispatch--promote-prod-fast) | 240 | 6,217 | 2026-07-15 Mechanism | 0007, 0011, 0033 | `.github/actions/promote-prod/action.yml`, `.github/scripts/ci_gate.sh`, `.github/scripts/release_notes.mjs`, `frontend/package.json` | "Archived 2026-10-18 — tier purity round 2 (BL-271 Phase C)" |
| h3 | [§2.7 Design Rationale](SWU_Platform_Spec.md#27-design-rationale) | 250 | 950 |  | 0022 |  |  |
| h3 | [§2.8 Documentation Controls Register (BL-271 Phase E, 2026-10-19 — [ADR-0033](../docs/decisions/0033-documentation-controls.md))](SWU_Platform_Spec.md#28-documentation-controls-register-bl-271-phase-e-2026-10-19--adr-0033) | 262 | 9,458 |  | 0020, 0033, 0035, 0036 | `.github/scripts/ci_gate.sh`, `.github/scripts/comment_check.mjs`, `.github/scripts/docs_audit.mjs`, `.github/scripts/docs_history.mjs`, `.github/scripts/docs_index.mjs`, `.github/scripts/health_check.mjs`, `.github/workflows/docs-audit.yml`, `.github/workflows/health-check.yml`, `backend/app`, `backend/app/tests/test_route_registry.py`, `frontend/src`, `frontend/src/mobile/docs.test.ts`, `specification_documents/planning/foundation/tools/registry.mjs` |  |
| h2 | [§3. Terraform Module Map](SWU_Platform_Spec.md#3-terraform-module-map) | 300 | 35,877 |  |  |  |  |
| h3 | [§3.1 Environments](SWU_Platform_Spec.md#31-environments) | 302 | 511 |  |  |  |  |
| h3 | [§3.2 State backend](SWU_Platform_Spec.md#32-state-backend) | 312 | 388 |  |  | `terraform/state` |  |
| h3 | [§3.3 Workload Identity Federation](SWU_Platform_Spec.md#33-workload-identity-federation) | 316 | 733 |  |  |  |  |
| h3 | [§3.4 IAM](SWU_Platform_Spec.md#34-iam) | 323 | 2,971 |  |  |  |  |
| h3 | [§3.4a Pricing infrastructure (BL-136/BL-139)](SWU_Platform_Spec.md#34a-pricing-infrastructure-bl-136bl-139) | 357 | 1,560 |  |  | `terraform/modules/app/pricing_jobs.tf` |  |
| h3 | [§3.5 Cloud Run](SWU_Platform_Spec.md#35-cloud-run) | 366 | 3,330 | 2026-07-24 As-built addition — BL-53 proxy-IP fix, |  | `backend/app/main.py` |  |
| h3 | [§3.6 Cloud SQL](SWU_Platform_Spec.md#36-cloud-sql) | 398 | 3,753 | 2026-07-24 D4 — prod Cloud SQL tier |  | `backend/app/database.py`, `terraform/environments/prod/main.tf` |  |
| h3 | [§3.7 Secret Manager](SWU_Platform_Spec.md#37-secret-manager) | 418 | 4,327 | 2026-07-30 Authoritative secrets for manual ops : t |  | `backend/app/services/github_notify.py`, `terraform/modules/app/secrets.tf` |  |
| h3 | [§3.8 Artifact Registry](SWU_Platform_Spec.md#38-artifact-registry) | 437 | 211 |  |  |  |  |
| h3 | [§3.9 Firebase & Identity Platform](SWU_Platform_Spec.md#39-firebase--identity-platform) | 441 | 3,077 |  | 0016 | `frontend/firebase.json` |  |
| h3 | [§3.10 Custom domain](SWU_Platform_Spec.md#310-custom-domain) | 448 | 2,476 | 2026-07-20 BL-127 — `hyperspacevault.com`, a stand- |  | `terraform/modules/app/firebase.tf` |  |
| h3 | [§3.11 Frontend ↔ backend connection](SWU_Platform_Spec.md#311-frontend--backend-connection) | 456 | 1,750 |  |  | `backend/app/main.py`, `frontend/firebase.json`, `frontend/src/api/authedFetch.ts` |  |
| h3 | [§3.12 Outputs consumed by CI](SWU_Platform_Spec.md#312-outputs-consumed-by-ci) | 472 | 816 |  |  |  |  |
| h3 | [§3.13 Design Rationale — extracted to ADRs (2026-08-17, BL-233)](SWU_Platform_Spec.md#313-design-rationale--extracted-to-adrs-2026-08-17-bl-233) | 481 | 725 |  | 0001, 0020, 0021, 0023 |  |  |
| h3 | [§3.14 CDN caching of public catalog reads (RR-3)](SWU_Platform_Spec.md#314-cdn-caching-of-public-catalog-reads-rr-3) | 489 | 2,782 |  |  | `backend/app/http_cache.py`, `backend/app/routers/sets.py`, `specification_documents/backlog` |  |
| h3 | [§3.15 Response compression (gzip, BL-99)](SWU_Platform_Spec.md#315-response-compression-gzip-bl-99) | 499 | 2,655 |  |  | `backend/app/main.py` |  |
| h3 | [§3.16 Self-hosted card images (BL-76 / ADR-0012)](SWU_Platform_Spec.md#316-self-hosted-card-images-bl-76--adr-0012) | 507 | 3,784 | 2026-07-12 Prod state | 0012 | `backend/app/ingestion/image_mirror.py`, `backend/app/routers/images.py`, `backend/app/services/image_paths.py`, `frontend/src/utils/cardImages.ts`, `specification_documents/backlog` |  |
| h2 | [§4. Observability](SWU_Platform_Spec.md#4-observability) | 521 | 13,049 |  |  |  |  |
| h3 | [§4.1 Structured JSON logging](SWU_Platform_Spec.md#41-structured-json-logging) | 523 | 2,122 |  |  | `backend/app/logging_config.py`, `backend/app/main.py`, `backend/app/middleware.py` |  |
| h3 | [§4.2 Cloud Monitoring dashboard](SWU_Platform_Spec.md#42-cloud-monitoring-dashboard) | 538 | 687 |  |  |  |  |
| h3 | [§4.3 Alerting](SWU_Platform_Spec.md#43-alerting) | 546 | 6,110 | 2026-07-14 Operational finding |  | `specification_documents/backlog` |  |
| h3 | [§4.4 Error Reporting](SWU_Platform_Spec.md#44-error-reporting) | 564 | 426 |  |  |  |  |
| h3 | [§4.5 Design Rationale](SWU_Platform_Spec.md#45-design-rationale) | 568 | 927 |  | 0025 |  |  |
| h3 | [§4.6 Cost Controls (RR-2 / finding F14)](SWU_Platform_Spec.md#46-cost-controls-rr-2--finding-f14) | 580 | 2,756 |  | 0008 | `terraform/modules/app/variables.tf` |  |
| h2 | [§5. Security Posture Summary](SWU_Platform_Spec.md#5-security-posture-summary) | 601 | 12,147 | 2026-08-16 Review currency |  |  |  |
| h3 | [§5.1 OWASP Top 10 (2021) — status](SWU_Platform_Spec.md#51-owasp-top-10-2021--status) | 607 | 9,074 | 2026-07-24 As-built addition — BL-53 + BL-157 (requ | 0008, 0022 | `backend/app/main.py`, `backend/app/rate_limit.py`, `backend/app/routers/feedback.py`, `backend/app/services/deck_fetch.py`, `specification_documents/backlog` |  |
| h3 | [§5.2 Secrets (Secret Manager)](SWU_Platform_Spec.md#52-secrets-secret-manager) | 632 | 551 |  |  |  |  |
| h3 | [§5.3 Network posture](SWU_Platform_Spec.md#53-network-posture) | 636 | 699 |  | 0023 |  |  |
| h3 | [§5.4 Open follow-ups](SWU_Platform_Spec.md#54-open-follow-ups) | 642 | 634 |  |  |  | "Archived 2026-10-18 — tier purity round 2 (BL-271 Phase C)" |

## SWU_Standard_Variant_Mapping_Spec.md

Total 22,315 B (LF) · 9 h2 · 10 h3

| § | Section | Line | Bytes (LF) | Dated banner | ADRs | Code paths cited | Archive headings quoted |
|---|---|---|---|---|---|---|---|
| — | (preamble: title and front matter) | 1 | 804 |  |  |  |  |
| h2 | [§1. Purpose](SWU_Standard_Variant_Mapping_Spec.md#1-purpose) | 10 | 1,602 |  |  |  |  |
| h2 | [§2. The Core Concept](SWU_Standard_Variant_Mapping_Spec.md#2-the-core-concept) | 21 | 1,006 |  |  |  |  |
| h2 | [§3. The Mechanism — `variant_of_uuid`](SWU_Standard_Variant_Mapping_Spec.md#3-the-mechanism--variant_of_uuid) | 32 | 3,777 |  |  |  |  |
| h3 | [§The integrity invariant this design depends on — corrected 2026-06-21 against the full export](SWU_Standard_Variant_Mapping_Spec.md#the-integrity-invariant-this-design-depends-on--corrected-2026-06-21-against-the-full-export) | 59 | 1,785 |  |  |  |  |
| h2 | [§4. Database Design](SWU_Standard_Variant_Mapping_Spec.md#4-database-design) | 67 | 1,916 | 2026-06-20 Resolved (swuapi-first redesign session |  | `specification_documents/backlog` |  |
| h2 | [§5. Scenario Taxonomy](SWU_Standard_Variant_Mapping_Spec.md#5-scenario-taxonomy) | 79 | 5,412 |  |  |  |  |
| h3 | [§A. Simple single-set family](SWU_Standard_Variant_Mapping_Spec.md#a-simple-single-set-family) | 83 | 218 |  |  |  |  |
| h3 | [§B. Cross-set reprint (independent roots)](SWU_Standard_Variant_Mapping_Spec.md#b-cross-set-reprint-independent-roots) | 87 | 239 |  |  |  |  |
| h3 | [§C. Container-set variant (cross-set anchor)](SWU_Standard_Variant_Mapping_Spec.md#c-container-set-variant-cross-set-anchor) | 91 | 426 |  |  |  |  |
| h3 | [§D. Old-set card-number collision](SWU_Standard_Variant_Mapping_Spec.md#d-old-set-card-number-collision) | 95 | 579 |  |  |  |  |
| h3 | [§E. Newer-set baseline](SWU_Standard_Variant_Mapping_Spec.md#e-newer-set-baseline) | 99 | 404 |  |  |  |  |
| h3 | [§F. Serialized Prestige triple-finish collision](SWU_Standard_Variant_Mapping_Spec.md#f-serialized-prestige-triple-finish-collision) | 103 | 920 |  |  |  |  |
| h3 | [§G. Standalone new-base set](SWU_Standard_Variant_Mapping_Spec.md#g-standalone-new-base-set) | 107 | 1,240 |  |  |  |  |
| h3 | [§H. No-anchor exception](SWU_Standard_Variant_Mapping_Spec.md#h-no-anchor-exception) | 124 | 715 | 2026-10-02 Status |  |  |  |
| h3 | [§I. Chain-depth invariant — corrected 2026-06-21](SWU_Standard_Variant_Mapping_Spec.md#i-chain-depth-invariant--corrected-2026-06-21) | 130 | 556 |  |  |  |  |
| h2 | [§6. Exception Handling](SWU_Standard_Variant_Mapping_Spec.md#6-exception-handling) | 136 | 3,211 | 2026-06-21 Definition |  |  |  |
| h2 | [§7. Deferred / Related Concepts (explicitly out of scope here)](SWU_Standard_Variant_Mapping_Spec.md#7-deferred--related-concepts-explicitly-out-of-scope-here) | 148 | 1,003 |  |  | `specification_documents/backlog` |  |
| h2 | [§8. Test Strategy](SWU_Standard_Variant_Mapping_Spec.md#8-test-strategy) | 155 | 2,036 |  |  |  |  |
| h2 | [§9. Appendix — Confirmed Reference Examples](SWU_Standard_Variant_Mapping_Spec.md#9-appendix--confirmed-reference-examples) | 166 | 1,548 |  |  |  |  |
