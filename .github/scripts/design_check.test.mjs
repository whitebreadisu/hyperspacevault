// Tests for design_check.mjs. Run: node --test .github/scripts/design_check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  check,
  parseCss,
  polygons,
  classNameClasses,
  buttonsInTsx,
  lowerBaseline,
  normHex,
  compareBaselines,
  expandIs,
} from "./design_check.mjs";

const ROOT_CSS =
  ":root {\n  --bg-surface: #0f1528;\n  --color-text: #e6e6e6;\n}\n";

function tree(files, { allow = [], baseline = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "dc-"));
  const all = { "frontend/src/index.css": ROOT_CSS, ...files };
  for (const [rel, body] of Object.entries(all)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  const allowFile = join(root, "design_check.allow");
  const baselineFile = join(root, "design_check.baseline");
  writeFileSync(allowFile, allow.join("\n") + "\n");
  writeFileSync(baselineFile, baseline.join("\n") + "\n");
  return {
    root,
    allowFile,
    baselineFile,
    run: () => check(root, allowFile, baselineFile),
  };
}

const CSS = "frontend/src/a.css";
const TSX = "frontend/src/A.tsx";
const BOTH_CUTS =
  "polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)";

// ---------- parser ----------

test("parser: comments, strings, url() with ; and nested @media", () => {
  const rules = parseCss(
    '/* a { b: c } */\n.x { background: url("data:image/svg+xml;utf8,<svg/>"); color: red; }\n@media (max-width: 9px) {\n  .y { clip-path: none; }\n}\n',
  );
  assert.deepEqual(
    rules.map((r) => [r.selector, r.line, r.decls.map((d) => d.prop)]),
    [
      [".x", 2, ["background", "color"]],
      [".y", 4, ["clip-path"]],
    ],
  );
});

test("polygons normalise whitespace and zero units", () => {
  assert.deepEqual(polygons("polygon(\n  0px   0%,\n 100% 0 , 0 100%)"), [
    ["0 0", "100% 0", "0 100%"],
  ]);
});

// ---------- clip ----------

test("clip: a single-corner polygon fails with file:line and selector", () => {
  const t = tree({
    [CSS]:
      ".tile {\n  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%);\n}\n",
  });
  const r = t.run();
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^frontend\/src\/a\.css:2: \[clip\] \.tile: /);
});

test("clip: multi-line, 0px-unit variant fails too", () => {
  const t = tree({
    [CSS]:
      ".tile::before {\n  clip-path: polygon(\n    0px 0px,\n    100% 0,\n    0 100%\n  );\n}\n",
  });
  assert.match(t.run().errors[0], /\[clip\] \.tile::before/);
});

test("clip: the two-corner steel-ring polygon passes", () => {
  const t = tree({ [CSS]: `.tile { clip-path: ${BOTH_CUTS}; }\n` });
  assert.deepEqual(t.run().errors, []);
});

test("clip: an allow-listed file + selector passes; a stale entry fails", () => {
  const css = ".tab { clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%); }\n";
  const ok = tree(
    { [CSS]: css },
    { allow: [`clip | ${CSS} | .tab | edge-attached tab`] },
  );
  assert.deepEqual(ok.run().errors, []);
  const stale = tree(
    { [CSS]: `.tab { clip-path: ${BOTH_CUTS}; }\n` },
    { allow: [`clip | ${CSS} | .tab | edge-attached tab`] },
  );
  assert.match(stale.run().errors[0], /stale entry/);
});

test("clip: the same selector in another file is not covered by the allow-list", () => {
  const css = ".tab { clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%); }\n";
  const t = tree(
    { "frontend/src/b.css": css },
    { allow: [`clip | ${CSS} | .tab | edge-attached tab`] },
  );
  const errs = t.run().errors;
  assert.ok(errs.some((e) => e.startsWith("frontend/src/b.css:1: [clip]")));
});

test("allow-list: a line without a reason is rejected", () => {
  const t = tree({ [CSS]: "" }, { allow: [`clip | ${CSS} | .tab |`] });
  assert.throws(() => t.run(), /bad line/);
});

// ---------- ring ----------

test("ring: a steel border on a rule with no clip-path fails", () => {
  const t = tree({
    [CSS]: ".tile {\n  border: 1px solid rgba(211, 211, 212, 0.4);\n}\n",
  });
  assert.match(
    t.run().errors[0],
    /^frontend\/src\/a\.css:2: \[ring\] \.tile: /,
  );
});

test("ring: steel via a custom property and outline fail too", () => {
  const t = tree({
    [CSS]:
      ".p { --ring: rgba(211,211,212,0.3); }\n.a { border: 2px solid var(--ring); }\n.b { outline: 1px solid rgba(211 211 212 / 0.5); }\n",
  });
  const errs = t.run().errors;
  assert.equal(errs.length, 2);
  assert.ok(errs[0].includes("[ring] .a") && errs[1].includes("[ring] .b"));
});

