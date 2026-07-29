import { useEffect, useState } from "react";
import { useLimits } from "../../context/LimitsContext";
import { LimitsApiError } from "../../api/settingsLimits";
import type { CapMode, LimitCell, LimitOverrideInput } from "../../api/settingsLimits";
import { ALL_TYPE_CATEGORIES, CANONICAL_BUCKETS } from "../../utils/limits";
import "./SettingsPage.css";

/** BL-25/BL-35/ADR-0013: dedicated full-page settings surface (not a modal),
 * reachable from the avatar menu's Settings item -- App.tsx hosts it as a
 * second pane alongside the Cards view (same always-mounted, display-toggled
 * shell pattern).
 *
 * ADR-0013 trims the original BL-25 15x2 per-bucket grid and the BL-35
 * hard/soft radio down to a single three-way "Keep-limit enforcement"
 * control (Hard cap / Soft cap / No limits). The backend keeps its full
 * per-bucket override contract (GET/PUT /api/settings/limits -- 15 buckets x
 * 2 categories, plus cap_mode) completely unchanged; this control is now the
 * only frontend surface that writes to it. "No limits" has no dedicated
 * cap_mode of its own -- it is expressed as cap_mode "hard" with every one of
 * the 30 cells overridden to max_quantity: null, which the enforcement
 * pre-checks (addCardsResolver, CardPopup) already resolve to the
 * unconditional 999 ceiling everywhere, so nothing downstream of the matrix
 * needs to change.
 *
 * Save model unchanged: an explicit Save/Discard for the whole page (not an
 * immediate save on radio click), matching the rest of the app's mutation
 * pattern (Add Cards commits a batch, modals submit forms). Switching the
 * three-way selection deliberately resets any per-bucket overrides that only
 * the API could still produce (e.g. a prior pre-ADR-0013 session, or a
 * future non-UI client) -- the control owns the full override contract from
 * here on.
 *
 * BL-129 R5: a "danger zone" section at the bottom of the page now holds the
 * Delete Account trigger, relocated from the avatar dropdown (UserMenu) --
 * Jeremy's dev review found it too easy to reach accidentally from the
 * everyday account menu. DeleteAccountModal + its App-owned open state are
 * completely unchanged (BL-87); only the trigger's source moved, the same
 * way Settings/Change Password/About items already thread a callback down
 * from App rather than owning modal state locally. */

type Selection = CapMode | "none";

const OPTIONS: { value: Selection; title: string; description: string }[] = [
  {
    value: "hard",
    title: "Hard cap",
    description:
      "At a card's keep-limit (3 copies, or 1 for Leaders and Bases), adding more is blocked.",
  },
  {
    value: "soft",
    title: "Soft cap",
    description: "Copies past a keep-limit are added and flagged, not blocked.",
  },
  {
    value: "none",
    title: "No limits",
    description:
      "Nothing is blocked or flagged. (An absolute maximum of 999 copies per variant always applies.)",
  },
];

/** The three-way control's derived current state: a fetched matrix where
 * EVERY cell is max_quantity: null displays as "No limits" regardless of
 * cap_mode -- that is exactly how this control itself expresses "No limits"
 * on save. Anything else displays as the fetched cap_mode. A matrix with
 * mixed numeric overrides (only reachable via a non-UI client, or a session
 * from before ADR-0013) therefore falls back to displaying its cap_mode --
 * acceptable, since the control owns the contract now. */
function deriveSelection(cells: LimitCell[], capMode: CapMode): Selection {
  if (cells.length > 0 && cells.every((cell) => cell.max_quantity === null)) return "none";
  return capMode;
}

/** All 30 (type_category, limit_bucket) cells forced to "No limit" -- the
 * override payload for the "No limits" selection. */
function allCellsUnlimited(): LimitOverrideInput[] {
  const overrides: LimitOverrideInput[] = [];
  for (const category of ALL_TYPE_CATEGORIES) {
    for (const bucket of CANONICAL_BUCKETS) {
      overrides.push({ type_category: category, limit_bucket: bucket, max_quantity: null });
    }
  }
  return overrides;
}

