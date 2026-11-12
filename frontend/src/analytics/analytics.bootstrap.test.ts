// @vitest-environment-options {"url": "https://www.hyperspacevault.com/"}
// The public pages' anonymous id (App Spec §22): the app's posthog init
// starts from it ONLY when it exists and posthog-js has no stored identity
// yet; otherwise the init options are exactly the usual ones. Runs on the
// real prod hostname with PROD stubbed on so initAnalytics reaches init().
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({
  default: { init: vi.fn(), capture: vi.fn(), register: vi.fn(), register_once: vi.fn() },
}));

import posthog from "posthog-js";
import { POSTHOG_STORE_KEY, PUBLIC_ID_KEY, publicBootstrap } from "./posthogConfig";

async function initOptions(): Promise<Record<string, unknown>> {
  const { initAnalytics } = await import("./analytics");
  initAnalytics();
  expect(posthog.init).toHaveBeenCalledTimes(1);
  return vi.mocked(posthog.init).mock.calls[0][1] as Record<string, unknown>;
}

// PORT (BL-209 slice c): before_send joined the usual options (the share-token
// redaction, redactShare.ts); the bootstrap rule is unchanged.
// PORT (r2, r3): advanced_disable_feature_flags (no /flags request) and
// capture_heatmaps: false joined them.
const USUAL_KEYS = [
  "advanced_disable_feature_flags",
  "api_host",
  "before_send",
  "capture_heatmaps",
  "autocapture",
  "capture_pageleave",
  "capture_pageview",
  "person_profiles",
  "persistence",
  "session_recording",
  "ui_host",
];

describe("posthog bootstrap from the public pages' id", () => {
  beforeEach(() => {
    vi.stubEnv("PROD", true);
    vi.resetModules();
    vi.mocked(posthog.init).mockClear();
    vi.mocked(posthog.register_once).mockClear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    window.localStorage.clear();
  });

  it("no public id: the init options are the usual ones, no bootstrap", async () => {
    const opts = await initOptions();
    expect(Object.keys(opts).sort()).toEqual([...USUAL_KEYS].sort());
    expect(opts).not.toHaveProperty("bootstrap");
  });

  it("a public id and no posthog identity yet: starts from the public id", async () => {
    window.localStorage.setItem(PUBLIC_ID_KEY, "page-id-1");
    const opts = await initOptions();
    expect(opts.bootstrap).toEqual({ distinctID: "page-id-1" });
    expect(Object.keys(opts).sort()).toEqual([...USUAL_KEYS, "bootstrap"].sort());
  });

  it("a public id but posthog already has an identity: usual options", async () => {
    window.localStorage.setItem(PUBLIC_ID_KEY, "page-id-1");
    window.localStorage.setItem(POSTHOG_STORE_KEY, JSON.stringify({ distinct_id: "ph-id" }));
    const opts = await initOptions();
    expect(opts).not.toHaveProperty("bootstrap");
  });

  it("publicBootstrap tolerates unreadable storage", () => {
    expect(publicBootstrap(null)).toBeNull();
    const broken = { getItem: () => "{not json" } as Pick<Storage, "getItem">;
    expect(publicBootstrap(broken)).toBeNull();
  });

  it("the init's before_send strips a share token from an event (vault and stash links)", async () => {
    const opts = await initOptions();
    const send = opts.before_send as (cr: unknown) => unknown;
    for (const path of ["/shared/tok-SECRET", "/shared/stash/tok-SECRET"]) {
      const out = send({
        uuid: "u",
        event: "$pageleave",
        properties: { $current_url: `https://www.hyperspacevault.com${path}`, $pathname: path },
        $set_once: { $initial_pathname: path },
      });
      expect(JSON.stringify(out)).not.toContain("tok-SECRET");
    }
  });

  it("no /flags request: feature flags are off (the remote config load stays on)", async () => {
    const opts = await initOptions();
    expect(opts.advanced_disable_feature_flags).toBe(true);
    // advanced_disable_flags would also stop the remote config session replay needs.
    expect(opts).not.toHaveProperty("advanced_disable_flags");
    expect(opts).not.toHaveProperty("advanced_disable_decide");
  });

  it("scrubs a persisted initial person info holding a share URL before init", async () => {
    window.localStorage.setItem(
      POSTHOG_STORE_KEY,
      JSON.stringify({
        distinct_id: "ph-id",
        $initial_person_info: {
          r: "$direct",
          u: "https://www.hyperspacevault.com/shared/stash/tok-SECRET",
        },
      })
    );
    await initOptions();
    const stored = window.localStorage.getItem(POSTHOG_STORE_KEY)!;
    expect(stored).not.toContain("tok-SECRET");
    expect(JSON.parse(stored).$initial_person_info.u).toBe(
      "https://www.hyperspacevault.com/shared/stash/:token"
    );
  });

  it("on a share page, records the first-page info with the token redacted", async () => {
    window.history.replaceState(null, "", "/shared/stash/tok-SECRET#/vault");
    await initOptions();
    expect(posthog.register_once).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(posthog.register_once).mock.calls[0][0] as Record<string, unknown>;
    expect(JSON.stringify(arg)).not.toContain("tok-SECRET");
    expect(arg).toEqual({
      $initial_person_info: {
        r: "$direct",
        u: "https://www.hyperspacevault.com/shared/stash/:token#/vault",
      },
    });
  });

  it("before_send also redacts a session-known token on another page", async () => {
    window.sessionStorage.setItem(
      "swu.share.session",
      JSON.stringify({ token: "tok-SECRET", name: "Rowan", kind: "vault" })
    );
    const opts = await initOptions();
    const send = opts.before_send as (cr: unknown) => unknown;
    const out = send({ uuid: "u", event: "$autocapture", properties: { $el_text: "tok-SECRET" } });
    expect(JSON.stringify(out)).not.toContain("tok-SECRET");
  });

  it("heatmaps are off", async () => {
    const opts = await initOptions();
    expect(opts.capture_heatmaps).toBe(false);
  });

  it("a lone-surrogate token in the stored session never stops init or leaks", async () => {
    const odd = "bad\ud800tok";
    window.sessionStorage.setItem(
      "swu.share.session",
      JSON.stringify({ token: odd, name: "Rowan" })
    );
    window.history.replaceState(null, "", "/shared/stash/tok-SECRET");
    const opts = await initOptions();
    const { analyticsActive } = await import("./analytics");
    expect(analyticsActive()).toBe(true);
    const send = opts.before_send as (cr: unknown) => { properties: Record<string, string> };
    const out = send({
      uuid: "u",
      event: "$pageleave",
      properties: {
        $current_url: "https://www.hyperspacevault.com/shared/stash/tok-SECRET",
        $el_text: `x ${odd} y`,
      },
    });
    expect(out.properties.$current_url).toBe("https://www.hyperspacevault.com/shared/stash/:token");
    expect(out.properties.$el_text).toBe("x :token y");
  });
});
