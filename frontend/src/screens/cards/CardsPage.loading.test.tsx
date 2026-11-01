import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CardsPage } from "./CardsPage";
import type { BaseCardDetail, VariantDetail } from "../../api/baseCards";

// The "Loading cards…" placeholder replaces the whole layout, so a frame of it
// unmounts the filter panel and the table. These cases watch every DOM
// mutation (not just the settled DOM, which act() hides intermediate commits
// from) to show whether that frame is ever committed when there are no real
// quantities to fetch.

vi.mock("../../api/sets", () => ({
  getSets: vi.fn().mockResolvedValue([
    {
      id: 1,
      code: "SOR",
      name: "Spark of Rebellion",
      is_base_set: true,
      release_date: "2024-03-08",
    },
    {
      id: 2,
      code: "SHD",
      name: "Shadows of the Galaxy",
      is_base_set: true,
      release_date: "2024-08-02",
    },
  ]),
}));

const mockGetQuantities = vi.fn();
vi.mock("../../api/inventory", () => ({
  adjustCard: vi.fn(),
  getQuantities: () => mockGetQuantities(),
  EmailNotVerifiedError: class extends Error {},
}));

vi.mock("../../api/sharedView", () => ({
  getSharedQuantities: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../api/shares", () => ({
  listShares: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../analytics/analytics", () => ({
  capture: vi.fn(),
}));

const mockGetBaseCardsList = vi.fn();
vi.mock("../../api/baseCards", () => ({
  getBaseCardsList: () => mockGetBaseCardsList(),
  getBaseCardDetail: vi.fn(),
  getPriceHistory: vi.fn().mockResolvedValue({ variant_id: 0, range: "90d", series: [] }),
}));

vi.mock("../../context/LimitsContext", () => ({
  useLimits: () => ({ limits: null, capMode: "hard" }),
}));

function variant(overrides: Partial<VariantDetail>): VariantDetail {
  return {
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
    ...overrides,
  };
}

function card(overrides: Partial<BaseCardDetail>): BaseCardDetail {
  return {
    id: 1,
    set_code: "SOR",
    set_name: "Spark of Rebellion",
    base_card_number: "1",
    name: "SOR Card One",
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
    variants: [variant({})],
    ...overrides,
  };
}

const CARDS: BaseCardDetail[] = [
  card({ id: 1, name: "SOR Card One", variants: [variant({ variant_id: 1, quantity: 3 })] }),
  card({
    id: 2,
    set_code: "SHD",
    set_name: "Shadows of the Galaxy",
    name: "SHD Card One",
    variants: [variant({ variant_id: 2, source_set_code: "SHD", quantity: 0 })],
  }),
];

const LOADING = "Loading cards…";

/** Every node added under document.body, in order, as "loading" / "content". */
function watchFrames() {
  const frames: string[] = [];
  const classify = (records: MutationRecord[]) => {
    for (const r of records) {
      for (const n of Array.from(r.addedNodes)) {
        const text = n.textContent ?? "";
        if (text.includes(LOADING)) frames.push("loading");
        else if (n instanceof HTMLElement && n.querySelector?.(".cards-layout"))
          frames.push("content");
        else if (n instanceof HTMLElement && n.classList.contains("cards-layout"))
          frames.push("content");
      }
    }
  };
  const observer = new MutationObserver(classify);
  observer.observe(document.body, { childList: true, subtree: true });
  return {
    frames,
    stop() {
      classify(observer.takeRecords());
      observer.disconnect();
      return frames;
    },
  };
}

beforeEach(() => {
  mockGetBaseCardsList.mockResolvedValue(CARDS);
  mockGetQuantities.mockResolvedValue([{ variant_id: 1, quantity: 3 }]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CardsPage loading placeholder with no quantities to fetch", () => {
  it("never shows Loading cards… on sign-out", async () => {
    let utils!: ReturnType<typeof render>;
    await act(async () => {
      utils = render(<CardsPage isAuthenticated={true} />);
    });
    expect(screen.getByText("SOR Card One")).toBeInTheDocument();

    const watch = watchFrames();
    await act(async () => {
      utils.rerender(<CardsPage isAuthenticated={false} />);
    });
    const frames = watch.stop();

    expect(frames).not.toContain("loading");
    expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    expect(screen.getByText("SOR Card One")).toBeInTheDocument();
  });

  it("never shows Loading cards… again once a signed-out visitor's catalogue is in", async () => {
    const watch = watchFrames();
    await act(async () => {
      render(<CardsPage isAuthenticated={false} />);
    });
    const frames = watch.stop();

    // The first frame is the catalogue placeholder (proves the watcher sees
    // commits); after the first content frame no placeholder follows.
    expect(frames[0]).toBe("loading");
    const firstContent = frames.indexOf("content");
    expect(firstContent).toBeGreaterThan(0);
    expect(frames.slice(firstContent)).not.toContain("loading");
    expect(mockGetQuantities).not.toHaveBeenCalled();
  });
});
