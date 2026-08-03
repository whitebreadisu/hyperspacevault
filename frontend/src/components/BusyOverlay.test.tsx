import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { BusyOverlay } from "./BusyOverlay";

// DISPOSITION (BL-196, CREATE): net-new component, no prior coverage exists.
// RETIRE (owner pick, 2026-08-03): the "DEV-only variant switcher" describe
// (5 tests: localStorage variant read/fallback, A/B/C switching, prod
// hiding, Hold wiring) tested review scaffolding that was designed away
// when the owner locked the orbit variant -- the switcher, the hold prop,
// and the localStorage key no longer exist. The surviving behavior (the
// orbit renders, reduced-motion swaps layouts) is pinned below.

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
  afterEach(() => {
    vi.unstubAllGlobals();
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
    it("renders the orbit layout when the OS has no reduced-motion preference", () => {
      mockMatchMedia(false);
      const { container } = render(<BusyOverlay stage={{ message: "x" }} />);
      expect(container.querySelector(".busy-overlay__glyphs--c")).not.toBeNull();
      expect(container.querySelector(".busy-overlay__glyphs--reduced")).toBeNull();
    });

    it("renders the static dimmed-row layout when prefers-reduced-motion is set", () => {
      mockMatchMedia(true);
      const { container } = render(<BusyOverlay stage={{ message: "x" }} />);
      expect(container.querySelector(".busy-overlay__glyphs--reduced")).not.toBeNull();
      expect(container.querySelector(".busy-overlay__glyphs--c")).toBeNull();
    });

    it("switches to the reduced layout live if the OS preference changes mid-session", () => {
      const mq = mockMatchMedia(false);
      const { container } = render(<BusyOverlay stage={{ message: "x" }} />);
      expect(container.querySelector(".busy-overlay__glyphs--c")).not.toBeNull();

      act(() => mq.fire(true));

      expect(container.querySelector(".busy-overlay__glyphs--reduced")).not.toBeNull();
    });

    it("renders all six aspect glyphs on the ring", () => {
      mockMatchMedia(false);
      const { container } = render(<BusyOverlay stage={{ message: "x" }} />);
      expect(container.querySelectorAll(".busy-overlay__glyph")).toHaveLength(6);
    });
  });
});
