# ADR-0029: Card scanning — on-device reader, recognise-then-prompt, printed-code collisions as picks

## Status
Accepted — 2026-10-10 (BL-238 camera spike, owner decisions during the 2026-10-09/10 live test session; feature **specified, not built** — App Spec §24)

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
