# Components, contracts, and the data model

*HyperspaceVault · Architecture · View 2 of 3 — Logical*

A React single-page app talks to one FastAPI service over REST; PostgreSQL holds both the shared catalog and per-tenant vaults, with tenant isolation enforced by the database itself. Around that core sit the ingestion pipelines that keep catalog, images, and prices current.

*Prepared 2026-07-28 · Companion views: [Conceptual](Architecture_Conceptual.md) (domain & actors) · [Physical](Architecture_Physical.md) (deployment & delivery)*

## Component layering

Both sides of the wire enforce a strict internal layering. The frontend keeps all server talk in thin fetch wrappers over one auth-aware client; the backend keeps routers free of logic, pushing it down through services to repositories.

**Logical components**

```mermaid
flowchart TB
  subgraph browser["Browser — React 19 + Vite SPA (TypeScript)"]
    views["Views (state-driven, no router):<br/>Vault (cards) · Deck Check · Settings · Import/Export"]
    comps["Screen components: CardsTable / GalleryGrid /<br/>CardPopup · AddCardsModal · FilterPanel · DeckCheck"]
    ctx["Contexts: Auth · Limits<br/>(client pre-checks; server is enforcer of record)"]
    api["api/* fetch wrappers → authedFetch<br/>(attaches Firebase ID token when signed in)"]
    views --> comps --> ctx --> api
  end

  subgraph backend["FastAPI service — Python 3.12, REST/JSON"]
    mw["Middleware: gzip · CORS (dev only) · structured JSON logging<br/>· security headers · proxy headers"]
    routers["Routers (no logic):<br/>sets · base-cards · catalog · images · inventory<br/>· settings · deck-check · feedback · account"]
    services["Services (domain logic:<br/>resolution, limits, pricing modes, import/export)"]
    repos["Repositories (SQL) → SQLAlchemy models"]
    mw --> routers --> services --> repos
  end

  subgraph data["Data"]
    pg[("PostgreSQL 16<br/>catalog (global) + vaults (RLS)")]
    gcs[("Object storage<br/>card images + WebP renditions")]
  end

  firebase["Firebase Auth"]

  api -->|"REST /api/**, /images/**"| mw
  repos --> pg
  routers -->|"image streaming"| gcs
  mw -.->|"verify ID token"| firebase

  classDef store fill:#F3E9D4,stroke:#8A6116;
  class pg,gcs store;
```

## API surface

| Route group | Purpose | Access |
|---|---|---|
| `/api/sets` | Set list and detail | `PUBLIC · CDN-CACHED` |
| `/api/base-cards` | Catalog list & card detail, price history; detail merges in your quantities when signed in | `PUBLIC` `(OPTIONAL AUTH)` |
| `/images/cards/*` | Card image streaming (3 renditions) | `PUBLIC · 1-YEAR IMMUTABLE CACHE` |
| `/api/catalog/reference.csv` | Resolution-key reference for importers | `PUBLIC` |
| `/api/inventory` | Quantities, increment / decrement, import / export | `AUTH · MUTATIONS + EXPORT NEED VERIFIED EMAIL` |
| `/api/deck-check` | Ephemeral three-scope deck diff with pricing | `AUTH` |
| `/api/settings/limits` | Keep-limit matrix, hard/soft cap mode | `AUTH` |
| `/api/feedback` | Feedback → GitHub issue (best-effort) | `OPTIONAL AUTH · RATE-LIMITED` |
| `/api/account` | Idempotent full-tenant delete | `AUTH + 5-MIN RECENT RE-AUTH` |

Auth requirements are expressed as a ladder of FastAPI dependencies — each endpoint declares exactly the trust level it needs: tenant-less catalog access, optional auth, required auth (which auto-provisions the user and tenant on first contact), verified email, and finally recent re-authentication for account deletion.

## Identity and tenant isolation

The load-bearing decision: **isolation is enforced by Postgres row-level security, not by application code**. Every request runs as a database role that cannot bypass RLS; the request's identity is injected as session variables, and policies do the filtering. A forgotten `WHERE tenant_id = …` in application SQL returns zero rows instead of another collector's vault.

**Authenticated request — token to tenant-scoped rows**

```mermaid
sequenceDiagram
  participant B as Browser (SPA)
  participant FA as Firebase Auth
  participant API as FastAPI
  participant PG as Postgres (app role, cannot bypass RLS)

  B->>FA: sign in (email+password or Google)
  FA-->>B: ID token
  B->>API: GET /api/inventory/quantities — Bearer ID token
  API->>API: verify token via firebase-admin (runtime service account — no shared secret)
  Note over API,PG: first authenticated request auto-provisions the user and their tenant
  API->>PG: set session vars: firebase_uid, tenant_id
  API->>PG: query inventory
  Note over PG: RLS policies filter every table to the session's tenant — an unset tenant matches zero rows, not everything
  PG-->>API: this tenant's rows only
  API-->>B: JSON (private, no-store)
```

