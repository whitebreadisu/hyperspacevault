// BL-184: pure formatting for the footer version label. `__APP_VERSION__` is
// package.json's "version" field, baked in at build time (vite.config.ts's
// `define`) -- this module only formats the string, it never reads the
// build-time global itself, so it stays trivially unit-testable.

/** "1.4.0" -> "v1.4" (trailing ".0" patch stripped); "1.4.2" -> "v1.4.2"
 * (non-zero patch kept). Anything that doesn't parse as major.minor.patch
 * passes through with a "v" prefix rather than throwing -- a malformed
 * version should degrade to "looks a little odd" not "crashes the header". */
export function formatVersionLabel(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return `v${version}`;
  const [, major, minor, patch] = match;
  return patch === "0" ? `v${major}.${minor}` : `v${major}.${minor}.${patch}`;
}
