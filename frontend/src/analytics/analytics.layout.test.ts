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

  // BL-257 FR5-06: the mirrored literal IS the gate's query (a phone held on
  // its side reports `phone`), and it is the string the brief names.
  it("FR5-06: analytics uses the same media query as the phone gate", async () => {
    const { PHONE_MEDIA_QUERY } = await import("./analytics");
    expect(PHONE_MEDIA_QUERY).toBe(PHONE_QUERY);
    expect(PHONE_QUERY).toBe(
      "(max-width: 767px), ((max-height: 500px) and (hover: none) and (pointer: coarse))"
    );
  });

  it("registers layout: desktop by default", async () => {
    const { initAnalytics } = await import("./analytics");
    initAnalytics();
    expect(posthog.register).toHaveBeenCalledWith({ layout: "desktop" });
  });
});
