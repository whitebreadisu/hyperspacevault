import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoOpenFromLocation, autoOpenTarget } from "./autoOpen";
import { autoOpenScript } from "./head";
import { isAllowedPublicEvent } from "./publicAnalytics";
import type { CardPageData } from "./publicCatalog";
import { APP_SEEN_KEY } from "../utils/appSeen";
import { POSTHOG_TOKEN, PUBLIC_ID_KEY } from "../analytics/posthogConfig";

// The returning-visitor redirect decision (App Spec §22, design note §4 D4).

const luke = { set_code: "SOR", base_card_number: "5" };

describe("auto-open decision", () => {
  afterEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("opens this card in the app only when the app has been seen", () => {
    expect(autoOpenTarget("", true, luke)).toBe("/?card=sor-005");
    expect(autoOpenTarget("?v=hyperspace-sorp-1", true, luke)).toBe("/?card=sor-005");
    expect(autoOpenTarget("", false, luke)).toBeNull();
  });

  it.each(["?page", "?page=", "?page=1", "?v=hyperspace-sorp-1&page", "?page&v=x"])(
    "stays on the page for %s",
    (search) => {
      expect(autoOpenTarget(search, true, luke)).toBeNull();
    }
  );

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

// The inline head script mirrors autoOpenTarget; evaluated here in jsdom
// against the same cases.
describe("auto-open head script", () => {
  const page = { card: { ...luke } } as unknown as CardPageData;
  const js = (hosts?: string[]) => {
    const html = autoOpenScript(page, hosts);
    return html.slice("<script>".length, -"</script>".length);
  };
  let replace: ReturnType<typeof vi.fn>;
  let beacon: ReturnType<typeof vi.fn>;

  function runAt(search: string, hosts?: string[]) {
    replace = vi.fn();
    vi.stubGlobal("location", {
      search,
      hostname: "localhost",
      origin: "http://localhost",
      replace,
    });
    new Function(js(hosts))();
  }

  beforeEach(() => {
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as { __hsvAutoOpen?: boolean }).__hsvAutoOpen;
    document.documentElement.style.visibility = "";
    window.localStorage.clear();
  });

  it.each(["", "?v=hyperspace-sorp-1", "?page", "?page=1", "?v=x&page"])(
    "makes autoOpenTarget's decision for %s, with and without the marker",
    (search) => {
      for (const seen of [false, true]) {
        window.localStorage.clear();
        if (seen) window.localStorage.setItem(APP_SEEN_KEY, "1");
        runAt(search);
        const want = autoOpenTarget(search, seen, luke);
        if (want) expect(replace).toHaveBeenCalledWith(want);
        else expect(replace).not.toHaveBeenCalled();
        expect((window as { __hsvAutoOpen?: boolean }).__hsvAutoOpen === true).toBe(!!want);
        delete (window as { __hsvAutoOpen?: boolean }).__hsvAutoOpen;
      }
    }
  );

  it("stays when storage throws", () => {
    const getter = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    runAt("");
    expect(replace).not.toHaveBeenCalled();
    getter.mockRestore();
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

  it("bakes the href in as escaped JSON: no value can close the script", () => {
    const evil = { card: { set_code: "SOR</script><b>", base_card_number: "5" } };
    const html = autoOpenScript(evil as unknown as CardPageData);
    expect(html.match(/<\/script/gi)).toHaveLength(1);
    expect(html).toContain("\u003c/script>");
  });
});
