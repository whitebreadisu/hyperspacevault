import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeleteAccountModal } from "./DeleteAccountModal";

const {
  mockCredential,
  mockReauthenticate,
  mockReauthenticateWithPopup,
  mockGoogleAuthProvider,
  mockDeleteUser,
  mockUseAuth,
  mockDeleteAccount,
} = vi.hoisted(() => ({
  mockCredential: vi.fn((email: string, password: string) => ({ email, password })),
  mockReauthenticate: vi.fn(),
  mockReauthenticateWithPopup: vi.fn(),
  mockGoogleAuthProvider: vi.fn(function GoogleAuthProvider(this: object) {
    return this;
  }),
  mockDeleteUser: vi.fn(),
  mockUseAuth: vi.fn(),
  mockDeleteAccount: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({})),
  connectAuthEmulator: vi.fn(),
  EmailAuthProvider: { credential: mockCredential },
  GoogleAuthProvider: mockGoogleAuthProvider,
  reauthenticateWithCredential: mockReauthenticate,
  reauthenticateWithPopup: mockReauthenticateWithPopup,
  deleteUser: mockDeleteUser,
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: mockUseAuth,
}));

vi.mock("../../api/account", () => ({
  deleteAccount: mockDeleteAccount,
}));

const fakeUser = { email: "a@b.com" };

