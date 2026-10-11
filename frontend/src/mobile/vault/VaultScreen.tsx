import { useRef } from "react";
import type { ReactNode } from "react";
import { useCollapse, useHeaderSlot } from "./useCollapse";
import { VaultHeader } from "./VaultHeader";
import type { StripSummary } from "./VaultHeader";
import "./header.css";

// BL-247 S1-05 / S1-06: the Vault screen's frame -- the collapsing header
// overlay, its layout slot (always the collapsed height), and the content
// below, moved down by --vh-delta while expanded (transform only). `children`
// is the list; stage 1b adds the status rows above it.

interface Props {
  summary: StripSummary;
  panel: ReactNode;
  account: ReactNode;
  unread: boolean;
  onOpenChooser: () => void;
  onOpenFeedback: () => void;
  /** ?collapsed=1 opens collapsed (rev4 param; review links). */
  startCollapsed?: boolean;
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
  children,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hdrRef = useRef<HTMLElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const { scrollEl, collapsed, expand, pull, pullStyle } = useCollapse(startCollapsed, 320, true);
  useHeaderSlot(rootRef, hdrRef, topRef, collapsed);

  return (
    <div
      ref={rootRef}
      className={
        "m-screen m-vault" + (collapsed ? " m-vh--collapsed" : "") + (pull > 0 ? " m-pulling" : "")
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
        <div className="m-scroll m-vault__scroll" ref={scrollEl}>
          <div className="m-pullshift">{children}</div>
        </div>
      </div>
    </div>
  );
}
