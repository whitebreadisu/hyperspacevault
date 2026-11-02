// BL-279 W2-16: tests for comment_check.mjs. Run: node --test .github/scripts/comment_check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { check, commentHits } from "./comment_check.mjs";

function tree(files, allow = []) {
  const root = mkdtempSync(join(tmpdir(), "cc-"));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  const allowFile = join(root, "comment_check.allow");
  writeFileSync(allowFile, allow.join("\n") + "\n");
  return { root, allowFile };
}

const TS = "frontend/src/a.ts";

test("flagged TS file not allowlisted fails with file:line", () => {
  const { root, allowFile } = tree({ [TS]: "const x = 1;\n// fixed in BL-12\n" });
  const r = check(root, allowFile);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^frontend\/src\/a\.ts:2: /);
});

test("the same file allowlisted passes", () => {
  const { root, allowFile } = tree({ [TS]: "// BL-12\n" }, [`${TS} 1`]);
  assert.deepEqual(check(root, allowFile).errors, []);
});

test("allowlisted clean file fails as stale", () => {
  const { root, allowFile } = tree({ [TS]: "// no ids here\n" }, [`${TS} 1`]);
  const r = check(root, allowFile);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /stale baseline entry/);
});

test("allowlisted missing file fails as stale", () => {
  const { root, allowFile } = tree({}, [`${TS} 1`]);
  assert.match(check(root, allowFile).errors[0], /stale baseline entry/);
});

test("BL-id in a string literal is not flagged", () => {
  const src = "const a = \"see BL-12\";\nconst b = 'BL-13';\nconst c = `BL-14\nBL-15`;\n";
  assert.deepEqual(commentHits(src, false), []);
});

test("block comment and JSDoc are flagged, on the right line", () => {
  const hits = commentHits("/**\n * Why: BL-7\n */\nconst x = 1; /* BL-8 */\n", false);
  assert.deepEqual(
    hits.map((h) => h.line),
    [2, 4]
  );
});

test("a comment after a string on the same line is flagged", () => {
  assert.equal(commentHits('const a = "x"; // BL-9\n', false).length, 1);
});

test("Python hash comment and docstring are flagged; string is not", () => {
  const src = 'x = "BL-1"\ny = 2  # BL-2\ndef f():\n    """Doc.\n\n    BL-3 here\n    """\n';
  assert.deepEqual(
    commentHits(src, true).map((h) => h.line),
    [2, 6]
  );
});

test("Python docstring hit in a file fails the check", () => {
  const { root, allowFile } = tree({ "backend/app/m.py": '"""Module. BL-5"""\n' });
  assert.match(check(root, allowFile).errors[0], /^backend\/app\/m\.py:1: /);
});

test("test files and test directories are skipped", () => {
  const { root, allowFile } = tree({
    "frontend/src/a.test.ts": "// BL-1\n",
    "frontend/src/b.spec.tsx": "// BL-1\n",
    "frontend/src/__tests__/c.ts": "// BL-1\n",
    "frontend/src/vendor/d.js": "// BL-1\n",
    "backend/app/tests/test_e.py": "# BL-1\n",
    "frontend/src/test/setup.ts": "// BL-1\n",
  });
  assert.deepEqual(check(root, allowFile).errors, []);
});

// ADR-0020 amendment 2026-11-01: the allowlist is a per-file count baseline.
// Dispositions: "the same file allowlisted passes", "allowlisted clean file fails as stale" and
// "allowlisted missing file fails as stale" are PORTED to the "path count" format; the rest unchanged.
test("count increase over the baseline fails", () => {
  const { root, allowFile } = tree({ [TS]: "// BL-1\n// BL-2\n" }, [`${TS} 1`]);
  const r = check(root, allowFile);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /baseline 1 - the count may only go down/);
});

test("count equal to the baseline passes", () => {
  const { root, allowFile } = tree({ [TS]: "// BL-1\n// BL-2\n" }, [`${TS} 2`]);
  assert.deepEqual(check(root, allowFile).errors, []);
});

test("count below the baseline fails with an update-the-baseline message", () => {
  const { root, allowFile } = tree({ [TS]: "// BL-1\n" }, [`${TS}\t3`]);
  const r = check(root, allowFile);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /update the baseline: lower this entry in comment_check\.allow to 1/);
});

