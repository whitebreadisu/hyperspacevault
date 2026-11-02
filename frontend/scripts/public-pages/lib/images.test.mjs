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
  withAvailableArt,
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

  it("falls back to the origin probe with a warning when the listing is refused (auto)", async () => {
    const fetch = vi.fn(async (url) =>
      url.startsWith("https://storage.googleapis.com")
        ? { ok: false, status: 403 }
        : { status: 200, body: null }
    );
    const r = await imageAvailability({
      stems: ["a"],
      bucket: "bk",
      token: "t",
      origin: "https://x",
      fetch,
    });
    expect(r.source).toBe("GET probe through https://x");
    expect(r.missing).toEqual([]);
    expect(r.warnings[0]).toMatch(/bucket listing failed \(list gs:\/\/bk: HTTP 403\)/);
  });

  it("fails instead of probing in bucket mode (prod)", async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 403 }));
    await expect(
      imageAvailability({
        stems: ["a"],
        bucket: "bk",
        token: "t",
        origin: "https://x",
        mode: "bucket",
        fetch,
      })
    ).rejects.toThrow(
      /bucket listing failed \(list gs:\/\/bk: HTTP 403\); this deploy requires it/
    );
    await expect(
      imageAvailability({ stems: ["a"], mode: "bucket", origin: "https://x" })
    ).rejects.toThrow(/no bucket name or no access token/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("allows 0.5% probe errors and no more", async () => {
    const stems = Array.from({ length: 400 }, (_, i) => `s${i}`);
    const failing = (n) => async (url) => {
      const i = Number(url.match(/s(\d+)_320/)[1]);
      return { status: i < n ? 503 : 200, body: null };
    };
    const ok = await imageAvailability({
      stems,
      origin: "https://x",
      mode: "probe",
      fetch: failing(2),
    });
    expect(ok.missing).toEqual(["s0", "s1"]);
    await expect(
      imageAvailability({ stems, origin: "https://x", mode: "probe", fetch: failing(3) })
    ).rejects.toThrow(/3 errors/);
  });

  it("probes without a bucket (with a warning), and skips entirely when off", async () => {
    const r = await imageAvailability({
      stems: ["a"],
      origin: "https://x",
      fetch: async () => ({ status: 307, body: null }),
    });
    expect(r.missing).toEqual(["a"]);
    expect(r.warnings[0]).toMatch(/no bucket name or no access token/);
    const off = await imageAvailability({ stems: ["a"], mode: "off" });
    expect(off.missing).toEqual([]);
    expect(off.warnings).toEqual([]);
    await expect(imageAvailability({ stems: ["a"] })).rejects.toThrow(/no origin/);
    await expect(imageAvailability({ stems: ["a"], mode: "nope" })).rejects.toThrow(/unknown mode/);
  });

  it("passes a timeout signal on every read", async () => {
    const fetch = vi.fn(async () => ({ status: 200, body: null }));
    await probeStems({ origin: "https://x", stems: ["a"], fetch });
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe("withAvailableArt", () => {
  it("drops missing renditions so the page renders the placeholder", () => {
    const present = new Set(["card_fx91001_front"]);
    const out = withAvailableArt(fixture, present);
    const luke = out.cards.find((c) => c.id === 9001);
    const [std, hyp] = luke.variants;
    expect(std.front_images.w320).toBe("/images/cards/card_fx91001_front_320.webp");
    expect(std.front_image_url).toMatch(/card_fx91001_front\.png$/);
    expect(std.back_images).toBeNull();
    expect(std.back_image_url).toBeNull();
    expect(hyp.front_images).toBeNull();
    expect(hyp.front_image_url).toBeNull();
    // The input is untouched.
    expect(fixture.cards[0].variants[1].front_images).not.toBeNull();
  });
});
