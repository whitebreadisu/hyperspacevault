# ADR-0022: CI authenticates to GCP via Workload Identity Federation, never service-account keys

## Status
Accepted — P1 choice; recorded retroactively 2026-08-17 (BL-233 rationale extraction from Platform Spec §2.7.1)

## Context
GitHub Actions needs GCP credentials to run `terraform apply` (ADR-0010) and
the deploy jobs. The default-easy answer — export a service-account JSON key
and put it in GitHub secrets — creates a long-lived, exfiltratable credential
that must be rotated by hand and grants whoever holds the file the SA's full
power from anywhere.

## Decision
Use **Workload Identity Federation**: GitHub Actions exchanges its
short-lived OIDC token for GCP credentials at run time. **No JSON key files
exist anywhere** — not in git, not in GitHub secrets. The trust is doubly
scoped to this repository: the WIF provider carries
`attribute_condition = "assertion.repository == 'whitebreadisu/hyperspacevault'"`,
belt-and-suspenders with the repository-scoped `principalSet://...`
binding on the `terraform-ci` SA itself. Only `terraform-ci` is WIF-bound;
`backend-runtime` is assumed solely by Cloud Run at runtime via Application
Default Credentials, never by CI.

## Consequences
- **+** Nothing to leak or rotate: credentials are minted per run and expire.
- **+** Repo-scoped trust — a fork or another repo presenting GitHub OIDC
  tokens cannot impersonate CI.
- **+** Anchors the platform's wider keyless/minimal-IAM posture (referenced
  by ADR-0010's consequences and the billing-budget decision in Platform
  Spec §4.6).
- **−** WIF pool/provider/binding wiring is more setup than pasting a key,
  and debugging a failed token exchange is less obvious than a bad secret.
- **−** Repo compromise (a malicious workflow on `main`) still yields live
  CI credentials for a run's duration — WIF narrows the window, it doesn't
  eliminate the class (see ADR-0010's blast-radius consequence).

**Related:** ADR-0010 (what CI does with these credentials), Platform Spec
§3.4 (IAM bindings as-built). Original prose: Platform Spec archive
(§2.7.1, extracted 2026-08-17).
