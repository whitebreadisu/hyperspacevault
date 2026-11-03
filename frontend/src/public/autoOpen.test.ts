import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_OPEN_STALLED_EVENT,
  AUTO_OPEN_STALL_MS,
  autoOpenFromLocation,
  autoOpenTarget,
  bootStep,
} from "./autoOpen";
import { autoOpenScript, scriptJson } from "./head";
import { isAllowedPublicEvent } from "./publicAnalytics";
import type { CardPageData } from "./publicCatalog";
import { APP_SEEN_KEY } from "../utils/appSeen";
import { POSTHOG_TOKEN, PUBLIC_ID_KEY } from "../analytics/posthogConfig";

// The returning-visitor redirect decision (App Spec §5.3, §22; design note
// §4 D4).

const luke = { set_code: "SOR", base_card_number: "5" };

describe("auto-open decision", () => {
  afterEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("reads the marker and the address bar", () => {
    window.history.replaceState(null, "", "/cards/sor/005/");
    expect(autoOpenFromLocation(luke)).toBeNull();
    window.localStorage.setItem(APP_SEEN_KEY, "1");
    expect(autoOpenFromLocation(luke)).toBe("/?card=sor-005");
    window.history.replaceState(null, "", "/cards/sor/005/?page");
    expect(autoOpenFromLocation(luke)).toBeNull();
  });

  it("stays on the page when storage throws", () => {
    const throwing = {
      getItem: vi.fn(() => {
        throw new Error("SecurityError");
      }),
    } as unknown as Storage;
    expect(autoOpenFromLocation(luke, throwing)).toBeNull();
    expect(autoOpenFromLocation(luke, null)).toBeNull();
    const getter = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(autoOpenFromLocation(luke)).toBeNull();
    getter.mockRestore();
  });
});

// One literal table for both implementations of the decision: autoOpenTarget
// (via the stored marker) and the inline head script (evaluated in jsdom).
// [search, stored marker (null = none), expected app href or null]
const DECISIONS: [string, string | null, string | null][] = [
  ["", null, null],
  ["", "1", "/?card=sor-005"],
  ["", "0", null],
  ["", "true", null],
  // The page's printing goes along when it has a slug's shape.
  ["?v=hyperspace-sorp-1", "1", "/?card=sor-005&v=hyperspace-sorp-1"],
  ["?v=hyperspace-sorp-1", null, null],
  [
    "?v=serialized-prestige-sec-1127-rose-gold",
    "1",
    "/?card=sor-005&v=serialized-prestige-sec-1127-rose-gold",
  ],
  ["?x=1&v=foil-sor-5", "1", "/?card=sor-005&v=foil-sor-5"],
  // Anything else in v is dropped, never copied into the app URL.
  ["?v=", "1", "/?card=sor-005"],
  ["?v=Hyperspace-SOR-1", "1", "/?card=sor-005"],
  ["?v=%3Cscript%3E", "1", "/?card=sor-005"],
  ["?v=a%26signup%3D1", "1", "/?card=sor-005"],
  ["?v=a%22b", "1", "/?card=sor-005"],
  ["?page", "1", null],
  ["?page=", "1", null],
  ["?page=1", "1", null],
  ["?v=x&page", "1", null],
  ["?page&v=x", "1", null],
  ["?page", null, null],
];

describe("auto-open decision table", () => {
  afterEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it.each(DECISIONS)("autoOpenFromLocation(%j, marker %j) = %j", (search, marker, want) => {
    window.history.replaceState(null, "", `/cards/sor/005/${search}`);
    if (marker != null) window.localStorage.setItem(APP_SEEN_KEY, marker);
    expect(autoOpenFromLocation(luke)).toBe(want);
    expect(autoOpenTarget(search, marker === "1", luke)).toBe(want);
  });
});

type Win = Window & { __hsvAutoOpen?: string };
const flag = () => (window as Win).__hsvAutoOpen;

