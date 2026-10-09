---
name: Mahub
description: Secure class attendance that looks like Apple Wallet and Settings, with one pass colour per class.
colors:
  tint: "#0066cc"
  tint-fill: "#0071e3"
  tint-fill-hover: "#0062c4"
  tint-wash: "#e5f0fc"
  grouped-ground: "#f2f2f7"
  surface: "#ffffff"
  surface-pressed: "#e9e9ee"
  separator: "#c6c6c8"
  ink: "#000000"
  ink-muted: "#6c6c70"
  success: "#1a7230"
  success-wash: "#e3f4e7"
  danger: "#d70015"
  danger-wash: "#fde7e9"
  warning: "#8a5300"
  warning-wash: "#fdf0d9"
  neutral: "#5e5e63"
  neutral-wash: "#ececf0"
  pass-teal: "#0b7a75"
  pass-indigo: "#4b44c8"
  pass-orange: "#b4530a"
  pass-pink: "#b4245e"
  pass-slate: "#4a5568"
  pass-purple: "#7e3aae"
  pass-text: "#ffffff"
  board: "#000000"
  board-text: "#ffffff"
  board-muted: "#c7c7cc"
  qr-tile: "#ffffff"
  tint-dark: "#4da3ff"
  grouped-ground-dark: "#000000"
  surface-dark: "#1c1c1e"
  surface-pressed-dark: "#2c2c2e"
  separator-dark: "#38383a"
  ink-muted-dark: "#aeaeb2"
  success-dark: "#30d158"
  danger-dark: "#ff6961"
  warning-dark: "#ffb340"
typography:
  large-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, 'Noto Sans Thai', 'Helvetica Neue', sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title-1:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, 'Noto Sans Thai', 'Helvetica Neue', sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.15
  title-2:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, 'Noto Sans Thai', 'Helvetica Neue', sans-serif"
    fontSize: "22px"
    fontWeight: 600
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Noto Sans Thai', 'Helvetica Neue', sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.4
  subhead:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Noto Sans Thai', 'Helvetica Neue', sans-serif"
    fontSize: "15px"
    fontWeight: 400
  footnote:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Noto Sans Thai', 'Helvetica Neue', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Noto Sans Thai', 'Helvetica Neue', sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.04em"
  stat:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, 'Noto Sans Thai', 'Helvetica Neue', sans-serif"
    fontSize: "clamp(2.75rem, 7vw, 3.5rem)"
    fontWeight: 700
    lineHeight: 1
    fontFeature: "tnum"
  board:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, 'Noto Sans Thai', 'Helvetica Neue', sans-serif"
    fontSize: "clamp(5rem, 22vh, 12rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
rounded:
  default: "12px"
  pass: "20px"
  pill: "999px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "20px"
  space-6: "24px"
  space-8: "32px"
  space-10: "40px"
  space-12: "48px"
  space-16: "64px"
components:
  button-primary:
    backgroundColor: "{colors.tint-fill}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.default}"
    padding: "0 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.tint-fill-hover}"
  button-secondary:
    backgroundColor: "{colors.tint-wash}"
    textColor: "{colors.tint}"
    rounded: "{rounded.default}"
    height: "44px"
  button-destructive:
    backgroundColor: "{colors.danger-wash}"
    textColor: "{colors.danger}"
    rounded: "{rounded.default}"
    height: "44px"
  button-block:
    width: "100%"
    height: "50px"
  button-on-pass:
    backgroundColor: "{colors.pass-text}"
    rounded: "{rounded.default}"
    width: "100%"
  badge-success:
    backgroundColor: "{colors.success-wash}"
    textColor: "{colors.success}"
    typography: "{typography.footnote}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
    height: "22px"
  badge-danger:
    backgroundColor: "{colors.danger-wash}"
    textColor: "{colors.danger}"
    rounded: "{rounded.pill}"
  badge-warning:
    backgroundColor: "{colors.warning-wash}"
    textColor: "{colors.warning}"
    rounded: "{rounded.pill}"
  badge-neutral:
    backgroundColor: "{colors.neutral-wash}"
    textColor: "{colors.neutral}"
    rounded: "{rounded.pill}"
  list:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.default}"
  list-row:
    textColor: "{colors.ink}"
    padding: "12px 16px"
    height: "44px"
  pass:
    backgroundColor: "{colors.pass-teal}"
    textColor: "{colors.pass-text}"
    rounded: "{rounded.pass}"
    padding: "20px"
  tab-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-muted}"
    height: "56px"
