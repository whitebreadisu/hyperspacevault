// BL-253 S7-03: what the scanner document can say about its own isolation --
// the numbers the stage-7a proof reports (and the owner's-phone proof reads in
// the LAN rounds): crossOriginIsolated, SharedArrayBuffer, the core count, the
// thread count onnxruntime-web will be given, and wasm SIMD.

export interface IsolationReport {
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  hardwareConcurrency: number | null;
  /** The ort thread count: min(4, hardwareConcurrency) when isolated, else 1
   * (paddle-reader.js:25, ported verbatim). */
  threads: number;
  /** WebAssembly SIMD supported (the spike's app.js:1249 probe). */
  simd: boolean | null;
}

/** paddle-reader.js:25 -- `crossOriginIsolated ? max(1, min(4, hwc || 1)) : 1`. */
export function ortThreads(isolated: boolean, hardwareConcurrency: number | null | undefined) {
  return isolated ? Math.max(1, Math.min(4, hardwareConcurrency || 1)) : 1;
}

/** app.js:1249: validate a module that uses a v128 instruction. */
export function wasmSimdSupported(): boolean | null {
  try {
    return WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0,
        253, 15, 253, 98, 11,
      ])
    );
  } catch {
    return null;
  }
}

export interface IsolationEnv {
  crossOriginIsolated?: boolean;
  hasSharedArrayBuffer?: boolean;
  hardwareConcurrency?: number | null;
  simd?: boolean | null;
}

/** The report for this realm, or for an injected environment (tests). */
export function isolationReport(env?: IsolationEnv): IsolationReport {
  const isolated = env?.crossOriginIsolated ?? !!globalThis.crossOriginIsolated;
  const hwc =
    env && "hardwareConcurrency" in env
      ? (env.hardwareConcurrency ?? null)
      : typeof navigator !== "undefined"
        ? navigator.hardwareConcurrency || null
        : null;
  return {
    crossOriginIsolated: isolated,
    sharedArrayBuffer: env?.hasSharedArrayBuffer ?? typeof SharedArrayBuffer !== "undefined",
    hardwareConcurrency: hwc,
    threads: ortThreads(isolated, hwc),
    simd: env && "simd" in env ? (env.simd ?? null) : wasmSimdSupported(),
  };
}
