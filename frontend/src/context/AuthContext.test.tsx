import { render, screen, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";
import { auth } from "../firebase";
import { AUTH_CHANNEL_NAME, TAB_ID } from "../utils/authChannel";

const { authStateCallbacks, mockSignOut, mockGetRedirectResult } = vi.hoisted(() => ({
  authStateCallbacks: [] as Array<(user: unknown) => void>,
  mockSignOut: vi.fn(),
  mockGetRedirectResult: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({})),
  connectAuthEmulator: vi.fn(),
  onAuthStateChanged: vi.fn((_auth: unknown, cb: (user: unknown) => void) => {
    authStateCallbacks.push(cb);
    return vi.fn();
  }),
  signOut: mockSignOut,
  getRedirectResult: mockGetRedirectResult,
}));

function Consumer() {
  const { user, loading, logout, emailVerified, refreshEmailVerified } = useAuth();
  if (loading) return <p>loading</p>;
  return (
    <div>
      <p>{user ? `signed in as ${(user as { email: string }).email}` : "signed out"}</p>
      <p>{emailVerified ? "email verified" : "email not verified"}</p>
      <button onClick={() => logout()}>Log Out</button>
      <button onClick={() => refreshEmailVerified()}>Refresh Verification</button>
    </div>
  );
}

