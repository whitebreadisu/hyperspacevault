// BL-279 W2-16 (decision D4): comments describe the present, not history. Fails on a
// BL-<n> id inside a comment in non-test source (frontend/src, backend/app) unless the
// file is on the allowlist; fails on a stale allowlist entry so the list only shrinks.
//
// Usage: node .github/scripts/comment_check.mjs [--root <dir>] [--allow <file>] [--seed]
//   --seed   (re)write the allowlist from the tree as it stands, then exit 0.
//
// Tokenizer (deliberately simple, dependency-free):
//   JS/TS: // to EOL, /* ... */ (incl. JSDoc); '...' and "..." strings end at EOL;
//          `...` strings span lines (no ${} nesting).
//   Python: # to EOL; ' and " strings end at EOL; triple-quoted strings count as
//           comments (docstrings), so a BL-id in any triple-quoted string is flagged.
// Not handled (accepted false positives/negatives -> allowlist the file): regex
// literals containing quotes or //, `//` or quotes inside JSX text, template-literal
// ${} nesting, Python string prefixes with unusual escapes.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, sep, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCAN_DIRS = ["frontend/src", "backend/app"];
const SKIP_DIRS = new Set([
  "__tests__",
  "tests",
  "test",
  "e2e",
  "vendor",
  "node_modules",
  "__pycache__",
]);
const JS_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const PY_EXT = /\.py$/;
const SKIP_FILE = /\.(test|spec)\./;
const BL = /\bBL-\d+\b/;

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, out);
    } else if ((JS_EXT.test(e.name) || PY_EXT.test(e.name)) && !SKIP_FILE.test(e.name)) {
      out.push(p);
    }
  }
}

// Returns [{ line, text }] for each source line holding a BL-id inside a comment.
export function commentHits(src, isPy) {
  const hits = [];
  const lines = src.split(/\r?\n/);
  let state = "code"; // code | block | tpl | triple
  let tripleQuote = "";
  for (let ln = 0; ln < lines.length; ln++) {
    const s = lines[ln];
    let i = 0;
    let commentText = "";
    let quote = "";
    while (i < s.length) {
      const c = s[i];
      const two = s.slice(i, i + 2);
      if (state === "block") {
        const end = s.indexOf("*/", i);
        if (end < 0) {
          commentText += s.slice(i) + " ";
          i = s.length;
        } else {
          commentText += s.slice(i, end) + " ";
          i = end + 2;
          state = "code";
        }
        continue;
      }
      if (state === "tpl") {
        if (c === "\\") i += 2;
        else {
          if (c === "`") state = "code";
          i++;
        }
        continue;
      }
      if (state === "triple") {
        const end = s.indexOf(tripleQuote, i);
        if (end < 0) {
          commentText += s.slice(i) + " ";
          i = s.length;
        } else {
          commentText += s.slice(i, end) + " ";
          i = end + 3;
          state = "code";
        }
        continue;
      }
      // state === code
      if (quote) {
        if (c === "\\") i += 2;
        else {
          if (c === quote) quote = "";
          i++;
        }
        continue;
      }
      if (isPy) {
        if (c === "#") {
          commentText += s.slice(i) + " ";
          i = s.length;
        } else if (s.startsWith('"""', i) || s.startsWith("'''", i)) {
          state = "triple";
          tripleQuote = s.slice(i, i + 3);
          i += 3;
        } else if (c === '"' || c === "'") {
          quote = c;
          i++;
        } else i++;
      } else {
        if (two === "//") {
          commentText += s.slice(i) + " ";
          i = s.length;
        } else if (two === "/*") {
          state = "block";
          i += 2;
        } else if (c === "`") {
          state = "tpl";
          i++;
        } else if (c === '"' || c === "'") {
          quote = c;
          i++;
        } else i++;
      }
    }
    if (BL.test(commentText)) hits.push({ line: ln + 1, text: commentText.trim().slice(0, 140) });
  }
  return hits;
}

export function scan(root) {
  const files = [];
  for (const d of SCAN_DIRS) walk(join(root, d), files);
  const result = new Map();
  for (const f of files.sort()) {
    const rel = relative(root, f).split(sep).join("/");
    const hits = commentHits(readFileSync(f, "utf-8"), PY_EXT.test(f));
    if (hits.length) result.set(rel, hits);
  }
  return result;
}

export function readAllow(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

export function check(root, allowFile) {
  const found = scan(root);
  const allow = readAllow(allowFile);
  const allowSet = new Set(allow);
  const errors = [];
  for (const [file, hits] of found) {
    if (allowSet.has(file)) continue;
    for (const h of hits) errors.push(`${file}:${h.line}: ${h.text}`);
  }
  for (const a of allow) {
    if (!found.has(a))
      errors.push(`${a}: stale allowlist entry - remove it (no BL-id comments left in this file)`);
  }
  return { errors, files: found.size, allow: allow.length, found };
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  const here = dirname(fileURLToPath(import.meta.url));
  const root = arg("--root") || join(here, "..", "..");
  const allowFile = arg("--allow") || join(root, ".github", "scripts", "comment_check.allow");
  if (argv.includes("--seed")) {
    const found = scan(root);
    const body =
      "# BL-279 W2-16 / D4: files whose comments still cite BL-ids. WS-4 shrinks this list to zero;\n" +
      "# the check fails on a new file not listed here and on an entry with no remaining hits.\n" +
      [...found.keys()].join("\n") +
      "\n";
    writeFileSync(allowFile, body);
    console.log(`comment-check: seeded ${found.size} files into ${relative(root, allowFile)}`);
    return;
  }
  const r = check(root, allowFile);
  if (r.errors.length) {
    for (const e of r.errors) console.error(e);
    console.error(`comment-check: FAIL ${r.errors.length} problem(s)`);
    process.exit(1);
  }
  console.log(
    `comment-check: ${r.files} files with BL-id comments, all allowlisted; allowlist ${r.allow}`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
