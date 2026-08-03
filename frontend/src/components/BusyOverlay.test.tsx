import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BusyOverlay } from "./BusyOverlay";

// DISPOSITION (BL-196, CREATE): net-new component, no prior coverage exists.

const VARIANT_KEY = "swu.busyOverlay.variant";

function mockMatchMedia(matches: boolean) {
  const listeners: ((e: MediaQueryListEvent) => void)[] = [];
  const mql = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.push(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql as unknown as MediaQueryList));
  return {
    fire(nextMatches: boolean) {
      mql.matches = nextMatches;
      listeners.forEach((cb) => cb({ matches: nextMatches } as MediaQueryListEvent));
    },
  };
}

describe("BusyOverlay (BL-196)", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("renders nothing when stage is null", () => {
    const { container } = render(<BusyOverlay stage={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the staged message and optional sub-line", () => {
    render(<BusyOverlay stage={{ message: "Applying 1,240 cards…", sub: "Hang tight" }} />);
    expect(screen.getByText("Applying 1,240 cards…")).toBeInTheDocument();
    expect(screen.getByText("Hang tight")).toBeInTheDocument();
  });

  it("omits the sub-line entirely when not provided", () => {
    const { container } = render(<BusyOverlay stage={{ message: "Checking your file…" }} />);
    expect(container.querySelector(".busy-overlay__sub")).toBeNull();
  });

  it("announces via role=status/aria-live, not role=dialog -- it's a busy state, not a dismissable modal", () => {
    render(<BusyOverlay stage={{ message: "Checking your file…" }} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("has no dismiss affordance -- Escape and a backdrop click are both no-ops", () => {
    render(<BusyOverlay stage={{ message: "Checking your file…" }} />);
    const overlay = screen.getByRole("status");

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(overlay);
    fireEvent.mouseDown(overlay);

    // Nothing dismissed it -- the component owns no state that would hide
    // itself; it stays rendered exactly as long as its `stage` prop is set.
    expect(screen.getByText("Checking your file…")).toBeInTheDocument();
  });

  describe("reduced motion (matchMedia)", () => {
    it("renders the animated variant layout when the OS has no reduced-motion preference", () => {
      mockMatchMedia(false);
      const { container } = render(<BusyOverlay stage={{ message: "x" }} />);
      expect(container.querySelector(".busy-overlay__glyphs--a")).not.toBeNull();
      expect(container.querySelector(".busy-overlay__glyphs--reduced")).toBeNull();
    });

    it("renders the static dimmed-row layout when prefers-reduced-motion is set", () => {
      mockMatchMedia(true);
      const { container } = render(<BusyOverlay stage={{ message: "x" }} />);
      expect(container.querySelector(".busy-overlay__glyphs--reduced")).not.toBeNull();
      expect(container.querySelector(".busy-overlay__glyphs--a")).toBeNull();
    });

    it("switches to the reduced layout live if the OS preference changes mid-session", () => {
      const mq = mockMatchMedia(false);
      const { container } = render(<BusyOverlay stage={{ message: "x" }} />);
      expect(container.querySelector(".busy-overlay__glyphs--a")).not.toBeNull();

      act(() => mq.fire(true));

      expect(container.querySelector(".busy-overlay__glyphs--reduced")).not.toBeNull();
    });
  });

  describe("DEV-only variant switcher", () => {
    it("reads the persisted variant from localStorage when DEV", () => {
      vi.stubEnv("DEV", true);
      localStorage.setItem(VARIANT_KEY, "B");
      const { container } = render(<BusyOverlay stage={{ message: "x" }} />);
      expect(container.querySelector(".busy-overlay__glyphs--b")).not.toBeNull();
    });

    it("falls back to the default variant for an unrecognized stored value", () => {
      vi.stubEnv("DEV", true);
      localStorage.setItem(VARIANT_KEY, "not-a-real-variant");
      const { container } = render(<BusyOverlay stage={{ message: "x" }} />);
      expect(container.querySelector(".busy-overlay__glyphs--a")).not.toBeNull();
    });

    it("renders the A/B/C + Hold corner control when DEV, and switching variants updates both the render and localStorage", () => {
      vi.stubEnv("DEV", true);
      const { container } = render(<BusyOverlay stage={{ message: "x" }} />);
      expect(screen.getByRole("button", { name: "B" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "C" }));

      expect(container.querySelector(".busy-overlay__glyphs--c")).not.toBeNull();
      expect(localStorage.getItem(VARIANT_KEY)).toBe("C");
    });

    it("ignores a stored variant and hides the corner switcher entirely outside DEV", () => {
      vi.stubEnv("DEV", false);
      localStorage.setItem(VARIANT_KEY, "C");
      const { container } = render(<BusyOverlay stage={{ message: "x" }} />);

      // Production hardcode point: always the coded default (A) regardless
      // of whatever a previous DEV session left in localStorage.
      expect(container.querySelector(".busy-overlay__glyphs--a")).not.toBeNull();
      expect(screen.queryByRole("button", { name: "A" })).toBeNull();
      expect(container.querySelector(".busy-overlay__dev")).toBeNull();
    });

    it("wires the Hold button to onToggleHold and reflects the active hold prop", () => {
      vi.stubEnv("DEV", true);
      const onToggleHold = vi.fn();
      const { rerender } = render(
        <BusyOverlay stage={{ message: "x" }} hold={false} onToggleHold={onToggleHold} />
      );
      const holdBtn = screen.getByRole("button", { name: "Hold" });
      expect(holdBtn.className).not.toMatch(/--active/);

      fireEvent.click(holdBtn);
      expect(onToggleHold).toHaveBeenCalledTimes(1);

      rerender(<BusyOverlay stage={{ message: "x" }} hold={true} onToggleHold={onToggleHold} />);
      expect(screen.getByRole("button", { name: "Hold" }).className).toMatch(/--active/);
    });
  });
});
