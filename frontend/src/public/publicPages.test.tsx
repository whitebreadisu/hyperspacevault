import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopCardPage, PhoneCardPage } from "./CardPublicPage";
import { headHtml, pageDescription } from "./head";
import {
  buildPages,
  cardPath,
  numberLabel,
  repairMojibake,
  stripEpicLabel,
  type PublicCard,
  type PublicCatalog,
} from "./publicCatalog";
import { renderCardBody } from "./render";

const capture = vi.hoisted(() => vi.fn());
vi.mock("../analytics/analytics", async (orig) => ({
  ...(await orig<typeof import("../analytics/analytics")>()),
  capture,
}));

// Public card pages (design note §4.0, §5, §6 C7, §8): the data model, the
// head, the server render and the hydration of each layout tree.

const CDN = "https://cdn.starwarsunlimited.com/";

function variant(id: number, finish: string, set: string, num: string, price: number | null) {
  return {
    variant_id: id,
    variant_type: finish,
    finish,
    channel: "Retail",
    stamped: false,
    source_set_code: set,
    source_set_name: set,
    card_number: num,
    front_image_url: `${CDN}card_${id}_front.png`,
    back_image_url: `${CDN}card_${id}_back.png`,
    front_images: {
      original: `/images/cards/card_${id}_front.png`,
      w640: `/images/cards/card_${id}_front_640.webp`,
      w320: `/images/cards/card_${id}_front_320.webp`,
    },
    back_images: {
      original: `/images/cards/card_${id}_back.png`,
      w640: `/images/cards/card_${id}_back_640.webp`,
      w320: `/images/cards/card_${id}_back_320.webp`,
    },
    stamp_group: null,
    price: price == null ? null : { market: price, low: price - 1, as_of: "2026-11-01" },
  };
}

function card(over: Partial<PublicCard> & Pick<PublicCard, "base_card_number">): PublicCard {
  return {
    id: 710,
    set_code: "SOR",
    set_name: "Spark of Rebellion",
    name: "Luke Skywalker",
    subtitle: "Faithful Friend",
    type: "Leader",
    type2: "Leader Unit",
    double_sided: true,
    rarity: "Special",
    cost: 6,
    power: 4,
    hp: 7,
    arena: "Ground",
    is_unique: true,
    front_text: "Action [1 resource, exhaust]: Give a Shield token.",
    back_text: "On Attack: You may give another unit a Shield token.",
    epic_action: "Epic Action: If you control 6 or more resources, deploy this leader.",
    artist: "Borja Pindado",
    is_token: false,
    aspects: ["Heroism", "Vigilance"],
    keywords: [],
    traits: ["Force", "Rebel"],
    variants: [
      variant(7123, "Standard", "SOR", "5", 3.99),
      variant(6502, "Hyperspace", "SORP", "1", null),
    ],
    ...over,
  };
}

const catalog: PublicCatalog = {
  build_sha: "test",
  sets: [
    { code: "SOR", name: "Spark of Rebellion", is_base_set: true, release_date: "2024-03-08" },
    {
      code: "SORP",
      name: "Spark of Rebellion Weekly Play",
      is_base_set: false,
      release_date: null,
    },
  ],
  counts: { SOR: 2 },
  cards: [
    card({ base_card_number: "5" }),
    card({ id: 1800, base_card_number: "25", name: "Tarkintown", subtitle: null, type: "Base" }),
    card({ id: 9, base_card_number: "5", name: "Token", is_token: true }),
  ],
};

describe("public catalog model", () => {
  it("builds the trailing-slash, zero-padded URL and the printed number", () => {
    expect(cardPath("SOR", "5")).toBe("/cards/sor/005/");
    expect(cardPath("TWI", "272")).toBe("/cards/twi/272/");
    expect(numberLabel("SOR", "5")).toBe("SOR 005");
  });

  it("repairs cp1252 mojibake and leaves valid text alone", () => {
    expect(repairMojibake("Units canâ€™t attack")).toBe("Units can’t attack");
    expect(repairMojibake("control 6Â or more")).toBe("control 6 or more");
    expect(repairMojibake("Give –3/–3")).toBe("Give –3/–3");
  });

  it("strips the label the data already carries from the epic action", () => {
    expect(stripEpicLabel("Epic Action: Deploy him.")).toBe("Deploy him.");
    expect(stripEpicLabel("Piloting [2 resources]")).toBe("Piloting [2 resources]");
    expect(stripEpicLabel(null)).toBeNull();
  });

  it("skips tokens, links neighbours in set order, never names the official CDN", () => {
    const pages = buildPages(catalog);
    expect(pages.map((p) => p.numberLabel)).toEqual(["SOR 005", "SOR 025"]);
    expect(pages[0].prev).toBeNull();
    expect(pages[0].next).toEqual({ path: "/cards/sor/025/", label: "Tarkintown" });
    expect(pages[1].prev?.path).toBe("/cards/sor/005/");
    expect(JSON.stringify(pages)).not.toContain("cdn.starwarsunlimited.com");
    expect(pages[0].asOfLabel).toBe("as of Nov 1, 2026");
    expect(pages[0].card.epic_action).toBe(
      "If you control 6 or more resources, deploy this leader."
    );
  });

  it("fails when two non-token cards claim one URL", () => {
    const clash = {
      ...catalog,
      cards: [card({ base_card_number: "5" }), card({ base_card_number: "05" })],
    };
    expect(() => buildPages(clash)).toThrow(/claimed by both/);
  });
});