test("a new unlisted file fails while a listed one stays within baseline", () => {
  const { root, allowFile } = tree(
    { [TS]: "// BL-1\n", "frontend/src/b.ts": "// BL-2\n" },
    [`${TS} 1`]
  );
  const r = check(root, allowFile);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^frontend\/src\/b\.ts:1: /);
});

test("frontend/src/content/ is exempt from the scan", () => {
  const { root, allowFile } = tree({ "frontend/src/content/releaseNotes.ts": "// BL-1\n" });
  const r = check(root, allowFile);
  assert.deepEqual(r.errors, []);
  assert.equal(r.files, 0);
});

test("a malformed baseline line throws", () => {
  const { root, allowFile } = tree({ [TS]: "// BL-1\n" }, [TS]);
  assert.throws(() => check(root, allowFile), /bad line/);
});

// Issue / PR number rule (BL-316): the same comment-only scope as the BL-id rule.
test("issue and PR number forms in comments are flagged", () => {
  const forms = [
    "// fixed in #123",
    "// (#360)",
    "// PR #45",
    "// PR 45",
    "// see issue 123",
    "// issue #7",
    "// pull request 88",
    "// someowner/somerepo#12",
    "/* regression (#4821) */",
    "// fixes #9",
    "// Resolves: #12",
    "// landed in #77",
    "// from #301",
    "// by #45",
    "// since #1200",
    "// after #88",
    "// cf. #19",
    "// GH-123 tracks this",
    "// resolved via #1500",
    "// closes #12",
    "// see issue 7",
    "// issues 123 and 456",
    "// https://github.com/someowner/somerepo/issues/123",
    "// https://github.com/someowner/somerepo/pull/45",
    "// fixes #123: background refresh",
  ];
  for (const f of forms) assert.equal(commentHits(f + "\n", false).length, 1, f);
});

test("Python comment and docstring issue numbers are flagged", () => {
  assert.equal(commentHits("x = 1  # see #123\n", true).length, 1);
  assert.equal(commentHits("# (#123) first\n", true).length, 1);
  assert.equal(commentHits("#123 marker only\n", true).length, 0);
  assert.equal(commentHits('def f():\n    """Done in PR #45."""\n', true).length, 1);
});

test("hex colours, headings, shebangs, regions and anchors are not flagged", () => {
  const ok = [
    "// colour #fff for the card",
    "// border #1a2b3c",
    "// #abc123 swatch",
    "// background #333 on dark",
    "// background #123456 on dark",
    "// see docs/page.md#12-section",
    "// &#39; entity",
    "// #region helpers",
    "// #section anchor",
    "// ## 2 heading text",
    "// card numbers: SEC #1 Palpatine vs SECP #1, leader #4 Grand Moff Tarkin",
    "// label \"Foil - #123\" in the popup",
    "// (#fff) and (#abc123)",
    "// (#333) is the background colour",
    "// This issues 5 Core queries",
    "// issue tracker (no number)",
    "// step 3 of 5, pull 3 rows",
  ];
  for (const f of ok) assert.deepEqual(commentHits(f + "\n", false), [], f);
  const py = [
    "#!/usr/bin/env python\n",
    "# 123 is the count\n",
    "# region helpers\n",
    "## 2. Heading\n",
    "x = 1  # colour #fff\n",
  ];
  for (const f of py) assert.deepEqual(commentHits(f, true), [], f);
});

test("issue numbers in strings and test files are not flagged", () => {
  assert.deepEqual(commentHits('const a = "PR #45"; const b = `#123`;\n', false), []);
  const { root, allowFile } = tree({ "frontend/src/a.test.ts": "// PR #123\n" });
  assert.deepEqual(check(root, allowFile).errors, []);
  const prod = tree({ "frontend/src/a.ts": "// PR #123\n" });
  assert.equal(check(prod.root, prod.allowFile).errors.length, 1);
});

test("an issue-number comment fails the check with file:line", () => {
  const { root, allowFile } = tree({ [TS]: "const x = 1;\n// per #360\n" });
  const r = check(root, allowFile);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^frontend\/src\/a\.ts:2: /);
});
