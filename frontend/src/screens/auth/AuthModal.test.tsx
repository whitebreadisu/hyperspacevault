import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthModal } from "./AuthModal";

const {
  mockSignIn,
  mockSignUp,
  mockSendEmailVerification,
  mockSendPasswordResetEmail,
  mockSignInWithPopup,
  mockSignInWithRedirect,
  mockGetAdditionalUserInfo,
  mockGoogleAuthProvider,
} = vi.hoisted(() => ({
  mockSignIn: vi.fn(),
  mockSignUp: vi.fn(),
  mockSendEmailVerification: vi.fn(),
  mockSendPasswordResetEmail: vi.fn(),
  mockSignInWithPopup: vi.fn(),
  mockSignInWithRedirect: vi.fn(),
  mockGetAdditionalUserInfo: vi.fn(),
  mockGoogleAuthProvider: vi.fn(function GoogleAuthProvider(this: object) {
    return this;
  }),
}));

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({})),
  connectAuthEmulator: vi.fn(),
  signInWithEmailAndPassword: mockSignIn,
  createUserWithEmailAndPassword: mockSignUp,
  sendEmailVerification: mockSendEmailVerification,
  sendPasswordResetEmail: mockSendPasswordResetEmail,
  GoogleAuthProvider: mockGoogleAuthProvider,
  signInWithPopup: mockSignInWithPopup,
  signInWithRedirect: mockSignInWithRedirect,
  getAdditionalUserInfo: mockGetAdditionalUserInfo,
}));

// DISPOSITION (BL-56 Slice 2, PORT from screens/auth/AuthScreen.test.tsx):
// the credential/validation/error-message behavior is unchanged -- only the
// full-screen AuthScreen component became the AuthModal component. These
// five tests are re-expressed verbatim against the new component.
describe("AuthModal form behavior (ported from AuthScreen)", () => {
  beforeEach(() => {
    mockSignIn.mockReset();
    mockSignUp.mockReset();
    mockSendEmailVerification.mockReset();
  });

  it("defaults to the login form", () => {
    render(<AuthModal onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /log in/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^log in$/i })).toBeInTheDocument();
  });

  it("switches to the signup form", () => {
    render(<AuthModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /need an account/i }));
    expect(screen.getByRole("heading", { name: /sign up/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sign up$/i })).toBeInTheDocument();
  });

  it("submits login credentials to signInWithEmailAndPassword", async () => {
    mockSignIn.mockResolvedValue(undefined);
    render(<AuthModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "secret1" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));
    });
    expect(mockSignIn).toHaveBeenCalledWith({}, "a@b.com", "secret1");
  });

  // DISPOSITION (BL-16, PORT): mockSignUp now resolves a UserCredential
  // (createUserWithEmailAndPassword's real return shape), since AuthModal
  // passes credential.user into the new sendEmailVerification call -- the
  // original assertion (mockSignUp called with the right args) is unchanged.
  it("submits signup credentials to createUserWithEmailAndPassword", async () => {
    mockSignUp.mockResolvedValue({ user: { email: "new@b.com" } });
    mockSendEmailVerification.mockResolvedValue(undefined);
    render(<AuthModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /need an account/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "new@b.com" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "secret1" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^sign up$/i }));
    });
    expect(mockSignUp).toHaveBeenCalledWith({}, "new@b.com", "secret1");
  });

  it("shows a friendly message for a known error code", async () => {
    mockSignIn.mockRejectedValue(Object.assign(new Error("bad"), { code: "auth/wrong-password" }));
    render(<AuthModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "wrongpass" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));
    });
    expect(screen.getByText("Incorrect password.")).toBeInTheDocument();
  });
});

