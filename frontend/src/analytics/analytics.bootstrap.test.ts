// @vitest-environment-options {"url": "https://www.hyperspacevault.com/"}
// The public pages' anonymous id (App Spec §22): the app's posthog init
// starts from it ONLY when it exists and posthog-js has no stored identity
// yet; otherwise the init options are exactly the usual ones. Runs on the
// real prod hostname with PROD stubbed on so initAnalytics reaches init().
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({
  default: { init: vi.fn(), capture: vi.fn(), register: vi.fn() },
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
const USUAL_KEYS = [
  "api_host",
  "before_send",
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
});
