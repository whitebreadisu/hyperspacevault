import { describe, it, expect } from "vitest";
import { AUTH_CHANNEL_NAME, TAB_ID, createAuthChannel } from "./authChannel";

// DISPOSITION (BL-95, CREATE): net-new shared module -- no prior behavior to
// port. Direct coverage here is deliberately thin; the interesting
// behaviors (loopback guard, ping/pong round-trip) are exercised through
// AuthContext.test.tsx and VerifyEmailAction.test.tsx, which are where a
// regression would actually be observable.
describe("authChannel (BL-95)", () => {
  it("TAB_ID is a non-empty string, stable across reads", () => {
    expect(typeof TAB_ID).toBe("string");
    expect(TAB_ID.length).toBeGreaterThan(0);
    expect(TAB_ID).toBe(TAB_ID);
  });

  it("createAuthChannel returns a BroadcastChannel bound to the shared channel name when supported", () => {
    const channel = createAuthChannel();
    expect(channel).not.toBeNull();
    expect(channel?.name).toBe(AUTH_CHANNEL_NAME);
    channel?.close();
  });

  it("createAuthChannel degrades to null when BroadcastChannel is unsupported", () => {
    const original = globalThis.BroadcastChannel;
    // @ts-expect-error -- simulating a browser with no BroadcastChannel
    globalThis.BroadcastChannel = undefined;

    expect(createAuthChannel()).toBeNull();

    globalThis.BroadcastChannel = original;
  });
});
