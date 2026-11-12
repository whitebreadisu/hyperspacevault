import { describe, expect, it } from "vitest";
import {
  knownShareTokens,
  MAX_REDACT_DEPTH,
  redactShareEvent,
  redactShareText,
  redactShareValue,
  scrubStoredShareTokens,
} from "./redactShare";

// A share token is the link's only credential (App Spec §19.1, §22). The
// events below have the URL-bearing properties posthog-js sets on a page
// (event properties, person properties, autocapture's element chain,
// pageleave), on a vault link's page and on a stash link's.

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

describe("share tokens are redacted from analytics events (redactShareEvent)", () => {
  for (const [label, path, redacted] of [
    ["vault link", `/shared/${TOKEN}`, "/shared/:token"],
    ["stash link", `/shared/stash/${TOKEN}`, "/shared/stash/:token"],
  ] as const) {
    it(`an event on a ${label} carries no token anywhere`, () => {
      const out = redactShareEvent(eventOn(path), knownShareTokens(path))!;
      expect(JSON.stringify(out)).not.toContain(TOKEN);
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

  it("walks every replay snapshot, on any page (a share session restored on `/` too)", () => {
    const snap = {
      event: "$snapshot",
      properties: {
        $snapshot_data: [
          { type: 4, data: { href: `https://x.test/shared/stash/${TOKEN}` } },
          // An app request's URL in network capture.
          { type: 6, data: { payload: { name: `https://x.test/api/shared/${TOKEN}/stash` } } },
        ],
      },
    };
    expect(JSON.stringify(redactShareEvent(snap))).not.toContain(TOKEN);
    // On `/` with the tab session's token known: a bare token is redacted too.
    const bare = { event: "$snapshot", properties: { $snapshot_data: [{ text: `tok ${TOKEN}` }] } };
    expect(JSON.stringify(redactShareEvent(bare, knownShareTokens("/", TOKEN)))).not.toContain(
      TOKEN
    );
  });

  it("leaves non-share events, and a dropped (null) event, as they are", () => {
    const ev = eventOn("/");
    expect(redactShareEvent(ev)!.properties).toBe(ev.properties);
    expect(redactShareEvent(null)).toBeNull();
  });
});

describe("redactShareText coverage", () => {
  it("plain paths, a bare /shared/stash and look-alikes", () => {
    expect(redactShareText("/shared/stash")).toBe("/shared/stash");
    expect(redactShareText("/sharedfoo/x")).toBe("/sharedfoo/x");
    expect(redactShareText("a /shared/t1?x=1 and /shared/stash/t2#/vault")).toBe(
      "a /shared/:token?x=1 and /shared/stash/:token#/vault"
    );
  });

  it("percent-encoded paths, either case", () => {
    expect(redactShareText(`/login?next=%2Fshared%2F${TOKEN}`)).toBe(
      "/login?next=%2Fshared%2F:token"
    );
    expect(redactShareText(`next=%2fshared%2fstash%2f${TOKEN}&x=1`)).toBe(
      "next=%2fshared%2fstash%2f:token&x=1"
    );
  });

  it("a token repeated in the query or the hash", () => {
    expect(redactShareText(`/shared/${TOKEN}?token=${TOKEN}#${TOKEN}`)).toBe(
      "/shared/:token?token=:token#:token"
    );
  });

  it("known tokens anywhere, raw or URI-encoded", () => {
    const odd = "a/b c";
    expect(redactShareText(`x ${encodeURIComponent(odd)} y`, [odd])).toBe("x :token y");
    expect(redactShareText("nothing here", [TOKEN])).toBe("nothing here");
  });
});

describe("redactShareValue bounds", () => {
  it("drops a cycle instead of looping or throwing", () => {
    const a: Record<string, unknown> = { url: `/shared/${TOKEN}` };
    a.self = a;
    const out = redactShareValue(a) as Record<string, unknown>;
    expect(out.url).toBe("/shared/:token");
    expect(out).not.toHaveProperty("self");
  });

  it("drops what nests deeper than the cap, keeps the rest", () => {
    let deep: Record<string, unknown> = { leaf: `/shared/${TOKEN}` };
    for (let i = 0; i < MAX_REDACT_DEPTH + 5; i++) deep = { d: deep };
    const out = redactShareValue({ keep: `/shared/${TOKEN}`, deep }) as Record<string, unknown>;
    expect(out.keep).toBe("/shared/:token");
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });

  it("a shared (non-cyclic) reference is redacted in both places", () => {
    const shared = { u: `/shared/${TOKEN}` };
    const out = redactShareValue({ a: shared, b: shared }) as Record<string, { u: string }>;
    expect(out.a.u).toBe("/shared/:token");
    expect(out.b.u).toBe("/shared/:token");
  });
});

describe("scrubStoredShareTokens (posthog-js's persisted state)", () => {
  function memStore(init: Record<string, string>) {
    const m = new Map(Object.entries(init));
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      m,
    };
  }

  it("scrubs a persisted initial person info that holds a share URL", () => {
    const store = memStore({
      ph_key: JSON.stringify({
        distinct_id: "d1",
        $initial_person_info: {
          r: "$direct",
          u: `https://www.hyperspacevault.com/shared/stash/${TOKEN}`,
        },
      }),
    });
    expect(scrubStoredShareTokens("ph_key", [store])).toBe(true);
    const saved = JSON.parse(store.m.get("ph_key")!);
    expect(saved.$initial_person_info.u).toBe(
      "https://www.hyperspacevault.com/shared/stash/:token"
    );
    expect(saved.distinct_id).toBe("d1");
  });

  it("leaves clean, absent and unparsable state alone", () => {
    const clean = memStore({
      ph_key: JSON.stringify({ $initial_person_info: { u: "https://x/" } }),
    });
    const broken = memStore({ ph_key: "{not json /shared/x" });
    expect(scrubStoredShareTokens("ph_key", [clean, broken, null, memStore({})])).toBe(false);
    expect(broken.m.get("ph_key")).toBe("{not json /shared/x");
  });
});

describe("object keys (posthog-js keys $heatmap_data by page URL)", () => {
  it("redacts share URLs used as keys, vault and stash links", () => {
    const ev = {
      event: "$$heatmap",
      properties: {
        $heatmap_data: {
          [`https://www.hyperspacevault.com/shared/${TOKEN}`]: [{ x: 1, y: 2, type: "click" }],
          [`https://www.hyperspacevault.com/shared/stash/${TOKEN}#/vault`]: [{ x: 3, y: 4 }],
        },
      },
    };
    const out = redactShareEvent(ev)!;
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(Object.keys(out.properties.$heatmap_data)).toEqual([
      "https://www.hyperspacevault.com/shared/:token",
      "https://www.hyperspacevault.com/shared/stash/:token#/vault",
    ]);
  });

  it("two keys collapsing to one merge: arrays concatenate, otherwise the later wins", () => {
    const out = redactShareValue({
      "/shared/aaa": [1, 2],
      "/shared/bbb": [3],
      n: { "/shared/ccc": "first", "/shared/ddd": "second" },
    }) as Record<string, unknown>;
    expect(out["/shared/:token"]).toEqual([1, 2, 3]);
    expect(out.n).toEqual({ "/shared/:token": "second" });
  });
});

describe("a token that cannot be URI-encoded (a lone surrogate)", () => {
  it("is still redacted raw, and nothing throws", () => {
    const odd = "ab\ud800cd";
    expect(() => redactShareText(`x ${odd} y`, [odd])).not.toThrow();
    expect(redactShareText(`x ${odd} y`, [odd])).toBe("x :token y");
    expect(redactShareText("/shared/t1 and nothing else", [odd])).toBe(
      "/shared/:token and nothing else"
    );
  });
});
