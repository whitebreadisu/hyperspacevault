import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { DesktopCardPage, PhoneCardPage, resetPrintingSelection } from "./CardPublicPage";
import { headHtml, indexHeadHtml, pageDescription, setHeadHtml } from "./head";
import {
  buildIndexPage,
  buildPages,
  buildSetPages,
  cardPath,
  compareSetsNewestFirst,
  numberLabel,
  repairMojibake,
  type PublicCard,
  type PublicCatalog,
} from "./publicCatalog";
import { renderCardBody, renderIndexBody, renderSetBody } from "./render";
import {
  isAllowedPublicEvent,
  publicAnalyticsEnabled,
  publicCapture,
  referrerKind,
} from "./publicAnalytics";
import { epicActionDisplay } from "../utils/epicAction";
import { EpicActionText } from "../components/EpicActionText";
import { priceAttribution } from "../utils/priceAttribution";

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

  it("skips tokens, links neighbours in set order, never names the official CDN", () => {
    const pages = buildPages(catalog);
    expect(pages.map((p) => p.numberLabel)).toEqual(["SOR 005", "SOR 025"]);
    expect(pages[0].prev).toBeNull();
    expect(pages[0].next).toEqual({
      path: "/cards/sor/025/",
      label: "Tarkintown",
      appHref: "/?card=sor-025",
    });
    expect(pages[1].prev?.path).toBe("/cards/sor/005/");
    expect(JSON.stringify(pages)).not.toContain("cdn.starwarsunlimited.com");
    // The epic action passes through; the views' shared rule labels it once.
    expect(pages[0].card.epic_action).toBe(
      "Epic Action: If you control 6 or more resources, deploy this leader."
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
    // The returning-visitor redirect is the first element, before the title.
    expect(head.startsWith("<script>(function (C)")).toBe(true);
    expect(head.indexOf("<script>")).toBeLessThan(head.indexOf("<title>"));
    expect(head).toContain('"href":"/?card=sor-005"');
  });

  it("set pages and the index carry no redirect script", () => {
    expect(setHeadHtml(buildSetPages(catalog)[0], { noindex: false })).not.toContain("<script>");
    expect(indexHeadHtml(buildIndexPage(catalog), { noindex: false })).not.toContain("<script>");
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
    resetPrintingSelection();
    window.history.replaceState(null, "", "/cards/sor/005/");
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
    // One <h1> element per page: the phone tree's title. The desktop title
    // is the same text and classes as a level-1 ARIA heading, not an <h1>.
    expect(document.body.querySelectorAll("h1")).toHaveLength(1);
    expect(phone.querySelector("h1")!.textContent).toBe("Luke Skywalker");
    expect(desk.querySelector("h1")).toBeNull();
    const deskTitle = desk.querySelector(".cp-title")!;
    expect(deskTitle.tagName).toBe("DIV");
    expect(deskTitle.getAttribute("role")).toBe("heading");
    expect(deskTitle.getAttribute("aria-level")).toBe("1");
    expect(deskTitle.textContent).toBe("Luke Skywalker");
    for (const tree of [desk, phone]) {
      expect(tree.textContent).toContain("Track this card in your vault");
      expect(tree.textContent).toContain("Create free account");
      expect(tree.textContent).toContain("SOR 005");
      expect(tree.textContent).toContain("Prices via TCGplayer · as of Nov 1, 2026 · 1 unpriced");
      expect(tree.textContent).toContain("Vigilance, Heroism");
      expect(tree.textContent).toContain("Fantasy Flight Publishing Inc.");
      expect(tree.textContent!.match(/Epic Action:/g)).toHaveLength(1);
      expect(tree.querySelector(".m-stepper, .cp-plate__stepper, button.cp-close")).toBeNull();
    }
    // The header's prev / next chevrons are the app's (same classes) and
    // open the neighbouring card in set order inside the app; at the set's
    // first card, prev is disabled (design note §4.0 row 2, §9 "Optional
    // extra"). No set navigation under the desktop shell.
    const prev = desk.querySelector(".cp-header__controls .cp-nav-btn--prev")!;
    const next = desk.querySelector<HTMLAnchorElement>(".cp-header__controls .cp-nav-btn--next")!;
    // The app's disabled chevron: a disabled button, same classes and label.
    expect(prev.tagName).toBe("BUTTON");
    expect((prev as HTMLButtonElement).disabled).toBe(true);
    expect(prev.getAttribute("aria-label")).toBe("Previous card");
    expect(next.tagName).toBe("A");
    expect(next.getAttribute("href")).toBe("/?card=sor-025");
    expect(next.getAttribute("aria-label")).toBe("Next card: Tarkintown, in Hyperspace Vault");
    expect(desk.querySelector(".pc-setnav")).toBeNull();
    // Row 4 on both trees: the set row and the printings group read the
    // set's real name, never "Base set".
    for (const tree of [desk, phone]) {
      expect(tree.textContent).not.toContain("Base set");
      expect(tree.querySelector(".cp-rail__group-label")!.textContent).toBe("Spark of Rebellion");
    }
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

describe("card page calls to action", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("every call to action on both trees opens this card in the app; the breadcrumb stays", () => {
    const [page] = buildPages(catalog);
    document.body.innerHTML = renderCardBody(page);
    for (const id of ["pc-desktop", "pc-phone"]) {
      const tree = document.getElementById(id)!;
      expect(tree.querySelector(".pc-brand")!.getAttribute("href")).toBe("/?card=sor-005");
      expect(tree.querySelector(".pc-bar__open")!.getAttribute("href")).toBe("/?card=sor-005");
      expect(tree.querySelector(".pc-cta__signin")!.getAttribute("href")).toBe("/?card=sor-005");
      expect([...tree.querySelectorAll(".pc-crumbs a")].map((a) => a.getAttribute("href"))).toEqual(
        ["/cards/", "/cards/sor/"]
      );
      expect(tree.querySelector(".pc-foot a")!.getAttribute("href")).toBe("/");
    }
    // The phone tree's previous / next text links open the neighbour in the
    // app, as the desktop header chevrons do.
    const phoneNav = [...document.querySelectorAll("#pc-phone .pc-setnav a")];
    expect(phoneNav.map((a) => a.getAttribute("href"))).toEqual(["/?card=sor-025"]);
    document.body.innerHTML = renderCardBody(buildPages(catalog)[1]);
    expect(
      [...document.querySelectorAll("#pc-phone .pc-setnav a")].map((a) => a.getAttribute("href"))
    ).toEqual(["/?card=sor-005"]);
  });

  it.each([
    ["desktop", "pc-desktop", DesktopCardPage],
    ["phone", "pc-phone", PhoneCardPage],
  ] as const)(
    "Create free account on the %s tree goes to this card in the app",
    async (_, id, Page) => {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      vi.stubGlobal(
        "fetch",
        vi.fn(() => new Promise(() => {}))
      );
      const [page] = buildPages(catalog);
      document.body.innerHTML = renderCardBody(page);
      const assign = vi.fn();
      vi.stubGlobal("location", { ...window.location, assign });
      await act(async () => {
        hydrateRoot(document.getElementById(id)!, <Page data={page} />);
      });
      const button = [...document.getElementById(id)!.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Create free account")
      )!;
      await act(async () => {
        button.click();
      });
      expect(assign).toHaveBeenCalledWith("/?card=sor-005&signup=1");
    }
  );

  it("set pages and the index keep the app's front door", () => {
    const [set] = buildSetPages(catalog);
    document.body.innerHTML = renderSetBody(set);
    expect(document.querySelector(".pc-brand")!.getAttribute("href")).toBe("/");
    expect(document.querySelector(".pc-bar__open")!.getAttribute("href")).toBe("/");
    document.body.innerHTML = renderIndexBody(buildIndexPage(catalog));
    expect(document.querySelector(".pc-brand")!.getAttribute("href")).toBe("/");
  });
});

describe("one printing selection across both trees", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    resetPrintingSelection();
    window.history.replaceState(null, "", "/cards/sor/005/");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {}))
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/");
  });

  it("a tree hydrated later shows, and changes, the other tree's selection", async () => {
    const [page] = buildPages(catalog);
    document.body.innerHTML = renderCardBody(page);
    const desk = document.getElementById("pc-desktop")!;
    const phone = document.getElementById("pc-phone")!;
    await act(async () => {
      hydrateRoot(desk, <DesktopCardPage data={page} />);
    });
    const deskArt = () => desk.querySelector<HTMLImageElement>("img.cp-image")!.getAttribute("src");
    const hyperspace = [...desk.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      /Hyperspace/.test(b.textContent ?? "")
    )!;
    await act(async () => {
      hyperspace.click();
    });
    expect(deskArt()).toMatch(/card_6502_front_320/);
    expect(window.location.search).toMatch(/v=hyperspace-sorp-1/);
    // The phone tree hydrates now (the viewport crossed the switch).
    await act(async () => {
      hydrateRoot(phone, <PhoneCardPage data={page} />);
    });
    const phoneArt = () =>
      phone.querySelector<HTMLImageElement>("img.m-art__img")!.getAttribute("src");
    expect(phoneArt()).toMatch(/card_6502_front_320/);
    // Back to Standard on the phone: desktop follows, and ?v= is dropped.
    const standard = [...phone.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      /Standard/.test(b.textContent ?? "")
    )!;
    await act(async () => {
      standard.click();
    });
    expect(phoneArt()).toMatch(/card_7123_front_320/);
    expect(deskArt()).toMatch(/card_7123_front_320/);
    expect(window.location.search).toBe("");
  });
});