---

# Design System: Mahub

## Overview

**Creative North Star: "The Class Pass"**

Mahub looks like a stock iPhone app: Apple Wallet for the classes, Settings for everything else. Each class is a coloured pass, and that colour follows the class to every screen: the instructor's home, the live session header, the projector band, the student's result and the colour dots in lists. Everything around the passes is plain: the device's own font, grouped inset lists on a grey ground, and blue as the only interactive colour.

The screens are quiet and dense enough to scan quickly. There's one main action per screen and one moment of motion (the result pass sliding up). Light and dark follow the device, and the projector is always dark. The CSP forbids `style=""` attributes and external assets, so every visual decision is a class in `src/ui/ui.css` reading a token from `src/ui/tokens.css`.

**Key Characteristics:**
- One Wallet-pass colour per class, with white text, used for identity only.
- Status appears only as small tinted badges (and the two tinted stat numbers).
- The system font, iOS text sizes, and tabular digits for every number.
- Grouped inset lists (12px) on a grey ground; passes are rounder (20px).
- Flat surfaces. Soft shadows only on passes, dialogs and the selected segment.

## Colors

The palette is neutral iOS greys plus a single blue tint. Saturated colour is reserved for the six class passes and the four status tones.

### Primary
- **System Blue** (`tint`, dark `tint-dark`): links, tinted buttons, the active tab, alert actions and the focus ring. Filled buttons use the slightly brighter **Fill Blue** (`tint-fill`), which keeps white text at 4.6:1.
- **Blue Wash** (`tint-wash`): the background of secondary buttons and text selection.

### Secondary: class passes
- **Teal, Indigo, Orange, Pink, Slate, Purple** (`pass-*`): one per class, all carrying white text at 4.5:1 or better, with the same values in light and dark. Set the colour with a `pass-<colour>` class on the container. It sets `--pass-bg`, which the pass, session header, projector band, colour dot and on-pass button/badge all read.

### Tertiary: status
- **Success green, Danger red, Warning amber, Neutral grey**, each a text colour on its own wash. Light-mode badge contrast is 5.26 (success), 4.56 (danger), 5.62 (warning) and 5.47 (neutral) to 1. Danger sits at the AA floor, so don't lighten it or put it on any background other than its wash or white.

### Neutral
- **Grouped Ground** (`grouped-ground`): the page background, like iOS Settings. It's pure black in dark mode.
- **Surface** (`surface`): lists, cards, stat tiles, the session board and dialogs.
- **Pressed Surface** (`surface-pressed`): pressed or hovered rows, the segmented control track, and hovered alert buttons.
- **Separator** (`separator`): row dividers, bar borders and table rules.
- **Ink / Muted Ink** (`ink`, `ink-muted`): body text, and secondary text (subtitles, group headers, footnotes, inactive tabs).
- **Board** (`board`, `board-text`, `board-muted`): the projector, which is black whatever the laptop's setting. The **QR Tile** is always pure white.

### Named Rules
**The Colour Is Identity Rule.** A class colour says *which class*, never *how it went*. No green pass (green means present), and no red or amber pass meaning "problem". Status always goes in a Badge.

**The One Tint Rule.** Blue is the only colour for things you can tap. Don't introduce a second accent.

## Typography

**Display Font:** system UI (SF Pro Display on Apple devices, falling back to Segoe UI, Roboto, Noto Sans Thai)
**Body Font:** system UI (SF Pro Text, with the same fallbacks)
**Mono:** `ui-monospace`, for code only. Numbers stay in the system font with tabular digits.

**Character:** the phone's own voice, so nothing is downloaded and Thai names render. Hierarchy comes from size and weight, never from a second family.

### Hierarchy
- **Large Title** (700, 34px, 1.15, -0.01em): one per screen, at the top. It drops to 28px under 720px.
- **Title 1** (700, 28px, 1.15): pass titles and session titles.
- **Title 2** (600–700, 22px): the count label and the rate on a pass.
- **Body** (400, 17px, 1.4): list titles and buttons (buttons use 600).
- **Subhead** (15px): list subtitles, pass codes and subtitles, the table, the segmented control.
- **Footnote** (13px, 1.35): group headers (uppercase, 0.02em, the iOS list-section style), group footers, badges (600), alert messages.
- **Caption** (600, 12px, uppercase, 0.04em): only the field labels on a pass, as on a Wallet boarding pass.
- **Stat / Board** (700, tabular digits, line-height 1): big rates and counts. The board size, `clamp(5rem, 22vh, 12rem)`, is for the projector count only.

