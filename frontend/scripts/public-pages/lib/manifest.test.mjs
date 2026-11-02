import { describe, expect, it, vi } from "vitest";
import {
  buildManifest,
  contentHash,
  fetchLiveManifest,
  manifestSummary,
  normalizeForHash,
  utcDate,
} from "./manifest.mjs";

const page = (assetHash, sha, price = "$3.99") => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="build-sha" content="${sha}" />
    <title>Luke Skywalker</title>
    <script type="module" crossorigin src="/assets/card-${assetHash}.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/client-${assetHash}.js">
    <link rel="stylesheet" crossorigin href="/assets/card-${assetHash}.css">
  </head>
  <body><h1>Luke Skywalker</h1><img src="/assets/SWH_Aspects_Vigilance-${assetHash.slice(0, 8).padEnd(8, "x")}.png"/><span>${price}</span></body>
</html>`;

describe("content hash (§3 guard 3)", () => {
  it("ignores Vite asset hashes and the build sha", () => {
    expect(contentHash(page("Ab12Cd34", "1111111"))).toBe(contentHash(page("Zz98Yy76", "2222222")));
    const norm = normalizeForHash(page("Ab12Cd34", "1111111"));
    expect(norm).not.toMatch(/<script[^>]*assets|<link|build-sha/);
    expect(norm).toContain('<img src="/assets/SWH_Aspects_Vigilance.png"/>');
    expect(norm).toContain("<h1>Luke Skywalker</h1>");
  });

  it("moves when the content moves (a price is content)", () => {
    expect(contentHash(page("a", "s", "$3.99"))).not.toBe(contentHash(page("a", "s", "$4.10")));
  });

  it("accepts extra volatile patterns", () => {
    const a = contentHash("<p>x</p><i>t1</i>", [/<i>[^<]*<\/i>/g]);
    expect(a).toBe(contentHash("<p>x</p><i>t2</i>", [/<i>[^<]*<\/i>/g]));
    expect(a).toMatch(/^sha256:[0-9a-f]{32}$/);
  });
});

describe("lastmod from the live manifest", () => {
  const today = utcDate(Date.UTC(2026, 10, 2, 21, 0));

  it("sets no lastmod when there is no live manifest", () => {
    const r = buildManifest({ live: null, hashes: { "/cards/sor/005/": "h1" }, today });
    expect(r.lastmodOf("/cards/sor/005/")).toBeNull();
    expect(r.manifest).toEqual({
      version: 1,
      pages: { "/cards/sor/005/": { hash: "h1", lastmod: null } },
    });
    expect(manifestSummary(r.stats)).toMatch(/no live manifest/);
  });

  it("dates changed and new pages today and carries unchanged pages' dates forward", () => {
    const live = {
      version: 1,
      pages: {
        "/cards/sor/005/": { hash: "same", lastmod: "2026-10-20" },
        "/cards/sor/010/": { hash: "old", lastmod: null },
        "/cards/sor/025/": "same-bare", // a bare-hash entry is tolerated
        "/cards/sor/099/": { hash: "gone" },
      },
    };
    const r = buildManifest({
      live,
      hashes: {
        "/cards/sor/005/": "same",
        "/cards/sor/010/": "new",
        "/cards/sor/025/": "same-bare",
        "/cards/sor/200/": "x",
      },
      today,
    });
    expect(today).toBe("2026-11-02");
    expect(r.lastmodOf("/cards/sor/005/")).toBe("2026-10-20");
    expect(r.lastmodOf("/cards/sor/010/")).toBe("2026-11-02");
    expect(r.lastmodOf("/cards/sor/025/")).toBeNull();
    expect(r.lastmodOf("/cards/sor/200/")).toBe("2026-11-02");
    expect(r.lastmodOf("/cards/sor/099/")).toBeNull();
    expect(r.stats).toEqual({ changed: 1, added: 1, unchanged: 2, firstDeploy: false });
    expect(manifestSummary(r.stats)).toBe(
      "lastmod: 1 changed, 1 new, 2 unchanged vs the live manifest"
    );
  });

  it("a redeploy of identical content keeps every date", () => {
    const first = buildManifest({
      live: { pages: {} },
      hashes: { "/a/": "h" },
      today: "2026-11-01",
    }).manifest;
    const second = buildManifest({
      live: first,
      hashes: { "/a/": "h" },
      today: "2026-11-09",
    }).manifest;
    expect(second).toEqual(first);
  });
});

describe("fetchLiveManifest", () => {
  const res = (status, body) => ({
    ok: status < 300,
    status,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
  });

  it("returns the manifest, or null with a reason when absent or malformed", async () => {
    const ok = await fetchLiveManifest({
      origin: "https://x/",
      fetch: vi.fn(async () => res(200, { pages: { "/a/": "h" } })),
    });
    expect(ok.reason).toBe("live manifest with 1 pages");
    expect(
      (await fetchLiveManifest({ origin: "https://x", fetch: async () => res(404) })).manifest
    ).toBeNull();
    expect(
      (await fetchLiveManifest({ origin: "https://x", fetch: async () => res(200, "<html>") }))
        .reason
    ).toMatch(/not JSON/);
    expect(
      (await fetchLiveManifest({ origin: "https://x", fetch: async () => res(200, { a: 1 }) }))
        .reason
    ).toMatch(/no pages/);
  });

  it("throws on a server error", async () => {
    await expect(
      fetchLiveManifest({ origin: "https://x", fetch: async () => res(502) })
    ).rejects.toThrow(/HTTP 502/);
  });
});