// DISPOSITION (BL-56 Slice 2, CREATE): net-new modal-specific behavior --
// AuthScreen was full-screen and had no open/close lifecycle to test.
describe("AuthModal open/close behavior", () => {
  beforeEach(() => {
    mockSignIn.mockReset();
    mockSignUp.mockReset();
  });

  it("renders as a dialog", () => {
    render(<AuthModal onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<AuthModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked, but not when the card itself is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<AuthModal onClose={onClose} />);

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    const overlay = container.querySelector(".auth-modal-overlay")!;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<AuthModal onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// DISPOSITION (BL-16, CREATE): net-new signup-verification behavior -- no
// prior AuthModal coverage to port, since sendEmailVerification/onSignedUp/
// the "check your email" screen didn't exist before this change.
describe("AuthModal signup email verification (BL-16)", () => {
  beforeEach(() => {
    mockSignIn.mockReset();
    mockSignUp.mockReset();
    mockSendEmailVerification.mockReset();
  });

  async function signUp(email = "new@b.com") {
    fireEvent.click(screen.getByRole("button", { name: /need an account/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "secret1" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^sign up$/i }));
    });
  }

  // DISPOSITION (BL-95, REPLACE): sendEmailVerification's call signature
  // grew a second argument (actionCodeSettings) so the email's action link
  // points at our own origin (VerifyEmailAction) instead of Firebase's
  // hosted __/auth/action dead end -- the "called with the newly created
  // user" assertion survives, extended to also assert the new argument.
  //
  // DISPOSITION (BL-95 continue-URL marker, REPLACE): customizing the
  // action URL itself turned out to be blocked on this project (Identity
  // Platform admin API + Firebase Console both reject it), so the link
  // still bounces through Firebase's hosted page -- but its "Continue"
  // button now carries an `emailVerified=1` marker back to our origin, so
  // VerifyEmailAction can recognize the landing without an oobCode. The
  // "points at our origin" assertion survives; the exact URL now includes
  // the marker.
  it("calls sendEmailVerification with the newly created user and actionCodeSettings pointing at our origin with the marker", async () => {
    const fakeUser = { email: "new@b.com" };
    mockSignUp.mockResolvedValue({ user: fakeUser });
    mockSendEmailVerification.mockResolvedValue(undefined);
    render(<AuthModal onClose={vi.fn()} />);

    await signUp("new@b.com");

    expect(mockSendEmailVerification).toHaveBeenCalledWith(fakeUser, {
      url: `${window.location.origin}/?emailVerified=1`,
    });
  });

  // DISPOSITION (BL-94, CREATE): net-new spam-folder hint copy on the
  // check-your-email confirmation screen.
  it("shows the spam-folder hint on the check-your-email confirmation", async () => {
    mockSignUp.mockResolvedValue({ user: { email: "new@b.com" } });
    mockSendEmailVerification.mockResolvedValue(undefined);
    render(<AuthModal onClose={vi.fn()} />);

    await signUp("new@b.com");

    expect(screen.getByText(/check your spam folder/i)).toBeInTheDocument();
  });

  it("shows the check-your-email confirmation with the signed-up address", async () => {
    mockSignUp.mockResolvedValue({ user: { email: "new@b.com" } });
    mockSendEmailVerification.mockResolvedValue(undefined);
    render(<AuthModal onClose={vi.fn()} />);

    await signUp("new@b.com");

    expect(screen.getByRole("heading", { name: /check your email/i })).toBeInTheDocument();
    expect(screen.getByText("new@b.com")).toBeInTheDocument();
  });

  it("still shows the confirmation screen even if sendEmailVerification itself fails", async () => {
    // The account is already created at this point -- a failed verification
    // email must not be reported as a failed signup. Recovery lives in the
    // site-wide banner's own Resend action.
    mockSignUp.mockResolvedValue({ user: { email: "new@b.com" } });
    mockSendEmailVerification.mockRejectedValue(new Error("network error"));
    render(<AuthModal onClose={vi.fn()} />);

    await signUp("new@b.com");

    expect(screen.getByRole("heading", { name: /check your email/i })).toBeInTheDocument();
  });

  it("calls onClose when the confirmation screen's Continue button is clicked", async () => {
    mockSignUp.mockResolvedValue({ user: { email: "new@b.com" } });
    mockSendEmailVerification.mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<AuthModal onClose={onClose} />);

    await signUp("new@b.com");
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onSignedUp synchronously before createUserWithEmailAndPassword resolves", async () => {
    // App relies on this ordering to suppress its auto-close-on-auth effect
    // (see App.tsx's signupInFlight) -- onSignedUp must fire before
    // Firebase's onAuthStateChanged could possibly land.
    const callOrder: string[] = [];
    const onSignedUp = vi.fn(() => callOrder.push("onSignedUp"));
    mockSignUp.mockImplementation(async () => {
      callOrder.push("createUserWithEmailAndPassword resolved");
      return { user: { email: "new@b.com" } };
    });
    mockSendEmailVerification.mockResolvedValue(undefined);
    render(<AuthModal onClose={vi.fn()} onSignedUp={onSignedUp} />);

    await signUp("new@b.com");

    expect(callOrder).toEqual(["onSignedUp", "createUserWithEmailAndPassword resolved"]);
  });

  it("does not call onSignedUp on the login path", async () => {
    mockSignIn.mockResolvedValue(undefined);
    const onSignedUp = vi.fn();
    render(<AuthModal onClose={vi.fn()} onSignedUp={onSignedUp} />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "secret1" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));
    });

    expect(onSignedUp).not.toHaveBeenCalled();
  });
});

