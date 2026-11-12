import { describe, expect, it } from "vitest";
import { redactShareEvent, redactShareText } from "./redactShare";

// A share token is the link's only credential (App Spec §19.1, §22): no
// analytics event may carry it. The event below has the URL-bearing
// properties posthog-js sets on a page (event properties, person
// properties, autocapture's element chain, pageleave), on a vault link's
// page and on a stash link's.

const TOKEN = "Zk3p_Q9-secretTOKEN";

function eventOn(path: string, event = "$autocapture") {
  const url = `https://www.hyperspacevault.com${path}#/card/12?v=3`;
  return {
    uuid: "u1",
    event,
    properties: {
      $current_url: url,
      $pathname: path,
      $referrer: url,
      $prev_pageview_pathname: path,
      $host: "www.hyperspacevault.com",
      $elements: [{ tag_name: "a", attr__href: path + "#/vault", $el_text: "Vault" }],
      screen: "shared_view",
      count: 3,
    },
    $set: { $current_url: url },
    $set_once: { $initial_current_url: url, $initial_pathname: path },
  };
}

describe("share tokens never reach analytics (redactShareEvent)", () => {
  for (const [label, path, redacted] of [
    ["vault link", `/shared/${TOKEN}`, "/shared/:token"],
    ["stash link", `/shared/stash/${TOKEN}`, "/shared/stash/:token"],
  ] as const) {
    it(`an event on a ${label} carries no token anywhere`, () => {
      const out = redactShareEvent(eventOn(path), path)!;
      const json = JSON.stringify(out);
      expect(json).not.toContain(TOKEN);
      expect(out.properties.$pathname).toBe(redacted);
      expect(out.properties.$current_url).toBe(
        `https://www.hyperspacevault.com${redacted}#/card/12?v=3`
      );
      expect(out.$set_once.$initial_pathname).toBe(redacted);
      // Everything else is untouched.
      expect(out.properties.screen).toBe("shared_view");
      expect(out.properties.count).toBe(3);
      expect(out.properties.$host).toBe("www.hyperspacevault.com");
    });
  }

  it("redacts session-replay snapshots on a share page; leaves them alone elsewhere", () => {
    const snap = {
      event: "$snapshot",
      properties: { $snapshot_data: [{ type: 4, data: { href: `/shared/stash/${TOKEN}` } }] },
    };
    expect(JSON.stringify(redactShareEvent(snap, `/shared/stash/${TOKEN}`))).not.toContain(TOKEN);
    expect(redactShareEvent(snap, "/")).toBe(snap);
  });

  it("leaves non-share URLs, and a dropped (null) event, as they are", () => {
    const ev = eventOn("/");
    expect(redactShareEvent(ev, "/")!.properties).toBe(ev.properties);
    expect(redactShareEvent(null)).toBeNull();
    expect(redactShareText("/shared/stash")).toBe("/shared/stash");
    expect(redactShareText("/sharedfoo/x")).toBe("/sharedfoo/x");
    expect(redactShareText("a /shared/t1?x=1 and /shared/stash/t2#/vault")).toBe(
      "a /shared/:token?x=1 and /shared/stash/:token#/vault"
    );
  });
});
