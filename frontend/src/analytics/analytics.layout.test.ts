// @vitest-environment-options {"url": "https://hyperspacevault.com/"}
// BL-244 / BL-247 S1-11: the `layout` super-property. Runs on the real prod
// hostname with PROD stubbed on so initAnalytics actually reaches register().
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({
  default: { init: vi.fn(), capture: vi.fn(), register: vi.fn() },
}));

import posthog from "posthog-js";
import { PHONE_QUERY, PHONE_TOUCH_QUERY } from "../mobile/useIsPhone";
import { resetMediaMatches, setMediaMatches } from "../test/setup";

describe("S1-11 layout super-property", () => {
  beforeEach(() => {
    vi.stubEnv("PROD", true);
    vi.resetModules();
    vi.mocked(posthog.register).mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetMediaMatches();
  });

  it("registers layout: phone when the media query matches, and follows changes", async () => {
    setMediaMatches(PHONE_QUERY, true);
    const { initAnalytics } = await import("./analytics");
    initAnalytics();
    expect(posthog.register).toHaveBeenCalledWith({ layout: "phone" });
    setMediaMatches(PHONE_QUERY, false);
    expect(posthog.register).toHaveBeenLastCalledWith({ layout: "desktop" });
  });

  // REPLACE (review FR5 S5, fix run 2026-10-12): the gate is no longer one
  // media-query string, so "the mirrored literal equals PHONE_QUERY" has
  // nothing to compare. Same intent -- analytics and the gate cannot drift --
  // proved the other way: `layout` follows `isPhoneLayout()` on the DEVICE arm,
  // which no width query can express (wide viewport, touch, short screen side),
  // and analytics.ts holds no query of its own.
  describe("FR5-06: analytics reads the phone gate's one function", () => {
    const realW = Object.getOwnPropertyDescriptor(window.screen, "width");
    const realH = Object.getOwnPropertyDescriptor(window.screen, "height");
    const setScreen = (w: number, h: number) => {
      Object.defineProperty(window.screen, "width", { configurable: true, get: () => w });
      Object.defineProperty(window.screen, "height", { configurable: true, get: () => h });
    };
    afterEach(() => {
      for (const [k, d] of [
        ["width", realW],
        ["height", realH],
      ] as const) {
        if (d) Object.defineProperty(window.screen, k, d);
        else delete (window.screen as unknown as Record<string, unknown>)[k];
      }
    });

    it("a phone on its side (874 wide viewport, touch, screen short side 402) is `phone`", async () => {
      const { isPhoneLayout } = await import("../mobile/useIsPhone");
      setScreen(874, 402);
      setMediaMatches(PHONE_TOUCH_QUERY, true);
      expect(isPhoneLayout()).toBe(true);
      const { initAnalytics } = await import("./analytics");
      initAnalytics();
      expect(posthog.register).toHaveBeenLastCalledWith({ layout: "phone" });
      // The device stops being touch-primary (a mouse is attached): the gate
      // flips, and `layout` with it.
      setMediaMatches(PHONE_TOUCH_QUERY, false);
      expect(isPhoneLayout()).toBe(false);
      expect(posthog.register).toHaveBeenLastCalledWith({ layout: "desktop" });
    });

    it("a tablet (touch, screen short side 768) is `desktop`, as the gate says", async () => {
      const { isPhoneLayout } = await import("../mobile/useIsPhone");
      setScreen(1024, 768);
      setMediaMatches(PHONE_TOUCH_QUERY, true);
      expect(isPhoneLayout()).toBe(false);
      const { initAnalytics } = await import("./analytics");
      initAnalytics();
      expect(posthog.register).toHaveBeenLastCalledWith({ layout: "desktop" });
    });

    it("analytics.ts holds no media query or screen rule of its own", () => {
      const src = readFileSync("src/analytics/analytics.ts", "utf8");
      expect(src).not.toMatch(
        /matchMedia|max-width|max-height|pointer: coarse|screen\.(width|height)/
      );
      expect(src).toMatch(/isPhoneLayout\(\)/);
    });
  });

  it("registers layout: desktop by default", async () => {
    const { initAnalytics } = await import("./analytics");
    initAnalytics();
    expect(posthog.register).toHaveBeenCalledWith({ layout: "desktop" });
  });
});
