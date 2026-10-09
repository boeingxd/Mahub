# Concept: Wallet passes

Mahub should feel like an app that came with the phone: Apple's font, Settings-style grouped lists, and familiar controls. Its one signature is borrowed from Apple Wallet: **every class is a pass with its own colour**, and that colour follows the class everywhere.

| Screen | What the pass does |
|---|---|
| Instructor home | One pass per section, each with a white **Start check-in** button |
| Live session | The header is the class's pass; the class sees only the QR and the count |
| Projector | A band in the class colour over a black screen, with the QR and a huge count |
| Student check-in | The class pass, one button; afterwards the pass slides up with **Checked in** |
| Student home | The student's classes stacked like cards in Wallet, each with their own rate |

## How it was chosen
- The first direction ("boarding pass": condensed caps, departure board, rubber stamps) was rejected as **too loud** and **a gimmick**.
- The user's anchor is Apple (Wallet, Settings), with the apple-design skill (Apple's Human Interface Guidelines) as a reference.
- The user picked "Wallet passes" over "Settings, plainly" (all grey lists with an animated checkmark).
- No concept-roll script was run; `mahub-wallet-passes` in `index.html` is just a label.

## Evidence
- **Loved objects:** train/boarding tickets (kept as the Wallet pass), exam papers and ID cards, receipts and shop signage.
- **Anti-references:**
  - the predecessor's generic dark-teal "AI" look, although its **flow** was good and is copied
  - the boarding-pass costume
- **Student takeaway:** "Done, I'm checked in".

## Rules this concept implies
- **Colour:**
  - Each class colour **identifies** a class and never means status.
  - Status uses small tinted badges: green present, red absent or problem, amber "check".
  - Primary actions are system blue.
- **Type:** the system font (San Francisco on Apple devices), in sentence case with iOS text sizes. Numbers use equal-width digits, not a code font.
- **Layout:**
  - Grey grouped background with rounded white groups.
  - Passes have a 20px radius; lists and buttons have 12px.
  - Touch targets are at least 44px.
- **Light and dark** follow the device; there's no switch in the app.
- **Motion:** one moment, the result pass sliding up. A slow dot pulses while check-in is open. Nothing else animates.

## Risks
- **Anonymous "iOS clone":** the class colours have to do the work. Never drop them for grey.
- **Too many colours:** keep each colour on its own class, and keep status colours as small badges.
