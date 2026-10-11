import { useEffect, useRef, useState } from "react";
import { SectionSeparator } from "../../components/SectionSeparator";
import { publishNav } from "../card/navList";
import { MOBILE_CAMERA_ENABLED } from "../flags";
import { MIcon } from "../icons";
import { go } from "../router";
import { discardBatch, getBatch, pendingEntries } from "./batch";
import { DiscardConfirm } from "./DiscardConfirm";
import { cameraKeypadRoute, closeTool, openCamera, renderCameraScreen } from "./cameraHop";
import { audioUnlock } from "./cue";
import { Pad } from "./Pad";
import { setScanSettings, useScanSettings } from "./scanSettings";
import { VerifySheet } from "./VerifySheet";
import { chooseSet, getToolState, setToolMode, setToolState } from "./toolStore";
import { toolAddCardsAbandoned, toolScreenViewed } from "./toolAnalytics";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import "./tool.css";

// BL-249 S3-01: the tool layer at #/pad (rev4 MTool.jsx). A layer over the
// current screen, like the card layer: the screen beneath stays mounted
// (the Vault keeps its state), the bottom bar is covered and inert. Header =
// title + sub, the mode toggle (only behind MOBILE_CAMERA_ENABLED, plan
// A8), X top-right. The X closes back to the screen the tool opened over;
// with a non-empty batch it asks desktop's close guard first (S3-14:
// Discard & Close empties the batch and closes, Return to Batch keeps
// both). The entry row's Verify button opens the Verify cards sheet (S3-12). The keypad
// ignores the Vault's finish scope: nothing here reads it, and Card details
// opens the S2 card layer on the resolved printing with no scope (S3-06).

// BL-253 S7-09 / S7-10: the same layer hosts the camera (#/camera, served by
// the isolated /scan/ document): title "Camera", the header's Fast add
// toggle (S7-17, remembered in hsv.scan.v1), the mode toggle (keypad side =
// in place, camera side = cameraHop.openCamera), the same X + close guard;
// the body is the camera screen the scanner entry registered (cameraSlot) --
// this file never imports mobile/camera/.

export interface ToolLayerProps {
  params: Record<string, string>;
  /** BL-253 S7-10: the camera mode (#/camera) rather than the keypad. */
  camera?: boolean;
  /** The card layer is over the tool (S3-06): the tool stays mounted, inert. */
  covered: boolean;
  onRequestSignIn: () => void;
  onClose?: () => void;
}

