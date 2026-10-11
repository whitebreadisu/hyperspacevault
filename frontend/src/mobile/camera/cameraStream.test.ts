import { describe, expect, it, vi } from "vitest";
import { CameraStream, STREAM_CONSTRAINTS } from "./cameraStream";
import type { StreamLike } from "./cameraStream";

// BL-253 S7-10: camera start / stop lifecycle against a fake MediaStream --
// the spike's request (app.js:112-115), the zoom put back to 1.0 on start and
// nothing else (no automatic zoom), the phone ending the track, permission
// denied / no camera as states (never alert), stop releasing every track.

function fakeStream(opts: { zoom?: number; caps?: { min: number; max: number } } = {}) {
  const listeners: Record<string, (() => void)[]> = {};
  const track = {
    stop: vi.fn(),
    addEventListener: (t: string, f: () => void) => {
      (listeners[t] ??= []).push(f);
    },
    removeEventListener: vi.fn(),
    getCapabilities: () => (opts.caps ? { zoom: opts.caps } : {}),
    getSettings: () => (opts.zoom != null ? { zoom: opts.zoom } : {}),
    applyConstraints: vi.fn().mockResolvedValue(undefined),
  };
  const stream: StreamLike = { getTracks: () => [track], getVideoTracks: () => [track] };
  return { stream, track, end: () => listeners.ended?.forEach((f) => f()) };
}

describe("S7-10 camera stream lifecycle (fake MediaStream)", () => {
  it("start requests the spike's constraints, attaches, goes live; stop releases", async () => {
    const f = fakeStream();
    const attach = vi.fn();
    const gum = vi.fn().mockResolvedValue(f.stream);
    const cs = new CameraStream({ getUserMedia: gum, attach });
    await cs.start();
    expect(gum).toHaveBeenCalledWith(STREAM_CONSTRAINTS);
    expect(STREAM_CONSTRAINTS).toEqual({
      audio: false,
      video: { facingMode: "environment", width: { ideal: 3840 }, height: { ideal: 2160 } },
    });
    expect(attach).toHaveBeenLastCalledWith(f.stream);
    expect(cs.state.kind).toBe("live");
    cs.stop("paused");
    expect(f.track.stop).toHaveBeenCalled();
    expect(attach).toHaveBeenLastCalledWith(null);
    expect(cs.state.kind).toBe("paused");
  });

  it("puts a non-1 zoom back to 1.0 on start, and touches zoom in no other case", async () => {
    const z = fakeStream({ zoom: 2, caps: { min: 0.5, max: 10 } });
    const a = new CameraStream({ getUserMedia: async () => z.stream, attach: () => {} });
    await a.start();
    await Promise.resolve();
    expect(z.track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 1 }] });
    const one = fakeStream({ zoom: 1, caps: { min: 0.5, max: 10 } });
    const b = new CameraStream({ getUserMedia: async () => one.stream, attach: () => {} });
    await b.start();
    await Promise.resolve();
    expect(one.track.applyConstraints).not.toHaveBeenCalled();
  });

  it("the phone ending the track -> ended (Start offered), stream released", async () => {
    const f = fakeStream();
    const cs = new CameraStream({ getUserMedia: async () => f.stream, attach: () => {} });
    const seen: string[] = [];
    cs.subscribe(() => seen.push(cs.state.kind));
    await cs.start();
    f.end();
    expect(cs.state.kind).toBe("ended");
    expect(seen).toEqual(["starting", "live", "ended"]);
  });

  it("permission denied / no camera / other failures are states, never thrown", async () => {
    const fail = (name: string) =>
      new CameraStream({
        getUserMedia: async () => {
          throw Object.assign(new Error(name), { name });
        },
        attach: () => {},
      });
    const d = fail("NotAllowedError");
    await d.start();
    expect(d.state.kind).toBe("denied");
    const n = fail("NotFoundError");
    await n.start();
    expect(n.state.kind).toBe("nocamera");
    const e = fail("AbortError");
    await e.start();
    expect(e.state).toEqual({ kind: "error", message: "AbortError" });
  });

  it("a stop while the request is pending drops the late stream", async () => {
    const f = fakeStream();
    let resolve!: (s: StreamLike) => void;
    const cs = new CameraStream({
      getUserMedia: () => new Promise<StreamLike>((r) => (resolve = r)),
      attach: () => {},
    });
    const p = cs.start();
    cs.stop();
    resolve(f.stream);
    await p;
    expect(f.track.stop).toHaveBeenCalled();
    expect(cs.state.kind).toBe("idle");
  });
});