// DISPOSITION (BL-116, CREATE): net-new "Forgot password?" flow -- no prior
// AuthModal coverage to port, since the link/email-entry/confirmation
// screens didn't exist before this change.
describe("AuthModal forgot password (BL-116)", () => {
  beforeEach(() => {
    mockSignIn.mockReset();
    mockSendPasswordResetEmail.mockReset();
  });

  it("shows the Forgot password? link on the login form but not the signup form", () => {
    render(<AuthModal onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /forgot password/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /need an account/i }));
    expect(screen.queryByRole("button", { name: /forgot password/i })).not.toBeInTheDocument();
  });

  it("prefills the reset email from whatever's already typed into the login email field", () => {
    render(<AuthModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "typed@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));

    expect(screen.getByRole("heading", { name: /reset password/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toHaveValue("typed@b.com");
  });

  it("sends the reset email with actionCodeSettings carrying the BL-116 continue-URL marker", async () => {
    mockSendPasswordResetEmail.mockResolvedValue(undefined);
    render(<AuthModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "reset@b.com" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    });

    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith({}, "reset@b.com", {
      url: `${window.location.origin}/?passwordReset=1`,
    });
  });

  it("shows the enumeration-safe generic confirmation copy after a successful send", async () => {
    mockSendPasswordResetEmail.mockResolvedValue(undefined);
    render(<AuthModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "reset@b.com" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    });

    expect(screen.getByRole("heading", { name: /check your email/i })).toBeInTheDocument();
    expect(screen.getByText(/if an account exists for/i)).toBeInTheDocument();
    expect(screen.getByText(/check your spam folder/i)).toBeInTheDocument();
  });

  // BL-116 email-enumeration safety: an unknown-account error must produce
  // the exact same confirmation screen as a real send -- anything else
  // would let an attacker distinguish "no account" from "sent" by response
  // shape alone. This project's Firebase config may or may not have
  // email-enumeration protection enabled server-side; the UI can't rely on
  // that setting, so it must swallow auth/user-not-found itself too.
  it("shows the identical generic confirmation for an unknown-account error (does not reveal non-existence)", async () => {
    mockSendPasswordResetEmail.mockRejectedValue(
      Object.assign(new Error("no account"), { code: "auth/user-not-found" })
    );
    render(<AuthModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "nobody@b.com" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    });

    expect(screen.getByRole("heading", { name: /check your email/i })).toBeInTheDocument();
    expect(screen.getByText(/if an account exists for/i)).toBeInTheDocument();
    expect(screen.queryByText(/no account/i)).not.toBeInTheDocument();
  });

  it("shows an inline format error for an invalid email and stays on the entry screen", async () => {
    // The Firebase call is mocked, so the browser's own HTML5 email-format
    // validation (which would otherwise block a syntactically-invalid
    // value from ever submitting in jsdom) doesn't come into play here --
    // a well-formed value is used deliberately so the mocked
    // auth/invalid-email rejection is what's under test, not the browser.
    mockSendPasswordResetEmail.mockRejectedValue(
      Object.assign(new Error("bad format"), { code: "auth/invalid-email" })
    );
    render(<AuthModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "reset@b.com" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    });

    expect(screen.getByText("That email address looks invalid.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /reset password/i })).toBeInTheDocument();
  });

  it("Back to sign in from the email-entry screen returns to the login form", () => {
    render(<AuthModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
    fireEvent.click(screen.getByRole("button", { name: /back to sign in/i }));

    expect(screen.getByRole("heading", { name: /^log in$/i })).toBeInTheDocument();
  });

  it("Back to Sign In from the confirmation screen returns to the login form", async () => {
    mockSendPasswordResetEmail.mockResolvedValue(undefined);
    render(<AuthModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "reset@b.com" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    });

    fireEvent.click(screen.getByRole("button", { name: /back to sign in/i }));
    expect(screen.getByRole("heading", { name: /^log in$/i })).toBeInTheDocument();
  });
});

