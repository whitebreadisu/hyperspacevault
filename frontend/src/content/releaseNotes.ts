// BL-184: content module for the "New Arrivals" release-notes surface.
// Pure data + types -- no formatting/rendering logic lives here (that's
// screens/notes/NewArrivalsPage.tsx and utils/releaseNotesSeen.ts). Newest
// first; `key` is the stable identity utils/releaseNotesSeen.ts's
// unread-tracking compares against (the version string for releases,
// `a-<date>` for announcements -- no announcements exist yet, but the
// `announcement` variant is part of the locked design so dated, unversioned
// entries can join the same chronological list later without a shape
// change).

export interface ReleaseNoteItem {
  title: string;
  body: string;
}

export interface ReleaseNoteSection {
  heading?: string;
  emoji?: string;
  items: ReleaseNoteItem[];
}

export type ReleaseNotesEntry =
  | {
      kind: "release";
      key: string;
      version: string;
      date: string;
      title: string;
      sections: ReleaseNoteSection[];
    }
  | {
      kind: "announcement";
      key: string;
      date: string;
      title: string;
      body: string;
    };

export const RELEASE_NOTES: ReleaseNotesEntry[] = [
  {
    kind: "release",
    // v1.4: sharing + the feedback batch. Date finalized at promote time
    // per the release-notes ritual (owner-approved copy 2026-08-16; NO
    // Safari sign-in item by owner decision — BL-212 unresolved/deferred).
    key: "1.4",
    version: "1.4",
    date: "2026-08-16",
    title: "Your Vault, shareable",
    sections: [
      {
        heading: "Show it off",
        items: [
          {
            title: "Share your Vault with a link",
            body: "The new Share control mints a private link to your collection. Anyone who has it sees the real thing — the full Vault, filters, sorting, gallery, prices, completion — look, don't touch, no account needed on their end. Rename the link, rotate it, or revoke it anytime; a rotated or revoked link dies instantly.",
          },
          {
            title: "What viewers see",
            body: "Your cards and your numbers, none of your account. Viewers can't change anything, and your email and settings never leave home.",
          },
        ],
      },
      {
        heading: "Straight from your feedback",
        items: [
          {
            title: "Sort by what matters",
            body: "Click a column header to sort: value (following your MARKET/LOW and UNIT/COLLECTION choices live), name, rarity, cost, power, HP, playset progress, and more. Sets never interleave — # and Set sorts keep each set together, the way your binder does. Click # to get the classic order back.",
          },
          {
            title: "Find your tradeables",
            body: "A new \"Over keep limit\" filter shows every card you hold past your cap — your trade pile, one click. Chasing a specific finish? It follows the playset finish filter like its siblings.",
          },
          {
            title: "The + button keeps up",
            body: "Click as fast as you like; the count keeps pace and the server catches up behind you. Big Add Cards batches commit in a fraction of the time, too.",
          },
          {
            title: "The table fits your screen",
            body: "Three table widths — Compact, Standard, Full — and the Vault picks the widest one that fits your window, live. A new control next to Table/Gallery lets you override it. Narrow screens: no more sideways scrolling.",
          },
        ],
      },
      {
        heading: "The gallery grew up",
        items: [
          {
            title: "A real header",
            body: "The gallery now has the table's header: every sortable column, the playset finish filter, and (while sorting by value) the MARKET/LOW and UNIT/COLLECTION switches — with the same amber bracket when a finish is engaged.",
          },
          {
            title: "Smarter card plates",
            body: "The pips under each card follow your finish filter (amber building, green complete), a completed plate lights its outline, and the copy count dropped the \"/3\" — you know what a playset is.",
          },
        ],
      },
      {
        heading: "One set selection, one language",
        items: [
          {
            title: "Set picks, unified",
            body: "Clicking a set in the completion panel's breakdowns and picking a set in the sidebar filter are now the same selection — no more two lists that could disagree.",
          },
          {
            title: "The Totals switch",
            body: "The completion boxes' scope control is now a proper switch (FILTERED / ALL) beside Collection value; when it reads FILTERED, it and the four boxes carry the amber narrowed signal.",
          },
          {
            title: "Amber means \"narrowed,\" everywhere",
            body: "The filter count badge went amber to match, and the header's version and fan-project links now share the buttons' blue hover glow.",
          },
        ],
      },
      {
        heading: "The catalog keeps up",
        items: [
          {
            title: "The 2026 promo wave is in",
            body: "134 new tournament promo printings across 82 cards: Galactic Championship, Sector and Planetary Qualifiers, Store Showdown — participation promos, prize walls, top-cut stamps, judge promos. If you earned it at an event this year, you can log it now.",
          },
        ],
      },
      {
        heading: "System upgrades",
        items: [
          {
            title: "The boring stuff",
            body: "The release pipeline now mechanically refuses to ship without an entry on this very page (you'll never wonder what changed), and releases mirror to GitHub for the changelog-inclined.",
          },
        ],
      },
    ],
  },
  {
    kind: "release",
    // BL-203 hotfix patch. Date finalized at promote time per the
    // release-notes ritual.
    key: "1.3.1",
    version: "1.3.1",
    date: "2026-08-11",
    title: "Big collections welcome",
    sections: [
      {
        heading: "Fixed",
        items: [
          {
            title: "Large imports no longer fail",
            body: "If you tried to import a collection with more than about 1,500 different cards, the import failed with an error — every time, every format, and retrying didn't help. That was our ceiling, not your file's. It's gone: imports of any size now go through, whether it's a HyperspaceVault export, a SWUDB export, or an SW-Unlimited-DB spreadsheet. If this bit you: sorry, and the exact same file will work now — no changes needed on your end.",
          },
        ],
      },
    ],
  },
  {
    kind: "release",
    // Owner renumber 2026-08-02: the post-announcement shipments (user caps,
    // Weekly Play pricing) do NOT get their own version -- they roll into
    // this release's notes instead. Date finalized 2026-08-07 at promote
    // time per the release-notes ritual (was the 2026-08-02 placeholder).
    key: "1.3",
    version: "1.3",
    date: "2026-08-07",
    title: "Imports and Reddit feedback",
    sections: [
      {
        heading: "What's new — literally",
        items: [
          {
            title: "[HSV] Updates & release notes",
            body: "The app now tells you what's new. An [HSV] Updates tab appears up top when there's news and steps aside once you've read it — and the version number in the corner reopens these notes anytime.",
          },
        ],
      },
      {
        heading: "Bring your collection with you",
        items: [
          {
            title: "Import straight from SWUDB",
            body: "Upload your SWUDB collection export as-is — no conversion, no AI middleman, no reformatting. The preview shows exactly what resolved (and calls out anything that needs your eye) before a single card changes.",
          },
          {
            title: "Import from SW-Unlimited-DB too",
            body: "Their spreadsheet export drops right in, same deal: upload the .xlsx, review the preview, done. And imports only ever add what your file claims — they never quietly remove anything.",
          },
          {
            title: "A preview that speaks collector",
            body: "When a row can't be matched, the preview now explains why in plain words — what went wrong up top in red, what to do about it right below — and lists the actual printings it might be: set, number, and name, not machine IDs. Problem rows and resolved rows each get their own clean table with the totals bar highlighting whichever you're viewing, and cards that share a number with tokens or promo printings now resolve to the card you actually meant.",
          },
        ],
      },
      {
        heading: "Straight from your feedback",
        items: [
          {
            title: "Keep-limits, your number",
            body: "The playset keep-limit is now yours to set. Settings has a new Keep-limits section with steppers for Leaders & Bases and for everything else (up to 999 — hoarders welcome), alongside the existing hard cap / soft cap / no limits enforcement. Collecting four-of for Twin Suns flexibility? Set it and forget it.",
          },
          {
            title: "Chase one finish, everywhere",
            body: "Tracking playsets against a specific finish? Open the playset finish filter — the dropdown on the Playset column header — and pick your finish; the whole Vault then follows it: card numbers and sort order switch to that finish's own numbers (exactly like your binder), the card popup opens on that printing, the ownership filters answer for that finish alone — \"cards I don't own\" means that finish, not any copy — and the amber highlights show you exactly what's adjusted.",
          },
          {
            title: "Add Cards knows the probable printing",
            body: "Early-set cards that share a number between foil and non-foil no longer stop to ask. The finish defaults to the likely one, highlighted so you can double-check — just hit Enter and keep going.",
          },
          {
            title: "Arrow through the printings",
            body: "In the card detail, up and down arrows now cycle through a card's printings — and left/right still walks the list. Hands never leave the keyboard.",
          },
          {
            title: "Gallery clicks keep your finish",
            body: "Filtering the gallery to a specific finish? Clicking a card now opens its detail on the exact printing you were looking at — not the standard art you'd then have to click away from.",
          },
          {
            title: "No more mystery waiting",
            body: "Big imports and batch adds now tell you what's happening while they work — how many cards are being applied, and when your Vault is refreshing — with a little aspect-glyph animation to keep you company.",
          },
        ],
      },
      {
        heading: "Prices",
        items: [
          {
            title: "Weekly Play prices, all the way back",
            body: "63 Weekly Play promos from the SOR/SHD/TWI era weren't getting prices. Now they are. Every Weekly Play printing across every set shows its market and low price.",
          },
          {
            title: "Deep price history, incoming",
            body: "Full price history for every priced printing — reaching back to March 2024, millions of data points — is curated and ready to load. Loading it needs about 30 minutes of system maintenance, which we'll schedule soon and announce right here. When it lands, your price-history panels go from weeks of memory to years.",
          },
        ],
      },
      {
        heading: "System upgrades",
        items: [
          {
            title: "The boring stuff",
            body: "Behind-the-scenes resilience work. Your collection is very thoroughly backed up.",
          },
        ],
      },
    ],
  },
  {
    kind: "release",
    key: "1.2",
    version: "1.2",
    date: "2026-07-31",
    title: "The Public Launch",
    sections: [
      {
        heading: "A new name, in the open",
        items: [
          {
            title: "HyperspaceVault, properly",
            body: "The app now wears its name: new wordmark, new title, one identity everywhere.",
          },
          {
            title: "Open source",
            body: 'The project\'s full source code is public on GitHub. Point your favorite LLM at it and ask "is this thing any good?"',
          },
        ],
      },
      {
        heading: "Prices & collection value",
        items: [
          {
            title: "Card prices everywhere",
            body: "Every printing shows current market and low prices (TCGplayer data, refreshed daily).",
          },
          {
            title: "Prices with a memory",
            body: "A price-history panel on every card detail, with real history reaching back over two years. Other trackers tell you what a card costs today; this one shows you where it's been.",
          },
          {
            title: "The chase finishes, priced",
            body: "Prestige, Showcase, and Weekly Play printings joined the pricing engine (coverage jumped from 83% to 93% of the catalog).",
          },
          {
            title: "Value column & Collection Value",
            body: "See each card's value right in the table with a UNIT/COLLECTION toggle and a MARKET/LOW switch, and the completion panel now shows what your whole collection is worth — overall, per set, or filtered.",
          },
        ],
      },
      {
        heading: "Deck Check",
        items: [
          {
            title: "Paste any decklist",
            body: "SWUDB .json or a URL from supported sites — instantly see what you own vs. what you're missing: three ownership scopes, full card lists, and the total cost of the gap.",
          },
          {
            title: "Buy the gap in one click",
            body: "Load your missing cards straight into a TCGplayer Mass Entry cart.",
          },
        ],
      },
      {
        heading: "Collection management",
        items: [
          {
            title: "Import & Export",
            body: "Your whole collection as a portable file. Export anytime; import back with a guided preview-then-commit flow. Your data is never locked in.",
          },
          {
            title: "Precon bulk add",
            body: "Add every card from any of the 22 preconstructed decks (starters, spotlight decks, Twin Suns) in one action.",
          },
          {
            title: "Playset tracking, your way",
            body: "The Playset cell shows your total count with a per-finish hover breakdown, and a header control lets collectors track playset progress against a specific finish (Hyperspace-only playsets, anyone?).",
          },
        ],
      },
      {
        heading: "A refreshed Vault",
        items: [
          {
            title: '"Inventory" is now the Vault',
            body: "Sharper name for the same home base.",
          },
          {
            title: "Rarity symbols",
            body: "The printed rarity glyph plus a color-coded label, in the table and the card popup.",
          },
          {
            title: "Filters, overhauled",
            body: "The completion panel's set blocks now filter the list, a three-way scope toggle controls what the panel counts, and the filter panel docks properly on smaller windows. Reset actually resets everything.",
          },
          {
            title: "New set & precon pickers",
            body: "Logo-rail dropdowns in canonical release order; precon rows preview the deck's leaders and base.",
          },
          {
            title: "Finish filter, tiered",
            body: "Tournament foils grouped and collapsible, foil/non-foil pairs fused onto one row. Far less scrolling.",
          },
          {
            title: "Prev/next in the card popup",
            body: "Arrow through your filtered list without closing the card.",
          },
          {
            title: "Polish everywhere",
            body: "A rotating set starfield in the header, smoother leader flips, richer Add Cards headers, and dozens of small fixes.",
          },
        ],
      },
      {
        heading: "System upgrades",
        items: [
          {
            title: "The boring stuff",
            body: "Security hardening, faster catalog loads, smarter rate limits, and a round of price-accuracy fixes — the stuff that keeps the fun stuff standing.",
          },
        ],
      },
    ],
  },
  {
    kind: "release",
    key: "1.1",
    version: "1.1",
    date: "2026-07-20",
    title: "A New Home",
    sections: [
      {
        items: [
          {
            title: "hyperspacevault.com",
            body: "The app moved to its own front door, with the old address redirecting forever. Update your bookmarks anyway.",
          },
          {
            title: "Sign in with Google",
            body: "One click, and existing email accounts with the same address link automatically.",
          },
          {
            title: "Account emails, from the source",
            body: "Verification and reset emails now come from noreply@hyperspacevault.com.",
          },
          {
            title: "Sharper cards table",
            body: "The whole name cell is clickable, empty stat badges no longer render as zeros, and leader cards flip naturally.",
          },
          {
            title: "Finish filter, first pass at taming it",
            body: "58 finish values collapsed into grouped, expandable rows.",
          },
          {
            title: "System upgrades",
            body: 'Invisible engine work that made everything in v1.2 possible (if you ever wondered what "laying groundwork" looks like: this).',
          },
        ],
      },
    ],
  },
  {
    kind: "release",
    key: "1.0",
    version: "1.0",
    date: "2026-07-14",
    title: "Initial Release",
    sections: [
      {
        heading: "The catalog",
        items: [
          {
            title: "Every Star Wars: Unlimited card",
            body: "9,000+ printings across 28 sets and promo releases, browsable by anyone without an account.",
          },
          {
            title: "Two ways to browse",
            body: "A fast full-catalog table and a card-image Gallery with finish-aware artwork and per-finish ownership on hover.",
          },
          {
            title: "Card detail view",
            body: "Every printing of a card with quantities, plus leader card flip.",
          },
        ],
      },
      {
        heading: "Your collection",
        items: [
          {
            title: "Track exact printings",
            body: "Quantities recorded per set, stamp, and finish, with reprints and parallel printings resolved automatically.",
          },
          {
            title: "Add Cards flow built for speed",
            body: "Type-ahead resolver that only asks for what's ambiguous (set, stamp, finish), batch entry, live card image preview.",
          },
          {
            title: "Playset progress",
            body: "See at a glance which cards are at a full playset.",
          },
          {
            title: "Keep limits",
            body: "Three per variant, enforced your way: hard cap, soft cap, or no limits.",
          },
        ],
      },
      {
        heading: "Finding cards",
        items: [
          {
            title: "Faceted filters",
            body: "Set, aspect (with Any/Within/Exact matching), rarity, type, cost, power, HP, trait, keyword, arena, finish — every filter narrows to what's actually available.",
          },
          {
            title: "Ownership filters",
            body: "Only cards you own, or only cards you're missing.",
          },
        ],
      },
      {
        heading: "Accounts",
        items: [
          {
            title: "Email sign-up with verification",
            body: "Plus password reset, change password, and full account deletion (your data, purged on request).",
          },
        ],
      },
      {
        heading: "The look",
        items: [
          {
            title: "SWU-themed identity",
            body: "Starfield header, console-styled stat badges and panels, themed scrollbars, and a feedback button that goes straight to the maintainer.",
          },
        ],
      },
    ],
  },
];
