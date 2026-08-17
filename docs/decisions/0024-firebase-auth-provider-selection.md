# ADR-0024: Firebase Authentication over Auth0 / Clerk / Supabase Auth

## Status
Accepted — P5 choice; recorded retroactively 2026-08-17 (BL-233 rationale extraction from Platform Spec §1.7.4)

## Context
P5 needed an auth platform. The choice recorded here is the *platform*
selection (Firebase Auth — the free tier of GCP Identity Platform — vs.
Auth0/Clerk/Supabase Auth), not a claim about which sign-in methods would
ever be enabled within it: launch was Email/Password only, and Google
sign-in (BL-118) + password reset (BL-116) were added 2026-07-20 without
revisiting this decision.

| | **Firebase Auth (selected)** | Auth0 | Clerk | Supabase Auth |
|---|---|---|---|---|
| Cost at hobby scale | Free, no practical cap for email/password | Free to ~7,500 MAU, then per-MAU | Free to ~10,000 MAU, then per-MAU | Generous free tier, scoped to a Supabase project |
| GCP-native integration | Same Firebase project already used for Hosting; Cloud Run verifies tokens via ADC, no new secret | None — separate vendor/dashboard/credentials | None | None — second database-adjacent vendor alongside Cloud SQL |
| Frontend DX (React) | Solid official SDK; build-your-own forms | Excellent docs, hosted login page | Best-in-class prebuilt `<SignIn>`/`<SignUp>` | Solid SDK, less-polished prebuilt UI |
| Portability off GCP | Lower — coupled to Firebase/GCP | High | High | Medium — coupled to Supabase |

## Decision
**Firebase Authentication**, enabled via `google_identity_platform_config`.
What tipped it: zero new vendor/dashboard, reuse of the existing Firebase
project, and consistency with the platform's GCP-first reasoning from P1.

## Consequences
- **+** No new vendor, account, secret, or dashboard; token verification on
  Cloud Run rides ADC with no Secret Manager entry.
- **+** Later provider additions (Google sign-in, collision policy
  ADR-0016) happened inside the platform with no migration.
- **−** Portability off GCP is the price — leaving Firebase Auth later means
  a real user-migration project.
- **−** Build-your-own forms: no prebuilt hosted login (Clerk's headline
  advantage foregone).

**Revisit if:** enterprise SSO (SAML/OIDC) is ever needed — Identity
Platform's paid tier covers it without switching providers — or portability
off GCP becomes a priority. Original prose: Platform Spec archive
(§1.7.4, extracted 2026-08-17).
