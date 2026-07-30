# SWU Platform Security Review (P7 Stage 4)

**Date:** 2026-06-14
**Scope:** OWASP Top 10 (2021) walkthrough of the SWU Inventory Manager backend/frontend, plus a secrets and network review of the `swu-prod` GCP project.

This is the "wrap-up audit" for P7 — a deliberate, point-in-time pass over the application's security posture, written as a document rather than a deploy. It records what's addressed (and how/where), and what's knowingly deferred along with the residual risk. Re-review when the auth/tenancy/infrastructure surface changes meaningfully.

**This is a living review.** The walkthrough below is the original 2026-06-14 point-in-time pass and is left intact as the historical baseline. BL-56 (shipped 2026-07-05) meaningfully changed the auth surface it describes — see the **2026-07-07 Revision** immediately below for the current, re-verified state of A01, A04, and A05. BL-16 (shipped 2026-07-10) added an email-verification gate on inventory mutations — see the **2026-07-10 Revision** for the current state of A07. BL-102 retired the `GET /api/cards*`/`GET /api/inventory` routes and BL-76 added the anonymous `/images/` serving surface — see the **2026-07-12 Revision** for the current route inventory and the image-handler assessment. BL-137's deck-check server-fetch, the BL-54 import/export surface, BL-88's account-deletion recency gate, and BL-53/BL-157's rate-limiting + security-headers wave — see the **2026-07-24 Revision** for the current state of A10, the now-Addressed A04 posture (rate limiting + import hardening), and A07's account-deletion hardening; its two residual `needs-live-check` items were closed in the **2026-07-30 Addendum** (post-promote header capture on the `hyperspacevault.com` front door + Firebase Auth abuse-settings review). Where revisions disagree with the historical baseline, **the latest dated revision is authoritative** — in particular, any sentence below still asserting "every `/api/*` route requires authentication uniformly" or naming `GET /api/cards`/`GET /api/cards/{id}` as a live route describes the pre-BL-56/pre-BL-102 system, not today's.

## 2026-07-07 Revision — Anonymous Catalog Surface (BL-56)

**Trigger:** BL-56 (shipped 2026-07-05) made the catalog reads anonymous — `GET /api/cards`, `GET /api/cards/{id}`, `GET /api/sets`, `GET /api/sets/{code}` now run on a tenant-less DB dependency (`get_catalog_db`), and `GET /api/base-cards` / `GET /api/base-cards/{id}` run on an optional-auth dependency (`get_optional_db`). This invalidates the 2026-06-14 walkthrough's central A01 claim ("every `/api/*` route requires authentication uniformly"). Full design rationale and rejected alternatives: [ADR-0008](../docs/decisions/0008-anonymous-catalog-reads.md). Mechanism reference: `SWU_Platform_Spec.md` §1.1/§1.3.

**Superseded 2026-07-10 (read this before the rest of this section):** `GET /api/cards` and `GET /api/cards/{id}` named above were retired outright by BL-102 (runtime-dead since BL-56/BL-44) — they do not exist in the current route table. The 2026-07-12 Revision below is explicit about this; this paragraph is left as-written (historical) rather than silently edited, per this document's own revision policy.

### A01:2021 – Broken Access Control — Re-verified, Addressed (revised access model)

- `GET /api/cards`, `GET /api/sets`, and `GET /api/base-cards*` are now **intentionally** public — this is a deliberate BL-56 design decision (public catalog / conversion-funnel UX), not a regression. `GET /api/inventory` and every mutation (`/api/inventory/*` increment/decrement/etc.) remain on `get_db` and are unaffected — still `401` without a valid token.
- **Live-verified against prod** (`https://swu.jeremybradenapps.com`, the Firebase Hosting domain real users hit — `/api/**` rewrites to Cloud Run):
  - `curl -s -o /dev/null -w "%{http_code}" https://swu.jeremybradenapps.com/api/cards` → **`200`**, no `Authorization` header sent.
  - `curl -s -o /dev/null -w "%{http_code}" https://swu.jeremybradenapps.com/api/sets` → **`200`**, no `Authorization` header sent.
  - `curl -s -o /dev/null -w "%{http_code}" https://swu.jeremybradenapps.com/api/inventory` → **`401`**, body `{"detail":"Missing or invalid Authorization header"}` — unchanged from the 2026-06-14 baseline.
- **Live-verified against the raw Cloud Run backend** (`https://backend-qsolsepaya-uc.a.run.app`, same methodology as the 2026-06-14 pass):
  - `GET /api/cards` with no `Authorization` header → **`200`**.
  - `GET /api/base-cards?limit=1` with no `Authorization` header → **`200`**, and every returned variant's `"quantity"` field is **`0`** — confirmed by inspecting the response body, matching ADR-0008's documented behavior for an anonymous caller (RLS yields zero `inventory` rows for a tenant-less session; this is "not signed in," not "you own zero").
  - `GET /api/inventory` with no `Authorization` header → **`401`**.
  - `GET /api/inventory` with `Authorization: Bearer notarealtoken` (present-but-invalid token) → **`401`** — confirms the optional-auth/tenant-less dependencies do not silently downgrade a bad token to anonymous; a bad token still fails closed everywhere, per ADR-0008.
