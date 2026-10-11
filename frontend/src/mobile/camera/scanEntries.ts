// BL-253 S7-01: the two HTML entries of the build -- the app and the isolated
// scanner document. vite.config.ts feeds this to build.rollupOptions.input;
// scanDocument.test.ts asserts it (importing vite.config itself does not work
// under vitest's jsdom).
export const ENTRY_INPUTS: Record<string, string> = { main: "index.html", scan: "scan.html" };
