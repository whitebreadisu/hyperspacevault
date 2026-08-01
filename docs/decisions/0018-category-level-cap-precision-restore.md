# ADR-0018: Restore numeric keep-limit precision at category granularity (BL-182)

## Status
Accepted — 2026-08-01

## Context
ADR-0013 (2026-07-13) trimmed the inventory-limits UI from a 30-cell
per-bucket grid to a three-way Hard/Soft/No-limits control, keeping the full
per-bucket backend contract (tables, RLS, endpoints, enforcement, 999
ceiling) live but UI-unexercised. It priced the return path explicitly:
*"Re-enabling precision later is a UI restore against a contract that never
left — cheap."* The trigger it anticipated — real user demand rather than
speculative generality — arrived on announcement day: the first piece of
feedback on the public-release post (2026-07-31) asked for user-defined
inventory caps.

The demand was for **two numbers, not thirty cells**: raise the cap for
Leaders/Bases and for everything else. That is a *third* granularity the
schema supports natively — between ADR-0013's zero-numbers control and the
trimmed grid's per-bucket matrix — expressible as uniform override rows
across a category's 15 buckets through the existing full-replacement PUT.

## Decision
The Settings control gains two numeric cap steppers — **Leaders & Bases**
(floor 1) and **all other cards** (floor 3), both ceilinged at the existing
`QUANTITY_CEILING` of 999 — in a dedicated "Keep-limits" section above the
enforcement control. The backend contract remains byte-identical to
ADR-0013's:

- A category whose cap differs from its code default saves as 15 uniform
  per-bucket override rows; a category at its default saves no rows — so a
  plain hard/soft pick with untouched steppers still round-trips as
  `overrides: []`, and "No limits" remains the all-null payload.
- The floors are enforced by the control, not the API — extending
  ADR-0013's "the control owns the contract" doctrine. Per-bucket precision
  via direct PUT remains unsupported-but-possible; a non-uniform or partial
  category matrix *displays* as the category default and is normalized to
  the control's state on the next save.
- Enforcement, the popup incrementor, and Add Cards required **zero
  changes**: they already resolve effective limits dynamically (BL-24/25
  plumbing), which is what made this a one-screen build.

## Consequences
- + The first user-demanded feature shipped against the preserved contract
  with no migration, no endpoint changes, and no enforcement changes —
  ADR-0013's build-then-trim bet cashed exactly as written.
- + The ownable UI surface grows from ~3 states to (3 modes × 2 numbers),
  far below the trimmed grid's 30-cells-×-modes space.
- − The category-uniform write pattern means a future per-bucket UI restore
  would need a migration *of expectations* (users will have learned
  category semantics), not just a UI revert.
- − Displayed-vs-stored divergence is now possible for API-written
  matrices (shown as defaults until the next save normalizes them) —
  accepted, consistent with the ADR-0013 doctrine it extends.

Related: ADR-0013 (the trim this partially reverses, on its own terms);
BL-182 (backlog, issue hyperspacevault#37); BL-24/25/35 (the preserved
machinery); App Spec §4.5 (as-built addendum).
