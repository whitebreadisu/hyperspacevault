import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The head of `/` (index.html, the app shell) is its search-facing
// surface (App Spec §5.3): a keyword title, a fuller description that og:*
// and twitter:* repeat, and one WebApplication JSON-LD block that describes
// the app truthfully, with no rating.

const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const meta = (attr: "name" | "property", key: string) =>
  [...doc.head.querySelectorAll(`meta[${attr}="${key}"]`)].map((m) => m.getAttribute("content"));

const TITLE = "HyperspaceVault - Star Wars: Unlimited collection tracker & card prices";

describe("index.html head (/)", () => {
  it("has the keyword title, one description, and og / twitter saying the same", () => {
    expect(doc.title).toBe(TITLE);
    const [desc, ...more] = meta("name", "description");
    expect(more).toEqual([]);
    expect(desc).toMatch(/^HyperspaceVault is a free, unofficial Star Wars: Unlimited collection/);
    expect(meta("property", "og:title")).toEqual([TITLE]);
    expect(meta("name", "twitter:title")).toEqual([TITLE]);
    expect(meta("property", "og:description")).toEqual([desc]);
    expect(meta("name", "twitter:description")).toEqual([desc]);
    expect(meta("property", "og:url")).toEqual(["https://www.hyperspacevault.com/"]);
  });

  it("carries one WebApplication JSON-LD block: free, web, no rating", () => {
    const blocks = [...doc.querySelectorAll('script[type="application/ld+json"]')];
    expect(blocks).toHaveLength(1);
    const ld = JSON.parse(blocks[0].textContent ?? "");
    expect(ld).toMatchObject({
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "HyperspaceVault",
      url: "https://www.hyperspacevault.com/",
      operatingSystem: "Web",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    });
    expect(typeof ld.applicationCategory).toBe("string");
    expect(ld.description).toEqual(expect.any(String));
    expect(ld.featureList).toEqual(expect.arrayContaining([expect.stringMatching(/camera/i)]));
    // No fabricated reviews or ratings (Google's structured-data policy).
    expect(JSON.stringify(ld)).not.toMatch(/"(aggregateRating|reviewRating|review|rating)"/i);
  });
});
