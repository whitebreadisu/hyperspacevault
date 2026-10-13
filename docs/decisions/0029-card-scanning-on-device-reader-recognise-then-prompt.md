# ADR-0029: Card scanning — on-device reader, recognise-then-prompt, printed-code collisions as picks

## Status
Accepted — 2026-10-10 (BL-238 camera spike, owner decisions during the 2026-10-09/10 live test session; feature **specified, not built** — App Spec §24)

### Amendment — 2026-10-11: built (BL-253, slices 7a-7c)
Status is now **built**: the scanner shipped as the camera mode of the phone's tool layer (App Spec §24 as-built flip, §25.7 facts). Decisions 1-7 stand as written. What the build added, and why:
- **Isolation is per document, not site-wide.** Four Paddle threads need `SharedArrayBuffer`, i.e. cross-origin isolation, and a site-wide COEP breaks the Google sign-in popup. The camera therefore lives in a second Vite entry, `/scan/`, served with COOP/COEP only on `/scan/**`, the vendored payload and the worker script; the main document is untouched. `/scan/` serves the full app bundle so nothing leaves the document while the camera is in use; sign-in (a popup) bounces to `/` and returns. Alternative rejected: single-thread Paddle in the main document.
- **Batch across the hop.** The batch and tool mode are mirrored to `sessionStorage`, so the document hop does not empty it.
- **Payload in the repo.** The reader payload (33 MB on disk, ~7.6 MB over the wire, immutable cache) is vendored under `frontend/public/vendor/scan/` in plain git; it loads when the camera route opens, Tesseract only at the first fallback need.
- **Crop padding follows the shipped spike code** (3.15 mm on every side); the "0.6 mm right of ©FFG" sentence in the pre-build §24.3 was stale and is superseded (archived verbatim).
- **Not build gates:** the timed pile against the keypad, >= 110 attempts, collision evidence from the community and a second phone are collected on the real app in the owner's LAN rounds.