describe("set end of the header chevrons", () => {
  it("the set's last card has a prev link into the app and a disabled next", () => {
    const pages = buildPages(catalog);
    document.body.innerHTML = renderCardBody(pages[1]);
    const desk = document.getElementById("pc-desktop")!;
    const prev = desk.querySelector(".cp-header__controls .cp-nav-btn--prev")!;
    const next = desk.querySelector(".cp-header__controls .cp-nav-btn--next")!;
    expect(prev.getAttribute("href")).toBe("/?card=sor-005");
    expect(next.tagName).toBe("BUTTON");
    expect((next as HTMLButtonElement).disabled).toBe(true);
    expect(next.getAttribute("aria-label")).toBe("Next card");
    document.body.innerHTML = "";
  });
});

// One rule for the epic-action label (App Spec §10), in both card views and
// the pages: the label shows only when the source carried it. Samples are
// the shapes of the 2026-10-02 export.
describe("epic action label", () => {
  it.each([
    ["Epic Action: Deploy him.", "Epic Action: ", "Deploy him."],
    ['"Epic Action: Deal 2 damage."', "Epic Action: ", "Deal 2 damage."],
    ["epic action:   Deal 2 damage.", "Epic Action: ", "Deal 2 damage."],
    ['"Epic Action [4 resources]: Deploy."', null, "Epic Action [4 resources]: Deploy."],
    // No label in the source = none shown (ASH 18, JTL 83).
    ["When you play this unit: draw a card.", null, "When you play this unit: draw a card."],
    [
      "When this upgrade detaches from a unit: take control of it.",
      null,
      "When this upgrade detaches from a unit: take control of it.",
    ],
    [
      "Piloting [2 resources, Heroism]: attach this.",
      null,
      "Piloting [2 resources, Heroism]: attach this.",
    ],
    ["Action [Exhaust]: Ready a unit.", null, "Action [Exhaust]: Ready a unit."],
    ["Epic Action: Piloting [1 resource]", null, "Piloting [1 resource]"],
    [
      "Epic Action [4 resources]: Deploy this leader.",
      null,
      "Epic Action [4 resources]: Deploy this leader.",
    ],
    // TWI 15's cp1252 mojibake ("6Â" + no-break space) is repaired first.
    [
      "Epic Action: If you control 6\u00c2\u00a0or more",
      "Epic Action: ",
      "If you control 6\u00a0or more",
    ],
  ])("%j", (raw, label, text) => {
    expect(epicActionDisplay(raw)).toEqual({ label, text });
  });

  it("strips the label once, not every occurrence", () => {
    expect(epicActionDisplay("Epic Action: Epic Action: twice")).toEqual({
      label: "Epic Action: ",
      text: "Epic Action: twice",
    });
  });

  it("renders nothing for an absent or empty field", () => {
    expect(epicActionDisplay(null)).toBeNull();
    expect(epicActionDisplay(undefined)).toBeNull();
    expect(epicActionDisplay("Epic Action:  ")).toBeNull();
    expect(renderToString(<EpicActionText text={null} />)).toBe("");
  });

  it("the shared paragraph shows the label exactly once, or not at all", () => {
    const labelled = renderToString(<EpicActionText text="Epic Action: Deploy him." />);
    expect(labelled.match(/Epic Action:/g)).toHaveLength(1);
    expect(labelled).toContain('class="cp-text__epic-label"');
    const pilot = renderToString(<EpicActionText text="Piloting [2 resources]: attach." />);
    expect(pilot).not.toContain("Epic Action");
    expect(pilot).not.toContain("cp-text__epic-label");
  });
});