// DISPOSITION (BL-87, CREATE): net-new modal, net-new coverage. Follows
// ChangePasswordModal.test.tsx's firebase/auth + useAuth mocking pattern,
// plus a mock of the new api/account module (DeleteAccountModal's purge
// step goes through deleteAccount() rather than a bare fetch, so that's
// what's asserted on for "purge called" / "purge not called").
describe("DeleteAccountModal (BL-87)", () => {
  beforeEach(() => {
    mockCredential.mockClear();
    mockReauthenticate.mockReset();
    mockReauthenticateWithPopup.mockReset();
    mockGoogleAuthProvider.mockClear();
    mockDeleteUser.mockReset();
    mockDeleteAccount.mockReset();
    mockUseAuth.mockReturnValue({ user: fakeUser, loading: false, logout: vi.fn() });
  });

  function goToConfirmStep(currentPassword = "oldpass") {
    fireEvent.change(screen.getByLabelText(/current password/i), {
      target: { value: currentPassword },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  }

  function typeConfirm(text: string) {
    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), {
      target: { value: text },
    });
  }

  it("shows step 1 warning copy and a current password field, with no Firebase/fetch calls yet", () => {
    render(<DeleteAccountModal onClose={vi.fn()} />);

    expect(
      screen.getByText(
        "This permanently deletes your account and all inventory records. This cannot be undone."
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
    expect(mockReauthenticate).not.toHaveBeenCalled();
    expect(mockDeleteAccount).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it("moves to step 2 (type-to-confirm) on Continue, without calling Firebase or the backend", () => {
    render(<DeleteAccountModal onClose={vi.fn()} />);
    goToConfirmStep();

    expect(screen.getByLabelText(/type delete to confirm/i)).toBeInTheDocument();
    expect(mockReauthenticate).not.toHaveBeenCalled();
    expect(mockDeleteAccount).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it("keeps the destructive button disabled until DELETE is typed exactly", () => {
    render(<DeleteAccountModal onClose={vi.fn()} />);
    goToConfirmStep();

    const deleteBtn = screen.getByRole("button", { name: /delete account/i });
    expect(deleteBtn).toBeDisabled();

    typeConfirm("delete");
    expect(deleteBtn).toBeDisabled();

    typeConfirm("DELET");
    expect(deleteBtn).toBeDisabled();

    typeConfirm("DELETE");
    expect(deleteBtn).toBeEnabled();
  });

  it("Cancel on step 1 closes the modal without any Firebase or backend calls", () => {
    const onClose = vi.fn();
    render(<DeleteAccountModal onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockReauthenticate).not.toHaveBeenCalled();
    expect(mockDeleteAccount).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it("Cancel on step 2 closes the modal without any Firebase or backend calls, even with DELETE typed", () => {
    const onClose = vi.fn();
    render(<DeleteAccountModal onClose={onClose} />);
    goToConfirmStep();
    typeConfirm("DELETE");

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockReauthenticate).not.toHaveBeenCalled();
    expect(mockDeleteAccount).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it("shows a friendly error and makes no purge call when the current password is wrong", async () => {
    mockReauthenticate.mockRejectedValue(
      Object.assign(new Error("bad"), { code: "auth/wrong-password" })
    );
    render(<DeleteAccountModal onClose={vi.fn()} />);
    goToConfirmStep("wrongpass");
    typeConfirm("DELETE");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    });

    expect(screen.getByText("Current password is incorrect.")).toBeInTheDocument();
    expect(mockDeleteAccount).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it("shows an error and never calls deleteUser when the backend purge fails", async () => {
    mockReauthenticate.mockResolvedValue(undefined);
    mockDeleteAccount.mockRejectedValue(new Error("Account deletion failed: 500"));
    render(<DeleteAccountModal onClose={vi.fn()} />);
    goToConfirmStep();
    typeConfirm("DELETE");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    });

    expect(
      screen.getByText(
        "Something went wrong deleting your data. Your account is intact — please try again."
      )
    ).toBeInTheDocument();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it("calls reauthenticate, then the backend purge, then deleteUser, in that exact order, then closes", async () => {
    mockReauthenticate.mockResolvedValue(undefined);
    mockDeleteAccount.mockResolvedValue(undefined);
    mockDeleteUser.mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<DeleteAccountModal onClose={onClose} />);
    goToConfirmStep("correctpass");
    typeConfirm("DELETE");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    });

    expect(mockCredential).toHaveBeenCalledWith("a@b.com", "correctpass");
    expect(mockReauthenticate).toHaveBeenCalledWith(fakeUser, {
      email: "a@b.com",
      password: "correctpass",
    });
    expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
    expect(mockDeleteUser).toHaveBeenCalledWith(fakeUser);

    const reauthOrder = mockReauthenticate.mock.invocationCallOrder[0];
    const purgeOrder = mockDeleteAccount.mock.invocationCallOrder[0];
    const deleteUserOrder = mockDeleteUser.mock.invocationCallOrder[0];
    expect(reauthOrder).toBeLessThan(purgeOrder);
    expect(purgeOrder).toBeLessThan(deleteUserOrder);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows retry guidance when deleteUser fails after a successful purge, and leaves the modal open", async () => {
    mockReauthenticate.mockResolvedValue(undefined);
    mockDeleteAccount.mockResolvedValue(undefined);
    mockDeleteUser.mockRejectedValue(new Error("network blip"));
    const onClose = vi.fn();
    render(<DeleteAccountModal onClose={onClose} />);
    goToConfirmStep();
    typeConfirm("DELETE");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    });

    expect(
      screen.getByText(
        "Your data was deleted but the account removal failed — please sign out and sign in again, then retry Delete Account."
      )
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // Retryable: the destructive button is enabled again (DELETE still typed).
    expect(screen.getByRole("button", { name: /delete account/i })).toBeEnabled();
  });

  it("disables step 2 buttons while the request is in flight", async () => {
    let resolveReauth: () => void = () => {};
    mockReauthenticate.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveReauth = resolve;
      })
    );
    mockDeleteAccount.mockResolvedValue(undefined);
    mockDeleteUser.mockResolvedValue(undefined);
    render(<DeleteAccountModal onClose={vi.fn()} />);
    goToConfirmStep();
    typeConfirm("DELETE");

    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    expect(screen.getByRole("button", { name: /please wait/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeDisabled();

    await act(async () => {
      resolveReauth();
    });
  });
});

// DISPOSITION (BL-118, CREATE): net-new coverage for ADR-0016 §3's
// provider-aware recent-auth gate -- a Google-only account (no `password`
// entry in providerData) skips the current-password field entirely and
// reauthenticates via reauthenticateWithPopup + GoogleAuthProvider instead.
describe("DeleteAccountModal Google-only account reauth (BL-118 / ADR-0016 §3)", () => {
  const fakeGoogleUser = {
    email: "g@b.com",
    providerData: [{ providerId: "google.com" }],
  };

  beforeEach(() => {
    mockCredential.mockClear();
    mockReauthenticate.mockReset();
    mockReauthenticateWithPopup.mockReset();
    mockGoogleAuthProvider.mockClear();
    mockDeleteUser.mockReset();
    mockDeleteAccount.mockReset();
    mockUseAuth.mockReturnValue({ user: fakeGoogleUser, loading: false, logout: vi.fn() });
  });

  it("shows no current-password field, offering a Google-reauth notice instead", () => {
    render(<DeleteAccountModal onClose={vi.fn()} />);

    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
    expect(screen.getByText(/reauthenticate with google/i)).toBeInTheDocument();
  });

  it("reauthenticates with reauthenticateWithPopup + GoogleAuthProvider instead of a password credential", async () => {
    mockReauthenticateWithPopup.mockResolvedValue(undefined);
    mockDeleteAccount.mockResolvedValue(undefined);
    mockDeleteUser.mockResolvedValue(undefined);
    render(<DeleteAccountModal onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), {
      target: { value: "DELETE" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    });

    expect(mockGoogleAuthProvider).toHaveBeenCalledTimes(1);
    expect(mockReauthenticateWithPopup).toHaveBeenCalledWith(fakeGoogleUser, expect.anything());
    expect(mockCredential).not.toHaveBeenCalled();
    expect(mockReauthenticate).not.toHaveBeenCalled();
    expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
    expect(mockDeleteUser).toHaveBeenCalledWith(fakeGoogleUser);
  });

  it("shows a friendly message and returns to step 1 when the Google reauth popup fails", async () => {
    mockReauthenticateWithPopup.mockRejectedValue(
      Object.assign(new Error("blocked"), { code: "auth/popup-blocked" })
    );
    render(<DeleteAccountModal onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), {
      target: { value: "DELETE" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    });

    expect(mockDeleteAccount).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(
      screen.getByText("Something went wrong signing in with Google. Please try again.")
    ).toBeInTheDocument();
    expect(screen.getByText(/reauthenticate with google/i)).toBeInTheDocument();
  });

  it("does not show a message when the user simply closes the Google reauth popup", async () => {
    mockReauthenticateWithPopup.mockRejectedValue(
      Object.assign(new Error("closed"), { code: "auth/popup-closed-by-user" })
    );
    render(<DeleteAccountModal onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), {
      target: { value: "DELETE" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    });

    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    expect(mockDeleteAccount).not.toHaveBeenCalled();
  });
});
