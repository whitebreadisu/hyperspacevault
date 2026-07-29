import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AboutModal } from "./AboutModal";

// DISPOSITION (BL-125, CREATE): net-new modal, net-new coverage. Follows
// AuthModal.test.tsx/ChangePasswordModal.test.tsx's Esc/backdrop/Close
// dismissal pattern -- no firebase or context dependency here, so no mocks
// are needed.
describe("AboutModal (BL-125)", () => {
  it("renders the title and all three section labels", () => {
    render(<AboutModal onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: /about this project/i })).toBeInTheDocument();
    expect(screen.getByText("Disclaimer")).toBeInTheDocument();
    expect(screen.getByText("Privacy")).toBeInTheDocument();
    expect(screen.getByText("Attribution")).toBeInTheDocument();
  });

  it("renders the disclaimer copy naming the non-affiliated parties", () => {
    render(<AboutModal onClose={vi.fn()} />);

    expect(screen.getByText(/unofficial fan project/i)).toBeInTheDocument();
    expect(screen.getByText(/disney, lucasfilm ltd\., fantasy flight games/i)).toBeInTheDocument();
  });

  it("renders the four original privacy points", () => {
    render(<AboutModal onClose={vi.fn()} />);

    expect(
      screen.getByText(/your account email address and your card collection/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/us-central1 \(iowa, usa\)/i)).toBeInTheDocument();
    expect(screen.getByText(/delete account in the account menu/i)).toBeInTheDocument();
    expect(screen.getByText(/no analytics, no ads, no third-party trackers/i)).toBeInTheDocument();
  });

  // DISPOSITION (BL-126, CREATE): new coverage for the fifth privacy bullet
  // this slice adds -- owner decision #4 on issue #289 (feedback storage
  // disclosure). The other four points keep their own dedicated test above,
  // unchanged.
  it("renders the feedback privacy point (BL-126)", () => {
    render(<AboutModal onClose={vi.fn()} />);

    expect(
      screen.getByText(/we store your message \(and your email only if you opt in/i)
    ).toBeInTheDocument();
  });

  it("renders the attribution copy", () => {
    render(<AboutModal onClose={vi.fn()} />);

    expect(screen.getByText(/swuapi\.com api/i)).toBeInTheDocument();
  });

  it("dismisses on Escape", () => {
    const onClose = vi.fn();
    render(<AboutModal onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses on backdrop click, but not on a click inside the panel", () => {
    const onClose = vi.fn();
    const { container } = render(<AboutModal onClose={onClose} />);

    fireEvent.click(screen.getByText("Disclaimer"));
    expect(onClose).not.toHaveBeenCalled();

    const overlay = container.querySelector(".about-overlay");
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses via the footer Close button", () => {
    const onClose = vi.fn();
    const { container } = render(<AboutModal onClose={onClose} />);

    // Two dismiss controls both have the accessible name "Close" -- the "x"
    // icon (aria-label="Close") and the footer's own text button. This test
    // targets the footer button specifically via its distinct class.
    const footerClose = container.querySelector(".about-submit");
    expect(footerClose).not.toBeNull();
    fireEvent.click(footerClose as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses via the icon Close button", () => {
    const onClose = vi.fn();
    render(<AboutModal onClose={onClose} />);

    // getByLabelText matches on the aria-label attribute specifically, so it
    // uniquely targets the icon button (the footer button has no aria-label,
    // just text content, so it's excluded even though its accessible name is
    // also "Close").
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
