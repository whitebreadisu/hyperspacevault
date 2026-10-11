import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../analytics/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../analytics/analytics")>()),
  capture: vi.fn(),
}));

import { capture, SCREEN_VIEWED_SCREENS } from "../../analytics/analytics";
import snapshot from "../../../e2e/mobile/fixtures/scan-catalog.snapshot.json";
import { commitPlan, executeCommit } from "../tool/commit";
import type { BatchRow } from "../tool/batch";
import { NO_PICKS } from "../tool/toolStore";
import { CameraFlow } from "./cameraFlow";
import {
  PICK_REASONS,
  cameraScreenViewed,
  scanDecision,
  scanFallbackKeypad,
  scanPickShown,
  scanRecognised,
} from "./scanAnalytics";
import { Catalog } from "./scanCore";
import type { ScanCatalogData } from "./scanCore";
import { timeBucket } from "./scanLoop";

vi.mock("../../api/inventory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/inventory")>()),
  adjustCard: vi.fn().mockResolvedValue(undefined),
}));

// BL-253 S7-18 (BL-244, additive): each scan event's exact property set
// (+ layout: "phone"), the time buckets, add_cards_committed's camera
// methods, and the guard: no property value is a card name, a key or the raw
// OCR text.

const spy = vi.mocked(capture);
const C = new Catalog(snapshot as unknown as ScanCatalogData);

beforeEach(() => spy.mockClear());

describe("S7-18 scan analytics (exact shapes, no OCR text / names)", () => {
  it("screen_viewed {screen: camera} -- camera is a registered screen value", () => {
    expect(SCREEN_VIEWED_SCREENS).toContain("camera");
    cameraScreenViewed();
    expect(spy).toHaveBeenLastCalledWith("screen_viewed", { screen: "camera", layout: "phone" });
  });

  it("scan_recognised {reader, key_strength, time_bucket}", () => {
    scanRecognised({ reader: "paddle", keyStrength: "weak", tAcceptMs: 800 });
    scanRecognised({ reader: "tesseract", keyStrength: "strong", tAcceptMs: 12000 });
    expect(spy.mock.calls).toEqual([
      [
        "scan_recognised",
        { reader: "paddle", key_strength: "weak", time_bucket: "<1s", layout: "phone" },
      ],
      [
        "scan_recognised",
        { reader: "tesseract", key_strength: "strong", time_bucket: ">10s", layout: "phone" },
      ],
    ]);
    expect([0, 999, 1000, 1999, 2000, 4999, 5000, 9999, 10000, null].map(timeBucket)).toEqual([
      "<1s",
      "<1s",
      "1-2s",
      "1-2s",
      "2-5s",
      "2-5s",
      "5-10s",
      "5-10s",
      ">10s",
      "<1s",
    ]);
  });

  it("scan_decision / scan_pick_shown / scan_fallback_keypad", () => {
    for (const d of ["add", "details", "wrong_card", "pick"] as const) scanDecision(d);
    for (const r of PICK_REASONS) scanPickShown(r);
    scanPickShown("denominator_9_not_252"); // never leaks a raw reason
    scanFallbackKeypad(true);
    scanFallbackKeypad(false);
    const by = (e: string) => spy.mock.calls.filter(([n]) => n === e).map(([, p]) => p);
    expect(by("scan_decision")).toEqual(
      ["add", "details", "wrong_card", "pick"].map((decision) => ({ decision, layout: "phone" }))
    );
    expect(by("scan_pick_shown")).toEqual([
      ...PICK_REASONS.map((reason) => ({ reason, layout: "phone" })),
      { reason: "several_cards", layout: "phone" },
    ]);
    expect(by("scan_fallback_keypad")).toEqual([
      { had_partial: true, layout: "phone" },
      { had_partial: false, layout: "phone" },
    ]);
  });

  it("add_cards_committed gains camera / camera_fast_add (+ fast_add); keypad unchanged", async () => {
    const row = (id: string, via: BatchRow["via"], vid: number): BatchRow => ({
      id,
      via,
      force: false,
      setCode: "SOR",
      cardNumber: String(vid),
      picks: NO_PICKS,
      variantId: vid,
      baseCardId: vid,
    });
    const batch = [
      row("b-1", "keypad", 1),
      row("b-2", "camera", 2),
      row("b-3", "camera", 2),
      row("b-4", "camera_fast_add", 3),
    ];
    const view = { added: batch.map((b) => ({ id: b.id })), notAdded: [], unresolved: [] };
    const plan = commitPlan(batch, view as never, "soft");
    await executeCommit(plan);
    expect(spy.mock.calls.filter(([e]) => e === "add_cards_committed").map(([, p]) => p)).toEqual([
      { method: "keypad", cards_added: 1, distinct_cards: 1, layout: "phone" },
      { method: "camera", cards_added: 2, distinct_cards: 1, fast_add: false, layout: "phone" },
      {
        method: "camera_fast_add",
        cards_added: 1,
        distinct_cards: 1,
        fast_add: true,
        layout: "phone",
      },
    ]);
  });

  it("guard: a full flow sends no card name, key or raw OCR text in any property", () => {
    const text = "SOR • EN R 229/252";
    const ev = C.evaluate(text);
    const card = ev.best!.cards[0];
    const flow = new CameraFlow({
      now: () => 0,
      fastAdd: () => false,
      cue: () => {},
      add: () => "b-1",
      remove: () => {},
      resume: () => {},
      setTimer: () => () => {},
      recognised: (a) => scanRecognised(a),
      pickShown: (r) => scanPickShown(r),
      decision: (d) => scanDecision(d),
    });
    flow.accepted({
      key: ev.best!.key,
      ev,
      card,
      reader: "paddle",
      keyStrength: "weak",
      tAcceptMs: 1500,
      decision: { state: "accept", accept: true, key: ev.best!.key },
    });
    flow.details();
    flow.add();
    flow.wrongCard();
    const amb = C.evaluate("ASHP • EN 16");
    flow.ambiguous(amb, amb.reason);
    const names = new Set<string>([card.name, ...amb.best!.cards.map((c) => c.name)]);
    const forbidden = [...names, ev.best!.key, amb.best!.key, text, "SOR", "229", "ASHP"];
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(5);
    for (const [, props] of spy.mock.calls)
      for (const v of Object.values(props ?? {}))
        for (const f of forbidden) expect(String(v)).not.toContain(f);
  });
});
