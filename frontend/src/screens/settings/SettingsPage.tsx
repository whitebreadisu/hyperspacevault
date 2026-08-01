import { useEffect, useState } from "react";
import { useLimits } from "../../context/LimitsContext";
import { LimitsApiError } from "../../api/settingsLimits";
import type {
  CapMode,
  LimitCell,
  LimitOverrideInput,
  TypeCategory,
} from "../../api/settingsLimits";
import {
  ALL_TYPE_CATEGORIES,
  CANONICAL_BUCKETS,
  DEFAULT_LIMITS,
  QUANTITY_CEILING,
} from "../../utils/limits";
import { CapStepper } from "./CapStepper";
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
 * pattern (Add Cards commits a batch, modals submit forms).
 *
 * BL-182 extends the three-way control with two numeric cap steppers
 * (Leaders & Bases / all other cards) so the keep-limits themselves are
 * user-defined rather than the fixed 1/3 code defaults. This replaces the
 * ADR-0013-era behavior where hard/soft saved overrides: [] unconditionally
 * (wiping any numeric overrides down to the code defaults) -- hard/soft now
 * save 15-row overrides per category that differs from its default (floor 1
 * for Leaders & Bases, floor 3 for everything else; both ceilinged at the
 * existing QUANTITY_CEILING of 999), and a category left at its default
 * still contributes zero override rows, so a plain hard/soft pick with both
 * steppers untouched round-trips as overrides: [] exactly as before. "No
 * limits" is unchanged: still the all-30-cells-null payload with cap_mode
 * "hard", and its steppers go inert (present, disabled) rather than
 * disappearing. A fetched matrix only displays a raised stepper value when
 * ALL 15 buckets of that category carry the SAME non-null override -- any
 * other shape (no overrides, partial, mixed values, or a null mixed in,
 * including a matrix from a prior pre-BL-182 session or a non-UI client)
 * displays the category default and normalizes to it on the next save. The
 * control still owns the full per-bucket override contract; this just moves
 * the two numbers it writes from hardcoded constants to page state.
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
    description: "At a card's keep-limit, adding more is blocked.",
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

/** BL-182: the floor each category's stepper can't go below -- the same
 * code default as its unconfigured value (utils/limits.ts DEFAULT_LIMITS),
 * matching the spec's "Leaders & Bases floor 1 / everything else floor 3". */
const CATEGORY_FLOOR: Record<TypeCategory, number> = DEFAULT_LIMITS;

function clamp(value: number, floor: number, ceiling: number): number {
  return Math.min(ceiling, Math.max(floor, value));
}

/** BL-182: a category's displayed cap. Only a matrix where ALL 15 of that
 * category's buckets carry the exact same non-null override value displays
 * that value (clamped into [floor, ceiling] in case a non-UI client wrote
 * something outside the current stepper bounds); no overrides, a partial
 * set, mixed values, or a null mixed in (including the all-null "No limits"
 * matrix, a subset of "all null") all fall back to the category default --
 * the API-era per-bucket precision the control no longer expresses. */
function deriveCap(cells: LimitCell[], category: TypeCategory): number {
  const values = cells
    .filter((cell) => cell.type_category === category)
    .map((cell) => cell.max_quantity);
  const [first] = values;
  const uniform = values.length > 0 && values.every((v) => v === first);
  if (uniform && first !== null) {
    return clamp(first, CATEGORY_FLOOR[category], QUANTITY_CEILING);
  }
  return DEFAULT_LIMITS[category];
}

/** The page's full draft state: the three-way selection plus the two
 * category caps the steppers show/edit. */
interface Draft {
  selection: Selection;
  singletonCap: number;
  standardCap: number;
}

function deriveDraft(cells: LimitCell[], capMode: CapMode): Draft {
  return {
    selection: deriveSelection(cells, capMode),
    singletonCap: deriveCap(cells, "singleton"),
    standardCap: deriveCap(cells, "standard"),
  };
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

/** BL-182: the hard/soft override payload -- 15 rows per category whose cap
 * differs from its default, none for a category left at its default (so
 * both steppers untouched still saves overrides: [], matching the pre-BL-182
 * behavior byte for byte). */
function buildCapOverrides(singletonCap: number, standardCap: number): LimitOverrideInput[] {
  const caps: Record<TypeCategory, number> = { singleton: singletonCap, standard: standardCap };
  const overrides: LimitOverrideInput[] = [];
  for (const category of ALL_TYPE_CATEGORIES) {
    if (caps[category] === DEFAULT_LIMITS[category]) continue;
    for (const bucket of CANONICAL_BUCKETS) {
      overrides.push({
        type_category: category,
        limit_bucket: bucket,
        max_quantity: caps[category],
      });
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
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Rebuild the draft whenever the server truth changes -- initial fetch and
  // every successful save (the PUT response's new effective body).
  useEffect(() => {
    setDraft(cells ? deriveDraft(cells, capMode) : null);
  }, [cells, capMode]);

  if (!cells || draft === null) {
    return (
      <div className="screen settings-screen">
        <h1 className="screen-heading">Settings</h1>
        <p className="loading-text">Loading settings…</p>
      </div>
    );
  }

  const serverDraft = deriveDraft(cells, capMode);
  const dirty =
    draft.selection !== serverDraft.selection ||
    draft.singletonCap !== serverDraft.singletonCap ||
    draft.standardCap !== serverDraft.standardCap;
  const capsInert = draft.selection === "none";

  function setSelection(value: Selection) {
    setDraft((prev) => (prev ? { ...prev, selection: value } : prev));
  }

  function setSingletonCap(value: number) {
    setDraft((prev) =>
      prev
        ? { ...prev, singletonCap: clamp(value, CATEGORY_FLOOR.singleton, QUANTITY_CEILING) }
        : prev
    );
  }

  function setStandardCap(value: number) {
    setDraft((prev) =>
      prev
        ? { ...prev, standardCap: clamp(value, CATEGORY_FLOOR.standard, QUANTITY_CEILING) }
        : prev
    );
  }

  async function handleSave() {
    if (draft === null) return;
    setSaving(true);
    setError(null);
    try {
      if (draft.selection === "none") {
        await save(allCellsUnlimited(), "hard");
      } else {
        await save(buildCapOverrides(draft.singletonCap, draft.standardCap), draft.selection);
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    setDraft(serverDraft);
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
            What happens when a variant is at (or past) its keep-limit and you add another copy. The
            keep-limits themselves are set below.
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
                checked={draft.selection === value}
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

        <div className="sl-capsteppers">
          <CapStepper
            label="LEADERS & BASES"
            ariaName="Leaders & Bases"
            floorHint={`min ${CATEGORY_FLOOR.singleton}`}
            value={draft.singletonCap}
            floor={CATEGORY_FLOOR.singleton}
            ceiling={QUANTITY_CEILING}
            disabled={saving || capsInert}
            onDecrement={() => setSingletonCap(draft.singletonCap - 1)}
            onIncrement={() => setSingletonCap(draft.singletonCap + 1)}
          />
          <CapStepper
            label="ALL OTHER CARDS"
            ariaName="All other cards"
            floorHint={`min ${CATEGORY_FLOOR.standard}`}
            value={draft.standardCap}
            floor={CATEGORY_FLOOR.standard}
            ceiling={QUANTITY_CEILING}
            disabled={saving || capsInert}
            onDecrement={() => setStandardCap(draft.standardCap - 1)}
            onIncrement={() => setStandardCap(draft.standardCap + 1)}
          />
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