describe("AuthContext", () => {
  beforeEach(() => {
    authStateCallbacks.length = 0;
    mockSignOut.mockClear();
    mockGetRedirectResult.mockReset();
    mockGetRedirectResult.mockResolvedValue(null);
  });

  it("shows a loading state until onAuthStateChanged fires", () => {
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    expect(screen.getByText("loading")).toBeInTheDocument();
  });

  it("reports signed-out once onAuthStateChanged resolves to null", () => {
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    act(() => authStateCallbacks[0](null));
    expect(screen.getByText("signed out")).toBeInTheDocument();
  });

  it("reports the signed-in user once onAuthStateChanged resolves", () => {
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    act(() => authStateCallbacks[0]({ email: "a@b.com" }));
    expect(screen.getByText("signed in as a@b.com")).toBeInTheDocument();
  });

  it("logout calls firebase signOut", () => {
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    act(() => authStateCallbacks[0]({ email: "a@b.com" }));
    screen.getByRole("button", { name: /log out/i }).click();
    expect(mockSignOut).toHaveBeenCalled();
  });

  // DISPOSITION (BL-16, CREATE): net-new emailVerified/refreshEmailVerified
  // surface -- no prior AuthContext behavior to port.
  it("mirrors emailVerified from the signed-in user", () => {
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    act(() => authStateCallbacks[0]({ email: "a@b.com", emailVerified: false }));
    expect(screen.getByText("email not verified")).toBeInTheDocument();
  });

  it("reports verified once onAuthStateChanged resolves with emailVerified true", () => {
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    act(() => authStateCallbacks[0]({ email: "a@b.com", emailVerified: true }));
    expect(screen.getByText("email verified")).toBeInTheDocument();
  });

  // BL-118: Google users are born verified -- Firebase itself sets
  // emailVerified: true on the User object for a google.com-provider
  // sign-in, so no AuthContext code change was needed for this to work;
  // this test exists to confirm that (the existing `emailVerified` mirror
  // logic above already reads it generically, provider-agnostic) rather
  // than to protect anything net-new.
  it("mirrors emailVerified true for a Google-provider user (born-verified)", () => {
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    act(() =>
      authStateCallbacks[0]({
        email: "g@b.com",
        emailVerified: true,
        providerData: [{ providerId: "google.com" }],
      })
    );
    expect(screen.getByText("email verified")).toBeInTheDocument();
  });

  // DISPOSITION (BL-118, CREATE): net-new coverage for the
  // signInWithRedirect completion path -- getRedirectResult must run once on
  // every load (a no-op on every normal load, since it resolves to null
  // whenever there's no pending redirect) so a blocked-popup Google sign-in
  // that fell back to a redirect actually gets picked up on the page that
  // reloads after the browser navigates back.
  describe("Google redirect-result completion (BL-118)", () => {
    it("calls getRedirectResult on mount", () => {
      render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      );
      expect(mockGetRedirectResult).toHaveBeenCalledTimes(1);
    });

    it("does not throw or leave the provider in a broken state when getRedirectResult rejects", async () => {
      mockGetRedirectResult.mockRejectedValue(
        Object.assign(new Error("collision"), {
          code: "auth/account-exists-with-different-credential",
        })
      );
      expect(() =>
        render(
          <AuthProvider>
            <Consumer />
          </AuthProvider>
        )
      ).not.toThrow();

      act(() => authStateCallbacks[0](null));
      expect(screen.getByText("signed out")).toBeInTheDocument();
    });
  });

  it("refreshEmailVerified reloads the user, force-refreshes the token, and updates emailVerified", async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    const getIdToken = vi.fn().mockResolvedValue("fresh-token");
    // Mutated in place after reload(), mirroring the real SDK's behavior --
    // this is exactly the "same object reference" trap the emailVerified
    // primitive state in AuthContext works around (see its docstring).
    const currentUser = { email: "a@b.com", emailVerified: false, reload, getIdToken };
    reload.mockImplementation(async () => {
      currentUser.emailVerified = true;
    });
    (auth as unknown as { currentUser: unknown }).currentUser = currentUser;

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    act(() => authStateCallbacks[0](currentUser));
    expect(screen.getByText("email not verified")).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: /refresh verification/i }).click();
    });

    expect(reload).toHaveBeenCalled();
    expect(getIdToken).toHaveBeenCalledWith(true);
    expect(screen.getByText("email verified")).toBeInTheDocument();
  });

  it("refreshEmailVerified with no current user sets emailVerified false", async () => {
    (auth as unknown as { currentUser: unknown }).currentUser = null;

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    act(() => authStateCallbacks[0](null));

    await act(async () => {
      screen.getByRole("button", { name: /refresh verification/i }).click();
    });

    expect(screen.getByText("email not verified")).toBeInTheDocument();
  });

  // BL-95 cross-tab sync: AuthContext is the "original tab" half -- it
  // listens on the shared BroadcastChannel for what VerifyEmailAction (the
  // landing tab) posts. These simulate "another tab" via a raw, independent
  // BroadcastChannel object rather than going through utils/authChannel's
  // createAuthChannel(), the same way a genuinely separate browser tab
  // would show up.
  describe("cross-tab sync (BL-95)", () => {
    it("refreshes emailVerified when another tab announces email-verified, while signed in", async () => {
      const reload = vi.fn().mockResolvedValue(undefined);
      const getIdToken = vi.fn().mockResolvedValue("fresh-token");
      const currentUser = { email: "a@b.com", emailVerified: false, reload, getIdToken };
      reload.mockImplementation(async () => {
        currentUser.emailVerified = true;
      });
      (auth as unknown as { currentUser: unknown }).currentUser = currentUser;

      render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      );
      act(() => authStateCallbacks[0](currentUser));
      expect(screen.getByText("email not verified")).toBeInTheDocument();

      const otherTab = new BroadcastChannel(AUTH_CHANNEL_NAME);
      otherTab.postMessage({ type: "email-verified", tabId: "fake-other-tab" });

      await waitFor(() => expect(reload).toHaveBeenCalled());
      expect(getIdToken).toHaveBeenCalledWith(true);
      await waitFor(() => expect(screen.getByText("email verified")).toBeInTheDocument());

      otherTab.close();
    });

    it("guard: does not act on email-verified when this tab has no signed-in user", async () => {
      (auth as unknown as { currentUser: unknown }).currentUser = null;

      render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      );
      act(() => authStateCallbacks[0](null));

      const otherTab = new BroadcastChannel(AUTH_CHANNEL_NAME);
      otherTab.postMessage({ type: "email-verified", tabId: "fake-other-tab" });

      // Nothing to await for a no-op -- give any (incorrect) async work a
      // beat to happen, then assert the DOM never changed.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.getByText("email not verified")).toBeInTheDocument();

      otherTab.close();
    });

    it("answers a ping from another tab with a pong", async () => {
      render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      );

      const otherTab = new BroadcastChannel(AUTH_CHANNEL_NAME);
      const received: unknown[] = [];
      otherTab.onmessage = (event) => received.push(event.data);
      otherTab.postMessage({ type: "ping", tabId: "fake-other-tab" });

      await waitFor(() =>
        expect(received).toContainEqual(expect.objectContaining({ type: "pong" }))
      );

      otherTab.close();
    });

    it("ignores a message carrying its own TAB_ID (same-tab loopback guard)", async () => {
      const reload = vi.fn().mockResolvedValue(undefined);
      const currentUser = {
        email: "a@b.com",
        emailVerified: false,
        reload,
        getIdToken: vi.fn().mockResolvedValue("t"),
      };
      (auth as unknown as { currentUser: unknown }).currentUser = currentUser;

      render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      );
      act(() => authStateCallbacks[0](currentUser));

      // A message carrying *this tab's own* TAB_ID -- as if a same-tab,
      // different-object sender's message looped back (see
      // utils/authChannel.ts) -- must be ignored even though its type would
      // otherwise trigger a refresh.
      const otherChannelObject = new BroadcastChannel(AUTH_CHANNEL_NAME);
      otherChannelObject.postMessage({ type: "email-verified", tabId: TAB_ID });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(reload).not.toHaveBeenCalled();

      otherChannelObject.close();
    });

    it("degrades without crashing when BroadcastChannel is unsupported", () => {
      const original = globalThis.BroadcastChannel;
      // @ts-expect-error -- simulating a browser with no BroadcastChannel
      globalThis.BroadcastChannel = undefined;

      expect(() =>
        render(
          <AuthProvider>
            <Consumer />
          </AuthProvider>
        )
      ).not.toThrow();

      globalThis.BroadcastChannel = original;
    });
  });
});
