import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SectionSeparator } from "./SectionSeparator";

// DISPOSITION (BL-111 F2, CREATE): SectionSeparator previously had no
// dedicated suite -- App.test.tsx renders it as a live child of the shell
// but never asserted on it, so there's nothing to port/replace. This locks
// in the new "circuit-separator" straddle pattern's class contract ahead of
// the restyle landing in App.tsx. The mask itself (public/swu-separator.svg,
// referenced by .circuit-separator's mask-image rule in index.css -- see
// that file and this component's docstring for why it's a public/ asset
// rather than a Vite import) is static CSS with nothing per-instance to
// assert on in jsdom; it's verified visually instead (see PR description).
describe("SectionSeparator (BL-111 F2, resolves BL-68)", () => {
  it("renders the circuit-separator class with no extra className by default", () => {
    const { container } = render(<SectionSeparator />);
    const el = container.firstElementChild;
    expect(el).toHaveClass("circuit-separator");
    expect(el?.className.trim()).toBe("circuit-separator");
  });

  it("appends an optional className for later reuse on other seams", () => {
    const { container } = render(<SectionSeparator className="popup-header-separator" />);
    const el = container.firstElementChild;
    expect(el).toHaveClass("circuit-separator");
    expect(el).toHaveClass("popup-header-separator");
  });
});
