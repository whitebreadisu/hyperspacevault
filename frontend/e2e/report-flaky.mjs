/* global process, console */
// BL-255 / #214: list the tests that failed and then passed on Playwright's one
// CI retry ("flaky") so a pass-on-retry is visible instead of hidden.
// Usage: node e2e/report-flaky.mjs [report.json] [leg name]
// Reads Playwright's JSON report, appends a Markdown section to
// $GITHUB_STEP_SUMMARY (when set) and prints one ::warning:: annotation per
// flaky test. Always exits 0: a missing/unreadable report is printed, never
// fatal -- the "Run mobile e2e" step is what decides the leg's result.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";

const reportPath = process.argv[2] ?? "e2e-results/report.json";
const leg = process.argv[3] ?? process.env.LEG_NAME ?? "";
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
// The report's spec.file is relative to testDir ("e2e"); annotations need a
// repo-root-relative path, and this script runs from frontend/.
const FILE_PREFIX = process.env.FLAKY_FILE_PREFIX ?? "frontend/e2e";

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

function firstErrorLine(test) {
  for (const result of test.results ?? []) {
    if (result.status === "passed" || result.status === "skipped") continue;
    const msg = result.error?.message ?? result.errors?.[0]?.message ?? "";
    const line = msg
      .replace(ANSI, "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l !== "");
    if (line) return line;
  }
  return "(no error message recorded)";
}

function collectFlaky(suite, out = []) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      if (test.status !== "flaky") continue;
      out.push({
        project: test.projectName ?? "",
        file: spec.file ?? suite.file ?? "",
        line: spec.line ?? 0,
        title: spec.title ?? "",
        error: firstErrorLine(test),
      });
    }
  }
  for (const child of suite.suites ?? []) collectFlaky(child, out);
  return out;
}

const esc = (s) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
// Workflow-command property/message escaping.
const escProp = (s) =>
  s
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A")
    .replace(/:/g, "%3A")
    .replace(/,/g, "%2C");
const escMsg = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

function summarize(text) {
  console.log(text);
  if (!summaryPath) return;
  try {
    appendFileSync(summaryPath, `${text}\n\n`);
  } catch (err) {
    console.log(`report-flaky: could not write the step summary (${err.message})`);
  }
}

const heading = `### Flaky tests${leg ? ` - ${leg}` : ""}`;

if (!existsSync(reportPath)) {
  summarize(
    `${heading}\n\nNo JSON report at \`${reportPath}\` (the run did not get far enough to write one).`
  );
  process.exit(0);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (err) {
  summarize(
    `${heading}\n\nThe JSON report at \`${reportPath}\` could not be parsed (${err.message}).`
  );
  process.exit(0);
}

const flaky = [];
for (const suite of report.suites ?? []) collectFlaky(suite, flaky);

if (flaky.length === 0) {
  summarize(`${heading}\n\nNo flaky tests.`);
  process.exit(0);
}

const rows = flaky.map(
  (t) => `| ${esc(t.project)} | \`${esc(t.file)}:${t.line}\` | ${esc(t.title)} | ${esc(t.error)} |`
);
summarize(
  [
    heading,
    "",
    `${flaky.length} test(s) failed and then passed on the CI retry. The leg is green; track these on issue #214.`,
    "",
    "| Project | Spec | Test | First error (failed attempt) |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n")
);
if (process.env.GITHUB_OUTPUT) {
  try {
    appendFileSync(process.env.GITHUB_OUTPUT, "flaky=true\n");
  } catch (err) {
    console.log(`report-flaky: could not write the step output (${err.message})`);
  }
}
for (const t of flaky) {
  const file = posix.join(FILE_PREFIX, t.file.replace(/\\/g, "/"));
  console.log(
    `::warning file=${escProp(file)},line=${t.line}::${escMsg(`Flaky (failed, then passed on retry) [${t.project}] ${t.title}: ${t.error}`)}`
  );
}
process.exit(0);
