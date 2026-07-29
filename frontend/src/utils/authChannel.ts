/** BL-95 cross-tab sync: shared BroadcastChannel wiring used by both
 * AuthContext (the "original tab" listener -- refreshes verification state
 * in real time, answers pings) and VerifyEmailAction (the landing tab --
 * announces success, pings to detect whether another SWU tab is already
 * open).
 *
 * TAB_ID exists to solve a same-tab false positive: AuthContext and
 * VerifyEmailAction both mount in the *same* document (see App.tsx) but each
 * holds its own `BroadcastChannel` object. BroadcastChannel delivers a
 * posted message to every *other* channel object sharing its name --
 * including a same-tab, different-object listener -- so without a guard, a
 * landing tab's own "ping" would be answered by its own AuthContext
 * listener, and that "pong" would bounce back to the landing tab's own
 * listener, reading as "another tab is open" even with only one tab in
 * play. TAB_ID is generated once per module load (i.e. once per tab, since
 * both consumers live in the same JS module graph / same tab) and is
 * embedded in every message; consumers ignore any message carrying their
 * own TAB_ID.
 */

export const AUTH_CHANNEL_NAME = "swu-auth";

export const TAB_ID: string = Math.random().toString(36).slice(2);

export type AuthChannelMessage =
  | { type: "email-verified"; tabId: string }
  | { type: "ping"; tabId: string }
  | { type: "pong"; tabId: string };

/** Feature-checked: older browsers without BroadcastChannel degrade to the
 * pre-BL-95-cross-tab-sync behavior (each tab manages its own state
 * independently) rather than crashing. */
export function createAuthChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel(AUTH_CHANNEL_NAME);
}
