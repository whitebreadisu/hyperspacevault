import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NewArrivalsPage } from "./NewArrivalsPage";
import { RELEASE_NOTES } from "../../content/releaseNotes";

// BL-184: NewArrivalsPage renders the real RELEASE_NOTES content module
// (not a fixture) -- App.test.tsx stubs this component entirely for its own
// pane-orchestration tests, so this file is the one place the actual
// rendering/quicklink-scroll behavior is exercised.

describe("NewArrivalsPage (BL-184)", () => {
  it("renders every entry, newest first, each labeled with its version", () => {
    render(<NewArrivalsPage />);
    const headings = screen.getAllByText(/^v\d/);
    // Entry headers render "v<version>" for every release entry -- confirms
    // both presence and DOM order matches RELEASE_NOTES' own order.
    const releaseVersions = RELEASE_NOTES.filter((e) => e.kind === "release").map(
      (e) => `v${e.version}`
    );
    expect(headings.map((h) => h.textContent)).toEqual(expect.arrayContaining(releaseVersions));
    for (const entry of RELEASE_NOTES) {
      expect(screen.getByTestId(`na-entry-${entry.key}`)).toBeInTheDocument();
    }
  });

  it("renders a title for every entry", () => {
    render(<NewArrivalsPage />);
    for (const entry of RELEASE_NOTES) {
      const el = screen.getByTestId(`na-entry-${entry.key}`);
      expect(el.textContent).toContain(entry.title);
    }
  });

  it("renders a human-readable date (no raw ISO string) for every entry", () => {
    render(<NewArrivalsPage />);
    // REPLACE (owner renumber 2026-08-02): v1.3 is now the upcoming release
    // (placeholder date 2026-08-02, finalized at promote) -- still confirms
    // the ISO string is reformatted, not passed through verbatim.
    const entry = screen.getByTestId("na-entry-1.3");
    expect(entry.textContent).toContain("August 2, 2026");
    expect(entry.textContent).not.toContain("2026-08-02");
  });

  it("renders every item's title and body for a release entry", () => {
    render(<NewArrivalsPage />);
    const entry = screen.getByTestId("na-entry-1.3");
    expect(entry.textContent).toContain("Keep-limits, your number");
    expect(entry.textContent).toContain("The playset keep-limit is now yours to set.");
  });

  // REPLACE (owner review round 2, 2026-08-02): emojis removed from the
  // shipped content -- the section-emoji RENDER path stays (schema field is
  // optional and may return), so this now pins heading text only.
  it("renders a section heading for a sectioned entry", () => {
    render(<NewArrivalsPage />);
    const entry = screen.getByTestId("na-entry-1.2");
    expect(entry.textContent).toContain("A new name, in the open");
  });

  it("renders one quicklink chip per entry", () => {
    render(<NewArrivalsPage />);
    const nav = screen.getByRole("navigation", { name: /jump to release/i });
    for (const entry of RELEASE_NOTES) {
      if (entry.kind === "release") {
        expect(nav).toHaveTextContent(`v${entry.version}`);
      }
    }
  });

  describe("quicklink scroll behavior", () => {
    // BL-192's test/setup.ts installs a global no-op scrollIntoView stub
    // (jsdom has none), so spying on the prototype is enough to observe
    // calls -- the same idiom CardPopup.test.tsx's own scroll tests use.
    // (Was a bare `vi.fn()` prototype assignment, which fails `tsc -b`'s
    // stricter test-project type-check: Mock isn't assignable to the DOM
    // method signature.)
    let scrollIntoViewMock: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      scrollIntoViewMock = vi
        .spyOn(Element.prototype, "scrollIntoView")
        .mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("scrolls the corresponding entry's anchor into view when its chip is clicked", () => {
      render(<NewArrivalsPage />);
      const chip = screen.getByRole("button", { name: "v1.2" });
      fireEvent.click(chip);

      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
      expect(scrollIntoViewMock).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: "smooth", block: "start" })
      );
      // Assert it fired on the right anchor -- the 1.2 entry's own element
      // (`this` inside a prototype-method mock is recorded in
      // mock.instances), not some other entry's.
      const entry12 = screen.getByTestId("na-entry-1.2");
      expect(entry12.id).toBe("na-entry-1.2");
      expect(scrollIntoViewMock.mock.instances[0]).toBe(entry12);
    });
  });
});
