import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChangePasswordModal } from "./ChangePasswordModal";

const { mockCredential, mockReauthenticate, mockUpdatePassword, mockUseAuth } = vi.hoisted(() => ({
  mockCredential: vi.fn((email: string, password: string) => ({ email, password })),
  mockReauthenticate: vi.fn(),
  mockUpdatePassword: vi.fn(),
  mockUseAuth: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({})),
  connectAuthEmulator: vi.fn(),
  EmailAuthProvider: { credential: mockCredential },
  reauthenticateWithCredential: mockReauthenticate,
  updatePassword: mockUpdatePassword,
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: mockUseAuth,
}));

const fakeUser = { email: "a@b.com" };

// DISPOSITION (BL-23, CREATE): net-new modal, net-new coverage. Follows
// AuthModal.test.tsx's firebase/auth mocking pattern, plus a useAuth mock
// (ChangePasswordModal pulls `user` from AuthContext instead of a prop).
describe("ChangePasswordModal (BL-23)", () => {
  beforeEach(() => {
    mockCredential.mockClear();
    mockReauthenticate.mockReset();
    mockUpdatePassword.mockReset();
    mockUseAuth.mockReturnValue({ user: fakeUser, loading: false, logout: vi.fn() });
  });

  function fillForm(current: string, next: string, confirm: string) {
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: current } });
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: next } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: confirm },
    });
  }

  it("blocks submission client-side when new passwords do not match, without calling Firebase", async () => {
    render(<ChangePasswordModal onClose={vi.fn()} />);
    fillForm("oldpass", "newpass1", "newpass2");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    });

    expect(screen.getByText("New passwords do not match.")).toBeInTheDocument();
    expect(mockReauthenticate).not.toHaveBeenCalled();
    expect(mockUpdatePassword).not.toHaveBeenCalled();
  });

  it("shows a friendly message when the current password is wrong", async () => {
    mockReauthenticate.mockRejectedValue(
      Object.assign(new Error("bad"), { code: "auth/wrong-password" })
    );
    render(<ChangePasswordModal onClose={vi.fn()} />);
    fillForm("wrongcurrent", "newpass1", "newpass1");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    });

    expect(screen.getByText("Current password is incorrect.")).toBeInTheDocument();
    expect(mockUpdatePassword).not.toHaveBeenCalled();
  });

  it("shows a friendly message when the new password is too weak", async () => {
    mockReauthenticate.mockResolvedValue(undefined);
    mockUpdatePassword.mockRejectedValue(
      Object.assign(new Error("weak"), { code: "auth/weak-password" })
    );
    render(<ChangePasswordModal onClose={vi.fn()} />);
    fillForm("oldpass", "newpas", "newpas");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    });

    expect(
      screen.getByText("New password is too weak — use at least 6 characters.")
    ).toBeInTheDocument();
  });

  it("reauthenticates then updates the password, and shows a success state", async () => {
    mockReauthenticate.mockResolvedValue(undefined);
    mockUpdatePassword.mockResolvedValue(undefined);
    render(<ChangePasswordModal onClose={vi.fn()} />);
    fillForm("oldpass", "newpass1", "newpass1");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    });

    expect(mockCredential).toHaveBeenCalledWith("a@b.com", "oldpass");
    expect(mockReauthenticate).toHaveBeenCalledWith(fakeUser, {
      email: "a@b.com",
      password: "oldpass",
    });
    expect(mockUpdatePassword).toHaveBeenCalledWith(fakeUser, "newpass1");

    const reauthOrder = mockReauthenticate.mock.invocationCallOrder[0];
    const updateOrder = mockUpdatePassword.mock.invocationCallOrder[0];
    expect(reauthOrder).toBeLessThan(updateOrder);

    expect(screen.getByText("Password changed.")).toBeInTheDocument();
  });

  it("disables the submit button while the request is in flight", async () => {
    let resolveReauth: () => void = () => {};
    mockReauthenticate.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveReauth = resolve;
      })
    );
    mockUpdatePassword.mockResolvedValue(undefined);
    render(<ChangePasswordModal onClose={vi.fn()} />);
    fillForm("oldpass", "newpass1", "newpass1");

    fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    expect(screen.getByRole("button", { name: /please wait/i })).toBeDisabled();

    await act(async () => {
      resolveReauth();
    });
  });
});
