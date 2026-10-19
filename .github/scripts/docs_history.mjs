// BL-271 Phase E: the generated Releases block in HISTORY.md ("generate, don't maintain").
// Dependency-free (shares docs_check.mjs's parsers), Node >= 20.
//
//   node .github/scripts/docs_history.mjs --write   regenerate the block between the markers in HISTORY.md
//   node .github/scripts/docs_history.mjs --check   exit 1 when the committed block differs (same check as
//                                                   docs_check's `history-releases`; printed standalone here)
//   [--root <dir>]
//
// Source of truth: frontend/src/content/releaseNotes.ts (release entries only, newest first as the module
// orders them). By the release-notes ritual (BL-210) the newest entry is drafted BEFORE its promote and its
// date is finalised at promote time; the row mirrors the entry as committed, so the promote-time docs gate
// (`docs_check.mjs --gate`) sees HISTORY carry the version it is about to ship.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HISTORY_BLOCK_START,
  RELEASE_NOTES_PATH,
  parseReleaseEntries,
  renderReleasesBlock,
  spliceReleasesBlock,
} from "./docs_check.mjs";

export function freshBlock(root) {
  return renderReleasesBlock(
    parseReleaseEntries(readFileSync(join(root, RELEASE_NOTES_PATH), "utf-8"))
  );
}

/** {status: "fresh"|"stale"|"missing", text} — `text` is HISTORY with the fresh block spliced in (LF). */
export function historyState(root) {
  const history = readFileSync(join(root, "HISTORY.md"), "utf-8");
  const block = freshBlock(root);
  const { text, had, current } = spliceReleasesBlock(history, block);
  return { status: !had ? "missing" : current === block ? "fresh" : "stale", text, block };
}

function main(argv) {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  let mode = "check";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = resolve(argv[++i]);
    else if (a === "--write") mode = "write";
    else if (a === "--check") mode = "check";
    else {
      console.error(`unknown argument ${a}`);
      return 2;
    }
  }
  for (const rel of ["HISTORY.md", RELEASE_NOTES_PATH]) {
    if (!existsSync(join(root, rel))) {
      console.error(`docs-history: ${rel} not found under ${root}`);
      return 2;
    }
  }
  const st = historyState(root);
  if (mode === "write") {
    if (st.status === "missing") {
      console.error(
        `docs-history: HISTORY.md has no markers — add a line "${HISTORY_BLOCK_START}" and the end marker where the Releases table belongs, then re-run`
      );
      return 1;
    }
    writeFileSync(join(root, "HISTORY.md"), st.text);
    console.log(
      `docs-history: wrote the Releases block (${st.block.split("\n").length - 6} rows) into HISTORY.md`
    );
    return 0;
  }
  if (st.status === "fresh") {
    console.log("docs-history: fresh");
    return 0;
  }
  console.log(
    `docs-history: ${st.status.toUpperCase()} — HISTORY.md's Releases block ${st.status === "missing" ? "has no markers" : "differs from releaseNotes.ts"}`
  );
  console.log("Regenerate with: node .github/scripts/docs_history.mjs --write");
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