- **RLS fail-safe reasoning (ADR-0008), re-verified from the migration history rather than a live probe (no way to directly observe Postgres session state from outside):** the same `swu_app` role serves `get_db`, `get_catalog_db`, and `get_optional_db`'s anonymous branch. Migration `0023` changed the `tenant_isolation` policy's fallback from `COALESCE(current_setting('app.current_tenant_id', true)::integer, 1)` (which would have leaked tenant 1's `inventory` to any tenant-less session) to a `NULLIF(...)` form under which an unset **or** explicitly-cleared tenant matches **zero** rows. Because `AppSessionLocal` connections are pooled, `get_catalog_db`/`get_optional_db` explicitly clear both session GUCs (`app.current_firebase_uid`, `app.current_tenant_id`) to `''` on every checkout rather than relying on "a fresh connection never sets them" — otherwise a pooled connection previously used by an authenticated request could leak that tenant's data to a later anonymous request on the same connection. This is defense-in-depth beneath the app-layer routing decision (which dependency a route uses); a bug that accidentally hung `get_catalog_db` off `/api/inventory` would still be blocked by RLS returning zero rows, not by the app layer alone.
- Everything else in the original A01 section (RLS on `inventory`/`users`, `swu_user` vs. `swu_app` role separation) is unchanged and still accurate.

### A04:2021 – Insecure Design — Re-verified; residual risk widened

- The original A04 deferral ("no application-level rate limiting," tracked as `SWU_Backlog.md` **BL-53**) now carries materially more exposure than it did on 2026-06-14: the deferral was written when *every* `/api/*` route required a Firebase account, which itself throttled abuse (an attacker needed at least a free Firebase sign-up per burst). Since BL-56, `GET /api/cards`, `GET /api/sets`, and `GET /api/base-cards*` are reachable by **any anonymous internet client**, with no account, no token, and no per-caller identity to key a future rate limit on beyond IP — the account-creation friction that implicitly rate-limited abuse before BL-56 no longer applies to the catalog surface.
- **In-flight mitigations** (both filed in the 2026-07-06 repo review, neither shipped as of this revision):
  - **RR-2** (issue #128) — Cloud Run `max_instance_count` + a GCP billing budget alert. Bounds the worst-case cost/scaling blast radius of an anonymous-endpoint abuse burst; doesn't reduce request volume, but caps what it can cost.
  - **RR-3** (issue #129) — `Cache-Control` headers on the strictly-anonymous catalog endpoints so Firebase Hosting's CDN serves repeat anonymous requests from the edge instead of reaching Cloud Run/Cloud SQL at all. This is the highest-leverage mitigation for the *volume* side of the widened exposure (most anonymous traffic never reaches the app layer to begin with), but explicitly must **not** apply to `GET /api/base-cards*` (`private, no-store` — it carries per-tenant `quantity` data for authenticated callers).
- **BL-53 itself remains open** (no rate-limiting control exists yet). This revision's contribution is scoping the risk correctly, not closing it: rate limiting is more relevant post-BL-56 than the original deferral assumed, and RR-2/RR-3 blunt but do not eliminate the gap — neither one rate-limits anything; they change what an unlimited request volume costs and how much of it reaches the backend at all.
- The original A04 CSRF reasoning (`Authorization: Bearer` only, no ambient credential) is unchanged and still accurate — it applies identically to authenticated and anonymous requests.

### A05:2021 – Security Misconfiguration — Re-verified, Addressed

- **Docs-disabled-in-prod re-verified**, same methodology as 2026-06-14 (direct against the Cloud Run backend, since Firebase Hosting's `/api/**` rewrite doesn't route `/docs`/`/openapi.json` at all — hitting them through `swu.jeremybradenapps.com` returns Hosting's own 404, not a backend response, which would understate the check):
  - `curl -s -o /dev/null -w "%{http_code}" https://backend-qsolsepaya-uc.a.run.app/docs` → **`404`**.
  - `curl -s -o /dev/null -w "%{http_code}" https://backend-qsolsepaya-uc.a.run.app/openapi.json` → **`404`**.
  - `curl -s -o /dev/null -w "%{http_code}" https://backend-qsolsepaya-uc.a.run.app/health` → **`200`** — still the one intentionally open route, unaffected by BL-56 (it isn't under `/api/*`).
- **CORS commentary unchanged.** `allow_origins=["http://localhost:5173"]` is still dev-only; the production frontend still calls `/api/*` same-origin via the Firebase Hosting rewrite and never triggers CORS. BL-56 didn't touch `main.py`'s CORS configuration. (The now-inert `allow_credentials=True` was subsequently removed 2026-07-08 per **RR-23** — the API is Bearer-token only, no cookie ever carries the session, so the flag granted nothing. The 2026-06-14 baseline below describes the pre-removal configuration.)

### Summary of this revision

| Category | 2026-06-14 status | 2026-07-07 status |
|---|---|---|
| A01 Broken Access Control | Addressed (uniform auth on all `/api/*`) | Addressed — **revised access model**: catalog reads (`/api/cards`, `/api/sets`, `/api/base-cards*`) intentionally anonymous/optional-auth (BL-56, ADR-0008); `/api/inventory` and mutations unchanged (still `401`-gated); RLS fail-safe re-verified via migration 0023. *(Update 2026-07-10, BL-101: the base-cards list is now strictly tenant-less and CDN-cached — its per-tenant quantities moved to the auth-gated `GET /api/inventory/quantities`; only the base-cards detail route remains optional-auth. BL-102 then retired the runtime-dead `GET /api/cards*` and heavy `GET /api/inventory` outright — anonymous surface shrank to `/api/sets*` + the base-cards list.)* |
| A04 Insecure Design | Addressed; rate limiting deferred (low severity, authenticated-only surface) | Addressed; rate limiting deferred, **residual risk widened** — deferral now covers unauthenticated internet traffic, not just known accounts; BL-53 open; RR-2/RR-3 in flight |
| A05 Security Misconfiguration | Addressed | Addressed — docs-disabled-in-prod and CORS re-verified unchanged |

## 2026-07-10 Revision — Email Verification Gate (BL-16)

**Trigger:** BL-16 (shipped 2026-07-10) added a second, stronger authorization check on top of the existing "valid token → authenticated" model. `verify_firebase_token` now returns `(firebase_uid, email, email_verified)` — the third element is the decoded token's `email_verified` claim, defaulted to `False` when the claim is absent (never an implicit pass). A new dependency, `require_verified_email`, composes off `get_current_identity` (no double token verification — FastAPI's per-request dependency cache) and rejects with `403 {"detail": "email_not_verified"}` when that claim is falsy. This refines, but does not contradict, the A01 revision above's claim that "`GET /api/inventory` and every mutation remain on `get_db` and are unaffected — still `401`-gated": that remains true (a missing/invalid token is still `401`), but the two inventory-mutating routes now carry an *additional* `403` layer beyond plain token validity.

### A07:2021 – Identification and Authentication Failures — Re-verified, Addressed (verification-gated mutations)

- `POST /api/inventory/{id}/increment` and `.../decrement` (the only inventory-mutating routes) now require both a valid token (`401` otherwise, unchanged) **and** a verified email (`403 {"detail": "email_not_verified"}` otherwise, new). `GET /api/inventory`, catalog endpoints, and `DELETE /api/account` (BL-87) are deliberately **not** gated on verification — an unverified user must still be able to browse their inventory and delete their own account; gating account deletion would strand it with no way to reverse course.
- The frontend calls `sendEmailVerification()` immediately after `createUserWithEmailAndPassword` on signup, and shows a persistent, dismiss-proof `VerifyEmailBanner` for any signed-in user whose token still says unverified — with a rate-limited Resend action and an "I've verified" recheck (`user.reload()` + `getIdToken(true)`, forcing a fresh token so the backend's next request sees the updated claim rather than a stale cached one).
- This closes the gap the 2026-06-14 baseline's A07 section didn't address: prior to BL-16, any syntactically-valid email could sign up, get auto-provisioned a tenant, and manage inventory immediately with no verification step at all (tracked as the accepted interim trade-off in `SWU_Backlog.md`'s BL-16 entry, now resolved).
- Everything else in the original A07 section (Firebase-owned credential storage, `verify_id_token`'s full signature/expiry/issuer/audience check, short-lived tokens with transparent refresh, tenant auto-provisioning) is unchanged and still accurate.

### Summary of this revision

| Category | 2026-06-14 status | 2026-07-10 status |
|---|---|---|
| A07 Auth Failures | Addressed (token validity only) | Addressed — **verification-gated mutations**: `email_verified` claim now required (`403`) for inventory-mutating routes only, on top of unchanged token validity (`401`) |

---

## 2026-07-12 Revision — Endpoint Retirement (BL-102) + Self-Hosted Image Serving (BL-76 / ADR-0012)

**Trigger 1 — BL-102 (2026-07-10):** the `GET /api/cards*` family and the heavy `GET /api/inventory` list were **retired outright** (runtime-dead since BL-56/BL-44). Where earlier revisions name those routes (the 2026-07-07 revision's curls, the 2026-07-10 revision's "not gated" list), read them as historical — the anonymous read surface they verified is now `GET /api/sets*` + `GET /api/base-cards` (list), the optional-auth surface is `GET /api/base-cards/{id}`, and the auth-gated read is `GET /api/inventory/quantities`. The security *properties* those revisions verified (anonymous fail-safe via migration 0023's RLS `NULLIF` policy; present-but-invalid token → `401`; verification gate on mutations only) carry over unchanged to the surviving routes — the retirement removed endpoints, it did not alter any auth mechanism.

**Trigger 2 — BL-76 Phases 1–4 (shipped 2026-07-11/12):** a **new anonymous surface**: `GET /images/cards/{filename}`, the same-origin card-image handler (Firebase Hosting rewrites `/images/**` to Cloud Run; as-built reference `SWU_Platform_Spec.md` §3.16). Assessment:

- **A01 (access control):** anonymous by construction, deliberately — the route takes no auth dependency and touches no tenant-scoped data; its response is a pure function of the filename (an immutable GCS object's bytes, or a redirect derived from the filename string). Public `Cache-Control` is therefore safe under the same invariant that governs the base-cards list (`http_cache.py`: response bytes independent of `Authorization`).
- **A03-adjacent (path handling):** `filename` must decompose into a stem matching a strict character-class regex plus one of three known suffixes; no dots allowed in stems (rules out `..` traversal) and Starlette's `{filename}` convertor rejects literal and encoded `/`. Malformed or probing input → `404`, indistinguishable from not-found.
- **SSRF/open-redirect:** the miss-path 307 target is built by string concatenation onto the **fixed official-CDN origin** (`https://cdn.starwarsunlimited.com`) — caller input can influence only the path segment, never the host, so the redirect cannot be aimed at an arbitrary origin.
- **Bucket exposure:** the GCS bucket is not publicly readable (uniform bucket-level access; only the `backend_runtime` SA holds `objectViewer`) — the handler is the sole read path, so the public surface is exactly the route's contract, not the bucket.
- **Cost/abuse (A04-adjacent):** an anonymous, CDN-cached byte-serving route is a bandwidth-amplification target in theory; in practice the `immutable, max-age=1y` header pushes repeat traffic to the Firebase CDN edge, and Cloud Run scaling stays capped by RR-2 (prod max 3 instances). Rate limiting remains the standing deferred item (BL-53) — this route joins its scope.

| Category | Prior status | 2026-07-12 status |
|---|---|---|
| A01 Broken Access Control | Addressed (BL-56/BL-16 revisions) | Addressed — retired routes removed from the surface; new `/images/` route anonymous **by construction** (no auth dependency, no tenant data, filename-pure response) |
| A04 Insecure Design | Rate limiting deferred (BL-53) | Unchanged — `/images/` added to BL-53's scope; edge caching + RR-2 instance caps bound the abuse cost meanwhile |

---

## 2026-07-24 Revision — Post-Auth/Pricing/Import Surface (BL-150 Phase A audit + Phase C Wave 3)

**Trigger:** BL-150's Steadying Arc ran a dedicated static/read-only security audit spike (Phase A, spike A4 — `specification_documents/analysis/BL150_Audit_Security_2026-07-24.md`, full findings list A4-01..A4-14) over every surface added since the 2026-07-12 revision above: the pricing/deck-check arc (BL-136/BL-137/BL-139/BL-146) and the import/export arc (BL-54). Phase B triage (same day) dispositioned every finding; a subset shipped same-night in Phase C Wave 3. This revision folds in both the audit's findings and what actually landed by the time this revision was written — **treat the disposition column below, not the audit report, as current** where they disagree.

### A10:2021 – Server-Side Request Forgery (SSRF) — correction: Applicable, Mitigated (was "Not applicable")

The 2026-06-14 historical baseline below (and every revision since) has carried A10 as "Not applicable — no backend code fetches a client-supplied URL." That became **wrong**, silently, when **BL-137** (deck-check, merged 2026-07-16, prod 2026-07-22) shipped `POST /api/deck-check`, which does exactly that — no revision here ever corrected it until the BL-150 Phase A doc-reconciliation spike caught it (finding A1-12) and fixed `SWU_Platform_Spec.md` §5.1 in Wave 1 (PR #431, 2026-07-24). This revision brings this document into agreement with the Platform Spec, which is now the accurate one:

- **`app/services/deck_fetch.py`** enforces a strict host allowlist (`swubase.com`/`www.swubase.com`, `sw-unlimited-db.com`/`www.sw-unlimited-db.com`; any other host raises before a network call is made); the fetch URL is always **rebuilt** from the allowlisted host + an id extracted from the pasted URL, never the client-pasted URL passed through verbatim; `httpx.Client(follow_redirects=False)` so a 3xx response is never chased on- or off-allowlist; a 10s timeout and a streamed ~1MB response-size cap. `SWU_Application_Spec.md` §12/§5.11 documents the allowlist as the deliberate mitigation.
- Verdict: **Applicable, Mitigated** — the category applies (a real client-influenced fetch exists), and the mitigation is sound by design (host allowlist + no-redirect-follow + rebuilt-not-passthrough URL + size/time bounds), not merely "not yet exploited." A4-13 (below) separately flags that this endpoint carries no per-tenant call quota — an amplification/cost concern, not an SSRF gap.

### A04:2021 – Insecure Design — Re-verified, Addressed (rate limiting + import hardening shipped)

The A4 audit's highest-priority finding was the **import upload path** (`POST /api/inventory/import`, BL-54): defenses were found structurally sound (10MB/20,000-row pre-parse caps, transactional commit, server-derived tenant scoping — never a "best-effort" parse), with four residual gaps (A4-01 through A4-04). By the time this revision was written, three of the four residual-gap items had shipped, in two waves the same night: BL-158 (PR #436 — CSV formula-escape, abuse-test suite) and BL-53/BL-157 (PR #437 — per-tenant rate limits on import/deck-check, `deck_json` size cap, stream-guard + single-parse on import, the proxy-IP fix, and app-layer security headers). This **closes the standing A04 rate-limiting deferral** the 2026-06-14 baseline and the 2026-07-07 revision both carried as open — see the findings table below for the exact disposition of each residual item, and `SWU_Platform_Spec.md` §5.1/§3.5/§5.4 for the as-built mechanism.

### A07:2021 – Identification and Authentication Failures — Re-verified, Addressed (destructive-op recency gate)

**BL-88** (merged 2026-07-24, PR #432 + ruff-format follow-up #434) closes the one actionable observation the 2026-06-14 review's original BL-87 walkthrough left open: `DELETE /api/account` previously trusted any valid-but-arbitrarily-old Firebase ID token — the password/Google reauth `DeleteAccountModal` performs was client-side UX only, never server-enforced. A new dependency, `require_recent_auth` (`app/auth.py:137-174`), now gates the route: the token's `auth_time` claim must be within 5 minutes of the request or the route rejects `401 {"detail": {"code": "recent-auth-required"}}` before the purge runs; a missing `auth_time` claim is treated as stale, never an implicit pass. Full contract: `SWU_Platform_Spec.md` §1.1/§1.2. **Not a new trust boundary** — the same stolen token could already wipe all inventory via the existing mutation endpoints — but it closes a pattern (client-side-only reauth) that shouldn't propagate as more destructive endpoints appear. **State as of this revision: merged to `main`, live on dev; the most recent prod promote run predates this merge, so it is not yet live in prod.** *(Update 2026-07-30: promoted to prod with the 2026-07-25/26 promote wave — see the 2026-07-30 addendum.)*

### A4 audit findings — disposition as of this revision

| ID | Finding | Severity | Audit disposition | Outcome tonight |
|---|---|---|---|---|
| A4-01 | No XLSX/XML parse surface on import (JSON/CSV only; zip-bomb/XXE not applicable) | info | accept | Unchanged — accepted, no code affected |
| A4-02 | `python-multipart==0.0.20` runtime dep backing the import upload carried high-severity DoS CVEs (patched 0.0.30) | **high** | fix-now | **Fixed** — bumped to `0.0.32` in Wave 0 (PR #425), ahead of this audit's own Wave 3 sequencing |
| A4-03 | Whole upload buffered before size check; JSON parsed twice per request; no app-level body cap | low | file-as-BL | **Fixed** (PR #437, shipped under BL-53) — `_read_capped()` reads the upload in 1MB chunks and stops past the byte cap instead of buffering the whole body; the JSON body is now parsed exactly once, with the `>20,000`-row gate running on that single parse's own row count |
| A4-04 | Import has no rate limit/call quota; abuse-case tests were thin; CSV export wrote `name`/`subtitle` unescaped (spreadsheet formula-injection) | medium | file-as-BL | **Fixed, split across two PRs** — `SWU_Backlog.md` BL-158 (PR #436): CSV export now neutralizes leading `=+-@`/tab/CR on `name`/`subtitle` (round-trip tested), plus a new 39-case abuse-test suite (`test_inventory_import_abuse.py`) and a `csv.Error`→`UnparseableFileError` fix for an oversized-field 500. BL-53 (PR #437): 30/hr/tenant rate limit on the import endpoint closes the quota half |
| A4-05 | Auth-gate boundary audited route-by-route — no mismatch against doctrine anywhere | info | accept | Unchanged — accepted; the route table in the audit report is the current reference |
| A4-06 | Swagger/OpenAPI disabled in prod, confirmed against live Cloud Run env config, not just source | info | accept | Unchanged — accepted |
| A4-07 | `tenants` intentionally carries no RLS (isolation via server-derived `WHERE id =` filter only) | low | accept | Unchanged — accepted, durable rationale on file (migration 0024, Platform Spec §1.5) |
| A4-08 | Tenant RLS policies are USING-only (no explicit WITH CHECK) — maintenance hazard, not a live gap | info | accept | Unchanged — accepted |
| A4-09 | eslint-10 PR #228 — close-don't-merge decision (blocked upstream by `eslint-plugin-react`) | info | accept, close #228 | **Done** — PR #228 closed |
| A4-10 | Secrets posture clean (Secret Manager only, no SA user keys, targeted git-history spot-check clean) | info | accept | Unchanged — accepted |
| A4-11 | Feedback per-IP rate limiter likely keys on the Hosting→Cloud Run proxy peer, not the real client IP (no `--proxy-headers`) | medium | needs-live-check → file-as-BL | **Fixed** (PR #437, shipped under BL-53) — uvicorn's `ProxyHeadersMiddleware` (`trusted_hosts="*"`) added as the outermost middleware, correcting `request.client.host` from `X-Forwarded-For`; transparently fixes the feedback limiter's key. The live-check (confirming pre-fix behavior on Cloud Run) was folded into the PR's own verification rather than run as a separate step |
| A4-12 | Auth-endpoint (login/reset/OAuth) throttling is Firebase-hosted, outside this backend | info | needs-live-check | **Not checked** — Firebase Auth console abuse/quota settings not yet reviewed *(closed 2026-07-30 — reviewed via the Identity Platform admin API; see the 2026-07-30 addendum below)* |
| A4-13 | No rate limit on deck-check or import; `deck_json` has no body-size cap | low | file-as-BL | **Fixed** (PR #437, shipped under BL-53) — 30/hr/tenant on import, 60/hr/tenant on deck-check, both 429 + computed `Retry-After`; `deck_json` capped at 1MB, 422 `deck_json_too_large` |
| A4-14 | No app-layer HSTS/CSP/`X-Content-Type-Options`/`X-Frame-Options`/`Referrer-Policy` on `/api/**`/`/images/**` responses | low | needs-live-check → file-as-BL | **Fixed** (PR #437, shipped under BL-157) — new `security_headers` middleware sets `nosniff`/`DENY`/`no-referrer`/HSTS on every response; a pre-fix live prod capture (2026-07-25) confirmed HSTS was already present via Hosting but the other three were absent. No CSP, by design (no HTML surface on this origin) *(post-fix live re-capture completed 2026-07-30 — all four headers confirmed on prod; see the 2026-07-30 addendum below)* |
| — | 15 open Dependabot alerts (not the "2" a stale continuity note claimed); dev-dep PRs #396/#397/#398 | medium (aggregate) | file-as-BL | **Mostly done** — #396 and #397 merged; #398 closed (superseded/resolved manually) |

**Net for this revision:** 1 high finding closed (A4-02), five medium/low findings closed (A4-03, A4-04, A4-11, A4-13, A4-14), one info finding closed out (A4-09). Every A4-01-through-A4-14 item is now either **accepted** (no action needed) or **fixed** — none remain in a bare "filed, not built" state as of this revision. The two `needs-live-check` items that couldn't close alongside their fix (A4-12 Firebase Auth console settings; a **post**-fix live re-capture of A4-14's headers once this promotes to prod) are the only residual work. *(Both closed 2026-07-30 — see the addendum below.)* A10's correction (above) and this table together are what "post-auth/pricing/import surface" review means for this pass; the RLS/secrets/CORS baseline audited alongside them (A4-05 through A4-10) turned up no new gap.

### Summary of this revision

| Category | Prior status | 2026-07-24 status |
|---|---|---|
| A04 Insecure Design | Rate limiting deferred (BL-53); import surface unaudited | Import surface audited (A4 spike) and hardened — CSV formula-injection + abuse-tests **closed** (BL-158, PR #436); per-tenant rate limits on import/deck-check, `deck_json` cap, stream-guard/single-parse, and the proxy-IP fix all **closed** (BL-53, PR #437). Standing rate-limiting deferral is **resolved**, scoped to the two highest-risk routes (not a blanket `/api/*` or edge control) |
| A07 Auth Failures | Addressed (token validity + BL-16 verification gate) | Addressed — **destructive-op recency gate** added: `DELETE /api/account` now requires `auth_time` within 5 minutes (BL-88), on dev, prod promote pending *(promoted 2026-07-25/26)* |
| A10 SSRF | Not applicable (stale since 2026-07-16, uncorrected until now) | **Corrected: Applicable, Mitigated** — `POST /api/deck-check`'s allowlisted, no-redirect, bounded fetch (BL-137) |

---

## 2026-07-30 Addendum — post-promote live re-captures (repo-public Q6 hygiene)

**Trigger:** the 2026-07-24 revision left exactly two residuals, both `needs-live-check` items that required state outside that night's merge window. Both are closed here. Context since that revision: the repo went public (2026-07-29, now `whitebreadisu/hyperspacevault`), the production front door is **`www.hyperspacevault.com`** (the apex 301s to `www`; `swu.jeremybradenapps.com` referenced in older captures above is the historical front door), and two prod promotes ran 2026-07-30 — prod, dev, and `main` are at the same tip.

### A4-14 — post-fix live header capture: **Closed, verified in prod**

Captured 2026-07-30 ~18:15Z against the real front door, no `Authorization` header, both surfaces the finding named:

- `GET https://www.hyperspacevault.com/api/sets` → `200`, response carries **all four** headers: `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- `GET https://www.hyperspacevault.com/images/cards/<rendition>.webp` → `200` (`image/webp`, `Cache-Control: public, max-age=31536000, immutable`), same four headers present.

Compared against the pre-fix capture on file (2026-07-25: HSTS present via Hosting, the other three absent), this confirms the `security_headers` middleware (PR #437, BL-157) is live in prod on both `/api/**` and `/images/**`. No CSP, unchanged by design (no HTML surface on this origin).

### A4-12 — Firebase Auth abuse/quota settings: **Closed, reviewed**

Reviewed 2026-07-30 via the Identity Platform admin API (`admin/v2/projects/swu-prod/config` — the API equivalent of the console pages the finding named), rather than remaining "not checked":

- **Email-enumeration protection is ON** (`emailPrivacyConfig.enableImprovedEmailPrivacy: true`) — sign-in/reset endpoints don't disclose whether an email is registered.
- **No custom sign-up quota overrides** (`quota: {}`) — Google-managed default throttling applies to the hosted auth endpoints (the finding's core question: throttling exists, it is Google's, and it has not been loosened).
- **SMS surface is closed**: `smsRegionConfig` is allowlist-only with an empty allowlist, and the app uses no phone auth — no SMS toll-fraud exposure.
- **MFA disabled, no blocking functions** — both known and by design (password + Google sign-in only, per the auth epic).
- One housekeeping observation: `authorizedDomains` still lists `swu.jeremybradenapps.com` alongside the `hyperspacevault.com` pair and the Firebase defaults. The domain is still owner-controlled, so this is stale config rather than a vulnerability; removal is an owner call once nothing depends on the old front door.

**Net:** every finding from the 2026-07-24 revision (A4-01..A4-14) is now accepted, fixed, or reviewed-with-outcome — no `needs-live-check` residuals remain. BL-88's recency gate, noted above as "not yet live in prod," rode the 2026-07-25/26 promote wave (the same promotes that carried BL-157's headers, whose presence today's capture proves).

---

## OWASP Top 10 (2021) Walkthrough — 2026-06-14 (historical baseline)

### A01:2021 – Broken Access Control — Addressed

- Every `/api/*` route depends on `Depends(get_db)` (`app/database.py`), which requires a valid Firebase ID token verified by `app/auth.py`'s `verify_firebase_token`/`get_current_identity`.
- Live-verified against `https://backend-qsolsepaya-uc.a.run.app`:
  - `GET /api/inventory` with no `Authorization` header → `401`, `{"detail":"Missing or invalid Authorization header"}`
  - `GET /api/inventory` with `Authorization: Bearer notarealtoken` → `401`
  - `GET /api/cards` with no `Authorization` header → `401` — even though `cards` is shared catalog data with no `tenant_id`/RLS, every `/api/*` route requires authentication uniformly, not just tenant-scoped ones.
  - `GET /health` → `200`, unauthenticated — the only intentionally open route.
- Row-level security provides defense-in-depth beneath the app-layer check: migration `0018` (`inventory.tenant_isolation`) and migration `0021` (`users.user_self_access`, `tenants` column-level grants). P7 Stage 3 added direct integration-test coverage for both. Even a hypothetical bug in `get_db()`'s tenant-scoping logic could not leak another tenant's `inventory`/`users` rows, because Postgres itself enforces the policy for the `swu_app` role the app connects as.
- `swu_user` (the migration/admin role, `BYPASSRLS`) is used only by Alembic via `DATABASE_URL`, never by the request-serving connection (`APP_DATABASE_URL`/`swu_app`) — confirmed in `app/database.py`.

### A02:2021 – Cryptographic Failures — Addressed

- All public traffic is HTTPS: Cloud Run terminates TLS for the backend; Firebase Hosting enforces HTTPS (with redirect) for the frontend.
- Database credentials (`db-password`, `app-db-password`) are 32-character `random_password` Terraform resources — never hand-chosen, never committed.
- The `database-url`/`app-database-url` secrets (full DSNs, including those passwords) live in Secret Manager and are injected into Cloud Run as env vars via `secret_key_ref` — never in source, never printed by CI.
- `.env` is gitignored and untracked in both `backend/` and `frontend/`; only `.env.example` files with placeholder values are committed.
- The app stores no user passwords — authentication is delegated entirely to Firebase Authentication (Identity Platform). The backend only ever sees short-lived, signed ID tokens (RS256 JWTs), verified against Google's rotating public keys.

### A03:2021 – Injection — Addressed

- Every runtime SQL statement uses SQLAlchemy `text()` with bound parameters (`:name` placeholders). A repo-wide check found no `f"SELECT ... {user_input}"`-style string-built SQL in any request-handling path.
- The only string-interpolated SQL in the codebase:
  - Migration `0019_create_app_role.py`: `CREATE ROLE swu_app WITH LOGIN PASSWORD '{password}'`, where `password` is `os.environ["APP_DB_PASSWORD"]` (a Terraform-generated secret, not user input), with `'` escaped via `.replace("'", "''")`. Runs once, at migration time — never per-request.
  - `app/ingestion/generate_seed.py` / `generate_inventory_snapshot.py`'s `sql_string()` helper — builds static `.sql` files from catalog/inventory CSVs at dev-time, with the same `'`-escaping. The output is a committed file, reviewed before `apply_seed`/`apply_inventory_snapshot` run it — not a runtime path.
- React escapes interpolated values by default, so rendering API responses (card names, etc.) carries no obvious DOM-based XSS vector. `dangerouslySetInnerHTML` is not used anywhere in `frontend/src`.

### A04:2021 – Insecure Design — Addressed, with one deferred item

- Multi-tenancy (P4) and concurrency-safety (P7 Stage 2) were both deliberate design phases with dedicated regression tests, not retrofits.
- **Deferred — no application-level rate limiting.** `/api/*` has no per-IP/per-tenant request-rate cap; Cloud Run's autoscaling absorbs load rather than rejecting it. Firebase Authentication has its own sign-in rate limiting (outside this app's code). Residual risk: an authenticated client repeatedly hitting `/api/inventory/{id}/increment` would increase Cloud Run cost before anything pushes back — low severity for a small, known set of users, but worth revisiting if the app ever opens more broadly.
- **N/A — CSRF.** The API uses `Authorization: Bearer <token>` exclusively (`allow_credentials=True` is set in CORS for completeness, but no cookie carries the session). With no ambient credential, there's nothing a forged cross-site request could ride on — CSRF tokens and `SameSite` cookie protections don't apply to a Bearer-token API.

### A05:2021 – Security Misconfiguration — Addressed

- **Remediated 2026-06-14: `/docs`, `/redoc`, and `/openapi.json` are disabled in production.** Previously, both `/docs` and `/openapi.json` were live-verified as publicly reachable (`200`, no `Authorization` header) against `https://backend-qsolsepaya-uc.a.run.app` — FastAPI serves Swagger UI/ReDoc/OpenAPI schema by default unless `docs_url`/`redoc_url`/`openapi_url` are set to `None`. This didn't expose data (every documented endpoint still requires a valid token), but it did expose the full API surface — route paths and request/response field names (`firebase_uid`, `tenant_id`, etc.) — to anyone who found the URL. Fix: `app/main.py`'s `_api_docs_enabled()` checks `ENVIRONMENT != "production"`; `terraform/environments/prod/cloud_run.tf` now sets `ENVIRONMENT=production` on the Cloud Run service, so docs stay on in local dev/CI (where `ENVIRONMENT` is unset) and are disabled (`docs_url=None`, etc.) in production.
- CORS (`allow_origins=["http://localhost:5173"]`) is a dev-only origin and is **not** exercised by the production frontend — `frontend/firebase.json` rewrites `/api/**` to the Cloud Run backend, so `swu-prod.web.app`/`swu.jeremybradenapps.com` call `/api/*` same-origin, never triggering CORS at all. The setting is overly *restrictive* for the raw Cloud Run URL (a browser-based client at the prod origin couldn't call it directly via `fetch`), not overly permissive — not a vulnerability as configured, just dev-only config that happens to also be the only config that exists.
- Cloud Run ingress is `INGRESS_TRAFFIC_ALL` with `roles/run.invoker = allUsers` — intentional. Access control is enforced at the application layer (A01), confirmed live. This is a common, accepted pattern for Cloud Run services that do their own auth.
- No stack traces or internal details are returned to clients on error — FastAPI's default exception handlers return generic JSON; full tracebacks go to structured logs (P6 Stage 1) with `severity=ERROR`, not to the response body.

### A06:2021 – Vulnerable and Outdated Components — Addressed (scanning); triage deferred

- Dependabot alerts + version updates enabled (P7 Stage 1): `.github/dependabot.yml` covers `pip` (`/backend`), `npm` (`/frontend`), and `github-actions` (`/`) on a weekly schedule.
- **7 open Dependabot alerts** (GitHub reports these as 1 critical, 1 high, 5 moderate), all in dev/test tooling, none in production request-handling libraries:
  - npm devDependencies: `esbuild` ×2 (1 high — dev-server CORS/registry issue), `vitest` (1 critical — `vitest --ui`'s file-read/execute vulnerability; this project never runs `--ui`, in CI or anywhere else), `uuid` (moderate), `vite` (moderate)
  - pip: `python-dotenv` (moderate), `pytest` (moderate)
  - `fastapi`, `sqlalchemy`, `psycopg2-binary`, `firebase-admin` — the libraries actually in the runtime request path — have no open alerts.
  - The "critical" and "high" ratings both require a dev-only feature (Vite's dev server / Vitest's UI server) that the deployed Cloud Run container never runs — it serves the built `frontend/dist` via Firebase Hosting and the FastAPI app directly, no Vite/Vitest process. Severity-in-isolation overstates the production risk here; ecosystem (dev vs. runtime) is the more relevant signal.
- **18 open Dependabot version-update PRs** (#8, #9, #11–#27) — more than the single TypeScript PR anticipated when this stage was planned. 13 pass CI as-is; 5 fail (#9, #19, #21, #22, #24 — major-version bumps to `pytest`, `pytest-asyncio`, `vitest`, and `@vitejs/plugin-react`).
  - **Decision (2026-06-14):** document the current state and defer triage to a dedicated future session, rather than fold an 18-PR merge/investigation pass into Stage 4. None of the 18 PRs touch a library with an open security alert — this is routine version-update backlog, not an unaddressed CVE.
  - **Notes for that session:** the two "multi" PRs (#11, #12 — bumping `vite`/`@vitejs/plugin-react`/`vitest` together) likely overlap with the single-package PRs for the same libraries (#21, #24); check for redundancy before merging both. The 5 failing PRs are all major-version bumps and will need their CI failures investigated individually (likely breaking API changes in `pytest` 9, `vitest` 4, `@vitejs/plugin-react` 6), not just re-run.

### A07:2021 – Identification and Authentication Failures — Addressed

- Firebase Authentication (Identity Platform) owns credential storage, hashing, and the sign-in flow entirely — the app never sees or stores a password.
- `app/auth.py`'s `verify_firebase_token` uses the Firebase Admin SDK's `verify_id_token`, which checks the token's signature (against Google's rotating public keys), expiry, issuer, and audience — a full verification, not just a decode.
- ID tokens are short-lived; the frontend's `authedFetch` calls `getIdToken()` per request, so the SDK transparently refreshes near-expiry tokens.
- New `firebase_uid`s are auto-provisioned (own tenant + user row, P5 Stage 2) on first authenticated request — no separate signup-approval step, appropriate for this app's "anyone with a login gets their own private inventory" model.

### A08:2021 – Software and Data Integrity Failures — Addressed

- CI/CD authenticates to GCP via Workload Identity Federation (OIDC) — no long-lived service account keys exist for `terraform-ci`, in git or anywhere else (P1).
- Every change to `main` runs through `ci.yml`'s `backend`/`frontend` jobs (tests + coverage gates, P7 Stage 3) before `build-and-push`/`deploy` run.
- Branch protection on `main` requires those checks to pass (P3 Stage 4) — but `enforce_admins: false`, so a repo admin (Jeremy) can push directly, bypassing CI. Documented, accepted trade-off for a single-developer project; would need revisiting if collaborators are added.
- Terraform state lives in a GCS bucket (`swu-prod-tfstate`), not in git — infrastructure changes are tracked and applied through a single, auditable path (`terraform apply` in CI).

### A09:2021 – Security Logging and Monitoring Failures — Addressed (P6)

- Structured JSON logging with `severity`/`httpRequest`/`tenant_id` fields (Stage 1) — every request and unhandled exception is a queryable Cloud Logging entry.
- Cloud Monitoring dashboard for the backend service (Stage 2).
- Alert policy + email notification channel for elevated 5xx error rates (Stage 3) — live-verified to fire within ~1-2 minutes of a real `500`.
- Cloud Error Reporting enabled (Stage 4) — unhandled exceptions are grouped by type, with first-seen/last-seen tracking, verified via a synthetic `events:report` call.

### A10:2021 – Server-Side Request Forgery (SSRF) — Not applicable

- No backend code accepts a URL from a client and fetches it. The only outbound network calls the backend makes are to its own Cloud SQL instance (fixed Unix-socket path) and to Google's Firebase Admin SDK endpoints (fixed, SDK-managed) — neither is influenced by request input.

## Secrets & Network Review

### Secret Manager

Four secrets, all `auto` replication, with `random_password`-generated values (never hand-set):

| Secret | Contents | Readable by |
|---|---|---|
| `db-password` | `swu_user` (migration/admin role) password | not directly granted — exists as the Terraform source of truth for the password embedded in `database-url` |
| `database-url` | Full DSN for `swu_user`, used by `alembic upgrade head` — since BL-8/RR-10 (shipped to dev 2026-07-25, PR #433) run once per deploy by the discrete `migrate` Cloud Run Job, not at serving-container start | `backend_runtime` SA only |
| `app-db-password` | `swu_app` (RLS-scoped runtime role) password | not directly granted — embedded in `app-database-url` |
| `app-database-url` | Full DSN for `swu_app`, used by `app/database.py`'s request-serving connection | `backend_runtime` SA only |

All values that reach Cloud Run are injected as env vars via `secret_key_ref` — never written to a config file, never logged (P6's structured logger logs request metadata, not env vars).

### IAM

- `terraform_ci`'s role list (`iam.tf`) has grown incrementally, one phase/stage at a time, each addition commented with which stage needed it — no blanket `roles/editor` or `roles/owner` at any point. The broadest single grant is `roles/resourcemanager.projectIamAdmin`, needed because `terraform-ci` must be able to grant IAM roles to *other* service accounts it creates (e.g., `backend_runtime` → Cloud SQL Client) as part of normal applies.
- `backend_runtime` (the Cloud Run service's identity) holds `roles/secretmanager.secretAccessor`, granted per-secret via `google_secret_manager_secret_iam_member` (scoped to the 2 DSN secrets above, not project-wide), plus whatever Cloud SQL connectivity role the connector needs — it cannot manage infrastructure, only read its own secrets and connect to its own database.
- Neither `terraform-ci` (WIF) nor `backend_runtime` (attached to Cloud Run, ADC) has a long-lived JSON key file — both use keyless auth.

### Cloud Run Ingress

- `ingress = "INGRESS_TRAFFIC_ALL"`, `roles/run.invoker = allUsers` — the backend's URL is reachable from the public internet with no IAM check at the Cloud Run layer. Intentional: access control is enforced in application code (A01), and live-verified — every `/api/*` route returns `401` without a valid Firebase ID token; only `/health` is open.

### Cloud SQL Connectivity

- `ipv4_enabled = true`, no `authorized_networks` configured. The instance has a public IP address, but with an empty allow-list nothing can reach it over that path — Cloud Run connects via the Cloud SQL connector (IAM-authenticated, Unix-socket), per the comment in `database.tf`. The public IP is currently unused attack surface rather than an active exposure — worth keeping in mind if `authorized_networks` is ever populated for a one-off debugging session and not cleaned up afterward.
- `deletion_protection = true`, automated backups enabled, `db-f1-micro`/`ZONAL` (single-zone, no HA) — appropriate for current scale; would need `availability_type = "REGIONAL"` if uptime requirements grow.

## Summary

**This table is the 2026-06-14 baseline, unedited.** Per this document's revision policy (banner at the top), A01/A04/A05 are superseded by the 2026-07-07/07-12 revisions, A07 by the 2026-07-10/07-24 revisions, and **A10 is corrected — Applicable, Mitigated, not "Not applicable"** — by the 2026-07-24 revision above. Read this row-by-row against the revisions before treating any single row here as current.

| Category | Status |
|---|---|
| A01 Broken Access Control | Addressed |
| A02 Cryptographic Failures | Addressed |
| A03 Injection | Addressed |
| A04 Insecure Design | Addressed; rate limiting deferred (low risk) |
| A05 Security Misconfiguration | Addressed |
| A06 Vulnerable/Outdated Components | Addressed (scanning); 18-PR triage deferred |
| A07 Auth Failures | Addressed |
| A08 Software/Data Integrity | Addressed; admin CI-bypass is an accepted trade-off |
| A09 Logging/Monitoring | Addressed |
| A10 SSRF | Not applicable |

**Open follow-ups (none blocking, all low-severity) — 2026-06-14 baseline list, superseded by `SWU_Backlog.md`:**

1. ~~Dedicated session to triage the 18 open Dependabot PRs~~ — **done** (`SWU_Backlog.md` BL-9, resolved 2026-06-15).
2. ~~If the app ever opens beyond its current known users, revisit rate limiting (A04)~~ — **done, 2026-07-24**: `SWU_Backlog.md` BL-53 (per-tenant rate limits on import/deck-check + the proxy-IP fix) and BL-157 (security headers) both shipped the same night (PR #437). `enforce_admins` (A08) remains a deliberate accepted trade-off, unchanged.

**Current open follow-ups, as of the 2026-07-24 revision:** see that revision's A4 findings table above for the live list — as of this revision, every A4 item is accepted or fixed; the only residuals are the two `needs-live-check` items that couldn't close alongside their code fix (A4-12 Firebase Auth console settings, unreviewed; a **post**-fix live re-capture of A4-14's response headers once BL-53/BL-157 promote to prod — the pre-fix capture is already on file), plus getting BL-88/BL-158/BL-53/BL-157 (all merged to `main`/dev tonight) through an actual prod promote.

**Update 2026-07-30:** all of the above landed — the promote wave ran 2026-07-25/26, and both `needs-live-check` residuals are closed in the **2026-07-30 Addendum** above. No open follow-ups remain from any revision of this review.
