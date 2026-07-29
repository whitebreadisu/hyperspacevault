# HISTORY

The shape of this project's development, distilled from the engineering backlog's
resolution ledger. Each line is a completed work item (title and resolution date);
the full working records — analysis docs, decision definitions, session logs —
live in a private engineering archive, referenced from public docs by their
BL-ids.

## Milestones

| Date | Milestone |
|---|---|
| 2026-05-09 | First commit — spec-first build begins (CSV-era prototype) |
| 2026-05-23 | Inventory view + filter panel shipped (first working slices) |
| 2026-06-14 | Platform program complete — GCP, Terraform, RLS tenancy, CI/CD, observability, security hardening (P1–P7) |
| 2026-06-21 | Catalog redesign shipped: swuapi-sourced catalog, two-axis variant model, full UI redesign |
| 2026-07-05 | Unified Cards experience (catalog + inventory merged) — built via multi-agent orchestration |
| 2026-07-11 | Self-hosted card images (GCS + WebP renditions) live in prod |
| 2026-07-13 | Full visual restyle shipped across all screens |
| 2026-07-14 | **v1.0 shipped** · content runbook first executed end-to-end |
| 2026-07-20 | Auth epic complete: password reset + Google sign-in live |
| 2026-07-22 | Pricing + deck check live: daily TCGplayer-data sync, 3.4M-row price history |
| 2026-07-25 | Inventory import/export shipped (canonical format, cross-tenant round-trip proven) |
| 2026-07-27 | Price coverage 92.9% — Prestige/Showcase/Weekly Play finishes mapped |
| 2026-07-29 | FFG card-data offload: exports moved out of git to private storage |

## Resolution ledger


### June 2026 — 27 items resolved

