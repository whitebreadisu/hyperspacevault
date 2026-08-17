# ADR-0025: Cloud Error Reporting over Sentry

## Status
Accepted — P6 choice; recorded retroactively 2026-08-17 (BL-233 rationale extraction from Platform Spec §4.5.1)

## Context
P6 needed error visibility. Sentry is the industry default; Cloud Error
Reporting is the GCP-native option that reads the structured logs the
platform already emits (Platform Spec §4.1).

| | **Cloud Error Reporting (selected)** | Sentry |
|---|---|---|
| Cost at hobby scale | Free, included with Cloud Logging/Cloud Run | Free to ~5K events/month, then per-event |
| Setup effort | Zero new accounts — reads existing structured logs | New account, SDK dependency, DSN secret, separate dashboard |
| Error grouping / DX | Groups by exception type + top frame; links to Cloud Logging. Functional, basic | Industry-leading grouping, release tracking, breadcrumbs, source context |
| Alerting | Same Cloud Monitoring alert policies as §4.3 — one system | Sentry's own separate alerting |
| Portability off GCP | Low | High |

## Decision
**Cloud Error Reporting.** What tipped it: zero new account/SDK/secret, and
it composes directly with the existing logging (§4.1) and alerting (§4.3) —
one pane of glass.

## Consequences
- **+** Nothing new to operate, secure, or pay for; alerting stays unified
  in Cloud Monitoring.
- **−** Basic grouping and no release tracking/breadcrumbs — triage quality
  is the accepted loss.
- **−** One more surface coupled to GCP.

**Revisit if:** error volume or team size grows enough that triage quality
("which of these 200 similar errors is new") becomes the bottleneck —
Sentry's SDK can run *alongside* continued Cloud Logging as a pure addition,
not a migration. Original prose: Platform Spec archive (§4.5.1, extracted
2026-08-17).