// The attribution line on every price surface (App Spec §5.10, §16.4).
describe("price attribution", () => {
  const priced = (as_of: string) => ({ price: { market: 1, low: 1, as_of } });
  it("carries the newest as-of date, in fixed UTC / en-US form", () => {
    expect(priceAttribution([priced("2026-07-19"), priced("2026-10-30")])).toBe(
      "Prices via TCGplayer · as of Oct 30, 2026"
    );
  });
  it("adds the unpriced count, and has no date when nothing is priced", () => {
    expect(priceAttribution([priced("2026-07-19"), { price: null }])).toBe(
      "Prices via TCGplayer · as of Jul 19, 2026 · 1 unpriced"
    );
    expect(priceAttribution([{ price: null }])).toBe("Prices via TCGplayer · 1 unpriced");
  });
});

describe("set pages and the set index", () => {
  const multi: PublicCatalog = {
    ...catalog,
    sets: [
      ...catalog.sets,
      { code: "HMW", name: "Homeworlds", is_base_set: true, release_date: "2026-10-01" },
      { code: "IBH", name: "Intro Battle: Hoth", is_base_set: true, release_date: "2025-05-01" },
      { code: "GG", name: "Gift Box", is_base_set: false, release_date: "2025-12-01" },
      { code: "ZZ", name: "Old Promo", is_base_set: false, release_date: "2024-01-01" },
    ],
    cards: [
      ...catalog.cards,
      card({ id: 2, set_code: "HMW", base_card_number: "12", name: "Han Solo", subtitle: null }),
      card({ id: 3, set_code: "HMW", base_card_number: "3", name: "Leia", subtitle: null }),
      card({ id: 4, set_code: "IBH", base_card_number: "1", name: "Echo Base", subtitle: null }),
      card({ id: 5, set_code: "GG", base_card_number: "1", name: "Gift", subtitle: null }),
      card({ id: 6, set_code: "ZZ", base_card_number: "1", name: "Promo", subtitle: null }),
    ],
  };

  it("orders the index newest first (ADR-0031) and counts non-token cards", () => {
    const index = buildIndexPage(multi);
    expect(index.sets.map((s) => s.code)).toEqual(["HMW", "SOR", "IBH", "GG", "ZZ"]);
    expect(index.sets.find((s) => s.code === "SOR")).toEqual({
      code: "SOR",
      name: "Spark of Rebellion",
      path: "/cards/sor/",
      count: 2,
    });
    expect(index.total).toBe(7);
    expect(
      compareSetsNewestFirst(
        { code: "GG", release_date: "2025-12-01" },
        { code: "ZZ", release_date: "2024-01-01" }
      )
    ).toBeLessThan(0);
  });

  it("lists every non-token card of a set in number order", () => {
    const hmw = buildSetPages(multi).find((s) => s.code === "HMW")!;
    expect(hmw.cards.map((c) => c.numberLabel)).toEqual(["HMW 003", "HMW 012"]);
    expect(hmw.cards[0]).toEqual({
      name: "Leia",
      subtitle: null,
      numberLabel: "HMW 003",
      rarity: "Special",
      path: "/cards/hmw/003/",
    });
    const sor = buildSetPages(multi).find((s) => s.code === "SOR")!;
    expect(sor.cards.map((c) => c.name)).toEqual(["Luke Skywalker", "Tarkintown"]);
  });

  it("renders one h1, the breadcrumb and a link per card, no price figure", () => {
    const sor = buildSetPages(multi).find((s) => s.code === "SOR")!;
    document.body.innerHTML = renderSetBody(sor);
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelector("h1")!.textContent).toBe("Spark of Rebellion");
    const links = [...document.querySelectorAll<HTMLAnchorElement>("a.pc-list__row")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/cards/sor/005/",
      "/cards/sor/025/",
    ]);
    expect(links[0].textContent).toContain("SOR 005");
    expect(links[0].textContent).toContain("Luke Skywalker");
    expect(links[0].textContent).toContain("Special");
    expect(document.querySelector(".pc-crumbs a")!.getAttribute("href")).toBe("/cards/");
    expect(document.body.textContent).not.toMatch(/\$\d/);
    document.body.innerHTML = renderIndexBody(buildIndexPage(multi));
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(
      [...document.querySelectorAll("a.pc-list__row")].map((a) => a.getAttribute("href"))
    ).toEqual(["/cards/hmw/", "/cards/sor/", "/cards/ibh/", "/cards/gg/", "/cards/zz/"]);
    document.body.innerHTML = "";
  });

  it("heads: title, description, canonical, breadcrumb JSON-LD, noindex only on dev", () => {
    const sor = buildSetPages(multi).find((s) => s.code === "SOR")!;
    const head = setHeadHtml(sor, { noindex: false });
    expect(head).toContain(
      "<title>Spark of Rebellion (SOR) card list · Prices and printings · HyperspaceVault</title>"
    );
    expect(head).toContain('<meta name="description" content="Every Star Wars: Unlimited card in');
    expect(head).toContain(
      '<link rel="canonical" href="https://www.hyperspacevault.com/cards/sor/" />'
    );
    expect(head).toContain('"@type":"BreadcrumbList"');
    expect(head).toContain('"item":"https://www.hyperspacevault.com/cards/sor/"');
    expect(head).not.toContain("noindex");
    expect(setHeadHtml(sor, { noindex: true })).toContain(
      '<meta name="robots" content="noindex" />'
    );

    const index = indexHeadHtml(buildIndexPage(multi), { noindex: false });
    expect(index).toContain(
      '<link rel="canonical" href="https://www.hyperspacevault.com/cards/" />'
    );
    expect(index).toContain(
      "<title>Star Wars: Unlimited card list · Every set · HyperspaceVault</title>"
    );
    expect(index).toContain('"@type":"BreadcrumbList"');
    expect(index).not.toContain("noindex");
    expect(indexHeadHtml(buildIndexPage(multi), { noindex: true })).toContain(
      '<meta name="robots" content="noindex" />'
    );
  });

  it("rendering the public pages calls the app's capture() zero times", () => {
    capture.mockClear();
    renderSetBody(buildSetPages(multi)[0]);
    renderIndexBody(buildIndexPage(multi));
    renderCardBody(buildPages(multi)[0]);
    expect(capture).not.toHaveBeenCalled();
  });
});

