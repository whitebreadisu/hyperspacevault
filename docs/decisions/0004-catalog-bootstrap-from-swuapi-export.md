# ADR-0004: Bootstrap the catalog by ingesting the committed swuapi export on startup

## Status
Accepted — 2026-06-25 (implemented same day)

## Context
After the catalog redesign ([ADR-0002](0002-csv-to-swuapi-rewrite.md)) the catalog (`base_cards`/`card_variants`/`sets` + aspects/keywords/traits) is sourced from **swuapi**. The old CSV-based `catalog_seed.sql` and its `generate_seed.py` were retired (deleted in the redesign migration `aa2b86b`). As a result a fresh database comes up with an **empty catalog** — it's populated by a manual `run_swuapi_ingestion` step — and the README's "on startup the backend applies the catalog seed" promise is now stale.

A captured swuapi export (`backend/app/tests/fixtures/swuapi_export_2026-06-21.json`, ~13 MB) is committed, and `run_swuapi_ingestion` builds the catalog from it idempotently (upsert by `swuapi_id`).

Options considered:
- **(A) Manual ingestion (status quo)** — document the CLI step; `apply_seed` stays a no-op. Zero new code, but `docker compose up` yields an empty app until the command is run by hand — not turnkey, poor first impression for a cloner/new developer.
- **(B) Auto-ingest from the committed export on startup, idempotently.**
- **(C) Rebuild a static `catalog_seed.sql` generator** — a new-schema `generate_seed.py` writing a committed SQL dump applied by `apply_seed`. The committed dump duplicates the export and goes stale, and the generator must be built and maintained.

## Decision
Adopt **Option B**. On startup, if the catalog is empty (no `base_cards` rows), ingest the catalog from the committed swuapi export; skip if already populated. Wire it into the FastAPI **lifespan** (where `apply_seed`/`apply_inventory_snapshot` run today), **replacing `apply_seed`**. The static `catalog_seed.sql` concept and `apply_seed.py` are removed.

Scope note: the *inventory* snapshot path (`apply_inventory_snapshot`, `regenerate_inventory`) is separate, throwaway scaffolding retired by BL-54 and is **not** in scope here.

## Consequences
- **+** Turnkey fresh-DB bootstrap — clone → `docker compose up` → a working app with a populated catalog. Restores the README's promise; a strong onboarding/portfolio experience.
- **+** Single source of truth: the swuapi export. No hand-maintained SQL dump to keep in sync (Option C's main downside) and no generator to maintain.
- **+** Simplifies the code: deletes `apply_seed.py` (including its latent `SELECT … FROM cards` bug against the dropped table) and the `catalog_seed.sql` concept; reuses `run_swuapi_ingestion` plus a small "is `base_cards` empty?" guard.
- **+** Idempotent and guarded: warm databases and production (already populated) skip it — no repeated 13 MB parse per boot.
- **−** First boot on a truly empty database parses ~13 MB of JSON and ingests ~8k cards (one-time, guarded). For a brand-new empty *production* environment this cost is paid once at startup — watch the Cloud Run startup-probe timeout in that case.
- **−** The committed export is a point-in-time capture of the catalog; it goes stale between captures. Real freshness is the planned operator-gated ongoing sync (BL-36/BL-37); until then the export is re-captured periodically.
- **−** App startup now exercises the ingestion/transform code path (already a dependency; now run at boot).

**Implementation:** `bootstrap_catalog()` in `app/ingestion/bootstrap.py` no-ops when `base_cards` is populated and otherwise loads + ingests the committed export; it's called from the FastAPI lifespan in place of `apply_seed()`. `apply_seed.py` and the CI "Apply catalog seed" step were removed, the export was relocated out of `tests/fixtures/` to `app/ingestion/data/`, and the README's startup description was updated.

---

**Amendment 2026-07-29 (BL-170, repo-public epic):** the export is no longer
*committed* — `backend/app/ingestion/data/*.json` is gitignored and the
capture's durable home is the private per-env `repo-assets` GCS bucket. CI's
`build-and-push` fetches `exports/swuapi_export_current.json` into the Docker
context before the image build, so the shipped image still embeds a capture
and this ADR's turnkey-bootstrap property is preserved for deployed
environments; credentialed local dev fetches via
`scripts/fetch_bootstrap_export.sh`. A credential-less fresh clone now boots
with an **empty** catalog (warn-and-skip) — the accepted trade for keeping
FFG card data out of the public repo. Resolution order and details:
`bootstrap.py` docstring + `backend/app/ingestion/data/README.md`.
