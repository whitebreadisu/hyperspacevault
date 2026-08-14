// BL-210: promote-time release-notes tooling. Two modes over the same
// source of truth (frontend/src/content/releaseNotes.ts, imported directly
// via Node's TypeScript type-stripping -- the module is pure data with no
// imports, exactly the shape stripping supports; run with
// `node --experimental-strip-types`, a no-op where stripping is default):
//
//   gate               exit 1 unless the NEWEST entry matches the version
//                      being promoted (frontend/package.json, trailing-.0
//                      normalized: 1.4.0 -> "1.4", 1.3.1 -> "1.3.1") AND
//                      carries today's America/Chicago date (the
//                      release-notes ritual finalizes the date at promote
//                      time -- Central is the app's user-facing timezone).
//                      ALLOW_STALE_NOTES=true skips ONLY the date check:
//                      the documented escape hatch for rollbacks and
//                      re-promotes of an already-shipped version, where the
//                      entry's date is legitimately in the past.
//
//   markdown [key]     render the entry with `key` (default: newest) as
//                      GitHub-Release markdown on stdout.
//
// This runs inside promote-prod.yml AT THE PROMOTED SHA (the workflow
// checks out the promoted commit before any step runs), so the gate always
// judges the notes that would actually ship, never main's tip.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const { RELEASE_NOTES } = await import(
  new URL("../../frontend/src/content/releaseNotes.ts", import.meta.url)
);

function normalizeVersion(pkgVersion) {
  return pkgVersion.replace(/\.0$/, "");
}

function centralToday() {
  // en-CA formats as YYYY-MM-DD, matching the entries' date strings.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
  }).format(new Date());
}

function entryToMarkdown(entry) {
  const lines = [`# v${entry.version} — ${entry.title}`, "", `_${entry.date}_`, ""];
  for (const section of entry.sections) {
    if (section.heading) {
      lines.push(`## ${section.heading}`, "");
    }
    for (const item of section.items) {
      lines.push(`**${item.title}**`, "", item.body, "");
    }
  }
  lines.push(
    "---",
    "",
    "_These notes also live in the app: the version number in the corner opens them anytime._"
  );
  return lines.join("\n");
}

const mode = process.argv[2];
const newest = RELEASE_NOTES[0];

if (mode === "gate") {
  const pkg = JSON.parse(
    readFileSync(join(repoRoot, "frontend", "package.json"), "utf-8")
  );
  const expected = normalizeVersion(pkg.version);
  const failures = [];

  if (newest.kind !== "release") {
    failures.push(
      `newest releaseNotes.ts entry is a "${newest.kind}", not a release`
    );
  } else if (newest.key !== expected) {
    failures.push(
      `newest releaseNotes.ts entry is "${newest.key}" but frontend/package.json says ${pkg.version} (expects entry "${expected}") — write the release notes before promoting`
    );
  }

  const today = centralToday();
  if (newest.date !== today) {
    if (process.env.ALLOW_STALE_NOTES === "true") {
      console.log(
        `notes-gate: date ${newest.date} != today ${today} — allowed by allow_stale_notes (rollback/re-promote path)`
      );
    } else {
      failures.push(
        `newest entry's date is ${newest.date} but today (America/Chicago) is ${today} — finalize the date at promote time per the release-notes ritual, or dispatch with allow_stale_notes for a rollback/re-promote`
      );
    }
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(`notes-gate FAIL: ${f}`);
    process.exit(1);
  }
  console.log(
    `notes-gate OK: v${newest.key} "${newest.title}" dated ${newest.date}`
  );
} else if (mode === "markdown") {
  const key = process.argv[3];
  const entry = key
    ? RELEASE_NOTES.find((e) => e.key === key)
    : newest;
  if (!entry) {
    console.error(`no release-notes entry with key "${key}"`);
    process.exit(1);
  }
  process.stdout.write(entryToMarkdown(entry) + "\n");
} else {
  console.error("usage: release_notes.mjs gate|markdown [key]");
  process.exit(1);
}
