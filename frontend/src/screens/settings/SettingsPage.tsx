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
import { analyticsActive, hasOptedOut, setOptedOut } from "../../analytics/analytics";
import "./SettingsPage.css";

/** Dedicated full-page settings surface (App Spec §4.5; ADR-0013, ADR-0018),
 * not a modal. On desktop it is reachable from the avatar menu's Settings
 * item -- App.tsx mounts it as a pane once signed in and display-toggles it
 * like the other panes; on the phone, mobile/account/SettingsScreen.tsx
 * renders it (App Spec §25.5).
 *
 * Keep-limit enforcement is a single three-way control (Hard cap / Soft cap
 * / No limits, ADR-0013). The backend keeps its full per-bucket override
 * contract (GET/PUT /api/settings/limits -- 15 buckets x 2 categories, plus
 * cap_mode); this page is the only frontend surface that writes to it. "No
 * limits" has no dedicated cap_mode of its own -- it is expressed as
 * cap_mode "hard" with every one of the 30 cells overridden to
 * max_quantity: null, which the enforcement pre-checks (addCardsResolver,
 * CardPopup) resolve to the unconditional 999 ceiling everywhere, so
 * nothing downstream of the matrix needs a special case.
 *
 * Save model: an explicit Save/Discard for the whole page (not an immediate
 * save on radio click), matching the rest of the app's mutation pattern
 * (Add Cards commits a batch, modals submit forms).
 *
 * Two numeric cap steppers (Leaders & Bases / all other cards, ADR-0018)
 * make the keep-limits themselves user-defined rather than the fixed 1/3
 * code defaults. Hard/soft save 15-row overrides per category that differs
 * from its default (floor 1 for Leaders & Bases, floor 3 for everything
 * else; both ceilinged at QUANTITY_CEILING, 999), and a category left at
 * its default contributes zero override rows, so a plain hard/soft pick with
 * both steppers untouched saves overrides: []. "No limits" is the
 * all-30-cells-null payload with cap_mode "hard", and its steppers go inert
 * (present, disabled) rather than disappearing. A fetched matrix only
 * displays a raised stepper value when ALL 15 buckets of that category
 * carry the SAME non-null override -- any other shape (no overrides,
 * partial, mixed values, or a null mixed in, e.g. from a non-UI client)
 * displays the category default and normalizes to it on the next save. The
 * control owns the full per-bucket override contract.
 *
 * A "danger zone" section at the bottom of the page holds the Delete
 * Account trigger, kept out of the everyday avatar menu so it is hard to
 * reach by accident. The shell owns DeleteAccountModal's open state
 * (App.tsx's deleteAccountModalOpen on desktop, MobileApp's `#/more/delete`
 * route on the phone); this page only calls onDeleteAccount, the same way
 * the Settings/Change Password/About items thread a callback down rather
 * than owning modal state locally. */

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
 * on save. Anything else displays as the fetched cap_mode, including a
 * matrix with numeric overrides (the stepper overrides this page writes, or
 * per-bucket values only a non-UI client can write) -- acceptable, since
 * the control owns the contract. */
function deriveSelection(cells: LimitCell[], capMode: CapMode): Selection {
  if (cells.length > 0 && cells.every((cell) => cell.max_quantity === null)) return "none";
  return capMode;
}

/** The floor each category's stepper can't go below -- the same code
 * default as its unconfigured value (utils/limits.ts DEFAULT_LIMITS),
 * matching App Spec §4.5's "Leaders & Bases (floor 1) / All other cards
 * (floor 3)". */
const CATEGORY_FLOOR: Record<TypeCategory, number> = DEFAULT_LIMITS;

function clamp(value: number, floor: number, ceiling: number): number {
  return Math.min(ceiling, Math.max(floor, value));
}

/** A category's displayed cap. Only a matrix where ALL 15 of that
 * category's buckets carry the exact same non-null override value displays
 * that value (clamped into [floor, ceiling] in case a non-UI client wrote
 * something outside the current stepper bounds); no overrides, a partial
 * set, mixed values, or a null mixed in (including the all-null "No limits"
 * matrix, a subset of "all null") all fall back to the category default --
 * per-bucket precision the control does not express. */
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

/** The hard/soft override payload -- 15 rows per category whose cap
 * differs from its default, none for a category left at its default (so
 * both steppers untouched saves overrides: [], App Spec §4.5). */
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
  /** Opens DeleteAccountModal, whose open state the shell owns (App.tsx on
   * desktop, MobileApp's `#/more/delete` route on the phone) -- the same
   * shell-owns-the-modal-state pattern as every other Settings/menu callback
   * (onOpenSettings, onChangePassword, onOpenAbout). */
  onDeleteAccount: () => void;
}

export function SettingsPage({ onDeleteAccount }: Props) {
  const { cells, capMode, save } = useLimits();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Mirrors posthog-js's persisted opt-out state (see the analytics
  // section below for why this sits outside the page's Save model).
  const [analyticsShared, setAnalyticsShared] = useState(() => !hasOptedOut());

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

      {/* The keep-limits themselves get their own section
          (concept explainer + the two category steppers), ABOVE enforcement --
          what the limit IS before what happens AT it. One shared draft/save
          still spans both sections; the action row stays at the bottom of the
          enforcement section. */}
      <section className="settings-section" aria-labelledby="settings-keeplimits-title">
        <div className="settings-section__head">
          <h2 className="settings-section__title" id="settings-keeplimits-title">
            Keep-limits
          </h2>
          <p className="settings-section__blurb">
            A keep-limit is the most copies of a card your inventory holds before the cap applies.
            Keep-limits are per variant, not per card — each printing of a card (Standard, Foil,
            Hyperspace, and so on) counts toward its own limit independently.
          </p>
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
      </section>

      <section className="settings-section" aria-labelledby="settings-capmode-title">
        <div className="settings-section__head">
          <h2 className="settings-section__title" id="settings-capmode-title">
            Keep-limit enforcement
          </h2>
          <p className="settings-section__blurb">
            What happens when a variant is at (or past) its keep-limit above and you add another
            copy.
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

      {/* Usage-analytics opt-out (App Spec §22). Deliberately OUTSIDE the page's
          Save/Discard batch model -- the choice is browser-local (posthog-js
          persists it in localStorage; analytics identity is per-browser, so
          the opt-out is too) and takes effect immediately on toggle. Inert
          outside the production hostnames, where analytics never initializes
          (see analytics.ts's gate). */}
      <section className="settings-section" aria-labelledby="settings-analytics-title">
        <div className="settings-section__head">
          <h2 className="settings-section__title" id="settings-analytics-title">
            Usage Analytics
          </h2>
          <p className="settings-section__blurb">
            To guide improvements, we collect anonymous usage data — which features get used, with
            everything you type masked out. It is never linked to your account. See About &amp;
            Legal for details.
          </p>
        </div>

        <label className="settings-analytics__toggle">
          <input
            type="checkbox"
            checked={analyticsShared}
            disabled={!analyticsActive()}
            onChange={(e) => {
              setAnalyticsShared(e.target.checked);
              setOptedOut(!e.target.checked);
            }}
          />
          <span>
            Share anonymous usage analytics
            {!analyticsActive() && (
              <span className="settings-analytics__inactive"> (active on the live site only)</span>
            )}
          </span>
        </label>
      </section>

      {/* Danger zone -- visually separated (own section, danger
          border/heading) from the routine controls above, holding the
          Delete Account trigger. The button only calls onDeleteAccount;
          the shell owns DeleteAccountModal's open state (App.tsx on
          desktop, the `#/more/delete` route on the phone), and the modal
          runs its own two-step confirm flow. */}
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