describe("auto-open head script", () => {
  const page = { card: { ...luke } } as unknown as CardPageData;
  const js = (hosts?: string[]) => {
    const html = autoOpenScript(page, hosts);
    return html.slice("<script>".length, -"</script>".length);
  };
  let replace: ReturnType<typeof vi.fn>;
  let beacon: ReturnType<typeof vi.fn>;

  function runAt(search: string, hosts?: string[], replaceImpl?: () => void) {
    replace = vi.fn(replaceImpl);
    vi.stubGlobal("location", {
      search,
      hostname: "localhost",
      origin: "http://localhost",
      replace,
    });
    new Function(js(hosts))();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as Win).__hsvAutoOpen;
    document.documentElement.style.visibility = "";
    window.localStorage.clear();
  });

  it.each(DECISIONS)("search %j, marker %j -> %j", (search, marker, want) => {
    if (marker != null) window.localStorage.setItem(APP_SEEN_KEY, marker);
    runAt(search);
    if (want) {
      expect(replace).toHaveBeenCalledWith(want);
      expect(flag()).toBe("pending");
      expect(document.documentElement.style.visibility).toBe("hidden");
    } else {
      expect(replace).not.toHaveBeenCalled();
      expect(flag()).toBeUndefined();
      expect(document.documentElement.style.visibility).toBe("");
    }
  });

  it("stays when storage throws", () => {
    const getter = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    runAt("");
    expect(replace).not.toHaveBeenCalled();
    expect(flag()).toBeUndefined();
    getter.mockRestore();
  });

  it("shows the page again at once when location.replace throws", () => {
    window.localStorage.setItem(APP_SEEN_KEY, "1");
    const stalled = vi.fn();
    window.addEventListener(AUTO_OPEN_STALLED_EVENT, stalled);
    runAt("", undefined, () => {
      throw new Error("blocked");
    });
    expect(flag()).toBe("stalled");
    expect(document.documentElement.style.visibility).toBe("");
    expect(stalled).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(AUTO_OPEN_STALL_MS * 2);
    expect(stalled).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTO_OPEN_STALLED_EVENT, stalled);
  });

  it("shows the page again when nothing has navigated after the stall timeout", () => {
    window.localStorage.setItem(APP_SEEN_KEY, "1");
    const stalled = vi.fn();
    window.addEventListener(AUTO_OPEN_STALLED_EVENT, stalled);
    runAt("");
    vi.advanceTimersByTime(AUTO_OPEN_STALL_MS - 1);
    expect(flag()).toBe("pending");
    expect(document.documentElement.style.visibility).toBe("hidden");
    expect(stalled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flag()).toBe("stalled");
    expect(document.documentElement.style.visibility).toBe("");
    expect(stalled).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTO_OPEN_STALLED_EVENT, stalled);
  });

  it("sends auto_open by beacon only on an analytics hostname, as publicCapture would", async () => {
    window.localStorage.setItem(APP_SEEN_KEY, "1");
    runAt("");
    expect(beacon).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/?card=sor-005");
    window.localStorage.setItem(PUBLIC_ID_KEY, "page-id");
    runAt("", ["localhost"]);
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0] as [string, Blob];
    expect(url).toBe("http://localhost/api/relay/i/v0/e/");
    expect(blob.type).toBe("application/json");
    const body = JSON.parse(await blob.text());
    expect(body).toMatchObject({
      api_key: POSTHOG_TOKEN,
      event: "card_page_cta",
      distinct_id: "page-id",
      properties: { action: "auto_open", $lib: "hsv-public-pages", $process_person_profile: false },
    });
    expect(Object.keys(body.properties).sort()).toEqual([
      "$lib",
      "$process_person_profile",
      "action",
    ]);
    expect(isAllowedPublicEvent(body.event, { action: body.properties.action })).toBe(true);
    expect(replace).toHaveBeenCalledWith("/?card=sor-005");
  });

  it("honours the analytics opt-out and still redirects", () => {
    window.localStorage.setItem(APP_SEEN_KEY, "1");
    window.localStorage.setItem(`__ph_opt_in_out_${POSTHOG_TOKEN}`, "0");
    runAt("", ["localhost"]);
    expect(beacon).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/?card=sor-005");
  });

  it("no value can close the script: the href is encoded and the JSON escapes <", () => {
    const evil = { card: { set_code: "SOR</script><b>", base_card_number: "5" } };
    const html = autoOpenScript(evil as unknown as CardPageData);
    expect(html.match(/<\/script/gi)).toHaveLength(1);
    expect(html).toContain('"href":"/?card=sor%3C%2Fscript%3E%3Cb%3E-005"');
    expect(scriptJson({ x: "</script>" })).toBe('{"x":"\\u003c/script>"}');
  });
});

// The page script's boot decision (card.tsx), one row per branch.
describe("page script boot step", () => {
  it.each([
    ["pending", "/?card=sor-005", "wait"],
    ["pending", null, "wait"],
    ["stalled", "/?card=sor-005", "hydrate"],
    ["stalled", null, "hydrate"],
    [undefined, "/?card=sor-005", "redirect"],
    [undefined, null, "hydrate"],
    [true, null, "hydrate"],
  ] as const)("head %j, fallback %j -> %s", (head, target, want) => {
    expect(bootStep(head, target)).toBe(want);
  });

  it("never redirects or sends again once the head script acted", () => {
    // "redirect" is the only step that sends the event.
    for (const head of ["pending", "stalled"]) {
      expect(bootStep(head, "/?card=sor-005")).not.toBe("redirect");
    }
  });
});
