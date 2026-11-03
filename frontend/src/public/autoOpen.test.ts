import { afterEach, describe, expect, it, vi } from "vitest";
import { autoOpenFromLocation, autoOpenTarget } from "./autoOpen";
import { APP_SEEN_KEY } from "../utils/appSeen";

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
