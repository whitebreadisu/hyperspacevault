// BL-271 Phase E: tests for docs_history.mjs. Run: node .github/scripts/docs_history.test.mjs
// Works on a temp copy of a docs_check fixture so the tracked fixtures never change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { historyState, freshBlock } from "./docs_history.mjs";
import { HISTORY_BLOCK_START, HISTORY_BLOCK_END } from "./docs_check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name) => join(here, "fixtures", "docs_check", name);
const SCRIPT = join(here, "docs_history.mjs");
const cli = (root, ...args) =>
  spawnSync(process.execPath, [SCRIPT, "--root", root, ...args], { encoding: "utf-8" });

const withCopy = (name, fn) => {
  const dir = mkdtempSync(join(tmpdir(), "docs-history-"));
  try {
    cpSync(fx(name), dir, { recursive: true });
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("state: fresh / stale / missing are detected", () => {
  assert.equal(historyState(fx("pass")).status, "fresh");
  assert.equal(historyState(fx("history_stale")).status, "stale");
  assert.equal(historyState(fx("history_missing")).status, "missing");
});

test("--check exits 0 fresh, 1 stale (with the --write hint), 1 missing", () => {
  assert.equal(cli(fx("pass"), "--check").status, 0);
  const stale = cli(fx("history_stale"), "--check");
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /STALE/);
  assert.match(stale.stdout, /docs_history\.mjs --write/);
  assert.equal(cli(fx("history_missing"), "--check").status, 1);
  assert.equal(cli(fx("pass"), "--bogus").status, 2);
});

test("--write splices the fresh block, preserves surrounding text, then --check is fresh; CRLF input ends LF", () => {
  withCopy("history_stale", (dir) => {
    const before = readFileSync(join(dir, "HISTORY.md"), "utf-8");
    writeFileSync(
      join(dir, "HISTORY.md"),
      // normalise first: on a Windows checkout the fixture is already CRLF (\r\r\n otherwise)
      before.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n") + "\r\nTail paragraph.\r\n"
    );
    const r = cli(dir, "--write");
    assert.equal(r.status, 0, r.stderr);
    const after = readFileSync(join(dir, "HISTORY.md"), "utf-8");
    assert.ok(!after.includes("\r"), "generated file is LF");
    assert.ok(after.startsWith("# HISTORY\n"));
    assert.ok(after.endsWith("Tail paragraph.\n"));
    assert.ok(after.includes(freshBlock(dir)));
    assert.equal((after.match(/generated:releases start/g) ?? []).length, 1);
    assert.equal(cli(dir, "--check").status, 0);
  });
});

test("--write refuses a HISTORY without markers (the markers are placed by hand once)", () => {
  withCopy("history_missing", (dir) => {
    const r = cli(dir, "--write");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no markers/);
    assert.match(
      r.stderr,
      new RegExp(HISTORY_BLOCK_START.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
    assert.ok(HISTORY_BLOCK_END.length > 0);
  });
});
