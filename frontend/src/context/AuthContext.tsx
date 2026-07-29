import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { onAuthStateChanged, signOut, getRedirectResult, type User } from "firebase/auth";
import { auth } from "../firebase";
import { createAuthChannel, TAB_ID, type AuthChannelMessage } from "../utils/authChannel";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
  /** BL-16: mirrors user.emailVerified, but as its own piece of state --
   * see refreshEmailVerified below for why. */
  emailVerified: boolean;
  /** BL-16: re-fetches the current user's verification status from Firebase
   * and force-refreshes the cached ID token so the backend's next request
   * sees the updated `email_verified` claim too.
   *
   * The trap this works around: firebase/auth's `User` is a mutable class
   * instance. `user.reload()` updates *properties on that same object* in
   * place -- it does not fire onAuthStateChanged (that only fires on
   * sign-in/sign-out transitions, not property changes), so simply calling
   * `setUser(auth.currentUser)` afterwards would pass React the identical
   * object reference and skip the re-render entirely. Tracking
   * emailVerified as its own primitive state sidesteps that: this function
   * always calls setEmailVerified with a fresh boolean read after reload,
   * which React always treats as a real state change.
   *
   * getIdToken(true) forces a fresh ID token from Firebase rather than
   * serving the cached one -- reload() alone updates the *User* object but
   * not the cached token, and the cached token's email_verified claim is
   * what the backend actually checks (require_verified_email). Skipping
   * this step would clear the frontend banner while every subsequent
   * mutation still 403s against the stale claim. */
  refreshEmailVerified: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailVerified, setEmailVerified] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setEmailVerified(nextUser?.emailVerified ?? false);
      setLoading(false);
    });
  }, []);

  // BL-118: completes a signInWithRedirect Google sign-in that fell back
  // from a blocked popup (AuthModal's handleGoogleSignIn is the only caller
  // of signInWithRedirect in this app). A blocked-popup redirect navigates
  // the whole browser away and back -- AuthModal itself doesn't survive that
  // round trip (the SPA reloads from scratch), so nothing left over there
  // can pick up the result; this runs unconditionally from AuthProvider,
  // which always mounts on load, instead. onAuthStateChanged above already
  // picks up the resulting sign-in on its own once Firebase resolves the
  // pending redirect internally -- calling getRedirectResult here exists
  // only to *surface any error* the redirect completion hit (e.g. a
  // collision) and to let Firebase clear the pending-redirect state; nothing
  // reads its resolved value. On every normal (non-redirect-return) load
  // this resolves to `null` and is a no-op. A known gap (see BL-118 PR
  // description): unlike the popup path, there's no modal left mounted here
  // to show the ADR-0016 "linked to an existing account" notice for a
  // redirect completion -- the error is swallowed rather than surfaced,
  // since there's nowhere in this component to put it.
  useEffect(() => {
    getRedirectResult(auth).catch(() => {});
  }, []);

  // BL-95: cross-tab sync. The verification email link opens a *new* tab
  // (see VerifyEmailAction's docstring) -- this tab's own stale
  // "unverified" banner/state has no other way to learn the email got
  // verified. This is the "original tab" half of the sync: it listens on
  // the shared BroadcastChannel for "email-verified" (posted by
  // VerifyEmailAction on success) and refreshes this tab's verification
  // state in real time, and it answers "ping" with "pong" so a newly opened
  // landing tab can tell this tab is already open and ready. See
  // utils/authChannel.ts for why TAB_ID must gate every branch here.
  useEffect(() => {
    const channel = createAuthChannel();
    if (!channel) return; // no BroadcastChannel support -- degrade silently

    // Arrow function expression (not a `function` declaration) so
    // TypeScript preserves the `channel` non-null narrowing from the guard
    // above inside this closure.
    const onMessage = (event: MessageEvent<AuthChannelMessage>) => {
      const msg = event.data;
      if (msg.tabId === TAB_ID) return; // ignore this tab's own messages
      if (msg.type === "email-verified") {
        if (auth.currentUser) void refreshEmailVerified();
      } else if (msg.type === "ping") {
        channel.postMessage({ type: "pong", tabId: TAB_ID });
      }
    };

    channel.addEventListener("message", onMessage);
    return () => {
      channel.removeEventListener("message", onMessage);
      channel.close();
    };
    // Deliberately mount-only: refreshEmailVerified reads auth.currentUser
    // fresh at call time (same pattern its own docstring above describes),
    // so a stale closure over it is harmless -- re-subscribing on every
    // render would tear down and recreate the channel for no benefit.
  }, []);

  function logout() {
    return signOut(auth);
  }

  async function refreshEmailVerified() {
    const current = auth.currentUser;
    if (!current) {
      setEmailVerified(false);
      return;
    }
    await current.reload();
    await current.getIdToken(true);
    setEmailVerified(current.emailVerified);
  }

  return (
    <AuthContext.Provider value={{ user, loading, logout, emailVerified, refreshEmailVerified }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
