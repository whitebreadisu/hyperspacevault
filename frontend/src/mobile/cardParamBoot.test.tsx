import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRouterForTest } from "./router";

// The phone half of the `/?card=` boot parameter (design note §9 "Optional
// extra", CREATE): resolved through the vault data already loaded, then
// `#/card/<base_card_id>`. Absent = nothing at all.
const data = vi.hoisted(() => ({
  loading: false,
  cards: [] as {
    base_card_id: number;
    set_code: string;
    base_card_number: string;
    is_token: boolean;
    variants?: {
      variant_id: number;
      finish: string | null;
      variant_type: string;
      source_set_code: string;
      card_number: string;
      front_image_url: string | null;
    }[];
  }[],
}));
vi.mock("../vault/useVaultData", () => ({ useVaultData: () => data }));

import { CardParamBoot } from "./CardParamBoot";

const printing = (variant_id: number, finish: string, card_number: string) => ({
  variant_id,
  finish,
  variant_type: finish,
  source_set_code: "SOR",
  card_number,
  front_image_url: null,
});
const CARDS = [
  {
    base_card_id: 41,
    set_code: "SOR",
    base_card_number: "6",
    is_token: false,
    variants: [printing(410, "Standard", "6"), printing(411, "Hyperspace", "272")],
  },
  { base_card_id: 99, set_code: "TWI", base_card_number: "1", is_token: true },
  { base_card_id: 42, set_code: "TWI", base_card_number: "1", is_token: false },
];

describe("CardParamBoot", () => {
  beforeEach(() => {
    resetRouterForTest();
    data.loading = false;
    data.cards = CARDS;
  });
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("absent: the hash and the address bar are untouched", async () => {
    window.history.replaceState(null, "", "/#/vault");
    await act(async () => {
      render(<CardParamBoot />);
    });
    expect(window.location.hash).toBe("#/vault");
    expect(window.location.search).toBe("");
  });

  it("navigates to the card once the catalogue is in, and drops the parameter", async () => {
    data.loading = true;
    window.history.replaceState(null, "", "/?card=twi-001#/vault");
    const { rerender } = render(<CardParamBoot />);
    expect(window.location.hash).toBe("#/vault");
    data.loading = false;
    await act(async () => {
      rerender(<CardParamBoot />);
    });
    // The non-token TWI 1, never the token that shares its number.
    expect(window.location.hash).toBe("#/card/42");
    expect(window.location.search).toBe("");
  });

  it("an unknown card only drops the parameter", async () => {
    window.history.replaceState(null, "", "/?card=sor-999&x=1#/vault");
    await act(async () => {
      render(<CardParamBoot />);
    });
    expect(window.location.hash).toBe("#/vault");
    expect(window.location.search).toBe("?x=1");
  });

  it.each([["not-a-card!"], [""]])("does nothing for a malformed %j", async (value) => {
    window.history.replaceState(null, "", `/?card=${value}#/vault`);
    await act(async () => {
      render(<CardParamBoot />);
    });
    expect(window.location.hash).toBe("#/vault");
    expect(window.location.search).toBe(`?card=${value}`);
  });

  it("does nothing while a shared vault is shown, or off the root path", async () => {
    window.history.replaceState(null, "", "/?card=sor-006#/vault");
    await act(async () => {
      render(<CardParamBoot disabled />);
    });
    expect(window.location.hash).toBe("#/vault");
    window.history.replaceState(null, "", "/shared/tok?card=sor-006#/vault");
    await act(async () => {
      render(<CardParamBoot />);
    });
    expect(window.location.hash).toBe("#/vault");
  });

  // `&v=<printing slug>` (App Spec §25.0): the slug becomes the route's
  // `?v=<variant_id>`; an unknown slug opens the usual printing; both leave
  // the address bar with the card.
  it.each([
    ["hyperspace-sor-272", "#/card/41?v=411"],
    ["hyperspace-twi-999", "#/card/41"],
    ["Not A Slug", "#/card/41"],
  ])("v=%j navigates to %j", async (slug, hash) => {
    window.history.replaceState(
      null,
      "",
      `/?card=sor-006&v=${encodeURIComponent(slug)}&x=1#/vault`
    );
    await act(async () => {
      render(<CardParamBoot />);
    });
    expect(window.location.hash).toBe(hash);
    expect(window.location.search).toBe("?x=1");
  });
});
