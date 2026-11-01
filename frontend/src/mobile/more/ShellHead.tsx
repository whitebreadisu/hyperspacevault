import { useCallback, useEffect } from "react";
import { MIcon } from "../icons";
import { back, backOr } from "../router";

// The full-shell header for More's sub-pages (48 px row, 44 px balance,
// centred 22 px title). Reached from More -> a LEFT back chevron that returns
// to #/more (screens that navigate back keep a left back chevron); reached
// from the title chooser, the account menu, a rail chip or a deep link -> the
// X top-right only (every close-able screen puts its X top-right). App Spec
// §25.4 "Back rule". Escape does the same (desktop useModalDismiss).

export function useShellExit(fromMore: boolean): () => void {
  return useCallback(() => (fromMore ? backOr("#/more") : back()), [fromMore]);
}

interface Props {
  title: string;
  titleId: string;
  fromMore: boolean;
  /** A long-running action is under way (Import & Export previewing /
   * committing): Escape and the X / chevron do nothing. */
  locked?: boolean;
}

// Layers that sit above the screen and own Escape (same idiom as
// ToolLayer): the tool, sheets, confirms, the sign-in layer, the card layer.
const ABOVE_SCREEN = ".m-tool, .m-sheet-layer, .m-d2-confirm-layer, .m-authlayer, .m-cardlayer";

export function ShellHead({ title, titleId, fromMore, locked = false }: Props) {
  const exit = useShellExit(fromMore);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || locked) return;
      if (document.querySelector(ABOVE_SCREEN)) return;
      exit();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [exit, locked]);
  return (
    <header className="m-shell__head">
      {fromMore ? (
        <button
          type="button"
          className="m-iconbtn m-shell__back"
          onClick={locked ? undefined : exit}
          aria-label="Back"
          aria-disabled={locked || undefined}
        >
          <MIcon name="back" />
        </button>
      ) : (
        <span className="m-shell__bal" aria-hidden="true" />
      )}
      <h1 className="m-shell__title" id={titleId}>
        {title}
      </h1>
      {fromMore ? (
        <span className="m-shell__bal" aria-hidden="true" />
      ) : (
        <button
          type="button"
          className="m-iconbtn m-shell__close"
          onClick={locked ? undefined : exit}
          aria-label="Close"
          aria-disabled={locked || undefined}
        >
          <MIcon name="close" />
        </button>
      )}
    </header>
  );
}
