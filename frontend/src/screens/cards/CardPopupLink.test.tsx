import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardPopup } from "./CardPopup";
import type { BaseCardDetail, VariantDetail } from "../../api/baseCards";
import { LINK_NOTE_MS } from "./CardPopupLink";

// The popup header's copy-link control (App Spec §5.3): the link is the
// selected printing's public page on the canonical origin, copied with the
// async clipboard or the textarea fallback; tokens have no page and no
// control; the popup's keys keep working around it.

const { getBaseCardDetail, getPriceHistory } = vi.hoisted(() => ({
  getBaseCardDetail: vi.fn(),
  getPriceHistory: vi.fn(),
}));
vi.mock("../../api/baseCards", () => ({ getBaseCardDetail, getPriceHistory }));
vi.mock("../../api/settingsLimits", () => ({ getLimits: vi.fn(), putLimits: vi.fn() }));
vi.mock("../../api/inventory", () => ({
  adjustCard: vi.fn(),
  EmailNotVerifiedError: class extends Error {},
}));
const mockCapture = vi.fn();
vi.mock("../../analytics/analytics", () => ({
  capture: (...args: unknown[]) => mockCapture(...args),
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
    card_number: "5",
    front_image_url: "front.png",
    back_image_url: null,
    stamp_group: null,
    quantity: 0,
    ...overrides,
  };
}

function detail(overrides: Partial<BaseCardDetail> = {}): BaseCardDetail {
  return {
    id: 1,
    set_code: "SOR",
    set_name: "Spark of Rebellion",
    base_card_number: "5",
    name: "Luke Skywalker",
    subtitle: null,
    type: "Unit",
    type2: null,
    double_sided: false,
    rarity: "R",
    cost: 3,
    power: 4,
    hp: 4,
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
      variant({ variant_id: 1 }),
      variant({
        variant_id: 2,
        variant_type: "Hyperspace",
        finish: "Hyperspace",
        card_number: "271",
      }),
    ],
    ...overrides,
  };
}

async function open(d: BaseCardDetail, onClose = vi.fn()) {
  getBaseCardDetail.mockResolvedValue(d);
  getPriceHistory.mockResolvedValue({ variant_id: 1, range: "90d", series: [] });
  await act(async () => {
    render(
      <CardPopup
        baseCardId={d.id}
        isAuthenticated={false}
        setNameByCode={{ SOR: "Spark of Rebellion" }}
        onClose={onClose}
        navigation={{ canPrev: true, canNext: true, onPrev: vi.fn(), onNext: vi.fn() }}
      />
    );
  });
  await waitFor(() => {
    if (screen.queryByText("Loading…")) throw new Error("loading");
    screen.getByRole("dialog");
  });
  return onClose;
}

const linkButton = () => screen.getByRole("button", { name: "Copy link to this card" });
const PAGE = "https://www.hyperspacevault.com/cards/sor/005/";

describe("CardPopup copy link", () => {
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });

  it("sits in the header cluster, between the chevrons and the close button", async () => {
    await open(detail());
    const cluster = document.querySelector(".cp-header__controls")!;
    const labels = [...cluster.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Previous card", "Next card", "Copy link to this card", "Close"]);
  });

  it("copies the default printing's page with no v, then the selected printing's with v", async () => {
    await open(detail());
    await act(async () => {
      fireEvent.click(linkButton());
    });
    expect(writeText).toHaveBeenLastCalledWith(PAGE);
    fireEvent.click(document.querySelector('.cp-rail__item[data-variant-id="2"]')!);
    await act(async () => {
      fireEvent.click(linkButton());
    });
    expect(writeText).toHaveBeenLastCalledWith(PAGE + "?v=hyperspace-sor-271");
    expect(mockCapture).toHaveBeenCalledWith("card_link_copied", {
      method: "copy",
      surface: "popup",
    });
  });

  it("shows Link copied for a moment", async () => {
    await open(detail());
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(linkButton());
    });
    expect(screen.getByRole("status").textContent).toBe("Link copied");
    act(() => {
      vi.advanceTimersByTime(LINK_NOTE_MS);
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("falls back to a hidden textarea when the clipboard refuses", async () => {
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    const exec = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    await open(detail());
    let copied = "";
    exec.mockImplementation(() => {
      copied = (document.querySelector("textarea") as HTMLTextAreaElement).value;
      return true;
    });
    await act(async () => {
      fireEvent.click(linkButton());
    });
    expect(exec).toHaveBeenCalledWith("copy");
    expect(copied).toBe(PAGE);
    expect(document.querySelector("textarea")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Link copied");
  });

  it("says the link was not copied when both ways fail, and sends no event", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    Object.defineProperty(document, "execCommand", { value: () => false, configurable: true });
    await open(detail());
    await act(async () => {
      fireEvent.click(linkButton());
    });
    expect(screen.getByRole("status").textContent).toBe("Link not copied");
    expect(mockCapture).not.toHaveBeenCalledWith("card_link_copied", expect.anything());
  });

  it("is absent for a token, which has no page", async () => {
    await open(detail({ is_token: true }));
    expect(screen.queryByRole("button", { name: "Copy link to this card" })).toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("leaves the popup's keys alone: Down cycles the printing and Escape closes", async () => {
    const onClose = await open(detail());
    linkButton().focus();
    await act(async () => {
      fireEvent.click(linkButton());
    });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowDown" });
    expect(document.querySelector(".cp-rail__item--active")?.getAttribute("data-variant-id")).toBe(
      "2"
    );
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
