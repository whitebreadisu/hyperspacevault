import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PreconPreviewComposition } from "./PreconPreviewComposition";
import type { AddCardsCatalogEntry } from "../../utils/addCardsResolver";
import type { PreconPreview } from "../../utils/preconPreview";

// BL-164 §5: the hover-preview's owner-locked leader+base composition --
// these tests assert DOM presence/shape per PreconPreview kind (standard /
// dual / ibh / unresolved), not pixel layout.

function makeEntry(overrides: Partial<AddCardsCatalogEntry>): AddCardsCatalogEntry {
  return {
    id: 1,
    name: "Card",
    subtitle: null,
    type: "Leader",
    variant_type: "Standard",
    finish: "Standard",
    channel: "Retail",
    set_code: "SOR",
    source_set_code: "SOR",
    card_number: "1",
    is_token: false,
    quantity: 0,
    front_image_url: "https://cdn.example/front.png",
    back_image_url: null,
    ...overrides,
  };
}

const LEADER_A = makeEntry({ id: 1, name: "Leader A", type: "Leader" });
const LEADER_B = makeEntry({ id: 2, name: "Leader B", type: "Leader" });
const BASE_A = makeEntry({ id: 3, name: "Base A", type: "Base" });
const BASE_B = makeEntry({ id: 4, name: "Base B", type: "Base" });

describe("PreconPreviewComposition", () => {
  it("standard: renders one leader image over one base image", () => {
    const preview: PreconPreview = { kind: "standard", leader: LEADER_A, base: BASE_A };
    const { container } = render(<PreconPreviewComposition preview={preview} />);

    expect(container.querySelector(".acx-pdd__preview-comp--standard")).not.toBeNull();
    expect(container.querySelector(".acx-pdd__preview-leader img")).toHaveAttribute(
      "alt",
      "Leader A"
    );
    expect(container.querySelector(".acx-pdd__preview-base img")).toHaveAttribute("alt", "Base A");
  });

  it("standard: omits the base layer entirely when the deck has no resolvable base", () => {
    const preview: PreconPreview = { kind: "standard", leader: LEADER_A, base: null };
    const { container } = render(<PreconPreviewComposition preview={preview} />);

    expect(container.querySelector(".acx-pdd__preview-leader img")).toHaveAttribute(
      "alt",
      "Leader A"
    );
    expect(container.querySelector(".acx-pdd__preview-base")).toBeNull();
  });

  it("dual (Twin Suns): renders both leaders side by side and one shared base", () => {
    const preview: PreconPreview = {
      kind: "dual",
      leaders: [LEADER_A, LEADER_B],
      base: BASE_A,
    };
    const { container } = render(<PreconPreviewComposition preview={preview} />);

    expect(container.querySelector(".acx-pdd__preview-comp--dual")).not.toBeNull();
    const leaderImgs = container.querySelectorAll(".acx-pdd__preview-leader img");
    expect(Array.from(leaderImgs).map((img) => img.getAttribute("alt"))).toEqual([
      "Leader A",
      "Leader B",
    ]);
    // Exactly one base layer shared between both leaders.
    expect(container.querySelectorAll(".acx-pdd__preview-base")).toHaveLength(1);
  });

  it("ibh: renders two standard compositions side by side, each with its own base", () => {
    const preview: PreconPreview = {
      kind: "ibh",
      halves: [
        { leader: LEADER_A, base: BASE_A },
        { leader: LEADER_B, base: BASE_B },
      ],
    };
    const { container } = render(<PreconPreviewComposition preview={preview} />);

    expect(container.querySelector(".acx-pdd__preview-comp--ibh")).not.toBeNull();
    expect(container.querySelectorAll(".acx-pdd__preview-comp--standard")).toHaveLength(2);
    const leaderImgs = container.querySelectorAll(".acx-pdd__preview-leader img");
    expect(Array.from(leaderImgs).map((img) => img.getAttribute("alt"))).toEqual([
      "Leader A",
      "Leader B",
    ]);
    const baseImgs = container.querySelectorAll(".acx-pdd__preview-base img");
    expect(Array.from(baseImgs).map((img) => img.getAttribute("alt"))).toEqual([
      "Base A",
      "Base B",
    ]);
  });

  it("unresolved: renders nothing", () => {
    const preview: PreconPreview = { kind: "unresolved", unresolvedCardNumbers: ["1"] };
    const { container } = render(<PreconPreviewComposition preview={preview} />);
    expect(container.firstChild).toBeNull();
  });
});
