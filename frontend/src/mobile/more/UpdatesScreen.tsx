import { useEffect } from "react";
import type { CSSProperties } from "react";
import { RELEASE_NOTES } from "../../content/releaseNotes";
import type { ReleaseNoteSection, ReleaseNotesEntry } from "../../content/releaseNotes";
import "../../screens/notes/NewArrivalsPage.css";
import { HEADER_STARFIELD_CODES } from "../../utils/headerStarfield";
import { go } from "../router";
import { ShellHead } from "./ShellHead";
import "./more.css";

// BL-250 S4-03: [HSV] Updates at #/more/updates -- desktop
// screens/notes/NewArrivalsPage.tsx at phone width. FORK: NewArrivalsPage
// exports only the page (its chip label, date format, starfield assignment,
// NoteSection and NoteEntry are module-private), so those pieces are
// duplicated here unchanged (BL-254 folds them back); the desktop .na-* rules
// are imported, not copied, and more.css carries the phone deltas (rev4
// m-rev4-d.css: 44 px rail hits around desktop-drawn chips, 14 px gutters).
// ALL entries render, newest first (desktop; rev4 carried the latest only).
// S4-04: mounting this screen marks the newest entry seen (`onSeen`) -- the
// only thing on the phone that clears the unread cue.

function chipLabel(entry: ReleaseNotesEntry): string {
  return entry.kind === "release" ? `v${entry.version}` : formatDisplayDate(entry.date);
}

function entryAnchorId(entry: ReleaseNotesEntry): string {
  return `na-entry-${entry.key}`;
}

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

/** Desktop scrollIntoView, phone delta: the rail is one sideways-scrolling row
 * (S4-03b), so the entry lands just under the sticky rail's measured bottom
 * instead of a fixed scroll-margin. Reduced motion jumps. */
function scrollToEntry(entry: ReleaseNotesEntry) {
  const el = document.getElementById(entryAnchorId(entry));
  const scroller = el?.closest<HTMLElement>(".m-shellscreen");
  const rail = scroller?.querySelector<HTMLElement>(".m-updates__rail");
  if (!el || !scroller || !rail) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // Where the rail sticks, below the scroller's top edge (its padding plus
  // the rail's own sticky `top`, more.css).
  const stick =
    parseFloat(getComputedStyle(scroller).paddingTop) + parseFloat(getComputedStyle(rail).top);
  const top =
    el.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop -
    stick -
    rail.offsetHeight;
  scroller.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
}

function starfieldByReleaseKey(): Record<string, string> {
  const releasesOldestFirst = RELEASE_NOTES.filter((e) => e.kind === "release").reverse();
  const map: Record<string, string> = {};
  releasesOldestFirst.forEach((entry, i) => {
    map[entry.key] = HEADER_STARFIELD_CODES[i % HEADER_STARFIELD_CODES.length];
  });
  return map;
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

function NoteEntry({ entry, starfieldCode }: { entry: ReleaseNotesEntry; starfieldCode?: string }) {
  const headerStyle = starfieldCode
    ? ({
        "--na-starfield": `url("/images/starfields/starfield_${starfieldCode}.jpg")`,
      } as CSSProperties)
    : undefined;
  return (
    <section id={entryAnchorId(entry)} className="na-entry" data-entry={entry.key}>
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
      <div className="na-divider na-divider--inner" />
      {entry.kind === "release" ? (
        <div className="na-entry__body">
          {entry.sections.map((section, i) => (
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
  fromMore: boolean;
  onSeen: () => void;
}

export function UpdatesScreen({ fromMore, onSeen }: Props) {
  useEffect(() => {
    onSeen();
  }, [onSeen]);
  const starfields = starfieldByReleaseKey();
  return (
    <div
      className="m-screen m-shellscreen m-updates"
      role="dialog"
      aria-labelledby="m-updates-title"
    >
      <div className="m-shell">
        <div className="m-shell__panel m-shell__panel--page">
          <ShellHead title="[HSV] Updates" titleId="m-updates-title" fromMore={fromMore} />
          <nav className="na-quicklinks m-updates__rail" aria-label="Jump to release">
            {RELEASE_NOTES.map((entry) => (
              <button
                type="button"
                key={entry.key}
                className="m-updates__chip"
                onClick={() => scrollToEntry(entry)}
              >
                <span className="na-quicklink">{chipLabel(entry)}</span>
              </button>
            ))}
            <button
              type="button"
              className="m-updates__chip m-updates__chip--about"
              onClick={() => go("#/about")}
            >
              <span className="na-quicklink">About &amp; Legal</span>
            </button>
          </nav>
          <div className="na-body">
            {RELEASE_NOTES.map((entry) => (
              <NoteEntry key={entry.key} entry={entry} starfieldCode={starfields[entry.key]} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
