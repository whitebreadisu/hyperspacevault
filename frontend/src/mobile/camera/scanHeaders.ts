// BL-253 S7-02: the isolation headers of the scanner document -- ONE source
// for the Vite dev middleware (vite.config.ts) and the assertion that
// firebase.json's `/scan/**` rule says the same thing (scanHeaders.test.ts).
//
// Why scoped: the Paddle reader wants threaded WASM, which needs
// SharedArrayBuffer, which needs a cross-origin-isolated document (COOP
// same-origin + COEP require-corp). A site-wide COEP would break Google
// sign-in (the popup is cross-origin), so ONLY `/scan/` carries them; the main
// document and its Permissions-Policy are untouched (plan A11).
//
// No DOM, no Node imports: this file is also loaded by vite.config.ts.

/** The three isolation headers of the `/scan/**` rule (App Spec 24.4 / A11). */
export const ISOLATION_HEADERS: Record<string, string> = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
};

/** What the scan document's HTML carries on top of the isolation headers. */
export const SCAN_DOCUMENT_HEADERS: Record<string, string> = {
  ...ISOLATION_HEADERS,
  "Cache-Control": "no-cache",
};

/** The vendored reader payload: immutable for a year. COEP (not only CORP)
 * is on these because the Paddle and Tesseract engines spawn Workers from
 * these URLs, and a worker script is only loaded under a COEP document when
 * its own response carries a COEP header (see the S7-03 log entry). */
export const VENDOR_HEADERS: Record<string, string> = {
  "Cache-Control": "public, max-age=31536000, immutable",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

/** The reader worker script itself (dev: the Vite-served module; prod: the
 * hashed file under /scan-workers/). */
export const WORKER_HEADERS: Record<string, string> = {
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

/** True for the scan document's own URLs: /scan, /scan/, /scan.html. */
export function isScanDocument(pathname: string): boolean {
  return pathname === "/scan" || pathname === "/scan/" || pathname === "/scan.html";
}

/** The response headers for a request path, or null when the path carries no
 * scanner header at all (the main document `/`, `/#/vault`, every other
 * asset). Pure; `pathname` has no query or hash. */
export function headersFor(pathname: string): Record<string, string> | null {
  if (isScanDocument(pathname)) return SCAN_DOCUMENT_HEADERS;
  if (pathname.startsWith("/vendor/scan/")) return VENDOR_HEADERS;
  if (pathname.startsWith("/scan-workers/") || /\/camera\/[A-Za-z]*Worker\.ts$/.test(pathname))
    return WORKER_HEADERS;
  return null;
}

/** The dev-server rewrite: /scan and /scan/ are served scan.html (what the
 * Firebase rewrite does in prod). Anything else is left alone. */
export function scanRewrite(pathname: string): string | null {
  return pathname === "/scan" || pathname === "/scan/" ? "/scan.html" : null;
}
