import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { VerifyEmailBanner } from "./VerifyEmailBanner";

const { mockUseAuth, mockSendEmailVerification } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockSendEmailVerification: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: mockUseAuth,
}));

vi.mock("firebase/auth", () => ({
  sendEmailVerification: mockSendEmailVerification,
}));

const fakeUser = { email: "a@b.com" };

describe("VerifyEmailBanner (BL-16)", () => {
  beforeEach(() => {
    mockSendEmailVerification.mockReset();
  });

  it("renders nothing when there is no signed-in user", () => {
    mockUseAuth.mockReturnValue({
      user: null,
      emailVerified: false,
      refreshEmailVerified: vi.fn(),
    });
    const { container } = render(<VerifyEmailBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the signed-in user is verified", () => {
    mockUseAuth.mockReturnValue({
      user: fakeUser,
      emailVerified: true,
      refreshEmailVerified: vi.fn(),
    });
    const { container } = render(<VerifyEmailBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the banner for a signed-in, unverified user", () => {
    mockUseAuth.mockReturnValue({
      user: fakeUser,
      emailVerified: false,
      refreshEmailVerified: vi.fn(),
    });
    render(<VerifyEmailBanner />);
    expect(screen.getByText("Verify your email to manage inventory")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resend email/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /i've verified/i })).toBeInTheDocument();
  });

  it("has no dismiss/close control", () => {
    mockUseAuth.mockReturnValue({
      user: fakeUser,
      emailVerified: false,
      refreshEmailVerified: vi.fn(),
    });
    render(<VerifyEmailBanner />);
    expect(screen.queryByRole("button", { name: /close|dismiss/i })).not.toBeInTheDocument();
  });

  // DISPOSITION (BL-95, REPLACE): sendEmailVerification's call signature
  // grew a second argument (actionCodeSettings) so the email's action link
  // points at our own origin (VerifyEmailAction) instead of Firebase's
  // hosted __/auth/action dead end -- the "called with the current user"
  // assertion survives, extended to also assert the new argument.
  //
  // DISPOSITION (BL-95 continue-URL marker, REPLACE): action-URL
  // customization is confirmed blocked on this project, so the link still
  // bounces through Firebase's hosted page -- but its "Continue" button now
  // carries an `emailVerified=1` marker back to our origin (see AuthModal's
  // matching call site). The "points at our origin" assertion survives; the
  // exact URL now includes the marker.
  it("Resend calls sendEmailVerification with the current user + actionCodeSettings with the marker and shows a sent confirmation", async () => {
    mockUseAuth.mockReturnValue({
      user: fakeUser,
      emailVerified: false,
      refreshEmailVerified: vi.fn(),
    });
    mockSendEmailVerification.mockResolvedValue(undefined);
    render(<VerifyEmailBanner />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /resend email/i }));
    });

    expect(mockSendEmailVerification).toHaveBeenCalledWith(fakeUser, {
      url: `${window.location.origin}/?emailVerified=1`,
    });
    expect(screen.getByRole("button", { name: /email sent/i })).toBeInTheDocument();
  });

  // DISPOSITION (BL-94, CREATE): net-new spam-folder hint copy alongside the
  // "Email sent" confirmation.
  it("shows the spam-folder hint once the resend succeeds", async () => {
    mockUseAuth.mockReturnValue({
      user: fakeUser,
      emailVerified: false,
      refreshEmailVerified: vi.fn(),
    });
    mockSendEmailVerification.mockResolvedValue(undefined);
    render(<VerifyEmailBanner />);

    expect(screen.queryByText(/check your spam folder/i)).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /resend email/i }));
    });

    expect(screen.getByText(/check your spam folder/i)).toBeInTheDocument();
  });

  it("disables Resend during its cooldown after a successful send", async () => {
    mockUseAuth.mockReturnValue({
      user: fakeUser,
      emailVerified: false,
      refreshEmailVerified: vi.fn(),
    });
    mockSendEmailVerification.mockResolvedValue(undefined);
    render(<VerifyEmailBanner />);

    const resendBtn = screen.getByRole("button", { name: /resend email/i });
    await act(async () => {
      fireEvent.click(resendBtn);
    });

    expect(screen.getByRole("button", { name: /email sent/i })).toBeDisabled();
  });

  it("shows an error message when resend fails", async () => {
    mockUseAuth.mockReturnValue({
      user: fakeUser,
      emailVerified: false,
      refreshEmailVerified: vi.fn(),
    });
    mockSendEmailVerification.mockRejectedValue(new Error("rate limited"));
    render(<VerifyEmailBanner />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /resend email/i }));
    });

    expect(screen.getByText(/couldn't resend/i)).toBeInTheDocument();
    // Not stuck on cooldown -- a failed send should be retryable immediately.
    expect(screen.getByRole("button", { name: /resend email/i })).not.toBeDisabled();
  });

  it("I've verified calls refreshEmailVerified", async () => {
    const refreshEmailVerified = vi.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({ user: fakeUser, emailVerified: false, refreshEmailVerified });
    render(<VerifyEmailBanner />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /i've verified/i }));
    });

    expect(refreshEmailVerified).toHaveBeenCalledTimes(1);
  });

  it("removes the banner once refreshEmailVerified confirms verification", async () => {
    // Simulates the real AuthContext: refreshEmailVerified flips
    // emailVerified to true, which flows back through useAuth() on rerender.
    let verified = false;
    const refreshEmailVerified = vi.fn().mockImplementation(async () => {
      verified = true;
    });
    mockUseAuth.mockImplementation(() => ({
      user: fakeUser,
      emailVerified: verified,
      refreshEmailVerified,
    }));

    const { rerender } = render(<VerifyEmailBanner />);
    expect(screen.getByText("Verify your email to manage inventory")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /i've verified/i }));
    });
    rerender(<VerifyEmailBanner />);

    expect(screen.queryByText("Verify your email to manage inventory")).not.toBeInTheDocument();
  });

  it("shows an error message when the verification check fails", async () => {
    const refreshEmailVerified = vi.fn().mockRejectedValue(new Error("network error"));
    mockUseAuth.mockReturnValue({ user: fakeUser, emailVerified: false, refreshEmailVerified });
    render(<VerifyEmailBanner />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /i've verified/i }));
    });

    expect(screen.getByText(/couldn't check verification status/i)).toBeInTheDocument();
  });
});
