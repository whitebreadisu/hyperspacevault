# ADR-0012: Self-host card images with pre-generated renditions, served same-origin

## Status
Accepted — 2026-07-11 (decision made with Jeremy; implementation tracked as BL-76, phased plan below)

**Amendment (2026-07-11, same day, decided with Jeremy during Phase 3):** the "additive path columns" element of the URL strategy is replaced by **read-time derivation** — Phase 2's implementation made the object paths a pure function of the stored CDN URL (`object_paths()`, verified against all 8,759 real URLs), so the API composes rendition URLs at serialization time with no schema change, no migration, and **no seed regeneration**. The bucket's content is created by the same function, so stored reality cannot diverge from the rule today; if a no-CDN-source world ever arrives (e.g. new sets self-hosted-first), adding a path column *then* is exactly the additive migration it would have been now. Provenance and rollback properties are unchanged (original CDN URLs remain the stored truth). Decision heuristic recorded: *store data when rows may need to disagree with the rule; derive when the rule is universal by construction.*

## Context
The app stores card-image **URLs**, not binaries; every URL points at the official SWU CDN (`https://cdn.starwarsunlimited.com/...`), and browsers hit that host directly on every render. That is a hard external dependency on an asset host we don't control: an outage, URL restructuring, or hotlink-blocking breaks every image in the app at once (DR concern, relates to BL-21), with a mild ToS concern at scale.

The dependency's blast radius grew this week: BL-62 (shipped 2026-07-11) made the Add Cards modal image-driven, BL-63 (image as add/won't-add cue) and BL-73 (gallery view — the table as a grid of card images) are queued behind it, and Jeremy plans a mobile-friendly version. A gallery screenful is ~30 simultaneous image loads; the app is becoming image-heavy right as the image supply chain remains someone else's.

**Measured facts (dev DB + CDN, 2026-07-11):**
- 8,363 variants → **8,342 distinct front images** + 417 backs ≈ **~8,760 files, ~1.75 GB** at the CDN's ~200 KB/PNG.
- ⚠️ This **corrects the BL-76 backlog entry's premise** that art-sharing makes distinct images ≪ variant count — URL-level dedupe is only the ~21 Serialized Prestige senator rows. Every printing (incl. foils) has its own CDN file.
- Full-size PNGs are ~10× the bytes any card-sized UI slot can display: a 320 px WebP of the same art is ~25 KB.

Options considered for **serving**:
- **(A) Status quo** — keep hotlinking. Zero work; keeps the DR exposure and forfeits thumbnails.
- **(B) Direct public GCS** — URLs point at `storage.googleapis.com/<bucket>/...` with immutable cache headers. Simplest self-hosting; third-party-looking origin; Google edge-caches public objects but without a contractual CDN.
- **(C) Same-origin via Firebase Hosting rewrite** — `swu.jeremybradenapps.com/images/...` → Hosting rewrite → small Cloud Run handler → GCS, with long-lived `Cache-Control` so the Firebase CDN edge-caches every object. This is the **proven BL-101/ADR-0005 pattern** (catalog list CDN caching, 0.35 s warm hits). Costs a thin serving path + cold-start on cache miss.
- **(D) Cloudflare R2 + CDN** — free egress, real CDN, but a second cloud vendor and credential estate outside GCP/terraform. Off-pattern.

For **renditions**, on-demand resizing in the Cloud Run handler was considered and rejected: the image set is small, finite, and immutable, so pre-generating at mirror time is deterministic, avoids per-request image compute and cold-start work, and costs pennies. On-demand transform earns its complexity with unbounded or unpredictable image sets — not this one.

## Decision
Self-host card images in **per-environment GCS buckets** (dev/prod, matching the terraform per-env pattern), mirrored at ingestion time, with **three renditions per image** — original PNG + **640 px and 320 px WebP** — exposed to browsers via `srcset` so each device pulls the smallest file that satisfies the slot × screen density (the mobile-friendly ambition is what settled the 3-tier set: high-DPR phones need the 640 tier that desktop doesn't). Serve **same-origin (option C)** through a Firebase Hosting rewrite to a thin Cloud Run handler over GCS, with immutable cache headers so the Firebase CDN does the heavy lifting.

**URL strategy is additive:** new columns store our object paths and the API composes full URLs from per-env config; the original `cdn.starwarsunlimited.com` URLs remain in place as provenance and the re-mirror source. Rollback is a config flip; adding a fourth rendition later is a script re-run over stored originals.

Selection rationale (Jeremy, 2026-07-11): same-origin serving over direct GCS for the true CDN edge + origin consistency, reusing the pattern the platform already trusts; per-env buckets for terraform symmetry (backfill is a cheap script, running it twice is fine); 3-tier renditions per his call to "store however many images to get the maximum performance in all situations"; additive URLs for provenance and trivial rollback.

## Consequences
- **Implementation phases (BL-76):**
  1. **Terraform** — per-env buckets (uniform access, public read via the handler's SA or direct, default `Cache-Control: public, max-age=31536000, immutable`; objects are immutable by convention — a changed image is a new path).
  2. **Mirror + renditions** — ingestion gains download → Pillow (640/320 WebP) → upload; plus a one-time **backfill** of the ~8,760 existing images, rate-limited ~3 req/s against the official CDN (~50 min/env), with loader-style conservation checks (every URL mapped or flagged, never silently skipped).
  3. **Serve switch** — schema adds path columns (additive migration); API exposes rendition URLs; **catalog seed regeneration required** (catalog-data change); frontend adopts `srcset` (Add Cards preview, popups; gallery arrives with BL-73).
  4. **Verify & close** — prod backfill, images verified serving same-origin, BL-76 closed.
- The official CDN becomes a **source**, not a runtime dependency: ingestion still reads it; browsers never do.
- Storage ≈ 2.5 GB/env (~$0.05/mo); egress at card-thumbnail sizes is fractions of a cent per heavy user. Cost is not a factor.
- The Cloud Run handler is in the serving path for cache-miss requests only; a miss storm (cold region) is bounded by catalog size.
- BL-73's gallery inherits a ~85% bandwidth cut (≈0.75 MB/screenful vs ≈6 MB) without further work.
