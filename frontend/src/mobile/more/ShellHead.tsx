import { useCallback, useEffect } from "react";
import { MIcon } from "../icons";
import { back, backOr } from "../router";

// BL-250 S4-05: the full-shell header for More's sub-pages (rev4
// m-rev4-d.css .m-d1-head: 48 px row, 44 px balance, centred 22 px title).
// Reached from More -> a LEFT back chevron that returns to #/more (skill,
// round 2: screens that navigate back keep a left back chevron); reached
// from the title chooser, the account menu, a rail chip or a deep link -> the
// X top-right only (round 2: every close-able screen puts its X top-right;
// rev4 D1: About from the wordmark has X). Escape does the same (desktop
// useModalDismiss).

export function useShellExit(fromMore: boolean): () => void {
  return useCallback(() => (fromMore ? backOr("#/more") : back()), [fromMore]);
}

interface Props {
  title: string;
  titleId: string;
  fromMore: boolean;
}

export function ShellHead({ title, titleId, fromMore }: Props) {
  const exit = useShellExit(fromMore);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exit();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [exit]);
  return (
    <header className="m-shell__head">
      {fromMore ? (
        <button type="button" className="m-iconbtn m-shell__back" onClick={exit} aria-label="Back">
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
          onClick={exit}
          aria-label="Close"
        >
          <MIcon name="close" />
        </button>
      )}
    </header>
  );
}
