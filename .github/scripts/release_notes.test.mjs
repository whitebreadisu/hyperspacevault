// Tests for release_notes.mjs `gate` in both modes. Run: node --test .github/scripts/release_notes.test.mjs
// Drives the CLI through its test seams: RELEASE_NOTES_MODULE, NOTES_TODAY, NOTES_PKG_VERSION.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "release_notes.mjs");
let dir;
let mod;

const entry = (key, date, kind = "release") => ({ kind, key, version: key, date, title: `T${key}`, sections: [] });

before(() => {
  dir = mkdtempSync(join(tmpdir(), "rn-"));
  mod = join(dir, "notes.mjs");
  // newest first: 2.2 (2026-10-26), 2.1.1 (2026-10-20), 2.1 (2026-09-01)
  writeFileSync(
    mod,
    `export const RELEASE_NOTES = ${JSON.stringify([
      entry("2.2", "2026-10-26"),
      entry("2.1.1", "2026-10-20"),
      entry("2.1", "2026-09-01"),
    ])};`
  );
});
after(() => rmSync(dir, { recursive: true, force: true }));

function gate({ today, pkg = "2.2.0", args = [], env = {} }) {
  return spawnSync(process.execPath, [SCRIPT, "gate", ...args], {
    encoding: "utf-8",
    env: { ...process.env, RELEASE_NOTES_MODULE: mod, NOTES_TODAY: today, NOTES_PKG_VERSION: pkg, ...env },
  });
}

// ---- dispatch mode (same-day rule) ----
test("dispatch: dated today passes", () => {
  const r = gate({ today: "2026-10-26" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /notes-gate OK:/);
});

test("dispatch: dated yesterday fails (same-day rule)", () => {
  const r = gate({ today: "2026-10-27" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /finalize the date at promote time/);
});

test("dispatch: stale date passes with ALLOW_STALE_NOTES", () => {
  const r = gate({ today: "2026-10-27", env: { ALLOW_STALE_NOTES: "true" } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /allowed by allow_stale_notes/);
});

test("dispatch: version mismatch fails", () => {
  const r = gate({ today: "2026-10-26", pkg: "2.3.0" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /write the release notes before promoting/);
});

// ---- train mode (newer than prod-current, within 7 days) ----
test("train: newer than prod-current and 2 days old passes", () => {
  const r = gate({ today: "2026-10-28", args: ["--train", "--prod-key", "2.1.1"] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /notes-gate OK \(train\)/);
});

test("train: exactly 7 days old passes", () => {
  const r = gate({ today: "2026-11-02", args: ["--train", "--prod-key", "2.1.1"] });
  assert.equal(r.status, 0, r.stderr);
});

test("train: 8 days old fails", () => {
  const r = gate({ today: "2026-11-03", args: ["--train", "--prod-key", "2.1.1"] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /within the last 7 days/);
});

test("train: newest entry is the one prod-current shipped fails", () => {
  const r = gate({ today: "2026-10-28", args: ["--train", "--prod-key", "2.2"] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already shipped/);
});

test("train: prod key not in the list fails closed", () => {
  const r = gate({ today: "2026-10-28", args: ["--train", "--prod-key", "9.9"] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /fail closed/);
});

test("train: missing --prod-key fails closed", () => {
  const r = gate({ today: "2026-10-28", args: ["--train"] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /needs --prod-key/);
});

test("train: an entry dated in the future fails", () => {
  const r = gate({ today: "2026-10-25", args: ["--train", "--prod-key", "2.1.1"] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /in the future/);
});

test("train: ALLOW_STALE_NOTES does not relax the train", () => {
  const r = gate({ today: "2026-11-10", args: ["--train", "--prod-key", "2.1.1"], env: { ALLOW_STALE_NOTES: "true" } });
  assert.equal(r.status, 1);
});

test("train: version mismatch still fails", () => {
  const r = gate({ today: "2026-10-28", pkg: "2.3.0", args: ["--train", "--prod-key", "2.1.1"] });
  assert.equal(r.status, 1);
});

test("train: an entry dated today passes (age 0)", () => {
  const r = gate({ today: "2026-10-26", args: ["--train", "--prod-key", "2.1.1"] });
  assert.equal(r.status, 0, r.stderr);
});

test("train: an announcement as the newest entry fails", () => {
  const ann = join(dir, "ann.mjs");
  writeFileSync(
    ann,
    `export const RELEASE_NOTES = ${JSON.stringify([
      entry("a-2026-10-27", "2026-10-27", "announcement"),
      entry("2.2", "2026-10-26"),
      entry("2.1.1", "2026-10-20"),
    ])};`
  );
  const r = gate({
    today: "2026-10-28",
    args: ["--train", "--prod-key", "2.1.1"],
    env: { RELEASE_NOTES_MODULE: ann },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a release/);
});
