import { describe, expect, it, vi } from "vitest";
import { CatalogFetchError, fetchBaseCardList, fetchCatalog } from "./fetchCatalog.mjs";

const catalog = (sha) => ({ build_sha: sha, sets: [], counts: {}, cards: [] });

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** A fake clock that advances only when sleep() is called. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: vi.fn(async (ms) => void (t += ms)) };
}

describe("fetchCatalog", () => {
  it("returns at once when the live revision already serves the SHA", async () => {
    const fetch = vi.fn(async () => json(catalog("abc")));
    const c = clock();
    const r = await fetchCatalog({
      backendUrl: "https://be.run.app/",
      expectSha: "abc",
      fetch,
      ...c,
    });
    expect(r.attempts).toBe(1);
    expect(r.catalog.build_sha).toBe("abc");
    expect(fetch).toHaveBeenCalledWith("https://be.run.app/api/public/cards", expect.anything());
    expect(c.sleep).not.toHaveBeenCalled();
  });

  it("retries every 10 s through the old revision, a 404 and a network error", async () => {
    const replies = [
      () => json(catalog("old")),
      () => json({ detail: "Not Found" }, 404),
      () => Promise.reject(new Error("ECONNRESET")),
      () => json(catalog("new")),
    ];
    const fetch = vi.fn(async () => replies.shift()());
    const c = clock();
    const log = vi.fn();
    const r = await fetchCatalog({ backendUrl: "https://be", expectSha: "new", fetch, log, ...c });
    expect(r.attempts).toBe(4);
    expect(r.waitedMs).toBe(30_000);
    expect(c.sleep).toHaveBeenCalledTimes(3);
    expect(c.sleep).toHaveBeenCalledWith(10_000);
    expect(log.mock.calls.map((a) => a[0]).join("\n")).toMatch(
      /build_sha old \(want new\)[\s\S]*HTTP 404[\s\S]*ECONNRESET/
    );
  });

  it("fails after 5 minutes when the SHA never appears", async () => {
    const fetch = vi.fn(async () => json(catalog("old")));
    const c = clock();
    await expect(
      fetchCatalog({ backendUrl: "https://be", expectSha: "new", fetch, ...c })
    ).rejects.toThrow(
      /no response with build_sha new after 31 attempts in 300 s; last: build_sha old/
    );
    expect(c.now()).toBeLessThanOrEqual(300_000);
  });

  it("treats a wrong-shaped body as not ready", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ build_sha: "x" }))
      .mockResolvedValueOnce(json(catalog("x")));
    const r = await fetchCatalog({ backendUrl: "https://be", expectSha: "x", fetch, ...clock() });
    expect(r.attempts).toBe(2);
  });

  it("requires a URL and a SHA", async () => {
    await expect(fetchCatalog({ backendUrl: "", expectSha: "a" })).rejects.toBeInstanceOf(
      CatalogFetchError
    );
    await expect(fetchCatalog({ backendUrl: "https://be", expectSha: "" })).rejects.toThrow(
      /expectSha/
    );
  });
});

describe("fetchBaseCardList", () => {
  it("reads the list endpoint from the Cloud Run URL", async () => {
    const fetch = vi.fn(async () => json([{ id: 1, is_token: false }]));
    const rows = await fetchBaseCardList({
      backendUrl: "https://be/",
      fetch,
      sleep: async () => {},
    });
    expect(rows).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith("https://be/api/base-cards", expect.anything());
  });

  it("retries, then fails with the last status", async () => {
    const fetch = vi.fn(async () => json({}, 503));
    await expect(
      fetchBaseCardList({ backendUrl: "https://be", fetch, sleep: async () => {} })
    ).rejects.toThrow(/HTTP 503/);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