- `2026-06-14` **BL-1** — Create `specification_documents/SWU_Platform_Spec.md`
- `2026-06-15` **BL-12** — Spec-vs-implementation reconciliation for `SWU_ClaudeCode_Spec.md`
- `2026-06-15` **BL-2** — Slim `SWU_Platform_Roadmap.md`
- `2026-06-15` **BL-3** — Retire original Learning Guide docx; rename Platform Learning Guide
- `2026-06-15` **BL-4** — Update `README.md`
- `2026-06-15` **BL-5** — Add CLAUDE.md file aliases for new docs
- `2026-06-15` **BL-6** — Backend linting/formatting
- `2026-06-15` **BL-7** — Frontend linting/formatting
- `2026-06-15` **BL-9** — Dependabot PR backlog triage
- `2026-06-17` **BL-18** — Frontend tab switching — keep pages mounted
- `2026-06-21` **BL-27** — Additional card variant types (Judge, Showcase, Prerelease Promo, etc.)
- `2026-06-21` **BL-31** — Card detail popup — consolidated representation for stamp-only variants
- `2026-06-24` **BL-47** — Documentation reconnaissance & cleanup
- `2026-06-24` **BL-49** — Absorb API/ingestion/architecture into the Application Spec
- `2026-06-27` **BL-10** — `card_keywords` / `sub_text` / `is_unique` data gaps
- `2026-06-27` **BL-14** — Conversation — understanding commits, pushes, and PRs
- `2026-06-27` **BL-19** — Add new card sets to catalog
- `2026-06-27` **BL-20** — Import/export inventory
- `2026-06-27` **BL-33** — Catalog schema redesign — `base_cards`/`card_variants` split, swuapi-id-keyed sync, scoped sequencing
- `2026-06-28` **BL-43** — Cloud dev environment — robust dev→prod pipeline
- `2026-06-28` **BL-59** — Remove the Decks tab until the deck feature ships
- `2026-06-28` **BL-63** — Add Cards — use the card image as the add/won't-add cue (extends BL-62)
- `2026-06-28` **BL-64** — Add Cards — clearer live inventory feedback (replace "Headroom: 1 of 1")
- `2026-06-28` **BL-65** — Add Cards — remove extraneous helper copy
- `2026-06-28` **BL-67** — Add Cards — provenance-default bug (JTL #1 → Retail despite collision)
- `2026-06-28` **BL-71** — Per-filter AND/OR toggle for multi-select filters (keywords, traits)
- `2026-06-28` **BL-72** — Filter layout — stop unnecessary elongation; wrap only when content won't fit

### July 2026 — 73 items resolved

- `2026-07-05` **BL-56** — Unify Catalog & Inventory into one list (supersedes BL-17)
- `2026-07-10` **BL-100** — `/api/base-cards` response-generation latency (~3.2 s TTFB)
- `2026-07-10` **BL-101** — Catalog/quantity split — CDN-cacheable `/api/base-cards`
- `2026-07-10` **BL-102** — Retire runtime-dead read endpoints (`GET /api/cards*`, `GET /api/inventory`)
- `2026-07-10` **BL-16** — Authentication hardening — email verification on signup
- `2026-07-10` **BL-22** — User settings page scaffolding
- `2026-07-10` **BL-23** — Change password from settings
- `2026-07-10` **BL-87** — Delete account permanently from settings
- `2026-07-10` **BL-90** — Aspect filter — empty-selection semantics and unreachable no-aspect cards
- `2026-07-10` **BL-91** — "Reset all filters" button
- `2026-07-10` **BL-95** — In-app email-verification landing
- `2026-07-10` **BL-99** — API response compression (gzip)
- `2026-07-11` **BL-61** — Add Cards — preserve batch across set changes (cross-set batch)
- `2026-07-11` **BL-62** — Add Cards — live card-image preview on entry
- `2026-07-11` **BL-92** — One-time tenant purge — v1.0 clean slate
- `2026-07-12` **BL-76** — Card image hosting strategy / DR (self-host vs. hotlink official CDN)
- `2026-07-13` **BL-114** — vite dev proxy intercepts `/images/*` statics — dev-only 404s for set logos/starfields/tile
- `2026-07-13` **BL-115** — Wire (or drop) the sidebar's "Only cards with no inventory" checkbox
- `2026-07-13` **BL-68** — SWU-styled banner / section-separator image
- `2026-07-13` **BL-69** — Info bubble on the completion calculations
- `2026-07-13` **BL-73** — Gallery view — toggle table ↔ grid of card images
- `2026-07-13` **BL-74** — Card detail popup — layout for many-variant cards
- `2026-07-13` **BL-75** — Card detail popup — "Base Set (Sub-set)" display for non-base-set variants
- `2026-07-14` **BL-104** — Privacy note — what's stored, where, and how to leave
- `2026-07-14` **BL-113** — Research: swuapi content delta check + durable new-content runbook
- `2026-07-16` **BL-132** — UI polish batch #2 — name-cell click target, absent-stat badge suppression, leader flip animation
- `2026-07-16` **BL-133** — Two-tier finish filter — grouped finishes with expandable subgroups
- `2026-07-20` **BL-117** — Auth provider strategy + account-linking design (keystone spike)
- `2026-07-20` **BL-118** — Google sign-in
- `2026-07-21` **BL-138** — In-app rebrand to HyperspaceVault — name-surface sweep
- `2026-07-22` **BL-109** — Research: inventory import/export landscape + canonical format proposal
- `2026-07-24` **BL-106** — Decide prod `min_instances = 1` vs. scale-to-zero cold start on first image view
- `2026-07-24` **BL-108** — Decide verified-email gate on settings mutations
- `2026-07-24` **BL-110** — Research — deck import/export formats across SWU platforms
- `2026-07-24` **BL-136** — Card pricing — backend arc (TCGCSV ingestion, mapping layer, price APIs, history backfill)
- `2026-07-24` **BL-137** — Deck check — backend arc (intake, SET_NUM resolution, three-scope diff, cost + cart)
- `2026-07-24` **BL-139** — BL-136 completion — price-sync scheduler, history backfill run, list-latency investigation
- `2026-07-24` **BL-140** — Pricing UI v1 — price block + history on the card detail / inventory popups
- `2026-07-24` **BL-141** — Pricing UI v2 — list/gallery + completion-header price surfaces (deferred)
- `2026-07-24` **BL-142** — Deck Check UI — top-level navigation item, entry + result screens
- `2026-07-24` **BL-143** — Navigation rename — 'Inventory' → 'Vault'
- `2026-07-24` **BL-144** — FilterPanel — collapsed by default unless side-by-side fits
- `2026-07-24` **BL-147** — Global UI scale — default view reads like 125% browser zoom
- `2026-07-24` **BL-148** — Card popup — prev/next navigation through the current filter result
- `2026-07-24` **BL-151** — Bulk add from preconstructed decks (Add Cards modal)
- `2026-07-24` **BL-152** — SWU button hover animation (deep-navy rest + warm edge flare)
- `2026-07-24` **BL-26** — Claude.ai design-system sync workflow — inspection needed
- `2026-07-24` **BL-30** — Bulk-add a pre-built product to inventory (IBH / Twin Suns / Starter Decks)
- `2026-07-24` **BL-32** — Inline inventory editing — consolidated entry for tournament-tier variants
- `2026-07-24` **BL-57** — "Create an account & here's what you get" value-prop popup
- `2026-07-24` **BL-58** — Revisit default column widths
- `2026-07-25` **BL-103** — Extend the BL-78 docs-only CI filter to `.design-sync/**`
- `2026-07-25` **BL-149** — Dev pricing-data reconciliation + mapping-run papercuts
- `2026-07-25` **BL-154** — Frontend API error-shape convention
- `2026-07-25` **BL-156** — Alerting round 2: cover the post-P6 surfaces
- `2026-07-25` **BL-159** — price-sync silently collapses shared-key variant groups
- `2026-07-25` **BL-54** — Inventory import/export (user-facing)
- `2026-07-25` **BL-93** — Retire inventory seed/snapshot machinery
- `2026-07-25` **BL-96** — Risk-gate semantics gap: merged-label check vs. whole-build promotion
- `2026-07-25` **BL-98** — Programmatic risk-tiering & autonomy rubric
- `2026-07-26` **BL-155** — CardPopup decomposition
- `2026-07-26` **BL-161** — Rarity image everywhere rarity displays
- `2026-07-26` **BL-162** — Card-list inventory column → full removal (playset merge + hover dossier)
- `2026-07-26` **BL-163** — Vault completion panel revamp
- `2026-07-26` **BL-164** — Add Cards set/precon dropdown restyle + reorder
- `2026-07-26` **BL-165** — Header starfield: random set pick per app open
- `2026-07-26` **BL-166** — TS26 set logo missing (broken image in both Add Cards pickers)
- `2026-07-26` **BL-167** — CI docs-only trigger gate
- `2026-07-26` **BL-169** — Go-public analysis & plan
- `2026-07-27` **BL-172** — The flip + post-flip hardening & validation
- `2026-07-27` **BL-173** — Cards-table variant scope + Unit Value column
- `2026-07-27` **BL-174** — Price mapping for Prestige / Showcase / Weekly Play finishes
- `2026-07-29` **BL-170** — FFG asset & dataset offload to private storage


---

*100 resolved items as of 2026-07-29. Generated from the backlog ledger;
regenerated at each release-notes cycle.*
