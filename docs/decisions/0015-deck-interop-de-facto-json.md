# ADR-0015: Deck interop via the de facto JSON, clipboard-first — not provider status, not URL fetching

## Status
Accepted — 2026-07-13

## Context
Jeremy named three export targets: Karabast, Force Table, SWUDB. The BL-110 research established that (a) a de facto JSON interchange exists — `{leader, base, deck[], sideboard[]}` of `{id:"SET_NUM", count}` — live-verified on two platforms and encoded as the target type Karabast normalizes 14 providers into; (b) Karabast and Force Table are deck *consumers* whose paste flows accept that shape; (c) SWUDB is bot-walled but its own clipboard export speaks the same shape.

Alternatives considered:
- **Becoming a Karabast provider** (public shareable deck URLs + a public JSON API + an upstream registry PR): real distribution win, but it creates a permanent public API surface, public-visibility semantics for decks (currently tenant-private), and a dependency on an external project's registry — the "worth owning" test (ADR-0013's lesson) says not before the feature has users.
- **URL-fetch import** from platforms with public APIs (SWUBase, sw-unlimited-db): convenient, but adds server-side fetching of third-party URLs to own (availability, format drift, SSRF surface) while the paste path serves the identical decks.
- **A bespoke export format of our own**: rejected — unlike inventory (where our model is richer than every external format, BL-109), deck semantics are fully expressible in the community shape; inventing a format would subtract interop and add nothing.

## Decision
Import and export are **client-side clipboard transforms of the de facto JSON** (plus a plain-text decklist export). No import/export endpoints, no URL fetching, no provider status. Provider status and URL-fetch import are recorded later-options, to be revisited only on demonstrated user demand.

## Consequences
- + One payload covers Karabast, Force Table, and the SWUDB-family tools; zero new server surface; the interop works the day the feature ships.
- + Format risk is externalized: the shape is the community's stable convention, not ours to version.
- − Users paste instead of clicking a deep link; export-to-SWUDB depends on its import affordance (gated — Jeremy's capture list) rather than an API.
- − No inbound "import by URL" convenience in v1 — a deliberate friction, reversible later.
