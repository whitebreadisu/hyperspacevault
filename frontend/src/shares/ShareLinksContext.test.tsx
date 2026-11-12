import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShareRecord } from "../api/shares";
import type { Stash } from "../api/stashes";
import { StashProvider } from "../stashes/StashContext";
import { ShareLinksProvider, useShareLinks } from "./ShareLinksContext";
import type { ShareLinksData } from "./ShareLinksContext";

// The owner-links source (App Spec §19.1 owner screens): lazy, joined with
// the stash list (current names, stash order, a gone stash's link dropped),
// off when signed out, dropped on a user change.

const { listShares } = vi.hoisted(() => ({ listShares: vi.fn() }));
vi.mock("../api/shares", async (orig) => ({
  ...(await orig<typeof import("../api/shares")>()),
  listShares,
}));
const stashApi = vi.hoisted(() => ({ getStashes: vi.fn(), getStashItems: vi.fn() }));
vi.mock("../api/stashes", async (orig) => ({
  ...(await orig<typeof import("../api/stashes")>()),
  ...stashApi,
}));

const vaultLink: ShareRecord = {
  id: 1,
  name: "Jeremy",
  scope: "inventory",
  token: "tok-v",
  created_at: "2026-11-12T00:00:00Z",
  revoked: false,
};
const stashLink = (stashId: number, stash_name: string): ShareRecord => ({
  ...vaultLink,
  id: 100 + stashId,
  scope: "stash",
  token: "tok-s" + stashId,
  target_id: stashId,
  stash_name,
});
const stash = (id: number, name: string): Stash => ({
  id,
  name,
  description: null,
  created_at: "2026-11-0" + id,
  copies: 0,
});

let stashes: Stash[];
beforeEach(() => {
  vi.clearAllMocks();
  stashes = [stash(1, "Red binder"), stash(2, "Trade stash")];
  stashApi.getStashes.mockImplementation(async () => stashes);
  stashApi.getStashItems.mockResolvedValue([]);
});

function Probe() {
  const l = useShareLinks();
  return (
    <p data-testid="links">
      {l.ready ? l.links.map((x) => `${x.label}:${x.share.token}`).join("|") : "-"} /{" "}
      {l.sharedStashes}
    </p>
  );
}

// The latest context value, for driving writes from the test.
const handle: { current: ShareLinksData | null } = { current: null };
function Grab() {
  const links = useShareLinks();
  useEffect(() => {
    handle.current = links;
  });
  return null;
}

function tree(enabled: boolean, uid: string, probe = true, paused = false) {
  return (
    <StashProvider enabled={enabled} uid={uid}>
      <ShareLinksProvider enabled={enabled} paused={paused} uid={uid}>
        {probe ? (
          <>
            <Grab />
            <Probe />
          </>
        ) : null}
      </ShareLinksProvider>
    </StashProvider>
  );
}

const text = () => screen.queryByTestId("links")?.textContent;

