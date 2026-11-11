import { describe, expect, it } from "vitest";
import {
  FOCUS_THROTTLE_MS,
  chunkFailureAction,
  chunkReloadKey,
  fetchBuildInfo,
  isChunkLoadError,
  isDifferentBuild,
  parseBuildFile,
  shouldCheck,
} from "./buildCheck";
import type { GuardStorage } from "./buildCheck";

// App Spec §20: compare, throttle and chunk-reload guard.

function memoryStorage(): GuardStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("parseBuildFile", () => {
  it("reads build and version", () => {
    expect(parseBuildFile({ build: "abc", version: "2.5.0" })).toEqual({
      build: "abc",
      version: "2.5.0",
    });
  });
  it.each([
    null,
    undefined,
    "abc",
    42,
    [],
    {},
    { build: "" },
    { build: " " },
    { build: 7 },
    // Both fields are required: a body outside { build, version } is not one.
    { build: "abc" },
    { build: "abc", version: 2 },
    { version: "2.5.0" },
  ])("rejects %j", (body) => {
    expect(parseBuildFile(body)).toBeNull();
  });
});

describe("isDifferentBuild", () => {
  it("is true only for a published build that differs", () => {
    expect(isDifferentBuild("aaa", { build: "bbb", version: "" })).toBe(true);
    expect(isDifferentBuild("aaa", { build: "aaa", version: "" })).toBe(false);
    expect(isDifferentBuild("aaa", null)).toBe(false);
  });
});

describe("shouldCheck", () => {
  it("lets the first focus check at once", () => {
    expect(shouldCheck("focus", 1000, null)).toBe(true);
  });
  it("throttles focus checks to one per FOCUS_THROTTLE_MS", () => {
    expect(shouldCheck("focus", 1000 + FOCUS_THROTTLE_MS - 1, 1000)).toBe(false);
    expect(shouldCheck("focus", 1000 + FOCUS_THROTTLE_MS, 1000)).toBe(true);
  });
  it("never throttles the interval", () => {
    expect(shouldCheck("interval", 1001, 1000)).toBe(true);
  });
});

describe("fetchBuildInfo", () => {
  const res = (body: unknown, ok = true) =>
    Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

  it("fetches past the cache", async () => {
    let init: RequestInit | undefined;
    const f = ((_u: string, i?: RequestInit) => (
      (init = i),
      res({ build: "x", version: "2.5.0" })
    )) as typeof fetch;
    expect(await fetchBuildInfo(f)).toEqual({ build: "x", version: "2.5.0" });
    expect(init?.cache).toBe("no-store");
  });
  it("is null on a failed status, a network error or a non-JSON body", async () => {
    expect(await fetchBuildInfo((() => res({ build: "x" }, false)) as typeof fetch)).toBeNull();
    expect(await fetchBuildInfo((() => Promise.reject(new TypeError("x"))) as typeof fetch)).toBe(
      null
    );
    const html = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.reject(new SyntaxError("Unexpected token <")),
      } as Response)) as typeof fetch;
    expect(await fetchBuildInfo(html)).toBeNull();
  });
});

describe("chunkFailureAction", () => {
  it("reloads once per build, then shows the banner", () => {
    const s = memoryStorage();
    expect(chunkFailureAction(s, "b1")).toBe("reload");
    expect(s.data.get(chunkReloadKey("b1"))).toBe("1");
    expect(chunkFailureAction(s, "b1")).toBe("banner");
    expect(chunkFailureAction(s, "b1")).toBe("banner");
    // A different build has its own guard.
    expect(chunkFailureAction(s, "b2")).toBe("reload");
  });
  it("never reloads without working storage", () => {
    expect(chunkFailureAction(null, "b1")).toBe("banner");
    const throwing: GuardStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    };
    expect(chunkFailureAction(throwing, "b1")).toBe("banner");
    // A write that does not stick (storage full) cannot guard a reload.
    const deaf: GuardStorage = { getItem: () => null, setItem: () => {} };
    expect(chunkFailureAction(deaf, "b1")).toBe("banner");
  });
});

describe("isChunkLoadError", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://x/assets/a-1.js",
    "Importing a module script failed.",
    "error loading dynamically imported module: https://x/a.js",
    "Unable to preload CSS for /assets/a.css",
  ])("recognises %s", (m) => {
    expect(isChunkLoadError(new TypeError(m))).toBe(true);
  });
  it("ignores other errors", () => {
    expect(isChunkLoadError(new Error("Network request failed"))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});