test("ring: border-color resolves width and style from the base rule of a :hover", () => {
  const t = tree({
    [CSS]:
      ".a { border: 1px solid transparent; }\n.a:hover { border-color: rgba(211, 211, 212, 0.5); }\n",
  });
  assert.match(t.run().errors[0], /\[ring\] \.a:hover/);
});

test("ring: a steel border on a clip-path rule fails (the border cannot follow the cut)", () => {
  const t = tree({
    [CSS]: `.clipped {\n  border: 1px solid rgba(211, 211, 212, 0.3);\n  clip-path: ${BOTH_CUTS};\n}\n.b { border: 1px solid #D3D3D4; }\n`,
  });
  const errs = t.run().errors;
  assert.equal(errs.length, 2);
  assert.match(errs[0], /^frontend\/src\/a\.css:2: \[ring\] \.clipped: /);
  assert.match(errs[1], /\[ring\] \.b: /);
});

test("ring: separators, sub-1px, no style and other colours pass", () => {
  const t = tree({
    [CSS]: [
      ".sep { border-top: 1px solid rgba(211, 211, 212, 0.3); border-bottom: 1px solid rgba(211, 211, 212, 0.3); }",
      ".hair { border: 0.5px solid rgba(211, 211, 212, 0.3); }",
      ".nostyle { border: 1px rgba(211, 211, 212, 0.3); }",
      ".blue { border: 1px solid var(--color-border); }",
      ".unknown { border-color: rgba(211, 211, 212, 0.3); }",
      ".bottomonly { border-width: 0 0 1px; border-style: solid; border-color: rgba(211, 211, 212, 0.3); }",
    ].join("\n"),
  });
  assert.deepEqual(t.run().errors, []);
});

test("ring: an allow-listed small control passes", () => {
  const t = tree(
    {
      [CSS]:
        ".m-app .dot { border: 1.5px solid rgba(211, 211, 212, 0.4); border-radius: 50%; }\n",
    },
    { allow: [`ring | ${CSS} | .m-app .dot | radio dot`] },
  );
  assert.deepEqual(t.run().errors, []);
});

// ---------- hex ratchet ----------