### Named Rules
**The Tabular Digits Rule.** Every student number, time, count and rate uses tabular digits (`.mono`, or `font-variant-numeric: tabular-nums`), never the monospace font.

**The Uppercase Belongs To iOS Rule.** Uppercase appears in exactly two places: grouped-list section headers and pass field labels. Don't add uppercase labels above titles anywhere else.

## Layout

Spacing is a 4px scale (`space-1` to `space-16`). The common steps are 16px row and page padding on phones, 20px pass padding and grid gaps, and 32px between groups.

- **Instructor (laptop):** a sticky app bar, then content up to 1040px wide with 20px side padding (16px under 720px). Passes sit in an auto-fill grid with a 300px minimum and 20px gaps.
- **Student (phone):** a 560px column with a fixed bottom tab bar (56px plus the safe area). The page bottom padding clears the tab bar. Passes are stacked with 16px gaps.
- **Check-in and sign-in:** a single centred column with one full-width button (50px tall).
- **Projector:** a full-height grid (class-colour band, then the QR beside the count, then a footer). It stacks under 720px.
- The only breakpoint is 720px: stat tiles go from 4 to 2 columns, the session board and projector stack and centre, and `.hide-on-phone` hides secondary columns.
- Tap targets are at least 44px everywhere (rows, buttons, tabs, back link, segments, alert buttons).

## Elevation & Depth

Depth is mostly tonal: white surfaces on a grey ground (dark grey on black in dark mode). Shadows are soft, diffuse and only on things that sit above the page.

### Shadow Vocabulary
- **Pass lift** (`--shadow-pass`: `0 1px 2px rgb(0 0 0 / 0.08), 0 8px 24px rgb(0 0 0 / 0.08)`): class passes and the confirm dialog.
- **Control lift** (`--shadow-control`: `0 1px 3px rgb(0 0 0 / 0.12), 0 1px 1px rgb(0 0 0 / 0.04)`): the selected option in a segmented control.
- **Bar material:** the app bar and tab bar use `saturate(180%) blur(20px)` over an 82% surface or ground. Only these two floating bars get blur.

### Named Rules
**The Flat Lists Rule.** Lists, cards, stat tiles and the session board have no shadow. If it isn't a pass, a dialog or a selected segment, it's flat.

## Shapes

- **Lists, cards, buttons, stat tiles, alerts and the QR tile** have a 12px radius (`rounded.default`). The dialog is slightly rounder (14px), like an iOS alert.
- **Passes, session headers and the session board** have 20px (`rounded.pass`). The larger radius is how you can tell a pass from a list.
- **Badges** are pills. Colour dots and the live dot are circles.
- The segmented control is iOS-native at 9px (track) and 7px (segment).
- Borders are 1px hairlines in the separator colour. Row separators are inset 16px so they start where the text starts.
- Icons are 24×24 inline SVG with 2px rounded strokes in `currentColor`, marked `aria-hidden`. Text next to an icon carries the meaning.

## Components

### Buttons (`Button`, `ButtonLink`, `ButtonRoute`)
Three components share one look: `Button` for actions, `ButtonLink` for real server URLs (login), and `ButtonRoute` for in-app navigation.
- **Shape:** 12px radius, at least 44px tall, 20px side padding, 17px semibold.
- **Primary:** Fill Blue with white text. Use it for the one main action on a screen.
- **Secondary:** blue text on Blue Wash, for other actions.
- **Destructive:** red text on Danger Wash, for actions like ending a session (always behind a `ConfirmDialog`).
- **Modifiers:** `button-block` makes it full width and 50px tall (the one big phone action). `button-on-pass` is white with the pass colour as text, placed on a pass.
- **States:** pressing scales to 0.98 at 85% opacity. Hover darkens primary, and dims secondary and destructive to 96% brightness. Disabled is 40% opacity; busy (`aria-busy`) is 70%.

### Badges (`Badge tone=…`)
- Small tinted pills: 22px tall, 13px semibold. The tones are `success` (present, live), `danger` (absent), `warning` (reserved: nothing uses it today) and `neutral` (excused, not checked in).
- On a pass, a badge turns white with the pass colour as text.

### Grouped lists (`List`, `ListRow`)
- A rounded white panel of rows, with an optional uppercase footnote header and a footer note.
- A row has an optional leading item (such as a colour dot), a title with an optional subtitle, and an optional right-side detail (value, badge or time). Passing `to` makes the whole row a link with a chevron and a pressed-grey state.

