import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  catalogStems,
  imageAvailability,
  listBucketStems,
  probeStems,
  stemFromPath,
} from "./images.mjs";

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/catalog.json"), "utf8")
);

describe("stems", () => {
  it("reads a 320 px stem and rejects anything else", () => {
    expect(stemFromPath("/images/cards/card_fx1_front_320.webp")).toBe("card_fx1_front");
    expect(stemFromPath("/images/cards/card_fx1_front_640.webp")).toBeNull();
    expect(stemFromPath("/images/cards/../x_320.webp")).toBeNull();
    expect(stemFromPath(undefined)).toBeNull();
  });

  it("collects front and back stems of non-token printings", () => {
    const stems = catalogStems(fixture);
    expect(stems.has("card_fx91001_front")).toBe(true);
    expect(stems.has("card_fx91001_back")).toBe(true);
    expect(stems.has("card_fx91099_front")).toBe(false); // token
  });
});

describe("bucket listing", () => {
  it("pages through cards/*_320.webp with a bearer token", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ name: "cards/a_320.webp" }, { name: "cards/b_320.webp" }],
          nextPageToken: "p2",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ name: "cards/c_320.webp" }] }),
      });
    const stems = await listBucketStems({
      bucket: "swu-dev-jbapps-card-images",
      token: "tok",
      fetch,
    });
    expect([...stems]).toEqual(["a", "b", "c"]);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(
      /^https:\/\/storage\.googleapis\.com\/storage\/v1\/b\/swu-dev-jbapps-card-images\/o\?/
    );
    expect(new URL(url).searchParams.get("matchGlob")).toBe("cards/*_320.webp");
    expect(init.headers.authorization).toBe("Bearer tok");
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get("pageToken")).toBe("p2");
  });

  it("fails on a 403", async () => {
    await expect(
      listBucketStems({ bucket: "b", token: "t", fetch: async () => ({ ok: false, status: 403 }) })
    ).rejects.toThrow(/HTTP 403/);
  });
});

function origin(statuses) {
  return vi.fn(async (url, init) => {
    expect(init).toMatchObject({ method: "GET", redirect: "manual" });
    const stem = url.match(/cards\/(.+)_320\.webp$/)[1];
    const s = statuses[stem];
    if (s instanceof Error) throw s;
    const next = Array.isArray(s) ? s.shift() : s;
    return { status: next, body: { cancel: vi.fn(async () => {}) } };
  });
}

describe("origin probe (fallback)", () => {
  it("200 = present; the backend's 307 or a 404 = missing", async () => {
    const present = await probeStems({
      origin: "https://x/",
      stems: ["a", "b", "c"],
      fetch: origin({ a: 200, b: 307, c: 404 }),
    });
    expect([...present]).toEqual(["a"]);
  });

  it("retries a 5xx once and fails on persistent errors", async () => {
    expect([
      ...(await probeStems({
        origin: "https://x",
        stems: ["a"],
        fetch: origin({ a: [503, 200] }),
      })),
    ]).toEqual(["a"]);
    await expect(
      probeStems({
        origin: "https://x",
        stems: ["a"],
        fetch: origin({ a: new Error("ETIMEDOUT") }),
      })
    ).rejects.toThrow(/1 errors \(first: a: ETIMEDOUT\)/);
  });

  it("keeps to the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetch = async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return { status: 200, body: null };
    };
    await probeStems({
      origin: "https://x",
      stems: Array.from({ length: 20 }, (_, i) => `s${i}`),
      fetch,
      concurrency: 3,
    });
    expect(peak).toBe(3);
  });
});

describe("imageAvailability", () => {
  it("uses the bucket when it can, reporting what is missing", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [{ name: "cards/a_320.webp" }] }),
    }));
    const r = await imageAvailability({
      stems: new Set(["a", "b"]),
      bucket: "bk",
      token: "t",
      origin: "https://x",
      fetch,
    });
    expect(r.source).toBe("bucket gs://bk");
    expect(r.missing).toEqual(["b"]);
    expect(r.line).toBe(
      "image check (bucket gs://bk): 1 of 2 320 px images present, 1 render the placeholder"
    );
  });

  it("falls back to the origin probe when the listing is refused", async () => {
    const fetch = vi.fn(async (url) =>
      url.startsWith("https://storage.googleapis.com")
        ? { ok: false, status: 403 }
        : { status: 200, body: null }
    );
    const log = vi.fn();
    const r = await imageAvailability({
      stems: ["a"],
      bucket: "bk",
      token: "t",
      origin: "https://x",
      fetch,
      log,
    });
    expect(r.source).toBe("GET probe through https://x");
    expect(r.missing).toEqual([]);
    expect(log.mock.calls[0][0]).toMatch(/bucket listing failed \(list gs:\/\/bk: HTTP 403\)/);
  });

  it("probes directly without a bucket, and skips entirely when off", async () => {
    const r = await imageAvailability({
      stems: ["a"],
      origin: "https://x",
      fetch: async () => ({ status: 307, body: null }),
    });
    expect(r.missing).toEqual(["a"]);
    const off = await imageAvailability({ stems: ["a"], mode: "off" });
    expect(off.missing).toEqual([]);
    await expect(imageAvailability({ stems: ["a"] })).rejects.toThrow(/no origin/);
  });
});
