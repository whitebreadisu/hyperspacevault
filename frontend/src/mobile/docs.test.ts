import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { SCREEN_VIEWED_SCREENS, VIEW_MODE_CHANGED_MODES } from "../analytics/analytics";
import { PICK_REASONS } from "./camera/scanAnalytics";
import { ADJUST_METHODS } from "./tool/commit";
import { PAD_KEYPAD_STATES } from "./tool/toolAnalytics";
import { SORT_ORDER } from "./vault/SortSheet";

// BL-252 stage 6b: documentation guards for the phone layout. The App Spec is
// the registry of record (§22 analytics, §25 mobile experience); these tests
// keep it honest as the code moves.
const SPEC = readFileSync("../specification_documents/SWU_Application_Spec.md", "utf8");

function section(startHeading: string, nextHeadingPrefix = "## "): string {
  const start = SPEC.indexOf(startHeading);
  if (start < 0) throw new Error(`no heading ${startHeading}`);
  const rest = SPEC.slice(start + startHeading.length);
  const m = new RegExp(`\\n${nextHeadingPrefix}\\d`).exec(rest);
  return startHeading + (m ? rest.slice(0, m.index) : rest);
}

describe("S6-09 App Spec §25 is one coherent as-built section", () => {
  const s25 = section("## 25. Mobile experience");

  it("has the overview and every subsection, once", () => {
    for (const h of [
      "### 25.0 Overview",
      "### 25.1 ",
      "### 25.2 ",
      "### 25.3 ",
      "### 25.4 ",
      "### 25.5 ",
      "### 25.6 ",
      "### 25.7 ",
    ]) {
      expect(s25.split(h).length - 1, h).toBe(1);
    }
  });

  // The guard's own pattern, exercised on fixture strings in the next test.
  const UNFINISHED =
    /placeholder|later slice|next slice|until (the )?[\w -]*?slice|arrives with|ships in slice|closing sweep|stage (6b|7[abc]?)\b/i;

  it("the unfinished-work pattern catches the natural phrasings (and spares normal prose)", () => {
    for (const bad of [
      "a placeholder for now",
      "comes in a later slice",
      "until slice 5",
      "until the shared-vault slice",
      "until the next slice",
      "arrives with the camera",
      "ships in slice 7",
      "the closing sweep",
      "done at stage 6b",
      "done at Stage 7",
    ])
      expect(UNFINISHED.test(bad), bad).toBe(true);
    for (const good of [
      "hint text in the field",
      "the slice of the catalogue",
      "pick one slice of the pie",
      "the camera ships with the app",
    ])
      expect(UNFINISHED.test(good), good).toBe(false);
  });

  it("carries no unfinished-work wording (placeholder / later slice / until ... slice / stage 6b)", () => {
    const hits = s25
      .split("\n")
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => UNFINISHED.test(line))
      .map(({ line, i }) => `${i}: ${line.slice(0, 80)}`);
    expect(hits).toEqual([]);
  });
});

