# ADR-0003: Model card variants on two axes (finish × provenance)

## Status
Accepted — 2026-06-21 (BL-27/BL-29; recorded retroactively 2026-06-23)
**Expected to evolve** — see BL-40 (revisit grouping model). When revised, this ADR will be *superseded* by a new one, not edited.

## Context
The original schema represented variants with ~eight independent boolean flags (`is_foil`, `is_hyperspace`, `is_organized_play`, …). That design conflated two genuinely orthogonal ideas into one flat namespace and could not represent the real variant space — a census of the actual data found roughly 58 distinct variant types, far more than a handful of booleans can express without ambiguous combinations. The census is recorded in [`BL27_Variant_Census_2026-06-21.md`](../../specification_documents/analysis/BL27_Variant_Census_2026-06-21.md).

## Decision
Model every variant along **two orthogonal axes**:
- **Finish** — the physical print treatment (Standard, Foil, Hyperspace, Hyperspace Foil, prestige finishes, …).
- **Provenance** — where/why the card was produced (retail, promo, tournament/organized-play tiers, …).

A standard variant-mapping mechanism resolves each variant to a "standard anchor"; cards that don't resolve are tracked explicitly in [`swuapi_standard_variant_exceptions.md`](../../specification_documents/swuapi_standard_variant_exceptions.md), kept deliberately short and regenerated each ingestion run. The full mechanism lives in `SWU_Standard_Variant_Mapping_Spec.md`.

## Consequences
- **+** Represents the full variant space; the two axes compose cleanly instead of producing ambiguous boolean combinations.
- **+** Queryable and groupable along each axis independently.
- **+** Exceptions are explicit and visible, not silently mis-bucketed.
- **−** More conceptual overhead than boolean flags; contributors must understand the two-axis model and the mapping mechanism.
- **−** Edge cases require explicit, maintained exception handling (the exceptions list).
- **−** Some classifications remain under active review (judge/prerelease stamps, channel-rule quirks, art-based grouping) — see BL-39/BL-40/BL-41. This model is a strong foundation, not the final word.
