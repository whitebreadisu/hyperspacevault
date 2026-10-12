/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isolationReport, ortThreads } from "./isolationReport";
import { ENTRY_INPUTS } from "./scanEntries";
import { headersFor, scanRewrite } from "./scanHeaders";

// BL-253 S7-01 / S7-02 / S7-03: the scanner document's build + hosting +
// isolation contract.

interface Rule {
  source: string;
  headers: { key: string; value: string }[];
}
const firebase = JSON.parse(readFileSync("firebase.json", "utf8")) as {
  hosting: {
    headers: Rule[];
    rewrites: { source: string; destination?: string }[];
    redirects?: { source: string; destination: string }[];
  };
};
const ruleHeaders = (source: string): Record<string, string> => {
  const rule = firebase.hosting.headers.find((r) => r.source === source);
  if (!rule) throw new Error("no firebase.json headers rule for " + source);
  return Object.fromEntries(rule.headers.map((h) => [h.key, h.value]));
};

describe("S7-01 second Vite entry", () => {
  it("builds two inputs: the app and scan.html", () => {
    expect(ENTRY_INPUTS).toEqual({ main: "index.html", scan: "scan.html" });
    expect(readFileSync("vite.config.ts", "utf8")).toContain("input: ENTRY_INPUTS");
    expect(existsSync("index.html")).toBe(true);
    expect(existsSync("scan.html")).toBe(true);
  });

  it("scan.html boots src/scan.tsx; the main entry does not import the camera", () => {
    expect(readFileSync("scan.html", "utf8")).toContain('src="/src/scan.tsx"');
    expect(readFileSync("src/main.tsx", "utf8")).not.toMatch(/camera/);
    expect(readFileSync("src/scan.tsx", "utf8")).toMatch(/mobile\/camera\/scanBoot/);
  });

  it("/scan and /scan/ are served scan.html in dev, as Firebase does in prod", () => {
    expect(scanRewrite("/scan")).toBe("/scan.html");
    expect(scanRewrite("/scan/")).toBe("/scan.html");
    expect(scanRewrite("/")).toBeNull();
    expect(scanRewrite("/scanner")).toBeNull();
    // Both paths are REWRITES. There must be no `/scan` -> `/scan/` redirect:
    // Hosting matches a redirect glob against the trailing-slash-normalised
    // path, so that 301 also fired on `/scan/` and redirected it to itself
    // (Safari "too many redirects", owner review round 2026-10-11).
    const rewriteFor = (source: string) =>
      firebase.hosting.rewrites.find((r) => r.source === source)?.destination;
    expect(rewriteFor("/scan")).toBe("/scan.html");
    expect(rewriteFor("/scan/**")).toBe("/scan.html");
    const scanRedirects = (firebase.hosting.redirects ?? []).filter((r) =>
      r.source.startsWith("/scan")
    );
    expect(scanRedirects).toEqual([]);
  });
});

describe("S7-02 scoped isolation headers", () => {
  it("headersFor('/scan/') equals firebase.json's /scan/** block", () => {
    expect(headersFor("/scan/")).toEqual(ruleHeaders("/scan/**"));
    expect(headersFor("/scan")).toEqual(ruleHeaders("/scan/**"));
    // Hosting's `/scan/**` header glob does not cover the slash-less form, so
    // bare `/scan` carries its own identical block (preview-channel proof
    // 2026-10-11: without it `/scan` served scan.html un-isolated).
    expect(headersFor("/scan")).toEqual(ruleHeaders("/scan"));
    expect(headersFor("/scan.html")).toEqual(ruleHeaders("/scan.html"));
  });

  it("the document rule is COOP + COEP + camera-only Permissions-Policy", () => {
    expect(ruleHeaders("/scan/**")).toEqual({
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
      "Cache-Control": "no-cache",
    });
  });

  it("the payload and the worker script match their firebase.json rules", () => {
    expect(headersFor("/vendor/scan/paddle/ort/ort-wasm-simd-threaded.wasm")).toEqual(
      ruleHeaders("/vendor/scan/**")
    );
    expect(ruleHeaders("/vendor/scan/**")["Cache-Control"]).toBe(
      "public, max-age=31536000, immutable"
    );
    expect(ruleHeaders("/vendor/scan/**")["Cross-Origin-Resource-Policy"]).toBe("same-origin");
    expect(headersFor("/scan-workers/paddleWorker-abc.js")).toEqual(
      ruleHeaders("/scan-workers/**")
    );
    expect(headersFor("/src/mobile/camera/paddleWorker.ts")).toEqual(
      ruleHeaders("/scan-workers/**")
    );
  });

  it("the main document and every ordinary asset carry nothing", () => {
    for (const p of [
      "/",
      "/index.html",
      "/assets/index-abc.js",
      "/images/set_sor.png",
      "/shared/x",
    ])
      expect(headersFor(p), p).toBeNull();
    // no site-wide rule can have given them anything
    for (const r of firebase.hosting.headers) {
      expect(["**", "/**", "/", "/index.html"]).not.toContain(r.source);
      if (/^\/(shared)\//.test(r.source)) continue;
      const keys = r.headers.map((h) => h.key);
      if (keys.includes("Cross-Origin-Opener-Policy")) expect(r.source).toMatch(/^\/scan/);
    }
  });
});

describe("S7-03 isolationReport()", () => {
  it("has the report shape and the ort thread rule min(4, cores) when isolated", () => {
    expect(
      isolationReport({
        crossOriginIsolated: true,
        hasSharedArrayBuffer: true,
        hardwareConcurrency: 12,
        simd: true,
      })
    ).toEqual({
      crossOriginIsolated: true,
      sharedArrayBuffer: true,
      hardwareConcurrency: 12,
      threads: 4,
      simd: true,
    });
    expect(ortThreads(true, 2)).toBe(2);
    expect(ortThreads(true, 6)).toBe(4);
    expect(ortThreads(true, null)).toBe(1);
  });

  it("is single-threaded when not isolated, whatever the core count", () => {
    const r = isolationReport({
      crossOriginIsolated: false,
      hasSharedArrayBuffer: false,
      hardwareConcurrency: 8,
      simd: true,
    });
    expect(r.threads).toBe(1);
    expect(r.crossOriginIsolated).toBe(false);
  });

  it("reads this realm when nothing is injected", () => {
    const r = isolationReport();
    expect(Object.keys(r).sort()).toEqual([
      "crossOriginIsolated",
      "hardwareConcurrency",
      "sharedArrayBuffer",
      "simd",
      "threads",
    ]);
    expect(typeof r.crossOriginIsolated).toBe("boolean");
  });
});
