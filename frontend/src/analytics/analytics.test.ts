// BL-235: the analytics seam's gating contract. In vitest, import.meta.env
// .PROD is false and the jsdom hostname is localhost -- BOTH gates are shut,
// which is exactly the property these tests pin: outside the production
// hostnames the entire subsystem is inert (no init, no captures, no posthog
// calls), so no component needs an environment guard around capture().
import { describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
    register: vi.fn(),
    has_opted_out_capturing: vi.fn(() => false),
    opt_out_capturing: vi.fn(),
    opt_in_capturing: vi.fn(),
  },
}));

import posthog from "posthog-js";
import {
  analyticsActive,
  capture,
  hasOptedOut,
  initAnalytics,
  setOptedOut,
} from "./analytics";

describe("analytics gating (non-production environment)", () => {
  it("initAnalytics is a no-op outside prod builds", () => {
    initAnalytics();
    expect(analyticsActive()).toBe(false);
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it("capture never reaches posthog while uninitialized", () => {
    capture("screen_viewed", { screen: "vault" });
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("opt-out surface is inert while uninitialized", () => {
    expect(hasOptedOut()).toBe(false);
    setOptedOut(true);
    expect(posthog.opt_out_capturing).not.toHaveBeenCalled();
    expect(posthog.has_opted_out_capturing).not.toHaveBeenCalled();
  });
});
