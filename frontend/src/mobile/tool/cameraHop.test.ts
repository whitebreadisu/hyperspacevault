import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRouterForTest, setBgRoute } from "../router";
import {
  bounceSignIn,
  closeTool,
  finishSignInBounce,
  isScanDocument,
  openCamera,
  pendingSignInReturn,
  setNavForTest,
} from "./cameraHop";
import { getScanSettings } from "./scanSettings";
import { getToolState, openTool, resetToolForTest, setToolMode, toolRouteFor } from "./toolStore";

// BL-253 S7-09: the camera mode is on (MOBILE_CAMERA_ENABLED); the camera
// lives in the isolated /scan/ document, so opening it from `/` is a document
// hop with the return target, and the mode is remembered (S7-08).

const nav = { assign: vi.fn(), replace: vi.fn(), historyBack: vi.fn() };

function at(path: string, hash: string) {
  window.history.replaceState(null, "", path + hash);
}

beforeEach(() => {
  resetToolForTest();
  resetRouterForTest();
  sessionStorage.clear();
  nav.assign.mockReset();
  nav.replace.mockReset();
  nav.historyBack.mockReset();
  setNavForTest(nav);
  at("/", "#/vault");
});
afterEach(() => {
  setNavForTest(null);
  at("/", "#/vault");
});

describe("S7-09 camera route + mode memory + the document hop", () => {
  it("the camera mode has its route and is remembered", () => {
    expect(toolRouteFor("camera")).toBe("#/camera");
    expect(toolRouteFor("keypad")).toBe("#/pad");
    setToolMode("camera");
    expect(getToolState().mode).toBe("camera");
    expect(getScanSettings().mode).toBe("camera");
    setToolMode("keypad");
    expect(getScanSettings().mode).toBe("keypad");
  });

  it("the bar opens the last mode: keypad in place, camera by the hop from /", () => {
    expect(isScanDocument()).toBe(false);
    openTool();
    expect(window.location.hash).toBe("#/pad");
    expect(nav.assign).not.toHaveBeenCalled();

    at("/", "#/vault?q=vader");
    setBgRoute("#/vault?q=vader");
    setToolMode("camera");
    openTool();
    expect(nav.assign).toHaveBeenCalledWith("/scan/#/camera");
    // The main document's entry is the screen beneath the tool, not a tool route.
    expect(window.location.hash).toBe("#/vault?q=vader");
    expect(sessionStorage.getItem("hsv.scan.hop")).toBe("1");
  });

  it("inside /scan/ the camera opens in place (no hop)", () => {
    at("/scan/", "#/pad");
    expect(isScanDocument()).toBe(true);
    openCamera(true);
    expect(window.location.hash).toBe("#/camera");
    expect(nav.assign).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("closing a hop-entered camera walks back to /; otherwise in-document back", () => {
    sessionStorage.setItem("hsv.scan.hop", "1");
    at("/scan/", "#/camera");
    closeTool();
    expect(nav.historyBack).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("hsv.scan.hop")).toBeNull();
    // No hop marker (a cold /scan/ tab): the Vault of this document.
    closeTool();
    expect(nav.historyBack).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#/vault");
  });

  it("sign-in from /scan/ bounces to / and returns once signed in", () => {
    at("/scan/", "#/camera");
    bounceSignIn();
    expect(nav.assign).toHaveBeenLastCalledWith("/#/vault");
    at("/", "#/vault");
    expect(pendingSignInReturn()).toBe("/scan/#/camera");
    finishSignInBounce(true);
    expect(nav.assign).toHaveBeenLastCalledWith("/scan/#/camera");
    expect(pendingSignInReturn()).toBeNull();
    // Abandoned: walk back instead.
    sessionStorage.setItem("hsv.scan.signin", "/scan/#/camera");
    finishSignInBounce(false);
    expect(nav.historyBack).toHaveBeenCalledTimes(1);
  });
});