- **Two database roles by design:** a privileged role (may bypass RLS) used only by migrations and ingestion pipelines; an application role (cannot bypass RLS) used by every request. The session is pinned to one pooled connection for the request's life so the identity variables can't leak across requests.
- **Fail-closed policies:** the tenant-matching expression was hardened so a missing or cleared tenant matches *no* rows — there is no default-tenant fallback.
- **One user = one tenant**, auto-provisioned; the tenants table itself is scoped by server-derived filters (deletes only), everything tenant-owned is under forced RLS.

## Data model

Three clusters: the global catalog, global pricing keyed to catalog variants, and the tenant-scoped vault tables. Amber marks tables under **forced row-level security**.

**Core tables and relationships (medium detail)**

```mermaid
flowchart LR
  subgraph catalog["Catalog — global, no tenant"]
    sets["sets"]
    base_cards["base_cards<br/>one design per base set<br/>standard_variant_id → its Standard printing"]
    card_variants["card_variants<br/>a physical printing<br/>upsert key: swuapi_id"]
    attrs["card_aspects · card_keywords · card_traits"]
    sets --> base_cards --> card_variants
    base_cards --> attrs
  end

  subgraph pricing["Pricing — global"]
    products["tcgplayer_products<br/>variant ↔ TCGplayer product mapping"]
    prices["variant_prices<br/>one row per variant per day (~3.4M rows)"]
    latest["variant_latest_prices<br/>hot-path snapshot (~7.5k rows)"]
    card_variants --> products
    products --> prices
    products --> latest
  end

  subgraph vault["Vault — tenant-scoped"]
    tenants["tenants"]
    users["users (RLS: self-access)"]
    inventory["inventory<br/>(tenant, variant) → quantity"]
    limits["tenant_card_limits · tenant_settings"]
    feedback["feedback (tenant optional)"]
    tenants --> inventory
    tenants --> limits
    users --- tenants
    tenants -.-> feedback
  end

  inventory -->|"variant_id"| card_variants

  classDef rls fill:#F3E9D4,stroke:#8A6116,stroke-width:2px;
  class users,inventory,limits,feedback rls;
```

- **History vs. hot path:** daily prices append to a history table (866 days of depth for charts); a separate latest-price snapshot keeps list-view reads flat regardless of history size.
- **Idempotent catalog writes:** ingestion upserts on the source system's stable ID, so a re-run of the same export is a no-op — additive, single-transaction, safe to retry.
- **Variant classification is derived, not stored:** the raw source label is kept verbatim; finish and channel are computed on read by the same classifier ingestion uses — one source of truth, no denormalization drift.

## Data pipelines — automated vs. operator-gated

**Ingestion flows (dashed = operator-run)**

```mermaid
flowchart LR
  swuapi["swuapi.com"] -.->|"content runbook:<br/>diff → dated export → verify"| ingest["catalog ingestion<br/>root resolution + classification,<br/>idempotent upsert"]
  ingest --> pg[("Postgres catalog")]
  swucdn["Official SWU CDN"] -.->|"throttled backfill after each refresh"| images["image mirror<br/>PNG + 320/640 WebP"]
  images --> gcs[("Object storage")]
  tcgcsv["tcgcsv.com"] -->|"daily 20:30 UTC, scheduled"| sync["price-sync job"]
  sync --> pp[("variant_prices<br/>+ latest snapshot")]
  tcgcsv -.->|"name+tier mapping run,<br/>rides every catalog refresh"| map["price mapping"]
  map --> tp[("tcgplayer_products")]
  user["Collector"] -->|"two-stage import:<br/>dry-run → commit"| impexp["import / export<br/>(JSON canonical, CSV derived)"]
  impexp --> inv[("inventory")]

  classDef store fill:#F3E9D4,stroke:#8A6116;
  class pg,gcs,pp,tp,inv store;
```

| Flow | Cadence | Trigger |
|---|---|---|
| Price sync (daily builds) | Daily, 20:30 UTC | `AUTOMATED` — scheduler |
| Catalog refresh + image backfill | Per new set / content change | `OPERATOR RUNBOOK` — verified end-to-end, prod gated |
| Price mapping | With every catalog refresh | `OPERATOR` — new printings never price without it |
| Price history backfill | One-time (complete) | `OPERATOR` — resumable archive walk, 3.4M rows |
| Inventory import / export | On demand | `COLLECTOR` — dry-run preview, then one-transaction commit |

> **Honest caveat baked into the design:** catalog *currency detection* is manual today — there is no automated "new set appeared" watcher. That is a documented operating decision (runbook-driven content), not an accident; automating detection is tracked backlog work.

---

*Prepared 2026-07-28 from the as-built system; companion views: [Conceptual](Architecture_Conceptual.md) · [Physical](Architecture_Physical.md)*
