// Feature tours (App Spec §20, "Feature tour"): on a release the owner flags,
// small anchored tips point at the new controls, one at a time, per page.
// Pure data. The runtime is src/tour/; each tip's target carries
// `data-tour="<anchor>"` in the UI, and src/tour/anchors.test.ts fails when an
// enabled tip's anchor is missing from the source.
//
// A tour is not a release-notes entry: releaseNotes.ts is written at the
// promote (it feeds the HISTORY gate), so a tour can exist on dev ahead of it.
// `since` (UTC date): accounts created on or after it get no tips (they are
// new, not returning). Set it to the release's promote date at the promote.

/** The pages a tip can belong to: the Vault's Collection, the card window
 * (desktop) or card detail (phone), and the Stashes page. */
export type TourPage = "collection" | "card" | "stashes";

export interface TourTip {
  /** Stable id, stored in the per-browser seen record. */
  id: string;
  page: TourPage;
  /** The target's `data-tour` value (the same anchor on both layouts). */
  anchor: string;
  title: string;
  body: string;
  /** Phone wording, when it differs. */
  titlePhone?: string;
  bodyPhone?: string;
  /** Only on one layout; absent = both. */
  device?: "desktop" | "phone";
  /** An alternative to another tip of the same page (shown instead of it when
   * its own target is the one rendered): seeing either counts as seeing both. */
  insteadOf?: string;
  /** False = registered but never shown (its feature has not shipped). */
  enabled: boolean;
}

export interface FeatureTour {
  /** major.minor of the release the tour belongs to ("2.5"). */
  version: string;
  /** ISO date (UTC): accounts created on or after it see no tips. */
  since: string;
  /** In order within each page. */
  tips: TourTip[];
}

export const FEATURE_TOURS: FeatureTour[] = [
  {
    version: "2.5",
    // The 2.5 promote date (owner "promote to prod", 2026-11-13).
    since: "2026-11-13",
    tips: [
      {
        id: "stashes-nav",
        page: "collection",
        anchor: "nav-stashes",
        title: "Stashes",
        body: "Keep track of where your cards live, like a binder or a deck box. Point at Stashes to see yours or start one.",
        titlePhone: "Stashes live under Vault",
        bodyPhone:
          "Tap Vault again to open its menu. Stashes keep track of where your cards are, like a binder or a deck box.",
        enabled: true,
      },
      {
        id: "stash-copies",
        page: "card",
        anchor: "card-stash-copies",
        title: "Stash copies",
        body: "Put copies of this card in a stash, so you know which binder or box or friend has it. They still count in your Vault.",
        enabled: true,
      },
      {
        id: "stashed-copies",
        page: "card",
        anchor: "card-stash-list",
        title: "Your stashed copies",
        body: "This card's copies are listed by stash. Use Edit to move them around.",
        insteadOf: "stash-copies",
        enabled: true,
      },
      {
        id: "share-card",
        page: "card",
        anchor: "card-share",
        title: "Share this card",
        body: "Copies a link to this exact printing, Hyperspace or Showcase included. Paste it in a text or on Discord.",
        bodyPhone: "Sends a link to this exact printing through your phone's share menu.",
        enabled: true,
      },
      {
        id: "stashes-page",
        page: "stashes",
        anchor: "stashes-heading",
        title: "Your stashes",
        body: "Make one for each binder, box or deck. Then stash copies from any card you own.",
        enabled: true,
      },
      {
        id: "share-stash",
        page: "stashes",
        anchor: "stash-share",
        title: "Share a stash",
        body: "Send a read-only link to just this stash, handy before trade night.",
        enabled: true,
      },
    ],
  },
];
