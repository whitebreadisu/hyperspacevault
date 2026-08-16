import { describe, expect, it } from "vitest";
import { RELEASE_NOTES } from "./releaseNotes";

// BL-184: structural invariants for the release-notes data -- not testing
// the copy itself (owner-reviewed, drafted verbatim per the PR description),
// just the shape utils/releaseNotesSeen.ts and NewArrivalsPage.tsx both rely
// on: newest-first ordering, unique keys, and no entry with nothing to show.

function toDate(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

describe("RELEASE_NOTES content module (BL-184)", () => {
  it("is non-empty", () => {
    expect(RELEASE_NOTES.length).toBeGreaterThan(0);
  });

  it("is ordered strictly newest-first by date", () => {
    for (let i = 1; i < RELEASE_NOTES.length; i++) {
      const prev = toDate(RELEASE_NOTES[i - 1].date);
      const cur = toDate(RELEASE_NOTES[i].date);
      expect(prev).toBeGreaterThan(cur);
    }
  });

  it("has a unique key per entry", () => {
    const keys = RELEASE_NOTES.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every release entry at least one non-empty section with at least one item", () => {
    for (const entry of RELEASE_NOTES) {
      if (entry.kind !== "release") continue;
      expect(entry.sections.length).toBeGreaterThan(0);
      for (const section of entry.sections) {
        expect(section.items.length).toBeGreaterThan(0);
        for (const item of section.items) {
          expect(item.title.trim().length).toBeGreaterThan(0);
          expect(item.body.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("gives every announcement entry a non-empty body", () => {
    for (const entry of RELEASE_NOTES) {
      if (entry.kind !== "announcement") continue;
      expect(entry.body.trim().length).toBeGreaterThan(0);
    }
  });

  it("uses the version string as the key for release entries", () => {
    for (const entry of RELEASE_NOTES) {
      if (entry.kind !== "release") continue;
      expect(entry.key).toBe(entry.version);
    }
  });

  it("includes v1.4 as the newest entry (current HEAD of the list)", () => {
    expect(RELEASE_NOTES[0].key).toBe("1.4");
  });
});
