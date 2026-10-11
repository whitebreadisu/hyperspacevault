import { useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { VerifyEmailBanner } from "../../components/VerifyEmailBanner";
import { useCollapse, useHeaderSlot } from "./useCollapse";
import { VaultHeader } from "./VaultHeader";
import type { StripSummary } from "./VaultHeader";
import "./header.css";

// BL-247 S1-05 / S1-06: the Vault screen's frame -- the collapsing header
// overlay, its layout slot (always the collapsed height), and the content
// below, moved down by --vh-delta while expanded (transform only). Below the
// header: `controls` (the status rows, S1-14) then the scrolling `children`
// (the list). `searching` (S1-15) collapses the header to its seam and lifts
// the content to the top -- transform + opacity only, the box grown once by
// the same cut mechanism (header.css .m-vault--search).

interface Props {
  summary: StripSummary;
  panel: ReactNode;
  account: ReactNode;
  unread: boolean;
  onOpenChooser: () => void;
  onOpenFeedback: () => void;
  /** ?collapsed=1 opens collapsed (rev4 param; review links). */
  startCollapsed?: boolean;
  /** S1-14: the status rows, fixed above the list. */
  controls?: ReactNode;
  /** S1-15: search mode. */
  searching?: boolean;
  /** The list's scroll container (the virtualiser's scroll element). */
  onScrollEl?: (el: HTMLElement | null) => void;
  /** Re-keys the scroll container (a view change starts at the top). */
  listKey?: string;
  children: ReactNode;
}

export function VaultScreen({
  summary,
  panel,
  account,
  unread,
  onOpenChooser,
  onOpenFeedback,
  startCollapsed = false,
  controls,
  searching = false,
  onScrollEl,
  listKey,
  children,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hdrRef = useRef<HTMLElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const { scrollEl, collapsed, expand, pull, pullStyle } = useCollapse(startCollapsed, 320, true);
  useHeaderSlot(rootRef, hdrRef, topRef, collapsed);
  const setScroll = useCallback(
    (el: HTMLElement | null) => {
      scrollEl(el);
      onScrollEl?.(el);
    },
    [scrollEl, onScrollEl]
  );

  return (
    <div
      ref={rootRef}
      className={
        "m-screen m-vault" +
        (collapsed ? " m-vh--collapsed" : "") +
        (pull > 0 ? " m-pulling" : "") +
        (searching ? " m-vault--search" : "")
      }
      style={pullStyle}
    >
      <VaultHeader
        hdrRef={hdrRef}
        topRef={topRef}
        collapsed={collapsed}
        onExpand={expand}
        summary={summary}
        unread={unread}
        onOpenChooser={onOpenChooser}
        onOpenFeedback={onOpenFeedback}
        account={account}
        panel={panel}
      />
      <div className="m-vh__slot" aria-hidden="true" />
      <div className="m-vault__below">
        {/* BL-251 S5-08: desktop's banner, unchanged, at the top of the list area. */}
        <VerifyEmailBanner />
        {controls}
        <div className="m-scroll m-vault__scroll" ref={setScroll} key={listKey}>
          <div className="m-pullshift">{children}</div>
        </div>
      </div>
    </div>
  );
}
