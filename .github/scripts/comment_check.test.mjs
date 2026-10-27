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
  const { root, allowFile } = tree({ [TS]: "// BL-12\n" }, [TS]);
  assert.deepEqual(check(root, allowFile).errors, []);
});

test("allowlisted clean file fails as stale", () => {
  const { root, allowFile } = tree({ [TS]: "// no ids here\n" }, [TS]);
  const r = check(root, allowFile);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /stale allowlist entry/);
});

test("allowlisted missing file fails as stale", () => {
  const { root, allowFile } = tree({}, [TS]);
  assert.match(check(root, allowFile).errors[0], /stale allowlist entry/);
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
