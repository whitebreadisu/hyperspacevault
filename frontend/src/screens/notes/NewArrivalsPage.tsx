import type { CSSProperties } from "react";
import { RELEASE_NOTES } from "../../content/releaseNotes";
import type { ReleaseNoteSection, ReleaseNotesEntry } from "../../content/releaseNotes";
import { HEADER_STARFIELD_CODES } from "../../utils/headerStarfield";
import "./NewArrivalsPage.css";

/** BL-184: the "New Arrivals" release-notes surface -- App.tsx mounts this as
 * a peer pane alongside Cards/Deck Check/Settings (same always-mounted,
 * display-toggled shell pattern; see App.tsx's own doc comment). Unlike
 * those panes, App itself owns NOTHING about unread state here -- the seen-
 * marking (utils/releaseNotesSeen.ts's saveLastSeenKey) happens the instant
 * the view is OPENED (App's onOpenNotes handler, fired from either the
 * Header nav tab or the footer version label), not on this component's own
 * mount effect, so the cue clears in lockstep with the click rather than a
 * render tick later.
 *
 * Visual language is composed from three existing console idioms rather than
 * inventing a fourth: AboutModal.css's clipped-corner "steel ring" shell
 * (`.about-shell`/`.about-modal` double clip-path) for the outer frame,
 * its circuit-tile `.about-body` backdrop for the content well, and
 * SectionSeparator's circuit-line seam between entries. Entry anchors use
 * the entry's own stable `key` (releaseNotesSeen.ts's identity) as the DOM
 * id, so the quicklink rail's targets and the unread-tracking identity never
 * drift apart. */

/** "1.3" (releases) or a human date (announcements, none shipped yet) --
 * the quicklink rail's chip label. */
function chipLabel(entry: ReleaseNotesEntry): string {
  return entry.kind === "release" ? `v${entry.version}` : formatDisplayDate(entry.date);
}

function entryAnchorId(entry: ReleaseNotesEntry): string {
  return `na-entry-${entry.key}`;
}

/** Plain YYYY-MM-DD -> "August 1, 2026", with no Date object / timezone math
 * involved (these are plain date strings, not instants -- parsing one
 * through `new Date(...)` risks a local-timezone off-by-one). */
function formatDisplayDate(iso: string): string {
  const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const parts = iso.split("-");
  const year = parts[0];
  const monthIdx = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  const month = MONTHS[monthIdx];
  return month ? `${month} ${day}, ${year}` : iso;
}

function scrollToEntry(entry: ReleaseNotesEntry) {
  document
    .getElementById(entryAnchorId(entry))
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function NoteSection({ section }: { section: ReleaseNoteSection }) {
  return (
    <div className="na-section">
      {section.heading && (
        <h3 className="na-section__heading">
          {section.emoji && (
            <span className="na-section__emoji" aria-hidden="true">
              {section.emoji}
            </span>
          )}
          {section.heading}
        </h3>
      )}
      <ul className="na-section__items">
        {section.items.map((item) => (
          <li key={item.title} className="na-item">
            <strong className="na-item__title">{item.title}</strong>
            <span className="na-item__sep"> — </span>
            <span className="na-item__body">{item.body}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Owner review round 1 (2026-08-02): each RELEASE header wears one of the
 * shipped header starfields, assigned in canonical set order from the OLDEST
 * release up -- 1.0 = SOR, 1.1 = SHD, 1.2 = TWI, ... -- rotating back to SOR
 * once the pool (utils/headerStarfield.ts, canonical order already) is
 * exhausted. Keyed by the release's position among RELEASES oldest-first, so
 * announcements interleaving the list never shift a version's starfield. */
function starfieldByReleaseKey(): Record<string, string> {
  const releasesOldestFirst = RELEASE_NOTES.filter((e) => e.kind === "release").reverse();
  const map: Record<string, string> = {};
  releasesOldestFirst.forEach((entry, i) => {
    map[entry.key] = HEADER_STARFIELD_CODES[i % HEADER_STARFIELD_CODES.length];
  });
  return map;
}

function NoteEntry({ entry, starfieldCode }: { entry: ReleaseNotesEntry; starfieldCode?: string }) {
  const headerStyle = starfieldCode
    ? ({
        "--na-starfield": `url("/images/starfields/starfield_${starfieldCode}.jpg")`,
      } as CSSProperties)
    : undefined;
  return (
    <section id={entryAnchorId(entry)} className="na-entry" data-testid={`na-entry-${entry.key}`}>
      <header
        className={`na-entry__header${starfieldCode ? " na-entry__header--starfield" : ""}`}
        style={headerStyle}
      >
        {entry.kind === "release" ? (
          <>
            <span className="na-entry__version">v{entry.version}</span>
            <span className="na-entry__title">{entry.title}</span>
          </>
        ) : (
          <span className="na-entry__title">{entry.title}</span>
        )}
        <span className="na-entry__date">{formatDisplayDate(entry.date)}</span>
      </header>

      {/* Owner review round 1: the same circuit-line seam the app uses
          between sections separates each version header from its content
          (the between-entries seam below stays too). */}
      <div className="na-divider na-divider--inner" />

      {entry.kind === "release" ? (
        <div className="na-entry__body">
          {entry.sections.map((section, i) => (
            // Sections have no stable id of their own (plain content data,
            // not user-addressable) -- index is fine, this list never
            // reorders/filters within a render.
            <NoteSection key={i} section={section} />
          ))}
        </div>
      ) : (
        <p className="na-announcement__body">{entry.body}</p>
      )}
    </section>
  );
}

interface Props {
  /** Opens the shell's AboutModal (App-owned state, same threading idiom as
   * Header's onOpenAbout). Optional so the page still renders standalone. */
  onOpenAbout?: () => void;
}

export function NewArrivalsPage({ onOpenAbout }: Props) {
  const starfields = starfieldByReleaseKey();
  return (
    <div className="screen na-screen">
      <div className="na-shell">
        <div className="na-panel">
          {/* Owner review round 3: no page title -- "New Arrivals" already
              reads from the app header's active nav tab; the quicklink rail
              is the page's top edge, with the About & Legal chip riding its
              right end. */}
          <nav className="na-quicklinks" aria-label="Jump to release">
            {RELEASE_NOTES.map((entry) => (
              <button
                type="button"
                key={entry.key}
                className="na-quicklink"
                onClick={() => scrollToEntry(entry)}
              >
                {chipLabel(entry)}
              </button>
            ))}
            {onOpenAbout && (
              <button
                type="button"
                className="na-quicklink na-quicklink--about"
                onClick={onOpenAbout}
              >
                About &amp; Legal
              </button>
            )}
          </nav>

          <div className="na-body">
            {/* Owner review round 2: no seam BETWEEN entries -- the next
                entry's starfield band + straddled inner seam carries the
                break on its own. */}
            {RELEASE_NOTES.map((entry) => (
              <NoteEntry key={entry.key} entry={entry} starfieldCode={starfields[entry.key]} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