### Amendment — 2026-10-13: the strip identifies the card; Fast add asks only for what the strip cannot say; hold 1 s; no timed wait after an add (BL-262)
Owner decisions on his iPhone, 2026-10-12 and 2026-10-13. Decisions 1, 2 and 4-7 stand; this supersedes the Fast add sentence of Decision 3 (verbatim in `SWU_Application_Spec_Archive.md`, "Archived 2026-10-13 — camera Fast add, hold and suppression (BL-262)"). As built: App Spec §24.2 and §25.7.
- **The bug.** With Fast add on, a scanned card whose number is shared was added as the base-set card and the scanner moved on. The reader was not at fault: it reads one card (the denominator names the printing). The add, however, went through the keypad resolver on set + number alone, and that resolver settles a number shared inside a set family on a default — the base-set card, the Base Set event — leaving the choice on the panel. Prompt mode shows that panel and waits; Fast add took the default. Measured on the live catalogue (8,719 strip reads the loop classes as one card): 706 were added past a question, 99 of them as another card than the one read (36 Weekly Play printings on a base-set number, 3 base-set cards whose default is another card, 60 tokens); after a tournament-tier pick, 16 of 23 rows were added as another card.
- **The rule: trust what the strip says** (owner, 2026-10-13). A read carries the printings its strip names, and the camera shows and adds from those alone — one function, `readIdentity`, behind the automatic add, Add to batch, the found panel and the pick list's rows. One printing: that card and printing; Fast add adds it at once and the prompt opens on it. Several printings of one card: that card, with the choice among exactly those printings. Printings of more than one card: the pick list (the reader's ambiguous read, unchanged), and the picked row then follows the first two. Nothing the strip did not identify is ever offered, defaulted to or added. The same fault was in the prompt, and is fixed with it: the panel opened on the keypad's default and Add to batch added it — the base-set card for a Weekly Play strip.
- **Why the camera does not use the keypad's default.** The keypad resolves a typed set and number, and for a number several cards share, the base-set card is the right default for typed input. A strip says more than a typed number: `N/252` against `N/20`, a `T` before the number, the printed code. Passing a read back through the keypad's resolver discards exactly that, and the resolver then answers a different question — IG-88 for Resupply's `SOR 12/20`, Saw Gerrera for the Credit token's `LAW T1`. A first version of this fix (on the branch, never merged) kept the keypad's resolver and made Fast add stop whenever the resolver showed a card, Set or Stamp choice: it added no wrong card, but it stopped on about 600 base-set strips that had been read unambiguously, and the panel still opened on the keypad's default. The owner chose the read over the resolver. The keypad is unchanged.
- **Early sets: ask foil or non-foil each time** (owner, 2026-10-13). SOR, SHD and TWI print the same strip on the foil and the non-foil printing, so the strip identifies two printings and nothing on the card's face tells the reader which. Under Fast add these stop for the Finish choice every time and the answer adds it: nothing is logged as the wrong finish, at the cost of one tap per early-set card (1,339 of the 8,915 strips the reader classes as one card on the live catalogue; none in JTL or later). In the prompt the non-foil default (BL-191) is shown with the choice left up and Add to batch adds what is shown — both printings are ones the strip identified.
- **Measured after** (live catalogue, every strip its printings carry — 8,967 strips, a slightly wider list than the bug measurement's): of 8,915 one-card reads, 7,555 are one printing and are added at once as that printing (546 of them on a number another card also holds, 9 Weekly Play printings on a base-set number, 66 tokens — the classes that were added wrong or stopped needlessly), 1,339 ask Finish, and 21 are Serialized Prestige printings no choice can tell apart, which resolve to the first as on the keypad; no read resolves to a card or printing outside its strip's, in either flow. Of the 109 pick rows, 97 are added at once after the pick and 12 (tournament tiers with two stamps) ask Stamp among the picked card's own printings.
- **Hold 1.5 s → 1 s.** Owner request; the on-screen text and the bar follow one constant.
- **No timed same-card wait after an add.** The spike suppressed the same code for 3 s after every decision. The owner removed it after an add: "the camera reset of 1 second should be enough friction for the user to move the card or camera or both." What still guards a double add: the 1 s hold; under Fast add the reader ignores the card until it has left the frame (the spike's auto-accept rule, unchanged) and its 2 s duplicate window; in prompt mode nothing is added without a tap — the same card left in view is prompted again. Known edge, unchanged in kind and now possible 2 s after the hold instead of 3 s: under Fast add a card left in view that is unreadable for a full second and then reads again counts as gone and back.
- **The 3 s wait stays after Wrong card** (and "Neither · scan again"). There it was never a double-add guard: it stops the read the user just rejected from coming straight back when the scan restarts. Orchestrator call, flagged to the owner.
- **Not changed:** how a read is produced or accepted — the reader, the thresholds, the agreement rule, the guide, the re-arm and duplicate windows — and the keypad. No analytics event or value was added; Add to batch is `camera`, an add with no Add tap (at the read, after a pick, or after the Finish / Stamp answer under Fast add) is `camera_fast_add`, as before.

## Context
BL-190 (mobile) reserved a place for camera entry from the outset, and
BL-238 asked one question: can a phone **browser** identify a card
reliably and quickly enough for entry by reading the printed set code,
collector number and denominator on the card's bottom strip — never by
recognising artwork? The definition (`planning/Definition_BL238_...`,
private layer) staged the experiment and named the risks: text 1.5 mm tall
versus the main lens's 24 cm minimum focus, glare on foils and sleeves,
wrong reads being worse than no reads, and Tesseract's known weakness on
small photographed text.

The spike ran as a disposable test page on a Firebase preview channel,
iterated six times in one evening against the owner's iPhone 16 Pro
(iOS 18.7, Safari 26.6) with his own mix of foil, non-foil, sleeved and
unsleeved cards. The exports (1,442 → 527 reads per run, every read
logged with sharpness, text size, reader, timings and sampled crops)
established:

- Safari grants a 4K portrait stream, zoom 0.5–10×, torch and a focus
  distance control; seven cameras are enumerated. Optics are not the
  limit.
- Blur was the first limit (61% of frames in run 1 produced nothing); a
  pre-OCR sharpness gate with an on-screen meter removed it. Zoom applied
  automatically was rejected by the owner — distance is the user's control.
- **Tesseract was the second limit**: on sharp, human-readable frames it
  returned fragments. Replaying the stored crops on the PC, PaddleOCR
  read 98 of 192 against Tesseract's best mode at 68 and its single-line
  mode at 14; on the 32 frames the phone had garbled, Paddle read 16,
  Tesseract 10 and 0. In the browser Paddle loads in ~1 s (7.6 MB over
  the wire, cached) and reads in 60–100 ms on four threads once the page
  is cross-origin isolated.
- **Every valid key has a one-digit neighbour** (census of 1,200 keys), and
  cards printed without a denominator (Hyperspace, Prestige) are the most
  exposed: 795↔785 was observed. Two agreeing reads were not enough; a
  silent wrong accept of Paz Vizsla for The Mandalorian happened once
  under that rule and never under three-of-four with a per-reader
  confidence bar.
- **Physical print differs from the digital image for Store Showdown
  promos**: the owner's Grogu "Yes. Yes. Yes." (catalogue P26 16) prints
  `ASHP • EN 16`, colliding with Weekly Play ASHP 16 (Emperor's
  Messenger). Nothing on the strip but a small program icon separates
  them. The definition's risk 9 is confirmed; the extent across other
  promo series is unknown.
- iOS Safari has no Vibration API and the switch-control haptic trick
  toggles without being felt; an audio beep is heard.
- Across the evening, median time from first text to a recognised card
  fell from 10.3 s to 0.8 s; p90 from 52 s to 2.3 s; no wrong card was
  offered to the owner under the final rules over 48 prompts.

The owner also settled the product flow during the session: continuous
"scan adds cards in succession" is **not** the product; a recognised card
is shown and the user decides, with an opt-in fast path.

## Decision
1. **Browser camera, on-device reader, no cloud.** Scanning is a web
   feature of the mobile experience (no app, no install — BL-190). Frames
   never leave the phone. **PaddleOCR (PP-OCR tiny det+rec on
   onnxruntime-web, wasm, multi-threaded) is the primary reader**; Tesseract
   runs only as a fallback when Paddle returns no code or number on a sharp
   frame, in block mode (PSM 6) then single-line (PSM 7). A cloud reader is
   not adopted: the on-device path met the need, and a cloud path would add
   per-frame cost and an image-privacy disclosure the analytics disclosure
   (App Spec §22) does not cover.
2. **Read the strip, validate against the catalogue.** The reader sees only
   the identification group (`SET • EN [icon] number[/denominator]`),
   cropped from the full-resolution stream by a guide drawn from measured
   card geometry (App Spec §24.3). A read is a triple; the denominator
   separates early-set main cards from Weekly Play (`12/252` vs `12/20`);
   a missing denominator in SOR/SHD/TWI maps to non-main printings, never
   silently to the main card. One-digit denominator confusions against a
   known set size are corrected and logged; a second valid number after the
   code makes the read ambiguous rather than a guess.
3. **Recognise, then the user decides.** Default mode: on a successful read
   the scanner pauses and shows the card exactly as the keypad shows a
   resolved card (art, name, printing, ownership readout) with **Card
   details / Add / Wrong card** (Wrong card restarts the scan; the keypad
   stays one tap away via the tool's mode toggle). Nothing is counted
   until Add. **Fast add** (opt-in, remembered): a successful read
   adds immediately and the scanner holds ~1.5 s before reading again — the
   guard against double adds.
4. **Acceptance needs three agreeing reads of the last four**, with a
   confidence bar per reader (Tesseract ≥ 30, Paddle ≥ 60, judged as the
   median of each read's ratio to its own bar), because every key has a
   one-digit neighbour. A minimum glyph height blocks acceptance of
   too-small text ("move closer"). Frames below a sharpness threshold are
   never read ("blurry — move back / closer").
5. **Printed-code collisions are picks, never guesses.** The printed-code
   table maps `ASHP` → {ASHP, P26}; any read whose candidates span two
   programs is shown amber with the program names for the user to choose.
   The table grows only on physical evidence (the community will be asked
   to check their Store Showdown cards when mobile launches — BL-238
   release note). The same evidence gate as ADR-0028 applies in reverse:
   a printed code that collides is a hazard for direct import mapping.
6. **Feedback is a beep plus a brief green flash.** No haptics on iPhone.
7. **The user controls distance.** No automatic zoom; optional presets
   and a focus-distance control are allowed as explicit user actions. The
   guide shows the card's bottom-right corner outline with the group box
   centred in the preview and the surroundings dimmed for the user only.

## Consequences
- Open Question G trigger (2) — "a scanning feature whose web camera UX
  proves inadequate" — **does not fire**. The web camera is adequate on
  the one phone tested.
- The decision rests on one phone and one evening. Before build, the
  go/no-go thresholds in the definition (≥ 110 attempts, Stage 3 pile vs
  keypad) remain owed; the tool and its per-condition scoreboard exist to
  run them. Results so far: 0 wrong cards offered under the final rules,
  but fewer than 110 attempts and no timed pile against the keypad.
- The spike's parser (`scan-core.js`), reader plug-in interface and
  Paddle bundle are the seed of the implementation, not a reference to
  reinterpret. The app's guide must use the measured fractions in App
  Spec §24.3 so it matches what was tested; the owner expects to keep
  refining them.
- Adding ~8 MB (cached) to first use of the scanner is accepted for the
  on-device path; the download happens on entering the camera, not on
  app load.
- The physical-print finding opens a data question outside this ADR:
  what collection tools write for a Store Showdown card, and whether the
  catalogue needs a printed-code table that lists P26 under ASHP. Filed
  with BL-238 for follow-up.

## Related
- App Spec §24 (specification), §17.5 / ADR-0028 (printed codes map
  direct — the collision hazard), §22 (analytics disclosure scope).
- BL-190 mobile design brief; BL-238 definition, runbook, results and the
  2026-10-09 session notes (private layer).
