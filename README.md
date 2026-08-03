# HyperspaceVault

[![CI](https://github.com/whitebreadisu/hyperspacevault/actions/workflows/ci.yml/badge.svg)](https://github.com/whitebreadisu/hyperspacevault/actions/workflows/ci.yml)
[![CodeQL](https://github.com/whitebreadisu/hyperspacevault/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/whitebreadisu/hyperspacevault/security/code-scanning)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Collection tracking for the Star Wars: Unlimited trading card game — a complete card
catalog with daily market prices, and a private, isolated vault for every signed-in
collector.

**Live app:** [www.hyperspacevault.com](https://www.hyperspacevault.com)

*Built end-to-end with AI-assisted engineering — owner-directed sessions, agent-executed
implementation; [HISTORY.md](HISTORY.md) chronicles the arc.*

## What it does

- **Complete card catalog** with a two-axis variant model — every printing, finish, and
  treatment (Hyperspace, Showcase, Prestige, serialized chase cards) resolved and browsable
- **Daily market prices** (TCGplayer data via tcgcsv.com, always attributed and dated) with
  multi-year price history per variant
- **A private vault per collector** — track exactly what you own, per finish; tenant
  isolation enforced in the database by Postgres Row-Level Security
- **Deck check** — price any decklist against the market and against what you already own
- **Collection value** — market/low valuation with per-finish and unit-value breakdowns
- **Import/export** — full-collection portability in and out

## Architecture

Three medium-detail views, built from the as-built system:

- **[Conceptual](specification_documents/architecture/Architecture_Conceptual.md)** — what the system is and for whom: actors, domain concepts, capability model
- **[Logical](specification_documents/architecture/Architecture_Logical.md)** — components, API surface, the tenancy/RLS model, data model, ingestion pipelines
- **[Physical](specification_documents/architecture/Architecture_Physical.md)** — the GCP footprint, request path, CI/CD promotion model, environments

At a glance:

| Layer | Technology | Details |
|-------|-----------|---------|
| Frontend | React + Vite | Firebase Hosting (prod + dev); Vite dev server (local) |
| Backend | FastAPI (Python) | Cloud Run (prod + dev); Docker (local) |
| Database | PostgreSQL 16 | Cloud SQL (prod + dev); Docker (local) |
| Auth | Firebase Authentication | Catalog reads are public; vault reads/writes require a Bearer token; every user gets an isolated tenant enforced by Postgres Row-Level Security — see `specification_documents/SWU_Platform_Spec.md` §1 |
| Card images | GCS + same-origin serving | Mirrored from the official CDN into a per-env bucket (PNG + WebP renditions), served via `GET /images/cards/{file}` with immutable CDN caching; see `docs/decisions/0012-card-image-self-hosting.md` |
| Pricing | tcgcsv.com (TCGplayer data) | Daily scheduled sync + multi-year price history; prices always attributed and dated |
| Infrastructure | GCP + Terraform | One shared module per environment: Cloud Run, Cloud SQL, Artifact Registry, Secret Manager, Cloud DNS, monitoring |
| CI/CD | GitHub Actions (keyless, WIF) | Build-once / promote: tests → one image build → auto-deploy to dev; prod release via explicit `workflow_dispatch` promotion (`risk:low` changes auto-promote in-pipeline) |

**API docs:** Swagger UI (`/docs`) and ReDoc (`/redoc`) are local-development only.

The project's development history is chronicled in [HISTORY.md](HISTORY.md).

---

## Environments

| Environment | URL | Purpose |
|------------|-----|---------|
| **Production** | [www.hyperspacevault.com](https://www.hyperspacevault.com) | Live app. Deploys via explicit human-triggered promotion, or auto-promoted for `risk:low` changes. |
| **Dev** | [swu-dev-jbapps.web.app](https://swu-dev-jbapps.web.app) | Staging. Every merge auto-deploys here first; full prod fidelity (real Cloud SQL, real Firebase Auth, same Docker image). |
| **Local** | `localhost:5173` | Docker Compose + Firebase Auth Emulator. No GCP credentials needed. |

## What you can / can't run from a fresh clone

No credentials required:

- ✅ The full stack via Docker Compose (auth emulator, empty catalog), the frontend production build, and both test suites (`pytest` runs a synthetic-fixture tier; the `realdata` census tier skips cleanly when the captured export is absent).
- ❌ A populated card catalog (the swuapi export lives in private storage — bring your own capture via `SWUAPI_EXPORT_PATH` if you want data), card-image serving from GCS (the frontend falls back to the official CDN), real Firebase auth, and deploys.

## Local setup

Prerequisites: [Docker Desktop](https://www.docker.com/products/docker-desktop/), [Git](https://git-scm.com/).

```bash
git clone https://github.com/whitebreadisu/hyperspacevault.git
cd hyperspacevault
cp .env.example .env        # defaults work unmodified
docker compose up --build
```

Four services start:

| Service | Port | Description |
|---------|------|-------------|
| PostgreSQL | 5432 | Database |
| FastAPI backend | 8000 | REST API |
| React frontend | 5173 | Dev server |
| Firebase Auth Emulator | 9099 | Local auth — reserved offline project id `demo-swu`, no GCP account needed |

On startup the backend runs migrations and, if the catalog is empty, attempts to
bootstrap it from a swuapi export. The export is **not tracked in git**: it lives in
a private GCS bucket, fetched at image-build time in CI (see
`backend/app/ingestion/data/README.md`). Without credentials the app still builds
and runs — the catalog is simply empty and the bootstrap logs a warning. To get an
inventory into a fresh database, sign in and use the app's Import/Export feature.

Verify: [localhost:5173](http://localhost:5173) (app) · [localhost:8000/health](http://localhost:8000/health) (`{"status": "ok"}`) · [localhost:8000/docs](http://localhost:8000/docs) (API docs).

Stop with `docker compose down`. Local auth-emulator accounts persist across restarts (exported to a volume on clean shutdown); add `-v` to wipe everything — database and local accounts alike.

## Development workflow

- **Backend** — `./backend:/app` is bind-mounted but the container doesn't hot-reload: `docker compose restart backend` picks up changes (`--build` if dependencies changed).
- **Frontend** — Vite hot-reloads `frontend/src/` instantly.
- **Tests** — `docker compose exec backend pytest` · `docker compose exec frontend npm test`

## Project structure

```
.
├── backend/
│   ├── alembic/            # Database schema migrations
│   └── app/
│       ├── ingestion/      # swuapi catalog ingestion, startup bootstrap, image mirror
│       ├── models/         # SQLAlchemy ORM models
│       ├── repositories/   # Database query logic
│       ├── routers/        # FastAPI route handlers
│       ├── schemas/        # Pydantic response models
│       ├── services/       # Business logic
│       ├── tests/          # pytest suite (incl. the synthetic catalog fixture)
│       ├── auth.py         # Firebase token verification
│       └── database.py     # get_db() — auth + RLS tenant-context wiring
├── frontend/
│   └── src/                # api/ (authed fetch), screens/, components/
├── terraform/
│   ├── modules/app/        # Shared module: Cloud Run, Cloud SQL, Firebase, monitoring
│   └── environments/       # prod / dev / sandbox
├── specification_documents/  # Public design docs (see Documentation Map)
├── docs/decisions/           # Architecture Decision Records
├── scripts/                  # Operational helpers
└── docker-compose.yml
```

## Environment variables

Local development uses `.env` (from `.env.example`). Production values live in GCP
Secret Manager, injected into Cloud Run at runtime — never committed.

| Variable | Local default | Description |
|----------|--------------|-------------|
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | `swu_inventory` / `swu_user` / `changeme` | Database + admin/migration role |
| `APP_DB_PASSWORD` | `changeme_app` | Password for `swu_app`, the RLS-enforced app role |
| `DATABASE_URL` / `APP_DATABASE_URL` | *(derived)* | Admin DSN (Alembic/ingestion) vs. app DSN (RLS enforced) |
| `ENVIRONMENT` | *(unset)* | `"production"` on Cloud Run; disables `/docs`/`/redoc` |
| `CARD_IMAGES_BUCKET` | *(unset)* | Per-env GCS images bucket; unset locally → frontend falls back to the official CDN |
| `SWUAPI_EXPORT_PATH` | *(unset)* | Override path to a swuapi export for catalog bootstrap |

## Documentation map

Public design documentation — one authoritative home per domain:

| Document | Authoritative for |
|----------|-------------------|
| `specification_documents/architecture/` | The three architecture views (conceptual / logical / physical) |
| `specification_documents/SWU_Application_Spec.md` | The application — data model, variant model, UX (as-built) |
| `specification_documents/SWU_Standard_Variant_Mapping_Spec.md` | The variant-resolution mechanism; current exceptions in `swuapi_standard_variant_exceptions.md` |
| `specification_documents/CARD_RULES.md` | Card-catalog domain rules (frozen; enforced by tests) |
| `specification_documents/SWU_Platform_Spec.md` | Platform — auth/tenancy, CI/CD, Terraform, observability, security (as-built) |
| `specification_documents/SWU_Platform_Security_Review.md` | Full security walkthrough (OWASP Top 10, secrets, network) |
| `docs/decisions/` | Architecture Decision Records — why the key decisions were made |
| [HISTORY.md](HISTORY.md) | The development chronicle |

Docs occasionally reference `BL-###` work-item ids, internal analysis documents, or the
project's original working name (*SWU Inventory Manager*) — those point into a private
engineering archive (working records, session logs, evidence docs) that isn't part of
this repository.

## License

Code is [MIT-licensed](LICENSE) (© 2026 whitebreadisu). The license covers the code
only — it does **not** cover Star Wars: Unlimited card data, images, logos, set
iconography, or other material owned by Disney and/or Fantasy Flight Games, which
appear here solely for this non-commercial fan project's UI. HyperspaceVault is not
affiliated with, endorsed by, or associated with Disney, Lucasfilm Ltd., or Fantasy
Flight Games. Card *data* (rules text) is deliberately not tracked in this
repository, and card prices shown in the app are provided via TCGplayer data with
attribution.