export function ToolLayer({
  params,
  camera = false,
  covered,
  onRequestSignIn,
  onClose,
}: ToolLayerProps) {
  const scan = useScanSettings();

  // S3-07: screen_viewed {screen: "tool"} once per open. BL-253 S7-18: the
  // camera mode reports "camera" itself (CameraScreen), so "tool" is sent
  // when the keypad is what the open shows (and again on a switch back).
  useEffect(() => {
    if (!camera) toolScreenViewed();
  }, [camera]);

  // Review deep link (as rev4's #/pad?set=&num=, kept like the Vault's and
  // the detail's review params): lock a set and type a number.
  const pSet = params.set;
  const pNum = params.num;
  // Applied once per distinct link: the card layer over the tool (S3-06)
  // and its return must not re-type a number the user has since changed.
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (covered || camera) return;
    const sig = (pSet ?? "") + "|" + (pNum ?? "");
    if (applied.current === sig) return;
    applied.current = sig;
    const t = getToolState();
    if (pSet && /^[A-Z0-9]{2,5}$/.test(pSet) && (t.setCode !== pSet || t.preconKey))
      chooseSet(pSet);
    if (pNum && /^\d{1,4}$/.test(pNum)) setToolState({ num: pNum.replace(/^0+(?=\d)/, "") });
  }, [pSet, pNum, covered, camera]);

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [guard, setGuard] = useState(false);
  const leave = onClose ?? closeTool;
  // S3-14: the X asks first while copies wait in the batch.
  const close = () => {
    if (getBatch().length) setGuard(true);
    else leave();
  };
  // F2: focus the close control on open, return it to the opener on close.
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener && opener.isConnected && opener.tagName !== "INPUT")
        opener.focus({ preventScroll: true });
    };
  }, []);
  // F3: Escape on the keypad layer (no sheet / confirm over it) = the X.
  const closeRef2 = useRef(close);
  const coveredRef = useRef(covered);
  useEffect(() => {
    closeRef2.current = close;
    coveredRef.current = covered;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || coveredRef.current) return;
      if (document.querySelector(".m-sheet-layer, .m-d2-confirm-layer")) return;
      closeRef2.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const openCard = (card: InventoryCard, variant: InventoryVariant) => {
    // S3-06: no scope, a one-card list; the batch is untouched.
    publishNav({ ids: [card.base_card_id], narrowed: false, scope: null });
    go("#/card/" + card.base_card_id + "?v=" + variant.variant_id);
  };
  return (
    <div
      className={"m-padlayer m-tool" + (camera ? " m-tool--camera" : "")}
      role="dialog"
      aria-modal="true"
      aria-label={camera ? "Camera" : "Keypad"}
      inert={covered}
    >
      <header className="m-padlayer__head m-tool__head">
        <div className="m-tool__titles">
          <h1 className="m-padlayer__title">{camera ? "Camera" : "Keypad"}</h1>
          <span className="m-padlayer__sub">Look up or add by number</span>
        </div>
        {camera ? (
          // S7-17 (rev4 MTool.jsx:25-29): Fast add, remembered in hsv.scan.v1.
          <button
            type="button"
            className={"m-check m-tool__fast" + (scan.fastAdd ? " m-check--on" : "")}
            role="switch"
            aria-checked={scan.fastAdd}
            onClick={() => {
              audioUnlock();
              setScanSettings({ fastAdd: !scan.fastAdd });
            }}
            aria-label="Fast add: add each read card without asking"
          >
            <span className="m-check__box">
              {scan.fastAdd ? <MIcon name="check" size={16} /> : null}
            </span>
            <span className="m-tool__fastl">Fast add</span>
          </button>
        ) : null}
        {MOBILE_CAMERA_ENABLED ? (
          <span className="m-seg m-tool__mode" role="group" aria-label="Tool mode">
            <button
              type="button"
              className={"m-seg__btn" + (!camera ? " m-seg__btn--on" : "")}
              aria-pressed={!camera}
              onClick={() => {
                setToolMode("keypad");
                // S7-16: leaving with a partial read prefills the keypad.
                if (camera) go(cameraKeypadRoute(), true);
              }}
              aria-label="Keypad mode"
            >
              <MIcon name="pad" size={20} />
            </button>
            <button
              type="button"
              className={"m-seg__btn" + (camera ? " m-seg__btn--on" : "")}
              aria-pressed={camera}
              onClick={() => {
                if (camera) return;
                audioUnlock(); // S7-17: the camera-mode tap is the user gesture
                setToolMode("camera");
                openCamera(true);
              }}
              aria-label="Camera mode"
            >
              <MIcon name="camera" size={22} />
            </button>
          </span>
        ) : null}
        <button
          type="button"
          ref={closeRef}
          className="m-iconbtn m-tool__close"
          onClick={close}
          aria-label={camera ? "Close camera" : "Close keypad"}
        >
          <MIcon name="close" />
        </button>
      </header>
      <SectionSeparator className="m-tool__sep" />
      {camera ? (
        renderCameraScreen({
          covered,
          busy: verifyOpen || guard,
          onRequestSignIn,
          onOpenCard: openCard,
          onOpenVerify: () => setVerifyOpen(true),
        })
      ) : (
        <Pad
          onRequestSignIn={onRequestSignIn}
          onOpenCard={openCard}
          onOpenVerify={() => setVerifyOpen(true)}
        />
      )}
      {verifyOpen ? <VerifySheet onClose={() => setVerifyOpen(false)} /> : null}
      {guard ? (
        <DiscardConfirm
          onReturn={() => setGuard(false)}
          onDiscard={() => {
            toolAddCardsAbandoned(pendingEntries(getBatch())); // BL-235 shape, S3-16
            discardBatch();
            setToolState({ lastAdded: null });
            setGuard(false);
            leave();
          }}
        />
      ) : null}
    </div>
  );
}
