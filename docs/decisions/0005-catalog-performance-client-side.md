# ADR-0005: Catalog performance — client-side payload-shrink + virtualization (not server-side pagination)

## Status
Accepted — 2026-06-27. **Implemented** (status corrected 2026-07-24, BL-150 W1): BL-44 shipped 2026-07-05; BL-56 shipped 2026-07-05; BL-70 shipped 2026-07-06; BL-73 stages 1-2 shipped 2026-07-11/2026-07-13 (BL-73 itself stays open in the backlog for further gallery-view work, unrelated to this ADR's decision)

## Context
The catalog (`base_cards`/`card_variants`) is now at full scale (~2,306 base cards, ~8,353 variants) and the Catalog view takes a few seconds to become usable. The slowness has two distinct costs that are easy to conflate:
1. **Fetch + parse + client-side grouping** of the payload, and
2. **Rendering** ~2,306 rows into the DOM at once (no virtualization).

Two code facts shape the decision:
- **`GET /api/cards` returns a flat list of ~8,353 variant rows, each carrying the full base-card data** — `name`, `subtitle`, `rarity`, `type`, `cost/power/hp/arena`, and the `aspects[]`/`keywords[]`/`traits[]` arrays are duplicated on *every* variant row even though there are only ~2,306 base cards (~3.6× redundancy). The client then groups those rows back down to base cards.
- A **nested base-card-with-variants shape already exists** for the single-card popup (`GET /api/base-cards/{id}` → `BaseCardDetail` with a `variants[]` array). A *list* version of that shape is therefore cheap to build.

A hard constraint: **filtering is client-side over in-memory data, and its instant response is a valued feature.** The faceted-filter design (BL-70) and the AND/OR toggle (BL-71) are specified client-side and depend on the full dataset being present in the browser.

Options genuinely considered:
- **(A) Status quo** — fix nothing. Filtering stays instant, but initial load stays slow and the DOM render stays janky.
- **(B) Client-side payload-shrink + virtualization** — add a base-cards-with-nested-variants *list* endpoint (shrinks the fetch and eliminates client-side grouping), and window the DOM render of the fully-loaded in-memory list.
- **(C) Server-side pagination + filtering** — fetch one page at a time. Fixes initial load most aggressively, **but filtering must move server-side** (you cannot client-filter data you have not fetched), which turns every filter change into a network round-trip to Cloud Run + Cloud SQL and **breaks the BL-70/BL-71 client-side faceting design**. Heaviest rework.

A DevTools measurement to attribute the lag precisely (fetch vs. parse vs. render) was deliberately treated as a *learning* exercise, not a gate — the decision is made on the code analysis above.

## Decision
Adopt **Option B — stay client-side**, with two levers, both scoped to v1.0:
1. **Payload-shrink:** add a `base-cards-with-nested-variants` **list** endpoint (reusing the existing `BaseCardDetail` shape). The client fetches ~2,306 base cards with nested variants instead of ~8,353 flat rows, removing the per-variant duplication of base-card data and eliminating the client-side grouping step. All data stays client-side, so filtering remains instant and faceting is preserved.
2. **Virtualization:** window the DOM render of the fully-loaded in-memory list (~30 rows rendered at a time), as a **continuous scroll** (not page controls); the scrollbar reflects the true full length.

Reject **Option C (server-side)** unless the catalog grows by an order of magnitude — its cost is the instant filter response and the client-side faceting, which are explicitly valued.

## Consequences
- **+** Preserves the instant client-side filtering and the BL-70/BL-71 faceting design — the thing most valued about the current build is untouched.
- **+** Fixes initial load: roughly half the bytes (base-card data deduped from ~8,353 to ~2,306 occurrences; per-variant image URLs stay), fewer objects to parse, and the client-side grouping pass is removed entirely.
- **+** Fixes render jank via windowing, independent of payload.
- **+** Low effort: the nested endpoint shape already exists for the popup, so payload-shrink is largely assembly, not new design.
- **+** A self-hosted-thumbnail path (BL-76) and the gallery view (BL-73) compose cleanly on top of this client-side model.
- **−** Initial load is *faster*, not *instant* — the client still downloads the whole (shrunk) base-card set up front. Truly minimal load would require Option C.
- **−** Bakes in the assumption that the entire catalog fits comfortably in browser memory. True at SWU's scale (a few thousand base cards) for years; an order-of-magnitude growth would force revisiting Option C and moving filtering server-side.
- **−** Virtualization adds a windowing dependency (e.g. react-window/TanStack Virtual) and the usual windowing caveats (variable row heights, scroll restoration, in-view measurement).
- **−** Does not address Cloud Run **cold-start** latency on the very first request after idle — that is a separate platform lever (`min-instances`), not a payload concern.

**Related:** BL-44 (perf epic / implementation), BL-70 + BL-71 (client-side faceting this protects), BL-56 (the unified catalog/inventory view this renders), BL-73 (gallery view), BL-76 (image hosting / thumbnails). Supersedes the "levers for later discussion" framing originally recorded in BL-44.

## Review trigger (added 2026-07-08, RR-24)

This decision is correct *at the current catalog size* — it has an expiry condition, not just a rationale. Baseline, measured 2026-07-08 against dev (`GET /api/base-cards`, anonymous):

| Metric | Value |
|---|---|
| Base-card rows | 2,306 |
| Payload, raw | 4,273,720 bytes (~4.1 MiB) |
| Payload, on the wire (since BL-99, 2026-07-10) | **~438 KB gzipped** — `GZipMiddleware` shipped; `Content-Encoding: gzip` verified surviving the prod Hosting rewrite, ~9.75× smaller |
| Payload if gzipped (level 6, measured offline 2026-07-08) | 476,440 bytes (~9.0× smaller) — the live default-level result came in slightly better (~438 KB) |
| Fetch time, decomposed (warm, prod Hosting path, 2026-07-10) | ~3.2 s TTFB + ~0.1 s transfer *(pre-BL-100)* — see the generation-bound note below |
| Fetch time after BL-100 (Core-rows rewrite, 2026-07-10) | **prod TTFB ~1.0 s + ~0.1 s transfer (was ~3.2 s — 3.2×)**; dev ~0.8 s (~4×); local generation 0.87 s → ~0.31 s (2.8×) |
| Fetch time after BL-101 (catalog/quantity split, 2026-07-10) | **prod warm CDN HIT: 0.32–0.40 s TTFB / ~0.7 s total** (fill ~1.9 s, once per deploy/`s-maxage`); browser tier (`max-age=300`) makes tab reopens zero-network for the catalog; quantities via auth-only `/api/inventory/quantities` (few KB). Full arc: ~3.2 s → ~0.35 s warm (~9×) |

Measurement method: `curl -s -o <file> -w "%{size_download}"` against the dev backend URL and the dev Hosting URL (`swu-dev-jbapps.web.app/api/base-cards`), with and without `Accept-Encoding: gzip`; gzip estimate via Python `gzip.compress(raw, 6)`; row count via `json.load` length.

**Compression note (discovered during this measurement):** nothing on the delivery path compresses this endpoint — FastAPI has no `GZipMiddleware`, Cloud Run does not auto-compress, and the Firebase Hosting rewrite forwarded the response uncompressed even when the client offered `Accept-Encoding: gzip` (no `Content-Encoding` header; `Content-Length` equals the raw size). `/api/base-cards` is also `private, no-store` by design (RR-3), so the CDN never absorbs it. Enabling response compression (~1 line of `GZipMiddleware`) is therefore the cheapest pre-trigger lever: it cuts the wire cost ~9× without touching this ADR's architecture. Tracked as **BL-85** *(originally filed as BL-82; renumbered 2026-07-08 during RR-25 — a parallel platform-retrospective session had independently claimed BL-82–84)*. **Shipped 2026-07-10 as BL-99** (BL-85 re-filed independently, then reconciled → BL-99 canonical).

**Generation-bound, not transfer-bound (discovered 2026-07-10):** after gzip shipped, `GET /api/base-cards` still felt no snappier — because decomposing the ~3.4 s load showed **~3.2 s is TTFB (backend generating the response) and only ~0.1–0.3 s is body transfer**. gzip optimized the ~6% that is transfer; the felt latency is server-side response generation, unchanged by compression. It is a different axis from this ADR's payload-size trigger — generation time, not payload growth — so it does not change the triggers below.

**BL-100 resolution (2026-07-10):** staged profiling (see `specification_documents/analysis/BL100_TTFB_Profile_2026-07-10.md`) attributed the cost precisely: **ORM hydration of ~10.7k mapped objects was 62%**; the suspected "double Pydantic pass" was innocent on FastAPI 0.138 (`response_model` re-validation ≈ 0 ms; serialization is Rust-side). Fix: the list endpoint now builds its response from **5 Core SELECTs** (plain rows, no ORM hydration — replacing 56 chunked selectinload queries), cutting local generation **0.87 s → ~0.31 s (2.8×)** with a byte-identical response. **Deployed & verified 2026-07-10 (PR #187):** prod TTFB **~3.2 s → ~1.0 s (3.2×)**, dev ~0.8 s (~4×) — cloud gains exceed local because the query-count drop also eliminates ~50 Cloud SQL round-trips. Remaining floor is assembly + serialization + gzip of the 4.3 MB payload — the next lever is on the *payload* axis (the catalog/quantity split noted below), not generation.

**BL-101 (2026-07-10, same session):** that split shipped — the list endpoint is now catalog-only (tenant-less by construction) and joined the RR-3 CDN-cached family, with per-tenant quantities on a lean auth-only `GET /api/inventory/quantities` merged client-side. This *strengthens* this ADR's client-side decision (the full catalog still ships to the browser and filters in memory) while removing its main cost — the per-visit fetch price. Baseline row above; details in `SWU_Backlog.md` BL-101.

**BL-146 sparse list split — measured 2026-07-25 against dev (2,319 base cards / 9,084 variants), git-stash A/B on the same code path, compact JSON, gzip level 9 (matches `GZipMiddleware`'s default):**

| Metric | Before | After | Change |
|---|---|---|---|
| Payload, raw | 7,492,348 bytes | 3,181,782 bytes | −57.5% |
| Payload, gzip | 717,680 bytes | 322,776 bytes | −55.0% |

**Correction to the RR-24 baseline above:** the "4,273,720 bytes (~4.1 MiB)" raw figure measured 2026-07-08 was **wrong** — the real pre-BL-146 raw payload was 7.49 MB, not 4.3 MB (measured at 2,306 rows then vs. 2,319 now, not enough card growth to explain the gap). Its gzip citation (~438 KB, close to this measurement's 717,680-byte "before" once the row-count difference and a stricter gzip level are accounted for) was in the right neighborhood, which is why the discrepancy went unnoticed — the raw number, not the wire number, was the one that undershot. **True pre-BL-146 wire compression was ~10.4:1, not the ~6:1 the RR-24 raw estimate implied.** The relative-percentage framing (raw shrinking roughly in proportion to dropped fields) still held up despite the absolute baseline being off.

**Revisit this ADR (client-side filtering over the full in-memory catalog) when any of:**
- raw `GET /api/base-cards` payload exceeds **10 MB** (≈2.4× today — roughly 5,600 base cards at current per-row weight), or
- base-card count exceeds **5,000**, or
- first-interactive on a mid-range phone over 4G exceeds **5 s** (spot-check at each set release).

At the current release cadence (~2–3 sets/year, ~300–500 base cards each), the count trigger is ~5+ years out; the payload trigger arrives sooner only if per-row weight grows (new fields/arrays), which is exactly what the check should catch. A five-minute re-measurement at each set release (same curl commands as above) answers "still fine?" objectively.