describe("ShareLinksContext", () => {
  it("fetches nothing until a consumer asks", async () => {
    listShares.mockResolvedValue([]);
    await act(async () => {
      render(tree(true, "u1", false));
    });
    expect(listShares).not.toHaveBeenCalled();
  });

  it("signed out: nothing fetched, nothing listed", async () => {
    await act(async () => {
      render(tree(false, "u1"));
    });
    expect(listShares).not.toHaveBeenCalled();
    expect(text()).toBe("- / 0");
  });

  it("vault first, stash links in stash order with the stash's current name", async () => {
    // Server order scrambled and a stale stash_name: the stash list wins.
    listShares.mockResolvedValue([stashLink(2, "Old name"), vaultLink, stashLink(1, "Red binder")]);
    render(tree(true, "u1"));
    await waitFor(() =>
      expect(text()).toBe("Vault:tok-v|Red binder:tok-s1|Trade stash:tok-s2 / 2")
    );
  });

  it("drops a revoked row and a link whose stash is gone", async () => {
    listShares.mockResolvedValue([
      { ...vaultLink, revoked: true },
      stashLink(1, "Red binder"),
      stashLink(9, "Deleted"),
    ]);
    render(tree(true, "u1"));
    await waitFor(() => expect(text()).toBe("Red binder:tok-s1 / 1"));
  });

  it("a user change drops what was held and reads again", async () => {
    listShares.mockResolvedValue([vaultLink]);
    const r = render(tree(true, "u1"));
    await waitFor(() => expect(text()).toBe("Vault:tok-v / 0"));
    listShares.mockResolvedValue([]);
    r.rerender(tree(true, "u2"));
    await waitFor(() => expect(text()).toBe(" / 0"));
    expect(listShares).toHaveBeenCalledTimes(2);
  });

  it("a write started under one account and landing after a switch is dropped", async () => {
    listShares.mockResolvedValue([]);
    const r = render(tree(true, "u1"));
    await waitFor(() => expect(text()).toBe(" / 0"));
    // A create begins as u1 ...
    const session = handle.current!.session();
    // ... the account changes before it answers ...
    r.rerender(tree(true, "u2"));
    await waitFor(() => expect(listShares).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(text()).toBe(" / 0"));
    // ... and u1's answer lands: nothing reaches u2's links, no re-read.
    act(() => handle.current!.put(vaultLink, session));
    act(() => handle.current!.drop(1, session));
    await act(async () => handle.current!.refresh(session));
    expect(text()).toBe(" / 0");
    expect(listShares).toHaveBeenCalledTimes(2);
    // The same write under u2's own session applies.
    act(() => handle.current!.put(vaultLink, handle.current!.session()));
    expect(text()).toBe("Vault:tok-v / 0");
  });

  it("a read started under one account and landing after a switch is dropped", async () => {
    let answer!: (rows: ShareRecord[]) => void;
    listShares.mockImplementationOnce(() => new Promise((res) => (answer = res)));
    const r = render(tree(true, "u1"));
    await waitFor(() => expect(listShares).toHaveBeenCalledTimes(1));
    listShares.mockResolvedValue([]);
    r.rerender(tree(true, "u2"));
    await waitFor(() => expect(text()).toBe(" / 0"));
    await act(async () => answer([vaultLink]));
    expect(text()).toBe(" / 0");
  });

  it("the generation alone drops a read from the old account (no newer read in between)", async () => {
    let answer!: (rows: ShareRecord[]) => void;
    listShares.mockImplementationOnce(() => new Promise((res) => (answer = res)));
    const r = render(tree(true, "u1"));
    await waitFor(() => expect(listShares).toHaveBeenCalledTimes(1));
    // Switch to u2 while paused: no read starts, so the read order (seq) is
    // unchanged; only the account generation tells the answer apart.
    r.rerender(tree(true, "u2", true, true));
    await act(async () => answer([vaultLink]));
    expect(listShares).toHaveBeenCalledTimes(1);
    // Unpaused, u2's own read is held: nothing shows, not u1's link.
    let second!: (rows: ShareRecord[]) => void;
    listShares.mockImplementationOnce(() => new Promise((res) => (second = res)));
    r.rerender(tree(true, "u2", true, false));
    await waitFor(() => expect(listShares).toHaveBeenCalledTimes(2));
    expect(text()).toBe("- / 0");
    await act(async () => second([]));
    expect(text()).toBe(" / 0");
  });

  it("sign-out then sign-in as the same account: the read from before is dropped", async () => {
    let stale!: (rows: ShareRecord[]) => void;
    listShares.mockImplementationOnce(() => new Promise((res) => (stale = res)));
    const r = render(tree(true, "u1"));
    await waitFor(() => expect(listShares).toHaveBeenCalledTimes(1));
    r.rerender(tree(false, "u1"));
    let fresh!: (rows: ShareRecord[]) => void;
    listShares.mockImplementationOnce(() => new Promise((res) => (fresh = res)));
    r.rerender(tree(true, "u1"));
    await waitFor(() => expect(listShares).toHaveBeenCalledTimes(2));
    await act(async () => stale([vaultLink]));
    expect(text()).toBe("- / 0");
    await act(async () => fresh([]));
    expect(text()).toBe(" / 0");
  });

  it("paused (a shared vault or stash is the view): reads and exposes nothing, keeps what it had", async () => {
    listShares.mockResolvedValue([vaultLink]);
    const r = render(tree(true, "u1"));
    await waitFor(() => expect(text()).toBe("Vault:tok-v / 0"));
    r.rerender(tree(true, "u1", true, true));
    expect(text()).toBe("- / 0");
    await act(async () => handle.current!.refresh());
    await act(async () => handle.current!.reload());
    expect(listShares).toHaveBeenCalledTimes(1);
    r.rerender(tree(true, "u1", true, false));
    expect(text()).toBe("Vault:tok-v / 0");
  });

  it("an ask after a failed first read reads again", async () => {
    listShares.mockRejectedValueOnce(new Error("down"));
    render(tree(true, "u1"));
    // The failure has landed (an ask before it would just join the read).
    await waitFor(() => expect(handle.current!.failed).toBe(true));
    listShares.mockResolvedValue([vaultLink]);
    await act(async () => handle.current!.load());
    await waitFor(() => expect(text()).toBe("Vault:tok-v / 0"));
  });
});