### Class pass (`Pass`), the signature component
- A 20px-radius card in the class colour with white text and Pass lift. It has the course code (with an optional corner such as a badge, check or rate), a Title 1 title, a subtitle, and optional label-over-value fields under a 30%-white divider. A button can go at the bottom.
- Without a corner, the code joins the subtitle line, so a lone code never floats above the title as a label.
- `pass-enter` (450ms, `cubic-bezier(0.16, 1, 0.3, 1)`, from 40% opacity and 32px lower) is the app's only entrance animation, used when check-in succeeds. It is off under reduced motion.

### Segmented control (`SegmentedControl`)
- An iOS segmented control: a grey track, and a white raised segment for the selected option (`aria-pressed`). Segments are at least 96px × 44px. On a session header it uses a dark translucent track, and the selected segment is white with the pass colour as text.

### Stat (`Stat`)
- A big tabular number over a subhead label. Tiles sit in a 4-column (2 on phone) grid on white 12px panels. The `success` and `danger` tones colour only the number.

### Navigation
- **Instructor app bar (`Layout`):** sticky, translucent and blurred, at least 52px tall, with the bold app name on the left and the user's name and sign-out on the right.
- **Student tab bar (`StudentLayout`):** fixed to the bottom, translucent and blurred, with 26px icons over 11px labels. Inactive tabs are muted and the active tab is blue. Checking in is not a tab.
- **Back link:** "‹ Title" in blue, at least 44px tall.

### Confirm dialog (`ConfirmDialog`)
- A native `<dialog>` styled as an iOS alert: 320px wide, centred text, 14px radius, Pass lift, and a 40% scrim (60% in dark mode). It has two equal buttons divided by hairlines; the destructive one is red and semibold.

### Action sheet (`ActionSheet`)
- A native `<dialog>` styled as an iOS action sheet: a grouped panel of 56px choices in 20px tint text, with a separate Cancel below. It rises from the bottom on phones and is centred on laptops. Destructive choices are red. Esc or a tap on the scrim cancels. The sheet animates in over 150ms (a state transition, not a second signature motion).
- Use it for "what do you want to do with this one thing?" (e.g. marking a student). Use `ConfirmDialog` when the question is "are you sure?".

### Table (`Table`)
- A list with columns, used for the roster: subhead text, footnote muted headers, hairline row rules and 12px × 16px cells (8px between columns on phones). It scrolls sideways inside its wrapper rather than the page. Columns can opt out on phones (`hideOnPhone`).

### Roster rules
- **No flags.** There are no "unusual GPS" or "off campus" labels (dropped). The instructor decides by looking at the room and marks exceptions by hand.
- **Manual marks:** each row ends in a tint "Change" button that opens an `ActionSheet` (Mark present · Mark excused · Clear mark). Rows set by hand show a muted "Marked by hand" note (`attendance.method = 'manual'`).
- While a session is open, "absent" reads **Not checked in** (neutral); "Absent" (danger) appears only after the session ends.

## Do's and Don'ts

### Do:
- **Do** give a class its `pass-<colour>` class once on the container and let `--pass-bg` colour everything inside it.
- **Do** show attendance status with `Badge` (success / danger / warning / neutral) and nothing else.
- **Do** put tabular digits on every number (`.mono`).
- **Do** keep every tap target at least 44px (`--tap-target`).
- **Do** use one primary button per screen. On phones, make it `button-block`.
- **Do** take every colour, size and space from `tokens.css`, and style with classes in `ui.css`. The CSP blocks `style=""`.
- **Do** check new colour pairs for 4.5:1 contrast in both light and dark.
- **Do** keep the QR on pure white with a wide quiet zone, in both modes.

### Don't:
- **Don't** use a class colour to mean status, and don't add a green pass colour.
- **Don't** add a second accent colour, web fonts, or any asset from another origin.
- **Don't** put shadows on lists, cards or stat tiles, or use blur anywhere except the app bar and tab bar.
- **Don't** add animations beyond `pass-enter`. Other changes are 150ms state transitions, and reduced motion must be respected.
- **Don't** add a light/dark toggle (the app follows the device), and don't let the projector go light.
- **Don't** add uppercase labels above titles. Uppercase is only for list section headers and pass field labels.
- **Don't** use emoji or icon fonts for icons. Add a 24×24 stroked SVG to `icons.tsx`.
