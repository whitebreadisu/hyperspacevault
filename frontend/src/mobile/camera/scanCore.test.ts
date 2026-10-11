import { describe, expect, it } from "vitest";
import snapshot from "../../../e2e/mobile/fixtures/scan-catalog.snapshot.json";
import { Acceptor, Catalog, numLenConflict } from "./scanCore";
import type { AcceptorOptions, ScanCatalogData } from "./scanCore";

// BL-253 S7-06: every case of the spike's tools/test_core.js (v0.5.5) ported
// verbatim -- the parser table (lines 5-30), the Acceptor replay scenarios
// (32-85) -- against the spike's own catalog.json snapshot.

const C = new Catalog(snapshot as unknown as ScanCatalogData);

const cases: [string, string][] = [
  ["SOR • EN R 229/252", "exact"],
  ["SOR • EN [R] 100/252", "exact"],
  ["SOR EN R 364", "exact"],
  ["SOR • EN U 12/20", "exact"],
  ["SOR • EN C 04/20", "exact"],
  ["SOR • EN S 1/2", "ambiguous"],
  ["SOR • EN S 001/002", "ambiguous"],
  ["SOR • EN C T01/T02", "exact"],
  ["SOR • EN R 12", "invalid"],
  ["JTL • EN U 598", "exact"],
  ["SEC • EN L 1041", "exact"],
  ["LAW • EN C 100/264", "exact"],
  ["ASH • EN C 19/264", "exact"],
  ["J25 • EN L 16", "exact"],
  ["C24 • EN S 005/006", "exact"],
  ["IBH • EN S 1/104", "exact"],
  ["TS26 • EN R 1/84", "exact"],
  ["S0R • EN R 229/252", "exact"],
  ["SOREN R229/252", "exact"],
  ["LFL FFG SOR EN R 22O/252", "exact"],
  ["HMW • EN C 1/272", "exact"],
  ["garbage", "invalid"],
  ["SOR • EN S229/252", "exact"],
  ["JTL • EN C T01", "exact"],
  // v0.3: owner run 2 failure shapes
  ["F LAWSEN 25/264 J", "exact"],
  ["LANEN 25/264", "exact"],
  ["LAW-EN 25/284", "exact"],
  ["LAME 25/264", "exact"],
  ["LW 25/264", "exact"],
  ["LEN 25/264", "invalid"],
  ["6G ASHP 4 E N V -", "invalid"],
  ["ASHP • EN 16", "ambiguous"],
  ["ASHP EN W 16", "ambiguous"],
  ["ASHP • EN 10", "ambiguous"],
  ["ASHP • EN 19", "ambiguous"],
  [". O0FFGASHP EN 16", "ambiguous"],
  ["LFFGSOR EN R 229/252", "exact"],
  ["OFFGASHPEN W 16", "ambiguous"],
  // PaddleOCR shapes
  ["ASHP·EN O   16 1", "ambiguous"],
  ["SOR EN R 229/252", "exact"],
  ["ASH EN L 795 4", "ambiguous"],
  ["SOR EN 1 229/252", "exact"],
  ["@LFL @FFG JTL·ENU598", "exact"],
  ["@LFL @FFG SOR·ENR 229/252", "exact"],
  ["@LFL@FFG ASHP·ENW 16", "ambiguous"],
  ["ASH·EN L795", "exact"],
  ["P26 • EN 16", "exact"],
  ["ASHP EN", "invalid"],
  ["6 ASHP", "invalid"],
  ["ASH EN 25/2G4", "invalid"],
  ["SOR EN 229/262", "exact"],
  ["SORS EN 229/252", "exact"],
];

// v0.4 acceptance sequences (keys as the reader produced them in the owner's runs)
type Seq = [number, string | null, number][] & { readers?: Record<number, string> };

function replay(seq: Seq, opts?: AcceptorOptions): string[] {
  const A = new Acceptor(opts);
  const accepted: string[] = [];
  seq.forEach(([t, text, conf]) => {
    let r;
    if (text === null) r = { t, result: "skipped" as const };
    else {
      const ev = C.evaluate(text);
      const rd = ev.best && ev.best.reading;
      r = {
        t,
        result: ev.result,
        key: ev.best ? ev.best.key : null,
        conf,
        reader: (seq.readers && seq.readers[t]) || "tesseract",
        weak:
          ev.result === "exact" && rd && ev.parse.code
            ? C.keyStrength(ev.parse.code, rd).strength === "weak"
            : false,
      };
    }
    const d = A.feed(r);
    if (d.accept) accepted.push(d.key as string);
  });
  return accepted;
}