describe("page head", () => {
  const [page] = buildPages(catalog);

  it("has title, canonical with trailing slash, breadcrumb JSON-LD and no price figure", () => {
    const head = headHtml(page, { noindex: false });
    expect(head).toContain(
      "<title>Luke Skywalker - Faithful Friend · SOR 005 · Price and printings · HyperspaceVault</title>"
    );
    expect(head).toContain(
      '<link rel="canonical" href="https://www.hyperspacevault.com/cards/sor/005/" />'
    );
    expect(head).toContain('"@type":"BreadcrumbList"');
    expect(head).not.toMatch(/\$\d/);
    expect(pageDescription(page)).not.toMatch(/\d\.\d\d/);
    expect(head).not.toContain("noindex");
  });

  it("carries a robots noindex only when asked (dev)", () => {
    expect(headHtml(page, { noindex: true })).toContain('<meta name="robots" content="noindex" />');
  });
});

describe("server render and hydration", () => {
  const [page] = buildPages(catalog);

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    capture.mockClear();
    // The price history fetch never resolves: hydration is what is under test.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {}))
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("renders both layout trees with the deltas and no inventory controls", () => {
    const html = renderCardBody(page);
    document.body.innerHTML = html;
    const desk = document.getElementById("pc-desktop")!;
    const phone = document.getElementById("pc-phone")!;
    expect(desk.querySelectorAll("h1")).toHaveLength(1);
    expect(desk.querySelector("h1")!.textContent).toBe("Luke Skywalker");
    expect(phone.querySelector("h1")!.textContent).toBe("Luke Skywalker");
    for (const tree of [desk, phone]) {
      expect(tree.textContent).toContain("Track this card in your vault");
      expect(tree.textContent).toContain("Create free account");
      expect(tree.textContent).toContain("SOR 005");
      expect(tree.textContent).toContain("as of Nov 1, 2026");
      expect(tree.textContent).toContain("Vigilance, Heroism");
      expect(tree.textContent).toContain("Fantasy Flight Publishing Inc.");
      expect(tree.textContent!.match(/Epic Action:/g)).toHaveLength(1);
      expect(tree.querySelector(".m-stepper, .cp-plate__stepper, button.cp-close")).toBeNull();
    }
    // The header's prev / next chevrons are the app's (same classes, enabled)
    // and both are plain links into the app; no set navigation under the
    // desktop shell (owner, 2026-11-02).
    const chevrons = desk.querySelectorAll<HTMLAnchorElement>(".cp-header__controls a.cp-nav-btn");
    expect(chevrons).toHaveLength(2);
    for (const a of chevrons) {
      expect(a.getAttribute("href")).toBe("/");
      expect(a.getAttribute("aria-label")).toBe("Open Hyperspace Vault to browse more cards");
    }
    expect(desk.querySelector(".pc-setnav")).toBeNull();
    // Row 4 is a desktop delta: the phone's set row already reads the set
    // name, and its printings group keeps the app's "Base set" label.
    expect(desk.textContent).not.toContain("Base set");
    // The desktop art is the 320 px rendition only.
    const img = desk.querySelector<HTMLImageElement>("img.cp-image")!;
    expect(img.getAttribute("src")).toBe("/images/cards/card_7123_front_320.webp");
    expect(img.hasAttribute("srcset")).toBe(false);
    expect(document.getElementById("card-data")!.textContent).toContain('"numberLabel":"SOR 005"');
  });

  it.each([
    ["desktop", "pc-desktop", DesktopCardPage],
    ["phone", "pc-phone", PhoneCardPage],
  ] as const)("hydrates the %s tree without a mismatch or an app event", async (_, id, Page) => {
    document.body.innerHTML = renderCardBody(page);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = vi.fn();
    await act(async () => {
      hydrateRoot(document.getElementById(id)!, <Page data={page} />, {
        onRecoverableError: recoverable,
      });
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
