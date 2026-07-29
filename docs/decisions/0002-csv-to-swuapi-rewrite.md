# ADR-0002: Rewrite catalog ingestion from CSV files to swuapi

## Status
Accepted — 2026-06-21 (BL-28/BL-29; recorded retroactively 2026-06-23)

## Context
The original card catalog was ingested from TCGPlayer CSV exports (`tcgcsv_files/`, one base + one promo file per set). Those files are *pricing*-oriented, not catalog-oriented: variant identity had to be reverse-engineered from product-name strings with heavy heuristics, set/variant numbering was inconsistent across sets, and the data didn't map cleanly onto the real variant space the game has. The source-data investigation behind this is recorded in [`CSV_Analysis.md`](../../specification_documents/analysis/CSV_Analysis.md).

The `swuapi` card data source provides structured, card-centric data (cards, variants, set membership) instead of pricing rows. Because adopting it changed the catalog schema, it was a decision worth recording rather than a routine swap.

## Decision
Rewrite the ingestion pipeline to source the catalog from `swuapi`, and restructure the catalog schema to match its structured card/variant shape. This rewrite is what made the two-axis variant model possible — see [ADR-0003](0003-two-axis-variant-model.md).

## Consequences
- **+** Structured, card-centric variant data replaces fragile name-string heuristics.
- **+** Directly enabled a principled variant model (finish × provenance) instead of inferring variants from pricing rows.
- **+** Simpler, more maintainable ingestion with far less special-case parsing.
- **−** Introduces an external dependency on `swuapi`'s data shape and availability; its modeling choices now constrain ours.
- **−** Required a one-time schema migration and full catalog reseed.
- **−** Some display fidelity is accepted as a known gap where swuapi flattens detail (e.g. same-aspect double-pip multiplicity — see BL-38).
- **−** The TCGPlayer CSVs remain only as historical/source data (gitignored `tcgcsv_files/`), no longer the live source of truth.