const M = (n: number) => "ASH • EN L " + n;
const run1: [number, number, number][] = [
  [85.2, 796, 34],
  [85.3, 785, 57],
  [85.5, 788, 49],
  [85.6, 795, 32],
  [85.65, 795, 51],
  [85.8, 795, 59],
  [85.9, 785, 46],
  [86.0, 795, 68],
  [86.2, 785, 25],
  [86.4, 795, 23],
  [86.5, 785, 41],
  [86.7, 795, 62],
  [86.9, 795, 52],
  [87.1, 795, 42],
  [87.2, 785, 47],
  [87.4, 795, 60],
  [87.6, 795, 36],
  [87.8, 795, 24],
  [88.0, 785, 17],
  [88.2, 785, 45],
  [88.3, 795, 44],
  [88.5, 795, 32],
  [88.7, 795, 16],
  [88.9, 795, 18],
  [89.1, 795, 24],
  [89.2, 795, 44],
  [89.25, 795, 51],
  [89.4, 785, 46],
  [89.5, 795, 66],
  [89.6, 795, 40],
];
const run1Seq = (): Seq => run1.map(([t, n, c]) => [Math.round(t * 1000), M(n), c]);

describe("S7-06 scan core port (test_core.js, verbatim)", () => {
  it.each(cases)("parse %s -> %s", (raw, want) => {
    expect(C.evaluate(raw).result).toBe(want);
  });

  describe("Acceptor replays", () => {
    it("795,795,785,795 -> one 795, no 785", () => {
      expect(
        replay([
          [0, M(795), 50],
          [150, M(795), 55],
          [300, M(785), 50],
          [450, M(795), 60],
          [600, M(795), 45],
          [750, M(785), 47],
          [900, M(795), 52],
        ])
      ).toEqual(["ASH 795"]);
    });

    it("run_1 85.2-89.6 Mandalorian -> one 795", () => {
      expect(replay(run1Seq())).toEqual(["ASH 795"]);
    });

    it("79/264 x3, 19/264 once, 79/264 -> no re-accept", () => {
      expect(
        replay([
          [0, "LAW • EN C 79/264", 45],
          [200, "LAW • EN C 79/264", 50],
          [400, "LAW • EN C 79/264", 48],
          [600, "LAW • EN C 19/264", 40],
          [800, "LAW • EN C 79/264", 47],
          [1000, "LAW • EN C 79/264", 52],
          [1200, "LAW • EN C 79/264", 49],
          [1400, "LAW • EN C 79/264", 49],
        ])
      ).toEqual(["LAW 79/264"]);
    });

    it("one garbage read between same keys -> no re-accept", () => {
      expect(
        replay([
          [0, M(795), 50],
          [200, M(795), 50],
          [400, M(795), 50],
          [600, "ASH • EN 1", 50],
          [800, M(795), 50],
          [1000, M(795), 50],
          [1200, M(795), 50],
        ])
      ).toEqual(["ASH 795"]);
    });

    it("blur skips do not re-arm", () => {
      const seq: Seq = [
        [0, M(795), 50],
        [200, M(795), 50],
        [400, M(795), 50],
        ...[...Array(30).keys()].map((i): [number, string | null, number] => [
          600 + i * 80,
          null,
          0,
        ]),
        [3100, M(795), 50],
        [3300, M(795), 50],
        [3500, M(795), 50],
      ];
      expect(replay(seq)).toEqual(["ASH 795"]);
    });

    it("card leaves 1.2 s then playset copy -> 2 accepts", () => {
      expect(
        replay([
          [0, M(795), 50],
          [200, M(795), 50],
          [400, M(795), 50],
          [700, "xx", 0],
          [1000, "yy", 0],
          [1700, "zz", 0],
          [2600, M(795), 50],
          [2800, M(795), 50],
          [3000, M(795), 50],
        ])
      ).toEqual(["ASH 795", "ASH 795"]);
    });

    it("copy back within 2 s of accept -> dup shown, not added", () => {
      expect(
        replay([
          [0, M(795), 50],
          [200, M(795), 50],
          [400, M(795), 50],
          [600, "xx", 0],
          [900, "yy", 0],
          [1500, "zz", 0],
          [1600, M(795), 50],
          [1800, M(795), 50],
          [1950, M(795), 50],
        ])
      ).toEqual(["ASH 795"]);
    });

    it("3 consecutive different valid key re-arms", () => {
      expect(
        replay([
          [0, M(795), 50],
          [200, M(795), 50],
          [400, M(795), 50],
          [600, M(356), 50],
          [800, M(356), 50],
          [1000, M(356), 50],
          [1200, M(356), 50],
        ])
      ).toEqual(["ASH 795", "ASH 356"]);
    });

    it("weak key, Tesseract conf 20-28 (< bar 30) -> not accepted", () => {
      expect(
        replay([
          [0, M(795), 20],
          [200, M(795), 25],
          [400, M(795), 28],
          [600, M(795), 22],
        ])
      ).toEqual([]);
    });

    it("weak key, Tesseract conf 33-37 (>= bar 30) -> accepted", () => {
      expect(
        replay([
          [0, M(795), 33],
          [200, M(795), 37],
          [400, M(795), 35],
        ])
      ).toEqual(["ASH 795"]);
    });

    it("mixed readers (T 37, P 92, T 35) -> accepted, attributed", () => {
      const mixed: Seq = [
        [0, M(795), 37],
        [200, M(795), 92],
        [400, M(795), 35],
      ];
      mixed.readers = { 200: "paddle" };
      expect(replay(mixed)).toEqual(["ASH 795"]);
    });

    it("Paddle conf 50 (< bar 60) -> not accepted", () => {
      const lowP: Seq = [
        [0, M(795), 50],
        [200, M(795), 50],
        [400, M(795), 50],
      ];
      lowP.readers = { 0: "paddle", 200: "paddle", 400: "paddle" };
      expect(replay(lowP)).toEqual([]);
    });

    // app configuration (v0.4 final): no re-arm on different reads; only >= 1.0 s without the accepted key
    const CONT = { rearmDiffN: Infinity };

    it("[continuous] different key x4 does not re-arm", () => {
      expect(
        replay(
          [
            [0, M(795), 50],
            [200, M(795), 50],
            [400, M(795), 50],
            [500, M(356), 50],
            [600, M(356), 50],
            [700, M(356), 50],
            [800, M(356), 50],
          ],
          CONT
        )
      ).toEqual(["ASH 795"]);
    });

    it("[continuous] 1 s without 795 then 356 -> re-arm, 356 added", () => {
      expect(
        replay(
          [
            [0, M(795), 50],
            [200, M(795), 50],
            [400, M(795), 50],
            [900, "xx", 0],
            [1300, M(356), 50],
            [1500, M(356), 50],
            [1700, M(356), 50],
          ],
          CONT
        )
      ).toEqual(["ASH 795", "ASH 356"]);
    });

    it("[continuous] run_1 Mandalorian -> one 795", () => {
      expect(replay(run1Seq(), CONT)).toEqual(["ASH 795"]);
    });

    it("[continuous] 79/264, one 19/264, 79/264 -> no re-accept", () => {
      expect(
        replay(
          [
            [0, "LAW • EN C 79/264", 45],
            [200, "LAW • EN C 79/264", 50],
            [400, "LAW • EN C 79/264", 48],
            [600, "LAW • EN C 19/264", 40],
            [800, "LAW • EN C 79/264", 47],
            [1000, "LAW • EN C 79/264", 52],
          ],
          CONT
        )
      ).toEqual(["LAW 79/264"]);
    });

    it("strong-key branch: 2 reads >= 150 ms apart accept (kept with its test)", () => {
      const A = new Acceptor();
      const a = A.feed({ t: 0, result: "exact", key: "SOR 229/252", conf: 90, weak: false });
      const b = A.feed({ t: 200, result: "exact", key: "SOR 229/252", conf: 90, weak: false });
      expect([a.accept, b.accept]).toEqual([false, true]);
      const A2 = new Acceptor();
      A2.feed({ t: 0, result: "exact", key: "SOR 229/252", conf: 90, weak: false });
      expect(
        A2.feed({ t: 100, result: "exact", key: "SOR 229/252", conf: 90, weak: false }).accept
      ).toBe(false);
    });
  });

  describe("C: number length conflict", () => {
    it("num_len_conflict ASH 1 vs pass2 795", () => {
      expect(numLenConflict({ num: 1, den: null }, "795")).toEqual({
        parsed_len: 1,
        pass2_len: 3,
        pass2_text: "795",
      });
    });
    it("no conflict ASH 795 vs pass2 795", () => {
      expect(numLenConflict({ num: 795, den: null }, "795")).toBeNull();
    });
  });

  it("key strength census runs (SOR/JTL/ASH/LAW numbers 1-300) and has weak keys", () => {
    let weak = 0;
    let strong = 0;
    for (const code of ["SOR", "JTL", "ASH", "LAW"])
      for (let n = 1; n <= 300; n++)
        for (const den of [null, C.cat.main[code]]) {
          const v = C.validateOne(code, { num: n, den, token: false });
          if (v.result === "invalid") continue;
          const k = C.keyStrength(code, { num: n, den, token: false });
          if (k.strength === "weak") weak++;
          else strong++;
        }
    expect(weak).toBeGreaterThan(0);
    // Spec 24.4: every key has a neighbour -> the strong branch is dead in practice
    expect(strong).toBe(0);
  });
});
