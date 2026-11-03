import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// robots.txt keeps the app's `/?card=` links out of the crawl; the card
// pages themselves stay crawlable (App Spec §5.3).

const robots = readFileSync(resolve(__dirname, "../../public/robots.txt"), "utf8");
const lines = robots.split(/\r?\n/).map((l) => l.trim());

describe("robots.txt", () => {
  it("disallows the app's card links and nothing under /cards/", () => {
    expect(lines).toContain("Disallow: /*?card=");
    expect(lines).toContain("Disallow: /api/");
    expect(lines.filter((l) => /^Disallow:\s*\/cards/.test(l))).toEqual([]);
    expect(lines).toContain("Sitemap: https://www.hyperspacevault.com/sitemap.xml");
  });
});
