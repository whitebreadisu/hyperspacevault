# ADR-0027: Product analytics — PostHog Cloud behind a first-party proxy

## Status
Accepted — 2026-08-26 (BL-235 tooling decision, owner sign-off; mobile-strategy session)

## Context
Product decisions — which features to invest in, what a mobile experience
should emphasize (BL-190/BL-234), what users actually use versus ignore —
were being made on owner assumption with zero behavioral data. The app had
shipped with an explicit "no analytics, no trackers" posture (About modal,
BL-104/BL-125), so adding measurement is a deliberate posture change, not a
default: it must answer named product questions (most-used functions, where
users get stuck, used-vs-ignored options, device-class behavior) while
staying defensible in the privacy policy it amends.

Constraints that shaped the field: at ~10² users, statistically thin funnels
make **session replay** the highest-value instrument (watching real sessions
beats aggregate charts at small n); a Reddit-sourced audience blocks known
tracker domains at high rates, so a naively integrated tool would silently
lose a *biased* slice of traffic; and a solo-maintained product cannot absorb
a permanently operated analytics stack.

Candidates considered: GA4/Firebase Analytics (most-blocked script on the
web, marketing-attribution shape, no replay); Plausible/Fathom (page-view
counters — wrong category for an SPA whose activity is intra-screen);
Mixpanel/Amplitude (viable, but thinner free tiers — Mixpanel cut 20M→1M
events in late 2025 — and less turnkey proxying, with no advantage over
PostHog at this scale); PostHog self-hosted (ClickHouse+Kafka on a
self-patched VM — permanent operational tax); roll-your-own events table
(strongest privacy, but no replay without rebuilding one, and the analysis
layer is the actual product being bought).

## Decision
**PostHog Cloud (US region, free tier), reached exclusively through a
first-party reverse proxy** (`/api/relay/*` → the backend, which forwards to
PostHog's ingest/assets hosts), with a locked rider set:

- **Session replay on, all inputs masked** — nothing the user types is
  recorded.
- **Anonymous events** — `identify()` is never called; analytics identity is
  a per-browser anonymous id, deliberately not linkable to accounts.
- **Opt-out toggle** in Settings (browser-local, immediate effect).
- **Privacy-policy disclosure in the same PR** as the instrumentation — the
  About modal's "tracking: none" claim is superseded by an explicit
  usage-analytics bullet naming the processor.
- **Event taxonomy is a closed, spec-registered union** (App Spec analytics
  section): every event answers a named question; values live in properties,
  never names; no raw user-typed text, no PII; events are deprecated, never
  renamed.
- **Init gated to production hostnames** — dev/CI/preview traffic never
  enters the dataset.

## Consequences
- **+** Replay + event analytics + funnels + feature flags from one
  integration at $0 for the foreseeable scale (free tier: 1M events + 5k
  recordings/month, historically stable limits).
- **+** First-party pathing makes the measurement resilient to tracker
  blocklists — and honest: the opt-out toggle, not an adblocker arms race,
  is the sanctioned off switch.
- **+** Feature flags (bundled, unused today) are the natural staged-rollout
  mechanism for the adaptive mobile experience (BL-190).
- **−** A third party now processes behavioral data on the app's behalf —
  the privacy posture moves from "collects nothing" to
  "collects anonymized, masked, disclosed, opt-out-able" and the policy
  must say so plainly.
- **−** Anonymous-mode analytics cannot answer per-account questions or
  stitch cross-device journeys; revisiting `identify()` is a new decision
  with new disclosure obligations.
- **−** All analytics traffic rides the backend service; if event volume
  ever grows to matter, the relay graduates to its own Cloud Run service
  (a config change, not a redesign).

**Related:** ADR-0026 (anonymous ≠ tenant-linked leans on one-user-one-tenant
being the only account shape). Tooling comparison and taxonomy definition:
internal repo (learning guide "Product Track addendum: BL-235";
`planning/Definition_Analytics_Taxonomy_2026-08-26.md`).