function describeError(err: unknown): string {
  if (err instanceof LimitsApiError && err.status === 401) {
    return "Your session has expired — please sign in again.";
  }
  return "Something went wrong saving your settings. Please try again.";
}

interface Props {
  /** BL-129 R5: opens the App-owned DeleteAccountModal -- same
   * App-owns-the-modal-state pattern as every other Settings/menu callback
   * (onOpenSettings, onChangePassword, onOpenAbout). */
  onDeleteAccount: () => void;
}

export function SettingsPage({ onDeleteAccount }: Props) {
  const { cells, capMode, save } = useLimits();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Rebuild the draft whenever the server truth changes -- initial fetch and
  // every successful save (the PUT response's new effective body).
  useEffect(() => {
    setSelection(cells ? deriveSelection(cells, capMode) : null);
  }, [cells, capMode]);

  if (!cells || selection === null) {
    return (
      <div className="screen settings-screen">
        <h1 className="screen-heading">Settings</h1>
        <p className="loading-text">Loading settings…</p>
      </div>
    );
  }

  const serverSelection = deriveSelection(cells, capMode);
  const dirty = selection !== serverSelection;

  async function handleSave() {
    if (selection === null) return;
    setSaving(true);
    setError(null);
    try {
      if (selection === "none") {
        await save(allCellsUnlimited(), "hard");
      } else {
        await save([], selection);
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    setSelection(serverSelection);
  }

  return (
    <div className="screen settings-screen">
      <h1 className="screen-heading">Settings</h1>

      <section className="settings-section" aria-labelledby="settings-capmode-title">
        <div className="settings-section__head">
          <h2 className="settings-section__title" id="settings-capmode-title">
            Keep-limit enforcement
          </h2>
          <p className="settings-section__blurb">
            What happens when a variant is at (or past) its keep-limit and you add another copy.
          </p>
        </div>

        {error && (
          <p className="settings-error" role="alert">
            {error}
          </p>
        )}

        <div className="sl-capmode" role="radiogroup" aria-labelledby="settings-capmode-title">
          {OPTIONS.map(({ value, title, description }) => (
            <label key={value} className="sl-capmode__option">
              <input
                type="radio"
                name="cap-mode"
                value={value}
                checked={selection === value}
                disabled={saving}
                onChange={() => setSelection(value)}
              />
              <span className="sl-capmode__text">
                <span className="sl-capmode__title">{title}</span>
                <span className="sl-capmode__desc">{description}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="settings-actions">
          <span className="settings-actions__spacer" />
          <button
            type="button"
            className="settings-btn"
            onClick={handleDiscard}
            disabled={saving || !dirty}
          >
            Discard changes
          </button>
          <button
            type="button"
            className="settings-btn settings-btn--primary"
            onClick={handleSave}
            disabled={saving || !dirty}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </section>

      {/* BL-129 R5: danger zone -- visually separated (own section, danger
          border/heading) from the routine keep-limit control above, holding
          the Delete Account trigger that used to live in the avatar
          dropdown. The button itself only calls onDeleteAccount; App still
          owns DeleteAccountModal's open state and the modal's own
          two-step confirm flow (BL-87) is completely unchanged. */}
      <section
        className="settings-section settings-section--danger"
        aria-labelledby="settings-danger-title"
      >
        <div className="settings-section__head">
          <h2
            className="settings-section__title settings-section__title--danger"
            id="settings-danger-title"
          >
            Danger Zone
          </h2>
          <p className="settings-section__blurb">
            Permanently delete your account and every inventory record. This cannot be undone.
          </p>
        </div>

        <div className="settings-actions">
          <span className="settings-actions__spacer" />
          <button
            type="button"
            className="settings-btn settings-btn--danger"
            onClick={onDeleteAccount}
          >
            Delete Account
          </button>
        </div>
      </section>
    </div>
  );
}
