# ADR-0016: Social-provider collisions resolve by native auto-link — one account per email, providers become mechanical

## Status
Accepted — 2026-07-20 (decision made in the 2026-07-15 design session; recorded here after a five-day documentation gap — see `Session_Notes_Statusline_BL135_2026-07-15.md` phase 3 for the original conversation)

## Context
BL-117 is the keystone spike gating every social provider (BL-118 Google, BL-119 Apple, BL-120 Facebook): tenants key off the Firebase UID, so the identity-collision policy decides whether a returning user keeps their inventory. The nightmare case: an email/password user later clicks "Sign in with Google" with the same address and gets a *new* UID — "where did my collection go?"

Facts verified live in prod during the 2026-07-15 session:
- **One-account-per-email** is the active Firebase setting (multiple-accounts-per-email was never enabled).
- **Email enumeration protection is ON** (`enableImprovedEmailPrivacy: true`) — consequence: `fetchSignInMethodsForEmail` returns empty, so the UI *cannot* pre-detect "this email already has an account via provider X" and must react to error codes at sign-in attempt time instead.
- No identity providers are currently enabled; reauthentication (BL-88 recent-auth gate on Delete Account / Change Password) is password-only today — a provider-only user could not pass it.

Alternatives considered for collisions:
- **Multiple accounts per email**: each provider mints its own UID. Rejected — guarantees the split-inventory failure mode; no upside for this app.
- **Manual linking UX** (block the collision, walk the user through sign-in-then-link): maximal explicitness, but adds an interstitial flow the user didn't ask for, and Firebase's native trusted-provider behavior already produces the correct end state.

## Decision
1. **Collisions resolve by Firebase's native auto-link, surfaced with a message.** With one-account-per-email kept ON, a Google sign-in matching an existing password account keeps the **same UID** — inventory intact. Firebase's trusted-provider rules apply: if the existing password account was **verified**, Google links alongside the password (both work); if it was **unverified**, the account becomes verified and the password credential is **unlinked** (Google becomes the way in — the user can set a new password via BL-116 reset if they want one). The UI acknowledges what happened in-modal rather than doing it silently.
2. **The reverse collision** (Google-first user later tries to *register* with email/password) is handled at error time — `email-already-in-use` → message directing them to the provider button. No pre-detection (enumeration protection makes it impossible anyway, and stays ON).
3. **Provider reauth ships inside BL-118, not as a follow-up.** The BL-88 recent-auth gate gains `reauthenticateWithPopup` for provider users; Change Password is hidden for accounts with no password credential. Google sign-in ships whole — no window where a Google-only user can't delete their account.
4. **Passwordless email-link sign-in is deferred with a named revisit trigger: BL-94 layer 1.** Every email-link sign-in depends on an email arriving, and that channel currently lands in spam — the exact failure stalling real signups. Revisit as part of, or immediately after, BL-94's custom-sender-domain work; recorded on BL-94's backlog entry so the trigger travels with the work.
5. **Apple (BL-119) and Facebook (BL-120) statuses are unchanged** — Apple gated on the $99/yr developer-program cost decision; Facebook deliberately deferred (it hands Firebase *unverified* emails, colliding with the BL-16 `email_verified` mutation gate — a policy carve-out this ADR explicitly does not grant).

## Consequences
- + BL-118 is unblocked and mechanical: console enablement, branded button, popup-with-redirect-fallback, collision message, popup reauth. Backend untouched (token validation is provider-agnostic).
- + The auto-link unverified path would have *rescued* both currently-stuck signups (unverified password accounts → one Google click = verified, same account).
- + Enumeration protection stays ON — a deliberate trade of pre-detection UX for privacy.
- − Auto-unlink of an unverified password credential can surprise a user who remembers setting a password; mitigated by the in-modal message and BL-116 reset.
- − Error-code-driven collision UX means the AuthModal needs solid handling for `email-already-in-use` / `account-exists-with-different-credential` rather than a tailored pre-flight message.
- − Passwordless deferral leaves "no password, no Google" users with no path — accepted; 3 of 4 real signups to date are Gmail.
