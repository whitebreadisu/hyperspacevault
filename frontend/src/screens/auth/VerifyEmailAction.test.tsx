import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { VerifyEmailAction } from "./VerifyEmailAction";
import { auth } from "../../firebase";
import { AUTH_CHANNEL_NAME } from "../../utils/authChannel";

const {
  mockApplyActionCode,
  mockUseAuth,
  mockRefreshEmailVerified,
  mockVerifyPasswordResetCode,
  mockConfirmPasswordReset,
} = vi.hoisted(() => ({
  mockApplyActionCode: vi.fn(),
  mockUseAuth: vi.fn(),
  mockRefreshEmailVerified: vi.fn(),
  mockVerifyPasswordResetCode: vi.fn(),
  mockConfirmPasswordReset: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({})),
  connectAuthEmulator: vi.fn(),
  applyActionCode: mockApplyActionCode,
  verifyPasswordResetCode: mockVerifyPasswordResetCode,
  confirmPasswordReset: mockConfirmPasswordReset,
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: mockUseAuth,
}));

function setSearch(search: string) {
  window.history.pushState({}, "", `/${search}`);
}

describe("VerifyEmailAction (BL-95)", () => {
  beforeEach(() => {
    mockApplyActionCode.mockReset();
    mockVerifyPasswordResetCode.mockReset();
    mockConfirmPasswordReset.mockReset();
    mockRefreshEmailVerified.mockReset().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({ refreshEmailVerified: mockRefreshEmailVerified });
    (auth as unknown as { currentUser: unknown }).currentUser = null;
    // Reset the URL between tests -- the component itself mutates it via
    // history.replaceState, so a prior test's stripped URL must not leak.
    window.history.pushState({}, "", "/");
  });

  it("renders nothing and never calls applyActionCode on a normal app boot (no action params)", () => {
    setSearch("");
    const { container } = render(<VerifyEmailAction />);
    expect(container).toBeEmptyDOMElement();
    expect(mockApplyActionCode).not.toHaveBeenCalled();
  });

  // DISPOSITION (BL-95 cross-tab sync, PORT): the success-copy assertion
  // moved from a synchronous getByText (right after the render() act) to an
  // async findByText. The component now waits up to PONG_TIMEOUT_MS for a
  // same-channel "pong" before settling its status (see waitForOtherTab);
  // with no other tab open in this test, it falls through to the original
  // "success-signed-in" copy once that wait times out. The behavior this
  // test protects -- applyActionCode called, verification refreshed, params
  // stripped, correct copy shown -- is unchanged; only the timing is.
  it("success while signed in, no other tab open: applies the code, refreshes verification, strips params", async () => {
    (auth as unknown as { currentUser: unknown }).currentUser = { email: "a@b.com" };
    mockApplyActionCode.mockResolvedValue(undefined);
    setSearch("?mode=verifyEmail&oobCode=abc123");

    render(<VerifyEmailAction />);

    expect(await screen.findByText(/^email verified — welcome!$/i)).toBeInTheDocument();
    expect(mockApplyActionCode).toHaveBeenCalledWith(auth, "abc123");
    expect(mockRefreshEmailVerified).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("");
  });

  it("success while signed out: shows sign-in wording and does not call refreshEmailVerified", async () => {
    (auth as unknown as { currentUser: unknown }).currentUser = null;
    mockApplyActionCode.mockResolvedValue(undefined);
    setSearch("?mode=verifyEmail&oobCode=abc123");

    await act(async () => {
      render(<VerifyEmailAction />);
    });

    expect(mockRefreshEmailVerified).not.toHaveBeenCalled();
    expect(screen.getByText(/verified — sign in to continue/i)).toBeInTheDocument();
  });

  it("expired/already-used code: shows a clear failure message", async () => {
    mockApplyActionCode.mockRejectedValue(
      Object.assign(new Error("expired"), { code: "auth/invalid-action-code" })
    );
    setSearch("?mode=verifyEmail&oobCode=stale");

    await act(async () => {
      render(<VerifyEmailAction />);
    });

    expect(
      screen.getByText(/this verification link has expired or was already used/i)
    ).toBeInTheDocument();
  });

  // DISPOSITION (BL-116, REPLACE): resetPassword gained its own in-app flow
  // below, so it's no longer an example of "no in-app flow yet" -- swapped
  // for recoverEmail (a real Firebase action mode this component still
  // doesn't handle) to keep exercising the same graceful-fallback path.
  it("unknown mode (e.g. recoverEmail): graceful fallback, params stripped, no applyActionCode call", async () => {
    setSearch("?mode=recoverEmail&oobCode=abc123");

    await act(async () => {
      render(<VerifyEmailAction />);
    });

    expect(mockApplyActionCode).not.toHaveBeenCalled();
    expect(mockVerifyPasswordResetCode).not.toHaveBeenCalled();
    expect(screen.getByText(/isn't handled in-app yet/i)).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  // DISPOSITION (BL-95 cross-tab sync, PORT): render() is no longer wrapped
  // in `await act(async () => ...)` because the Continue button only shows
  // up once the ping/pong wait settles (see the port note above); findByRole
  // polls for it instead.
  it("Continue dismisses the landing card", async () => {
    (auth as unknown as { currentUser: unknown }).currentUser = { email: "a@b.com" };
    mockApplyActionCode.mockResolvedValue(undefined);
    setSearch("?mode=verifyEmail&oobCode=abc123");

    render(<VerifyEmailAction />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const continueButton = await screen.findByRole("button", { name: /continue/i });
    act(() => continueButton.click());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // BL-95 cross-tab sync additions below.
  describe("cross-tab sync (BL-95)", () => {
    it("announces email-verified over BroadcastChannel on success, even when signed out", async () => {
      (auth as unknown as { currentUser: unknown }).currentUser = null;
      mockApplyActionCode.mockResolvedValue(undefined);
      setSearch("?mode=verifyEmail&oobCode=abc123");

      const received: unknown[] = [];
      const listener = new BroadcastChannel(AUTH_CHANNEL_NAME);
      listener.onmessage = (event) => received.push(event.data);

      render(<VerifyEmailAction />);

      await screen.findByText(/verified — sign in to continue/i);
      await waitFor(() =>
        expect(received).toContainEqual(expect.objectContaining({ type: "email-verified" }))
      );

      listener.close();
    });

    it("another open SWU tab answers the ping: shows tab-aware copy with a secondary Continue", async () => {
      (auth as unknown as { currentUser: unknown }).currentUser = { email: "a@b.com" };
      mockApplyActionCode.mockResolvedValue(undefined);
      setSearch("?mode=verifyEmail&oobCode=abc123");

      // Simulate a second, already-open SWU tab: answers any "ping" with a
      // "pong" from a raw, independent channel object (a real separate tab
      // would likewise carry its own random TAB_ID from
      // utils/authChannel.ts, distinct from this test file's).
      const otherTab = new BroadcastChannel(AUTH_CHANNEL_NAME);
      otherTab.onmessage = (event) => {
        if ((event.data as { type: string }).type === "ping") {
          otherTab.postMessage({ type: "pong", tabId: "fake-other-tab" });
        }
      };

      render(<VerifyEmailAction />);

      const synced = await screen.findByText(/other swu window is ready/i);
      expect(synced).toBeInTheDocument();
      const continueButton = screen.getByRole("button", { name: /continue/i });
      expect(continueButton.className).toContain("auth-cancel");

      otherTab.close();
    });

    it("feature check: without BroadcastChannel support, landing still succeeds", async () => {
      const original = globalThis.BroadcastChannel;
      // @ts-expect-error -- simulating a browser with no BroadcastChannel
      globalThis.BroadcastChannel = undefined;

      (auth as unknown as { currentUser: unknown }).currentUser = { email: "a@b.com" };
      mockApplyActionCode.mockResolvedValue(undefined);
      setSearch("?mode=verifyEmail&oobCode=abc123");

      render(<VerifyEmailAction />);

      expect(await screen.findByText(/^email verified — welcome!$/i)).toBeInTheDocument();

      globalThis.BroadcastChannel = original;
    });
  });

  // BL-95 continue-URL marker: action-URL customization is confirmed
  // blocked on this project, so the link still bounces through Firebase's
  // hosted __/auth/action page; its "Continue" button navigates here with
  // only the `emailVerified=1` marker (no oobCode -- the code was already
  // applied by Google's handler before the redirect).
  describe("continue-URL marker landing (BL-95)", () => {
    it("signed in: refreshes verification, broadcasts, strips the marker, never calls applyActionCode, shows success", async () => {
      (auth as unknown as { currentUser: unknown }).currentUser = { email: "a@b.com" };
      setSearch("?emailVerified=1");

      const received: unknown[] = [];
      const listener = new BroadcastChannel(AUTH_CHANNEL_NAME);
      listener.onmessage = (event) => received.push(event.data);

      render(<VerifyEmailAction />);

      expect(await screen.findByText(/^email verified — welcome!$/i)).toBeInTheDocument();
      expect(mockApplyActionCode).not.toHaveBeenCalled();
      expect(mockRefreshEmailVerified).toHaveBeenCalledTimes(1);
      expect(window.location.search).toBe("");
      await waitFor(() =>
        expect(received).toContainEqual(expect.objectContaining({ type: "email-verified" }))
      );

      listener.close();
    });

    it("signed in with another SWU tab already open: shows tab-aware copy via the same ping/pong path", async () => {
      (auth as unknown as { currentUser: unknown }).currentUser = { email: "a@b.com" };
      setSearch("?emailVerified=1");

      const otherTab = new BroadcastChannel(AUTH_CHANNEL_NAME);
      otherTab.onmessage = (event) => {
        if ((event.data as { type: string }).type === "ping") {
          otherTab.postMessage({ type: "pong", tabId: "fake-other-tab" });
        }
      };

      render(<VerifyEmailAction />);

      const synced = await screen.findByText(/other swu window is ready/i);
      expect(synced).toBeInTheDocument();
      expect(mockApplyActionCode).not.toHaveBeenCalled();

      otherTab.close();
    });

    it("signed out: shows the signed-out success copy, does not refresh verification", async () => {
      (auth as unknown as { currentUser: unknown }).currentUser = null;
      setSearch("?emailVerified=1");

      render(<VerifyEmailAction />);

      expect(await screen.findByText(/verified — sign in to continue/i)).toBeInTheDocument();
      expect(mockApplyActionCode).not.toHaveBeenCalled();
      expect(mockRefreshEmailVerified).not.toHaveBeenCalled();
      expect(window.location.search).toBe("");
    });
  });

  // DISPOSITION (BL-116, CREATE): net-new password-reset landing -- no
  // prior coverage to port, since mode=resetPassword had no in-app flow
  // before this change (it fell through to the "unsupported" screen).
  describe("password reset landing (BL-116)", () => {
    async function fillResetForm(newPassword: string, confirmPassword: string) {
      fireEvent.change(await screen.findByLabelText(/^new password$/i), {
        target: { value: newPassword },
      });
      fireEvent.change(screen.getByLabelText(/confirm new password/i), {
        target: { value: confirmPassword },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^reset password$/i }));
      });
    }

    it("happy path: verifies the code, shows the account email, submits confirmPasswordReset, strips params", async () => {
      mockVerifyPasswordResetCode.mockResolvedValue("account@b.com");
      mockConfirmPasswordReset.mockResolvedValue(undefined);
      setSearch("?mode=resetPassword&oobCode=reset123");

      render(<VerifyEmailAction />);

      expect(await screen.findByText("account@b.com")).toBeInTheDocument();
      expect(mockVerifyPasswordResetCode).toHaveBeenCalledWith(auth, "reset123");
      expect(window.location.search).toBe("");

      await fillResetForm("newsecret1", "newsecret1");

      expect(mockConfirmPasswordReset).toHaveBeenCalledWith(auth, "reset123", "newsecret1");
      expect(screen.getByRole("heading", { name: /password changed/i })).toBeInTheDocument();
    });

    it("blocks submission client-side when the two new passwords don't match, without calling confirmPasswordReset", async () => {
      mockVerifyPasswordResetCode.mockResolvedValue("account@b.com");
      setSearch("?mode=resetPassword&oobCode=reset123");

      render(<VerifyEmailAction />);
      await fillResetForm("newsecret1", "newsecret2");

      expect(screen.getByText("New passwords do not match.")).toBeInTheDocument();
      expect(mockConfirmPasswordReset).not.toHaveBeenCalled();
    });

    it("expired/invalid code at verify time: shows the reset-link-issue screen", async () => {
      mockVerifyPasswordResetCode.mockRejectedValue(
        Object.assign(new Error("expired"), { code: "auth/invalid-action-code" })
      );
      setSearch("?mode=resetPassword&oobCode=stale");

      render(<VerifyEmailAction />);

      expect(
        await screen.findByText(/this password reset link has expired or was already used/i)
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /request a new reset email/i })
      ).toBeInTheDocument();
    });

    it("expired/invalid code discovered at confirm time: routes to the same reset-link-issue screen", async () => {
      mockVerifyPasswordResetCode.mockResolvedValue("account@b.com");
      mockConfirmPasswordReset.mockRejectedValue(
        Object.assign(new Error("expired"), { code: "auth/expired-action-code" })
      );
      setSearch("?mode=resetPassword&oobCode=reset123");

      render(<VerifyEmailAction />);
      await fillResetForm("newsecret1", "newsecret1");

      expect(
        screen.getByText(/this password reset link has expired or was already used/i)
      ).toBeInTheDocument();
    });

    it("weak new password: shows an inline error and stays on the form", async () => {
      mockVerifyPasswordResetCode.mockResolvedValue("account@b.com");
      mockConfirmPasswordReset.mockRejectedValue(
        Object.assign(new Error("weak"), { code: "auth/weak-password" })
      );
      setSearch("?mode=resetPassword&oobCode=reset123");

      render(<VerifyEmailAction />);
      await fillResetForm("weak12", "weak12");

      expect(
        screen.getByText("New password is too weak — use at least 6 characters.")
      ).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /choose a new password/i })).toBeInTheDocument();
    });

    it("Continue to Sign In calls onRequestSignIn and dismisses the landing", async () => {
      mockVerifyPasswordResetCode.mockResolvedValue("account@b.com");
      mockConfirmPasswordReset.mockResolvedValue(undefined);
      setSearch("?mode=resetPassword&oobCode=reset123");
      const onRequestSignIn = vi.fn();

      render(<VerifyEmailAction onRequestSignIn={onRequestSignIn} />);
      await fillResetForm("newsecret1", "newsecret1");

      fireEvent.click(screen.getByRole("button", { name: /continue to sign in/i }));

      expect(onRequestSignIn).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("Request a New Reset Email calls onRequestSignIn and dismisses the landing", async () => {
      mockVerifyPasswordResetCode.mockRejectedValue(
        Object.assign(new Error("expired"), { code: "auth/invalid-action-code" })
      );
      setSearch("?mode=resetPassword&oobCode=stale");
      const onRequestSignIn = vi.fn();

      render(<VerifyEmailAction onRequestSignIn={onRequestSignIn} />);
      const requestButton = await screen.findByRole("button", {
        name: /request a new reset email/i,
      });
      fireEvent.click(requestButton);

      expect(onRequestSignIn).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // BL-116 continue-URL marker: mirrors the emailVerified=1 marker
    // handling above -- Firebase's hosted __/auth/action page collects the
    // new password itself for resetPassword (unlike verifyEmail's one-click
    // apply), so a marker-only landing means the reset already happened.
    describe("continue-URL marker landing (BL-116)", () => {
      it("shows success directly, never calls verifyPasswordResetCode or confirmPasswordReset, strips the marker", async () => {
        setSearch("?passwordReset=1");

        render(<VerifyEmailAction />);

        expect(
          await screen.findByRole("heading", { name: /password changed/i })
        ).toBeInTheDocument();
        expect(mockVerifyPasswordResetCode).not.toHaveBeenCalled();
        expect(mockConfirmPasswordReset).not.toHaveBeenCalled();
        expect(window.location.search).toBe("");
      });
    });
  });
});