// DISPOSITION (BL-118, CREATE): net-new "Continue/Sign in with Google"
// coverage -- no prior AuthModal coverage to port, since Google sign-in
// didn't exist before this change.
describe("AuthModal Google sign-in (BL-118 / ADR-0016)", () => {
  beforeEach(() => {
    mockSignInWithPopup.mockReset();
    mockSignInWithRedirect.mockReset();
    mockGetAdditionalUserInfo.mockReset();
    mockGoogleAuthProvider.mockClear();
  });

  it("labels the button 'Sign in with Google' on the login form and 'Sign up with Google' on signup", () => {
    render(<AuthModal onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /sign in with google/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /need an account/i }));
    expect(screen.getByRole("button", { name: /sign up with google/i })).toBeInTheDocument();
  });

  it("calls signInWithPopup with a GoogleAuthProvider instance", async () => {
    mockGetAdditionalUserInfo.mockReturnValue({ isNewUser: true });
    mockSignInWithPopup.mockResolvedValue({
      user: { providerData: [{ providerId: "google.com" }] },
    });
    render(<AuthModal onClose={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    });

    expect(mockGoogleAuthProvider).toHaveBeenCalledTimes(1);
    expect(mockSignInWithPopup).toHaveBeenCalledWith({}, expect.anything());
  });

  it("falls back to signInWithRedirect when the popup is blocked", async () => {
    mockSignInWithPopup.mockRejectedValue(
      Object.assign(new Error("blocked"), { code: "auth/popup-blocked" })
    );
    mockSignInWithRedirect.mockResolvedValue(undefined);
    render(<AuthModal onClose={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    });

    expect(mockSignInWithRedirect).toHaveBeenCalledWith({}, expect.anything());
  });

  it("does not fall back to redirect for a plain closed-popup cancellation, and shows no error", async () => {
    mockSignInWithPopup.mockRejectedValue(
      Object.assign(new Error("closed"), { code: "auth/popup-closed-by-user" })
    );
    render(<AuthModal onClose={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    });

    expect(mockSignInWithRedirect).not.toHaveBeenCalled();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it("shows a friendly message for auth/account-exists-with-different-credential", async () => {
    mockSignInWithPopup.mockRejectedValue(
      Object.assign(new Error("collision"), {
        code: "auth/account-exists-with-different-credential",
      })
    );
    render(<AuthModal onClose={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    });

    expect(
      screen.getByText(
        "An account already exists with that email using a different sign-in method."
      )
    ).toBeInTheDocument();
  });

  it("shows the reverse-collision hint directing to Google when signup hits auth/email-already-in-use", async () => {
    mockSignUp.mockRejectedValue(
      Object.assign(new Error("in use"), { code: "auth/email-already-in-use" })
    );
    render(<AuthModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /need an account/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "taken@b.com" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "secret1" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^sign up$/i }));
    });

    expect(screen.getByText(/if you originally signed up with google/i)).toBeInTheDocument();
  });

  // ADR-0016 §1: Firebase's own trusted-provider auto-link is what actually
  // links the accounts server-side -- this only asserts that AuthModal
  // *notices* it happened (isNewUser: false + a password provider already
  // on the resulting user) and shows the in-modal notice, calling
  // onGoogleLinked first so App can keep the modal open long enough to see
  // it (mirrors onSignedUp's ordering contract).
  it("shows the linked-account notice and calls onGoogleLinked when Google auto-links onto an existing password account", async () => {
    mockGetAdditionalUserInfo.mockReturnValue({ isNewUser: false });
    mockSignInWithPopup.mockResolvedValue({
      user: {
        providerData: [{ providerId: "password" }, { providerId: "google.com" }],
      },
    });
    const onGoogleLinked = vi.fn();
    render(<AuthModal onClose={vi.fn()} onGoogleLinked={onGoogleLinked} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    });

    expect(onGoogleLinked).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: /signed in/i })).toBeInTheDocument();
    expect(screen.getByText(/linked to your existing/i)).toBeInTheDocument();
  });

  it("does not show the linked-account notice for a brand-new Google account", async () => {
    mockGetAdditionalUserInfo.mockReturnValue({ isNewUser: true });
    mockSignInWithPopup.mockResolvedValue({
      user: { providerData: [{ providerId: "google.com" }] },
    });
    const onGoogleLinked = vi.fn();
    render(<AuthModal onClose={vi.fn()} onGoogleLinked={onGoogleLinked} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    });

    expect(onGoogleLinked).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: /signed in/i })).not.toBeInTheDocument();
  });

  it("Continue on the linked-account notice closes the modal", async () => {
    mockGetAdditionalUserInfo.mockReturnValue({ isNewUser: false });
    mockSignInWithPopup.mockResolvedValue({
      user: {
        providerData: [{ providerId: "password" }, { providerId: "google.com" }],
      },
    });
    const onClose = vi.fn();
    render(<AuthModal onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