describe("public analytics", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("allows exactly the two events with exactly their properties", () => {
    expect(
      isAllowedPublicEvent("card_page_viewed", {
        set: "SOR",
        number: "005",
        referrer_kind: "search",
      })
    ).toBe(true);
    for (const action of [
      "create_account",
      "sign_in",
      "open_app",
      "open_card_in_app",
      "auto_open",
    ]) {
      expect(isAllowedPublicEvent("card_page_cta", { action })).toBe(true);
    }
    // Other names, including the app's own events, are rejected.
    for (const name of ["card_popup_opened", "screen_viewed", "$pageview", "$autocapture", "x"]) {
      expect(isAllowedPublicEvent(name, {})).toBe(false);
    }
    // Extra, missing or free-text properties are rejected.
    expect(isAllowedPublicEvent("card_page_cta", { action: "create_account", email: "a@b" })).toBe(
      false
    );
    expect(isAllowedPublicEvent("card_page_cta", { action: "anything" })).toBe(false);
    expect(isAllowedPublicEvent("card_page_cta", { action: "auto_open_x" })).toBe(false);
    expect(isAllowedPublicEvent("card_page_cta", { action: "auto_open", set: "SOR" })).toBe(false);
    expect(isAllowedPublicEvent("card_page_viewed", { set: "SOR", number: "005" })).toBe(false);
    expect(
      isAllowedPublicEvent("card_page_viewed", {
        set: "sor; drop",
        number: "5",
        referrer_kind: "none",
      })
    ).toBe(false);
    expect(isAllowedPublicEvent("toString", {})).toBe(false);
  });

  it("sends nothing for a name outside the allowlist, even when enabled", () => {
    const transport = vi.fn();
    const sent = publicCapture(
      "card_popup_opened" as "card_page_cta",
      { action: "open_app" },
      { enabled: true, transport }
    );
    expect(sent).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it("is off outside a production build on a production hostname", () => {
    expect(publicAnalyticsEnabled("www.hyperspacevault.com", true)).toBe(true);
    expect(publicAnalyticsEnabled("hyperspacevault.com", true)).toBe(true);
    expect(publicAnalyticsEnabled("swu-dev-jbapps.web.app", true)).toBe(false);
    expect(publicAnalyticsEnabled("localhost", true)).toBe(false);
    expect(publicAnalyticsEnabled("www.hyperspacevault.com", false)).toBe(false);
    // The test run itself is not production: the default gate is closed.
    const transport = vi.fn();
    expect(publicCapture("card_page_cta", { action: "open_app" }, { transport })).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it("posts one capture to the first-party relay, without a person profile", () => {
    const transport = vi.fn();
    expect(
      publicCapture(
        "card_page_viewed",
        { set: "SOR", number: "005", referrer_kind: "none" },
        { enabled: true, transport }
      )
    ).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, body] = transport.mock.calls[0] as [string, string];
    expect(url).toBe(`${window.location.origin}/api/relay/i/v0/e/`);
    const payload = JSON.parse(body);
    expect(payload.event).toBe("card_page_viewed");
    expect(payload.properties).toMatchObject({
      set: "SOR",
      number: "005",
      referrer_kind: "none",
      $process_person_profile: false,
    });
    expect(typeof payload.distinct_id).toBe("string");
  });

  it("keeps its own id under a page-only key and never writes posthog-js's storage", () => {
    const send = () => {
      const transport = vi.fn();
      publicCapture("card_page_cta", { action: "open_app" }, { enabled: true, transport });
      return JSON.parse((transport.mock.calls[0] as [string, string])[1]).distinct_id as string;
    };
    const first = send();
    expect(window.localStorage.getItem("hsv_public_id")).toBe(first);
    expect(send()).toBe(first);
    expect(Object.keys(window.localStorage).filter((k) => k.startsWith("ph_"))).toEqual([]);
    // A browser that already used the app sends under posthog-js's id.
    window.localStorage.setItem(
      "ph_phc_ydajqUnNvaUnixWs95mAoVwtw8G2DMXr7Sz4iUvSwGxW_posthog",
      JSON.stringify({ distinct_id: "app-id" })
    );
    expect(send()).toBe("app-id");
  });

  it("respects the app's analytics opt-out", () => {
    window.localStorage.setItem(
      "__ph_opt_in_out_phc_ydajqUnNvaUnixWs95mAoVwtw8G2DMXr7Sz4iUvSwGxW",
      "0"
    );
    const transport = vi.fn();
    expect(
      publicCapture("card_page_cta", { action: "sign_in" }, { enabled: true, transport })
    ).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it("classifies the referrer as an enum, never the URL", () => {
    const host = "www.hyperspacevault.com";
    expect(referrerKind("", host)).toBe("none");
    expect(referrerKind("https://www.google.com/search?q=luke", host)).toBe("search");
    expect(referrerKind("https://duckduckgo.com/", host)).toBe("search");
    expect(referrerKind("https://old.reddit.com/r/starwarsunlimited", host)).toBe("social");
    expect(referrerKind("https://hyperspacevault.com/cards/", host)).toBe("internal");
    expect(referrerKind("https://swudb.com/card/SOR/005", host)).toBe("other");
    expect(referrerKind("not a url", host)).toBe("other");
  });
});
