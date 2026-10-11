import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useLimits } from "../../context/LimitsContext";
import { SettingsPage } from "../../screens/settings/SettingsPage";
import { ShellHead } from "../more/ShellHead";
import "./account.css";

// BL-251 S5-01: Settings at #/more/settings. Desktop's SettingsPage renders
// UNCHANGED (its `onDeleteAccount` prop is all it takes) inside the phone's
// transactional card (plain rounded card, 3 px blue top bar -- skill, "Two
// modal families"; rev4 m-rev4-d2.css 137-247). The card's head is ShellHead
// (back chevron from More, X top-right otherwise -- S4-05 rule); SettingsPage's
// own page heading is hidden by CSS because the head already says "Settings".
//
// "Saved." (rev4 R4-13) does not exist on desktop's page, which is not edited:
// the wrapper watches for the Save button tap followed by a new limits matrix
// from LimitsContext (the PUT response -- a failed save leaves it untouched)
// and portals a status line into the enforcement section, under the Save row.
// Any other tap in the card clears it. BL-254 may fold "Saved." into desktop.

const CAPMODE_SECTION = '[aria-labelledby="settings-capmode-title"]';

interface Props {
  fromMore: boolean;
  onDeleteAccount: () => void;
}

export function SettingsScreen({ fromMore, onDeleteAccount }: Props) {
  const { cells, capMode } = useLimits();
  const rootRef = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [saved, setSaved] = useState(false);
  const armed = useRef(false);

  // The enforcement section exists only once the page has loaded its matrix.
  // Runs every render on purpose (the section appears a render after `cells`);
  // setHost bails out when the element is unchanged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setHost(rootRef.current?.querySelector<HTMLElement>(CAPMODE_SECTION) ?? null);
  });

  useEffect(() => {
    if (armed.current) {
      armed.current = false;
      setSaved(true);
    }
  }, [cells, capMode]);

  function onCardClick(e: MouseEvent<HTMLDivElement>) {
    const btn = (e.target as HTMLElement).closest("button");
    const isSave = !!btn?.classList.contains("settings-btn--primary");
    armed.current = isSave;
    if (!isSave) setSaved(false);
  }

  return (
    <div className="m-screen m-acctscreen m-settings">
      <div className="m-acctcard" role="region" aria-labelledby="m-settings-title" ref={rootRef}>
        <ShellHead title="Settings" titleId="m-settings-title" fromMore={fromMore} />
        <div className="m-acctcard__body" onClick={onCardClick}>
          <SettingsPage onDeleteAccount={onDeleteAccount} />
        </div>
        {host && saved
          ? createPortal(
              <p className="m-fine m-settings__saved" role="status">
                Saved.
              </p>,
              host
            )
          : null}
      </div>
    </div>
  );
}
