import { LinkIcon } from "./stashIcons";
import "./LinkOnLine.css";

/** "Link on · <share name>": the line under a shared stash's Share button
 * (desktop head) and under VALUE in the phone stash panel, while the stash
 * has a live link. */
export function LinkOnLine({ name, className }: { name: string; className?: string }) {
  return (
    <span className={"sp-linkon" + (className ? " " + className : "")}>
      <LinkIcon size={13} />
      <span className="sp-linkon__text">Link on · {name}</span>
    </span>
  );
}
