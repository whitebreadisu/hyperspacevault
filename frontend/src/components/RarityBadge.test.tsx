import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RarityBadge, RARITY_META } from "./RarityBadge";

// CREATE (BL-161): RarityBadge is new -- symbol image + colored label,
// replacing bare getRarityLabel() text in the Cards table's Rarity column
// (a follow-up slice reuses it for CardPopup's rarity line, see the
// component's own doc comment). Covers: every rarity's icon+label+color
// (both single-letter code and swuapi's real spelled-out input, since
// getRarityLabel accepts either), the default 20px icon size, and the
// unrecognized-rarity fallback.

describe("RarityBadge", () => {
  it.each([
    ["C", "Common", "common"],
    ["U", "Uncommon", "uncommon"],
    ["R", "Rare", "rare"],
    ["L", "Legendary", "legendary"],
    ["S", "Special", "special"],
  ])("renders the %s code as %s with the %s symbol + color class", (code, label, key) => {
    const { container } = render(<RarityBadge rarity={code} />);
    const icon = container.querySelector(".rarity-badge__icon") as HTMLImageElement;
    expect(icon).toBeTruthy();
    expect(icon.src).toContain(key);
    expect(icon).toHaveAttribute("width", "20");
    expect(icon).toHaveAttribute("height", "20");
    const labelEl = container.querySelector(".rarity-badge__label")!;
    expect(labelEl.textContent).toBe(label);
    expect(labelEl.className).toContain(`rarity-badge__label--${key}`);
  });

  // swuapi's live catalog ships the full word directly (not the single-letter
  // code) -- getRarityLabel passes it through unchanged, and RARITY_META is
  // keyed by that same spelled-out label, so this input shape resolves
  // identically to the coded one above.
  it("also accepts the spelled-out rarity word directly (swuapi's real shape)", () => {
    const { container } = render(<RarityBadge rarity="Legendary" />);
    const labelEl = container.querySelector(".rarity-badge__label")!;
    expect(labelEl.textContent).toBe("Legendary");
    expect(labelEl.className).toContain("rarity-badge__label--legendary");
  });

  it("respects a custom size prop for the icon", () => {
    const { container } = render(<RarityBadge rarity="R" size={32} />);
    const icon = container.querySelector(".rarity-badge__icon")!;
    expect(icon).toHaveAttribute("width", "32");
    expect(icon).toHaveAttribute("height", "32");
  });

  it("falls back to the raw label with no icon/color for an unrecognized rarity", () => {
    const { container } = render(<RarityBadge rarity="Mythic" />);
    expect(container.querySelector(".rarity-badge__icon")).toBeNull();
    const labelEl = container.querySelector(".rarity-badge__label")!;
    expect(labelEl.textContent).toBe("Mythic");
    expect(labelEl.className).toBe("rarity-badge__label");
  });

  it("exports RARITY_META with all five rarities", () => {
    expect(Object.keys(RARITY_META).sort()).toEqual(
      ["Common", "Legendary", "Rare", "Special", "Uncommon"].sort()
    );
  });
});