describe("S6-10 App Spec §22 lists every phone event and property", () => {
  const s22 = section("## 22. Product Analytics");
  const analyticsSrc = readFileSync("src/analytics/analytics.ts", "utf8");

  // The event registry table: first column's backticked names.
  const tableEvents = new Set<string>();
  for (const line of s22.split("\n")) {
    if (!line.startsWith("|")) continue;
    const first = line.split("|")[1] ?? "";
    for (const m of first.matchAll(/`([a-z_]+)`/g)) tableEvents.add(m[1]);
  }

  it("every AnalyticsEvent union member is a row of the event registry", () => {
    const block = /export type AnalyticsEvent =([\s\S]*?);/.exec(analyticsSrc);
    expect(block, "AnalyticsEvent union found").not.toBeNull();
    const members = [...block![1].matchAll(/\|\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(members.length).toBeGreaterThan(20);
    const missing = members.filter((e) => !tableEvents.has(e));
    expect(missing).toEqual([]);
  });

  /** Property names passed to capture() / capturePhone() under src/mobile. */
  function emittedProperties(): { events: Set<string>; props: Set<string> } {
    const events = new Set<string>();
    const props = new Set<string>();
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk("src/mobile");

    const collect = (node: ts.Node) => {
      if (ts.isObjectLiteralExpression(node)) {
        for (const prop of node.properties) {
          if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
            if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
              props.add(prop.name.text);
          } else if (ts.isSpreadAssignment(prop)) {
            collect(prop.expression);
          }
        }
      } else if (ts.isConditionalExpression(node)) {
        collect(node.whenTrue);
        collect(node.whenFalse);
      } else if (ts.isParenthesizedExpression(node)) {
        collect(node.expression);
      }
    };

    for (const f of files) {
      const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          (node.expression.text === "capture" || node.expression.text === "capturePhone")
        ) {
          const [first, second] = node.arguments;
          if (first && ts.isStringLiteral(first)) events.add(first.text);
          if (second) collect(second);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    return { events, props };
  }

  it("every event emitted under src/mobile is a registry row", () => {
    const { events } = emittedProperties();
    expect(events.size).toBeGreaterThan(15);
    expect([...events].filter((e) => !tableEvents.has(e))).toEqual([]);
  });

  it("every property name emitted under src/mobile appears in the registry", () => {
    const { props } = emittedProperties();
    // The parser found the real call sites (a sample of known property names).
    for (const known of ["layout", "screen", "reader", "fast_add", "surface", "pending_entries"]) {
      expect(props.has(known), `parsed ${known}`).toBe(true);
    }
    // Documented as a backticked span that names the property ("`reader: paddle ...`", "`finish`").
    const spans = [...s22.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const missing = [...props].filter(
      (p) => !spans.some((sp) => new RegExp(`(^|[^a-z_])${p}([^a-z_]|$)`).test(sp))
    );
    expect(missing).toEqual([]);
  });

  it("the phone-only enum values are registered, from the exported const arrays", () => {
    const row = (event: string) => {
      const line = s22.split("\n").find((l) => l.startsWith("| `" + event + "`"));
      expect(line, "registry row for " + event).toBeDefined();
      return line as string;
    };
    const has = (line: string, v: string) =>
      new RegExp("(^|[^A-Za-z0-9_])" + v + "([^A-Za-z0-9_]|$)").test(line);
    const check = (event: string, values: readonly string[]) => {
      expect(values.length, event + " values").toBeGreaterThan(0);
      const r = row(event);
      expect(
        values.filter((v) => !has(r, v)),
        event + " values missing from its §22 row"
      ).toEqual([]);
    };
    check("screen_viewed", SCREEN_VIEWED_SCREENS);
    check("view_mode_changed", VIEW_MODE_CHANGED_MODES);
    check("scan_pick_shown", PICK_REASONS);
    check("add_cards_committed", ADJUST_METHODS);
    check("pad_keypad_toggled", PAD_KEYPAD_STATES);
    // No exported array for these: listed beside the test.
    check("scan_decision", ["add", "details", "wrong_card", "pick"]);
    check("scan_recognised", ["paddle", "tesseract", "weak", "strong"]);
    // filter_applied.field: FilterField is a type, so its names are listed here.
    check("filter_applied", [
      "set",
      "rarity",
      "finish",
      "type",
      "arena",
      "keyword",
      "trait",
      "cost",
      "power",
      "hp",
      "aspect",
      "aspect_mode",
      "completion",
      "owned",
      "no_inventory",
      "over_cap",
    ]);
    // sort_changed.column: the phone's sorts (review FR5 S2). `owned` is the
    // phone-only value; `set` and `variants` are named as never sent.
    check("sort_changed", SORT_ORDER);
    expect(SORT_ORDER as string[]).toContain("owned");
    check("sort_changed", ["set", "variants", "asc", "desc"]);
    expect(row("sort_changed")).toMatch(/phone-only value `owned`/);
    expect(row("sort_changed")).toMatch(/never sends `set` or `variants`/);
    // Values of events without a single exported array (kept from the hand-picked list).
    for (const v of ["swipe", "detail"]) expect(s22, v).toContain(v);
  });
});
