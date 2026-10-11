// @vitest-environment-options {"url": "https://hyperspacevault.com/"}
// BL-244 / BL-247 S1-11: the `layout` super-property. Runs on the real prod
// hostname with PROD stubbed on so initAnalytics actually reaches register().
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({
  default: { init: vi.fn(), capture: vi.fn(), register: vi.fn() },
}));

import posthog from "posthog-js";
import { PHONE_QUERY } from "../mobile/useIsPhone";
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

  it("registers layout: desktop by default", async () => {
    const { initAnalytics } = await import("./analytics");
    initAnalytics();
    expect(posthog.register).toHaveBeenCalledWith({ layout: "desktop" });
  });
});
