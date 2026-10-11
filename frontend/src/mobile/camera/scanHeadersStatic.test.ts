/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// BL-253 S7-22: a static assertion over firebase.json -- the isolation headers
// exist for /scan/** and for nothing else. A site-wide COOP / COEP would
// sever window.opener and block the Google sign-in popup on the main document
// (plan A11), so no rule that could match `/` may carry either.

interface Rule {
  source: string;
  headers: { key: string; value: string }[];
}
const rules = (
  JSON.parse(readFileSync("firebase.json", "utf8")) as { hosting: { headers: Rule[] } }
).hosting.headers;
const keys = (r: Rule) => r.headers.map((h) => h.key.toLowerCase());
const isolating = (r: Rule) =>
  keys(r).includes("cross-origin-opener-policy") ||
  keys(r).includes("cross-origin-embedder-policy");

describe("S7-22 firebase.json isolation scope", () => {
  it("the /scan/** rule exists with COOP + COEP + the camera-only Permissions-Policy", () => {
    const rule = rules.find((r) => r.source === "/scan/**");
    expect(rule).toBeDefined();
    const h = Object.fromEntries(rule!.headers.map((x) => [x.key, x.value]));
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(h["Cross-Origin-Embedder-Policy"]).toBe("require-corp");
    expect(h["Permissions-Policy"]).toContain("camera=(self)");
  });

  it("no site-wide rule carries COOP / COEP / Permissions-Policy", () => {
    const sitewide = (s: string) => ["**", "/**", "/", "/index.html", "/shared/**"].includes(s);
    for (const r of rules.filter((x) => sitewide(x.source))) {
      expect(keys(r), r.source).not.toContain("cross-origin-opener-policy");
      expect(keys(r), r.source).not.toContain("cross-origin-embedder-policy");
      expect(keys(r), r.source).not.toContain("permissions-policy");
    }
  });

  it("only the scanner's own paths carry isolation headers", () => {
    const sources = rules.filter(isolating).map((r) => r.source);
    expect(sources.sort()).toEqual(
      ["/scan", "/scan-workers/**", "/scan.html", "/scan/**", "/vendor/scan/**"].sort()
    );
  });
});
