import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SharedVaultPage } from "./SharedVaultPage";
import { StashProvider } from "../../stashes/StashContext";
import type { BaseCardDetail } from "../../api/baseCards";

// BL-209 rule 4: the vault link stays stash-free. A vault viewer sees no
// stash name, description or count, and no stash control -- even when the
// viewer is signed in with stashes of their own (App.tsx keeps their
// StashProvider mounted, paused, around the share pane). The share
// subtree never reads a stash: not the owner's (no stash read exists for a
// vault token) and not the viewer's.

const { getStashes, getStashItems, getSharedStash } = vi.hoisted(() => ({
  getStashes: vi.fn(),
  getStashItems: vi.fn(),
  getSharedStash: vi.fn(),
}));
vi.mock("../../api/stashes", async () => {
  const actual = await vi.importActual<typeof import("../../api/stashes")>("../../api/stashes");
  return { ...actual, getStashes, getStashItems };
});
vi.mock("../../api/sharedView", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/sharedView")>("../../api/sharedView");
  return {
    ...actual,
    resolveShare: vi.fn().mockResolvedValue({ name: "Rowan", scope: "inventory" }),
    getSharedQuantities: vi.fn().mockResolvedValue([{ variant_id: 1, quantity: 3 }]),
    getSharedLimits: vi.fn().mockResolvedValue({ limits: [], cap_mode: "hard" }),
    getSharedStash,
  };
});

const CARD: BaseCardDetail = {
  id: 1,
  set_code: "SOR",
  set_name: "Spark of Rebellion",
  base_card_number: "1",
  name: "Alpha",
  subtitle: null,
  type: "Unit",
  type2: null,
  double_sided: false,
  rarity: "C",
  cost: 1,
  power: 1,
  hp: 1,
  arena: "Ground",
  is_unique: false,
  front_text: null,
  back_text: null,
  epic_action: null,
  artist: null,
  is_token: false,
  aspects: [],
  keywords: [],
  traits: [],
  variants: [
    {
      variant_id: 1,
      variant_type: "Standard",
      finish: "Standard",
      channel: "Retail",
      stamped: false,
      source_set_code: "SOR",
      source_set_name: "Spark of Rebellion",
      card_number: "1",
      front_image_url: null,
      back_image_url: null,
      stamp_group: null,
      quantity: 0,
    },
  ],
};
vi.mock("../../api/baseCards", () => ({
  getBaseCardsList: vi.fn(async () => [CARD]),
  getBaseCardDetail: vi.fn(async () => CARD),
  getPriceHistory: vi.fn().mockResolvedValue({ variant_id: 0, range: "90d", series: [] }),
}));
vi.mock("../../api/sets", () => ({ getSets: vi.fn().mockResolvedValue([]) }));
vi.mock("../../analytics/analytics", () => ({ capture: vi.fn() }));

const SECRET = ["Secret binder", "Owner-only notes"];

describe("the vault viewer stays stash-free (BL-209 rule 4)", () => {
  beforeEach(() => {
    getStashes.mockResolvedValue([
      { id: 9, name: SECRET[0], description: SECRET[1], created_at: "2026-11-01", copies: 2 },
    ]);
    getStashItems.mockResolvedValue([{ stash_id: 9, variant_id: 1, quantity: 2 }]);
    getSharedStash.mockReset();
  });

  it("shows no stash name, description, count or control, in the list or the card detail", async () => {
    let utils!: ReturnType<typeof render>;
    await act(async () => {
      // As App.tsx: the signed-in viewer's own StashProvider, paused while
      // the share shows, around the share pane.
      utils = render(
        <StashProvider enabled paused uid="viewer-1">
          <SharedVaultPage token="tok-1" onResolved={vi.fn()} />
        </StashProvider>
      );
    });
    const { container } = utils;
    await waitFor(() => expect(container.querySelector(".data-table tbody tr")).not.toBeNull());
    const noStash = () => {
      const text = container.ownerDocument.body.textContent ?? "";
      for (const s of SECRET) expect(text).not.toContain(s);
      expect(text).not.toMatch(/in stash|stashed|stashes/i);
      expect(container.ownerDocument.querySelector('[class*="sp-"], [class*="stash"]')).toBeNull();
    };
    noStash();
    await act(async () => {
      fireEvent.click(container.querySelector(".data-table tbody tr td:nth-child(2) button")!);
    });
    await waitFor(() =>
      expect(container.ownerDocument.querySelector(".cp-plate__owned-label")).not.toBeNull()
    );
    expect(container.ownerDocument.querySelector(".cp-plate__owned-label")!.textContent).toMatch(
      /^OWNED/
    );
    noStash();
    // No stash read of any kind under a vault link.
    expect(getSharedStash).not.toHaveBeenCalled();
  });
});