test("hex: a token-valued literal in an unlisted file fails, naming the token", () => {
  const t = tree({
    [CSS]: ".a { color: #E6E6E6; }\n.b { background: #0F1528; }\n",
  });
  const errs = t.run().errors;
  assert.equal(errs.length, 2);
  assert.match(errs[0], /:1: \[hex\] #E6E6E6 is var\(--color-text\)/);
});

test("hex: 3-digit shorthand, selectors, url() and non-token hex are handled", () => {
  assert.equal(normHex("#FFF"), "#ffffff");
  const t = tree({
    [CSS]: "#e6e6e6 .a { color: #123456; background: url(#e6e6e6); }\n",
  });
  assert.deepEqual(t.run().errors, []);
});

test("hex: the :root definitions and @property initial values are not counted", () => {
  const t = tree({
    "frontend/src/index.css":
      ROOT_CSS +
      '@property --color-text { syntax: "<color>"; initial-value: #e6e6e6; }\n.x { --color-text: #e6e6e6; }\n',
  });
  assert.deepEqual(t.run().errors, []);
});

test("hex ratchet: at baseline passes, above fails, below fails with how to lower", () => {
  const css2 = ".a { color: #e6e6e6; }\n.b { color: #e6e6e6; }\n";
  assert.deepEqual(
    tree({ [CSS]: css2 }, { baseline: [`${CSS} 2`] }).run().errors,
    [],
  );
  const up = tree({ [CSS]: css2 }, { baseline: [`${CSS} 1`] }).run().errors;
  assert.equal(up.length, 1);
  assert.match(
    up[0],
    /2 token-valued hex literal\(s\), baseline 1 - the count may only fall/,
  );
  const down = tree(
    { [CSS]: ".a { color: #e6e6e6; }\n" },
    { baseline: [`${CSS} 2`] },
  ).run().errors;
  assert.match(
    down[0],
    /lower the baseline: set this entry in design_check\.baseline to 1/,
  );
  assert.match(down[0], /--lower-baseline/);
});

test("hex ratchet: a baseline entry for a clean file fails as stale", () => {
  const errs = tree(
    { [CSS]: ".a { color: var(--color-text); }\n" },
    { baseline: [`${CSS} 1`] },
  ).run().errors;
  assert.match(errs[0], /stale baseline entry/);
});

test("hex ratchet: --lower-baseline lowers and drops, never raises", () => {
  const t = tree(
    {
      [CSS]: ".a { color: #e6e6e6; }\n",
      "frontend/src/b.css": ".b { color: #e6e6e6; color: #e6e6e6; }\n",
      "frontend/src/c.css": "",
    },
    { baseline: [`${CSS} 3`, "frontend/src/b.css 1", "frontend/src/c.css 2"] },
  );
  lowerBaseline(t.root, t.baselineFile);
  const body = readFileSync(t.baselineFile, "utf-8");
  assert.match(body, /^frontend\/src\/a\.css 1$/m);
  assert.match(body, /^frontend\/src\/b\.css 1$/m); // not raised to 2
  assert.doesNotMatch(body, /c\.css/);
  assert.equal(t.run().errors.length, 1); // b.css still above its baseline
});

// ---------- font ----------

test("font: className extraction reads literals, template statics and ternaries", () => {
  assert.deepEqual(classNameClasses('<button className="a b"'), ["a", "b"]);
  assert.deepEqual(classNameClasses("<button className={`x x--${s} y`}"), [
    "x",
    "y",
  ]);
  assert.deepEqual(
    classNameClasses('<button className={on ? "p p--on" : "p"}'),
    ["p", "p--on"],
  );
  assert.deepEqual(classNameClasses("<button className={styles.q}"), []);
  assert.deepEqual(
    buttonsInTsx(
      '<div>\n<button type="button" onClick={() => a > b} className="z">x</button>',
    ).map((b) => [b.line, b.classes]),
    [[2, ["z"]]],
  );
});

test("font: a button class with font-size and no family fails at the CSS rule", () => {
  const t = tree({
    [CSS]: ".close { font-size: 20px; }\n",
    [TSX]: 'export const A = () => <button className="close">x</button>;\n',
  });
  const errs = t.run().errors;
  assert.equal(errs.length, 1);
  assert.match(
    errs[0],
    /^frontend\/src\/a\.css:1: \[font\] close: .*frontend\/src\/A\.tsx:1/,
  );
});

test("font: family on any of the button's classes, font: inherit, or no font-size passes", () => {
  const t = tree({
    [CSS]:
      ".a { font-size: 12px; }\n.a-mod { font-family: var(--font-ui); }\n.b { font: inherit; font-size: 14px; }\n.c { color: red; }\n",
    [TSX]:
      '<button className="a a-mod" />;\n<button className="b" />;\n<button className="c" />;\n<span className="a" />;\n',
  });
  assert.deepEqual(t.run().errors, []);
});

test("font: a global button reset covers everything; the .m-app reset covers mobile only", () => {
  const sized = ".close { font-size: 20px; }\n";
  const btn = '<button className="close" />;\n';
  const global = tree({
    [CSS]: sized + "button { font: inherit; }\n",
    [TSX]: btn,
  });
  assert.deepEqual(global.run().errors, []);
  const scoped = tree({
    [CSS]: sized + ".m-app button { font: inherit; }\n",
    "frontend/src/mobile/M.tsx": btn,
    [TSX]: btn,
  });
  const errs = scoped.run().errors;
  assert.equal(errs.length, 1);
  assert.match(errs[0], /frontend\/src\/A\.tsx/);
});

test("font: an .m-app-scoped font-size rule is ignored for a desktop button", () => {
  const t = tree({
    [CSS]:
      ".m-app button { font: inherit; }\n.m-app .close { font-size: 20px; }\n",
    [TSX]: '<button className="close" />;\n',
  });
  assert.deepEqual(t.run().errors, []);
});

test("font: an allow-listed class passes; test files are not scanned", () => {
  const t = tree(
    {
      [CSS]: ".close { font-size: 20px; }\n.other { font-size: 20px; }\n",
      [TSX]: '<button className="close" />;\n',
      "frontend/src/A.test.tsx": '<button className="other" />',
    },
    { allow: [`font | ${CSS} | close | glyph-only close button`] },
  );
  assert.deepEqual(t.run().errors, []);
});

// ---------- review fold-ins: clip both corners ----------

test("clip: a top-left-only cut (bottom-right square) fails too", () => {
  const t = tree({
    [CSS]:
      ".x { clip-path: polygon(8px 0, 100% 0, 100% 100%, 0 100%, 0 8px); }\n",
  });
  const errs = t.run().errors;
  assert.equal(errs.length, 1);
  assert.match(errs[0], /\[clip\] \.x: .*bottom-right corner uncut/);
});

test("clip: a bottom-attached sheet (both top corners cut) is flagged until allow-listed", () => {
  const css =
    ".m-app .m-sheet { clip-path: polygon(18px 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 0 100%, 0 18px); }\n";
  assert.match(
    tree({ [CSS]: css }).run().errors[0],
    /bottom-right corner uncut/,
  );
  const ok = tree(
    { [CSS]: css },
    {
      allow: [
        `clip | ${CSS} | .m-app .m-sheet | bottom sheet, flat bottom on the screen edge`,
      ],
    },
  );
  assert.deepEqual(ok.run().errors, []);
});

test("clip: a full rectangle names both corners; :is() and nested @media are still seen", () => {
  const t = tree({
    [CSS]:
      ":is(.a, .b) .x { clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%); }\n.y { color: red; @media (min-width: 1px) { clip-path: polygon(0 0, 100% 0, 100% 100%); } }\n",
  });
  const errs = t.run().errors;
  assert.equal(errs.length, 2);
  assert.match(errs[0], /top-left and bottom-right corners uncut/);
});

// ---------- review fold-ins: font conditions ----------

const BTN_B = '<button className="b">x</button>;\n';

test("font: a family only under :hover, an ancestor, or .b.c (c not on the button) does not cover .b", () => {
  for (const extra of [
    ".b:hover { font-family: x; }",
    ".other .b { font-family: x; }",
    ".b.c { font-family: x; }",
    "@media (min-width: 1px) { .b { font-family: x; } }",
  ]) {
    const errs = tree({
      [CSS]: `.b { font-size: 12px; }\n${extra}\n`,
      [TSX]: BTN_B,
    }).run().errors;
    assert.equal(errs.length, 1, extra);
    assert.match(errs[0], /\[font\] b: /, extra);
  }
});

test("font: .b.c covers a button carrying both; the same ancestor context covers its size", () => {
  const t = tree({
    [CSS]:
      ".b { font-size: 12px; }\n.b.c { font-family: x; }\n.p .d { font-size: 12px; }\n.p .d { font-family: x; }\n",
    [TSX]: '<button className="b c" />;\n<button className="d" />;\n',
  });
  assert.deepEqual(t.run().errors, []);
});

test("font: button:focus-visible, button[disabled] and @media-wrapped button rules are not resets", () => {
  for (const reset of [
    "button:focus-visible { font-family: x; }",
    "button[disabled] { font: inherit; }",
    "@media print { button { font: inherit; } }",
  ]) {
    const errs = tree({
      [CSS]: `.b { font-size: 12px; }\n${reset}\n`,
      [TSX]: BTN_B,
    }).run().errors;
    assert.equal(errs.length, 1, reset);
  }
});

test("font: an .m-app button reset does not cover a desktop button", () => {
  const errs = tree({
    [CSS]: ".b { font-size: 12px; }\n.m-app button { font: inherit; }\n",
    [TSX]: BTN_B,
  }).run().errors;
  assert.equal(errs.length, 1);
});

test("font: an :is(.a, .b) font-size rule is checked per argument", () => {
  assert.deepEqual(expandIs(":is(.a, .b) > .c"), [".a > .c", ".b > .c"]);
  const errs = tree({
    [CSS]: ":is(.a, .b) { font-size: 20px; }\n",
    [TSX]: BTN_B,
  }).run().errors;
  assert.equal(errs.length, 1);
  assert.match(errs[0], /\[font\] b: /);
});

test("font: commented-out JSX buttons are not scanned", () => {
  const t = tree({
    [CSS]: ".b { font-size: 12px; }\n",
    [TSX]:
      '{/* <button className="b">x</button> */}\n// <button className="b" />\n/*\n<button className="b" />\n*/\n',
  });
  assert.deepEqual(t.run().errors, []);
});

// ---------- review fold-ins: hex strings, baseline vs base branch ----------

test("hex: a quoted string (content) is not a colour", () => {
  const t = tree({
    [CSS]: ".a::before { content: \"#e6e6e6\"; }\n.b { content: '#e6e6e6'; }\n",
  });
  assert.deepEqual(t.run().errors, []);
});

test("compareBaselines: a raised count or an added file fails; a lowered or removed one passes", () => {
  const base = new Map([
    ["a.css", 3],
    ["b.css", 1],
    ["gone.css", 2],
  ]);
  const head = new Map([
    ["a.css", 4],
    ["b.css", 0],
    ["new.css", 1],
  ]);
  const errs = compareBaselines(base, head);
  assert.equal(errs.length, 2);
  assert.match(errs[0], /^a\.css: .*raised from 3 to 4/);
  assert.match(errs[1], /^new\.css: .*added/);
  assert.deepEqual(compareBaselines(base, new Map([["a.css", 3]])), []);
});

test("compareBaselines: no baseline on the base branch (first introduction) compares nothing", () => {
  assert.deepEqual(compareBaselines(null, new Map([["a.css", 9]])), []);
});
