import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FeedbackModal } from "./FeedbackModal";

const { mockUseAuth, mockSubmitFeedback } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockSubmitFeedback: vi.fn(),
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: mockUseAuth,
}));

vi.mock("../../api/feedback", () => ({
  submitFeedback: mockSubmitFeedback,
}));

// DISPOSITION (BL-126, CREATE): net-new modal, net-new coverage. Mocking
// pattern follows ChangePasswordModal.test.tsx (useAuth mock, since the
// component pulls `user` from AuthContext rather than a prop) plus a mock
// of the api/feedback module (this modal's own network call) instead of
// firebase/auth (ChangePasswordModal's).
describe("FeedbackModal (BL-126)", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });
    mockSubmitFeedback.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function messageBox() {
    return screen.getByLabelText(/your feedback/i);
  }

  function consentCheckbox() {
    return screen.getByRole("checkbox", { name: /is it ok if we contact you/i });
  }

  function submitButton() {
    return screen.getByRole("button", { name: /submit feedback/i });
  }

  describe("enablement matrix", () => {
    it("disables Submit when the message is empty", () => {
      render(<FeedbackModal onClose={vi.fn()} />);
      expect(submitButton()).toBeDisabled();
    });

    it("enables Submit when the message is non-empty and consent is unchecked", () => {
      render(<FeedbackModal onClose={vi.fn()} />);
      fireEvent.change(messageBox(), { target: { value: "Great app!" } });
      expect(submitButton()).toBeEnabled();
    });

    it("disables Submit when consent is checked but the email fails format validation", () => {
      render(<FeedbackModal onClose={vi.fn()} />);
      fireEvent.change(messageBox(), { target: { value: "Great app!" } });
      fireEvent.click(consentCheckbox());

      fireEvent.change(screen.getByLabelText(/your email/i), {
        target: { value: "not-an-email" },
      });
      expect(submitButton()).toBeDisabled();
    });

    it("enables Submit when consent is checked and the email passes format validation", () => {
      render(<FeedbackModal onClose={vi.fn()} />);
      fireEvent.change(messageBox(), { target: { value: "Great app!" } });
      fireEvent.click(consentCheckbox());

      fireEvent.change(screen.getByLabelText(/your email/i), {
        target: { value: "user@example.com" },
      });
      expect(submitButton()).toBeEnabled();
    });

    it("disables Submit when consent is checked and the email is blank", () => {
      render(<FeedbackModal onClose={vi.fn()} />);
      fireEvent.change(messageBox(), { target: { value: "Great app!" } });
      fireEvent.click(consentCheckbox());
      expect(submitButton()).toBeDisabled();
    });

    it("does not render the email field until consent is checked", () => {
      render(<FeedbackModal onClose={vi.fn()} />);
      expect(screen.queryByLabelText(/your email/i)).not.toBeInTheDocument();

      fireEvent.click(consentCheckbox());
      expect(screen.getByLabelText(/your email/i)).toBeInTheDocument();
    });
  });

  describe("email prefill", () => {
    it("prefills the email field from the Firebase user's email when authenticated", () => {
      mockUseAuth.mockReturnValue({
        user: { email: "signed-in@example.com" },
        loading: false,
        logout: vi.fn(),
      });
      render(<FeedbackModal onClose={vi.fn()} />);
      fireEvent.click(consentCheckbox());

      expect(screen.getByLabelText(/your email/i)).toHaveValue("signed-in@example.com");
    });

    it("leaves the email field empty when anonymous", () => {
      render(<FeedbackModal onClose={vi.fn()} />);
      fireEvent.click(consentCheckbox());

      expect(screen.getByLabelText(/your email/i)).toHaveValue("");
    });

    it("keeps the prefilled email editable", () => {
      mockUseAuth.mockReturnValue({
        user: { email: "signed-in@example.com" },
        loading: false,
        logout: vi.fn(),
      });
      render(<FeedbackModal onClose={vi.fn()} />);
      fireEvent.click(consentCheckbox());

      const emailInput = screen.getByLabelText(/your email/i);
      fireEvent.change(emailInput, { target: { value: "different@example.com" } });
      expect(emailInput).toHaveValue("different@example.com");
    });
  });

  describe("submission", () => {
    it("posts the payload including the honeypot field and shows a success state", async () => {
      mockSubmitFeedback.mockResolvedValue(undefined);
      render(<FeedbackModal onClose={vi.fn()} />);
      fireEvent.change(messageBox(), { target: { value: "Great app!" } });

      await act(async () => {
        fireEvent.click(submitButton());
      });

      expect(mockSubmitFeedback).toHaveBeenCalledWith({
        message: "Great app!",
        contact_ok: false,
        contact_email: undefined,
        website: "",
      });
      expect(screen.getByText(/thanks for the feedback/i)).toBeInTheDocument();
    });

    it("includes contact_email only when consent is checked", async () => {
      mockSubmitFeedback.mockResolvedValue(undefined);
      render(<FeedbackModal onClose={vi.fn()} />);
      fireEvent.change(messageBox(), { target: { value: "Great app!" } });
      fireEvent.click(consentCheckbox());
      fireEvent.change(screen.getByLabelText(/your email/i), {
        target: { value: "user@example.com" },
      });

      await act(async () => {
        fireEvent.click(submitButton());
      });

      expect(mockSubmitFeedback).toHaveBeenCalledWith({
        message: "Great app!",
        contact_ok: true,
        contact_email: "user@example.com",
        website: "",
      });
    });

    it("auto-closes ~1.5s after a successful submission", async () => {
      vi.useFakeTimers();
      mockSubmitFeedback.mockResolvedValue(undefined);
      const onClose = vi.fn();
      render(<FeedbackModal onClose={onClose} />);
      fireEvent.change(messageBox(), { target: { value: "Great app!" } });

      await act(async () => {
        fireEvent.click(submitButton());
      });
      expect(onClose).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("shows an inline error and preserves the form when the submission fails", async () => {
      mockSubmitFeedback.mockRejectedValue(new Error("network error"));
      render(<FeedbackModal onClose={vi.fn()} />);
      fireEvent.change(messageBox(), { target: { value: "Great app!" } });

      await act(async () => {
        fireEvent.click(submitButton());
      });

      expect(screen.getByText(/something went wrong sending your feedback/i)).toBeInTheDocument();
      expect(messageBox()).toHaveValue("Great app!");
    });
  });

  describe("cancel and dismissal", () => {
    it("closes without posting when Cancel is clicked", () => {
      const onClose = vi.fn();
      render(<FeedbackModal onClose={onClose} />);
      fireEvent.change(messageBox(), { target: { value: "Great app!" } });

      fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(mockSubmitFeedback).not.toHaveBeenCalled();
    });

    it("dismisses on Escape", () => {
      const onClose = vi.fn();
      render(<FeedbackModal onClose={onClose} />);

      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("dismisses on backdrop click, but not on a click inside the panel", () => {
      const onClose = vi.fn();
      const { container } = render(<FeedbackModal onClose={onClose} />);

      fireEvent.click(screen.getByText("Leave Feedback"));
      expect(onClose).not.toHaveBeenCalled();

      const overlay = container.querySelector(".feedback-overlay");
      expect(overlay).not.toBeNull();
      fireEvent.click(overlay as Element);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("honeypot", () => {
    it("renders the honeypot input hidden and out of tab order", () => {
      render(<FeedbackModal onClose={vi.fn()} />);
      const honeypot = document.querySelector('input[name="website"]');
      expect(honeypot).not.toBeNull();
      expect(honeypot).toHaveAttribute("tabIndex", "-1");
      expect(honeypot?.closest('[aria-hidden="true"]')).not.toBeNull();
    });
  });
});
