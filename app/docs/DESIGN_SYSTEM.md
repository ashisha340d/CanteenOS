# MenuBoard Mobile — Design System

This document is the visual authority for the `app/` mobile client. It complements the
engineering conventions in `../AGENTS.md`. All screens and components consume the tokens and
primitives defined here.

## Philosophy

- **Information First, Emotion Second, Beauty Always, Speed Above Everything.**
- Premium consumer-product feel (Apple HIG, Linear, Notion, Things 3), never an
  enterprise/POS/admin aesthetic.
- High-density but readable; minimal UI chrome; touch-first; every tap gives immediate
  feedback.

## Tokens

Single source of truth: `src/theme/tokens.ts`.

### Colors

A refined, calm palette with clear semantic meaning:

- Brand: `primary50` → `primary900`. Primary action color is `primary600`.
- Neutrals: `gray50` (page bg) → `gray900` (primary text).
- Semantic: `success*`, `warning*`, `danger*`, `info*`.
- Surfaces: `background`, `surface`.
- Text: `textPrimary`, `textSecondary`, `textMuted`, `textInverse`.

Order status colors live in `tokens.ts` as `status{Pending,Acknowledged,WorkInProgress,Completed,Cancelled}`.

### Spacing

Tight 4-pt based scale from `0` to `24` (multiples of 4, with a few half steps). Use the
`spacing` object, never inline numbers.

### Typography

A 7-step scale: `display`, `title1`, `title2`, `title3`, `body`, `callout`, `caption`,
`footnote`. Each step exposes `size`, `lineHeight`, `letterSpacing` and `weight`. Large
confident titles; clear hierarchy.

### Radii & shadows

`radii.xs` to `radii.full`; `shadows.sm` / `md` / `lg`. Cards use `radii.lg` + `shadows.sm`.

### Motion

`motion.fast` (150ms), `motion.normal` (250ms), `motion.slow` (400ms). Spring configs:
`spring.gentle`, `spring.snappy`, `spring.bouncy` for Reanimated. Lists stagger in with
`FadeInUp`; step composers cross-fade with `FadeInRight`/`FadeOutLeft`; buttons use the spring
press feedback in `PressableScale`.

## Shared primitives

### Card

`src/components/Card.tsx`. White rounded-rectangle surface, soft shadow, 1px border. Wrap any
content block that needs elevation.

### PressableScale

`src/components/PressableScale.tsx`. Use instead of plain `Pressable` for anything
clickable. Immediate 0.97 spring scale on press, spring back on release.

### PrimaryButton / PressableScale

`src/components/PrimaryButton.tsx`. Solid CTA with variants `primary` (default),
`secondary`, `danger`, `ghost`, and sizes `md`/`sm`. Loading state included. Always springy
because it wraps `PressableScale`.

### FormInput

`src/components/FormInput.tsx`. Clean rounded input with label, error and helper text.

### SearchInput

`src/components/SearchInput.tsx`. Pill-shaped search with an icon; used for order and menu
item search.

### StatusBadge

`src/components/StatusBadge.tsx`. Dot + label, color-coded per `OrderStatus`, with `sm`
and `md` sizes.

### AvatarStack

`src/components/AvatarStack.tsx`. Overlapping circular initials used to show participants on
order cards and detail headers.

### OrderCard

`src/components/OrderCard.tsx`. Rich object card with status ribbon, priority indicator,
meta pills, avatar stack, attachment hints and pending-sync cue. Accepts optional
`participants`, `imageCount`, `voiceCount`.

### Bottom sheets

- `src/components/BottomSheet.tsx` — `ThemedBottomSheet`: consistent Gorhom shell with drag
  handle, title, backdrop and pan-to-dismiss.
- `src/components/PickerSheet.tsx` — searchable bottom-sheet picker, used for activity
  type, priority, master lookup. Replaces native select/alert.

## Screen patterns

- **Auth screens**: centered brand lockup, form inside `Card`, animated entrance.
- **Lists**: `FlatList` + `Card` rows, `FadeInUp` stagger, pull-to-refresh with brand
  spinner color.
- **Home**: stat tile cards + "Today's Orders" list, sync banner when pending queue > 0.
- **Board detail**: board summary card with count pills, segmented tabs, search, order grid.
- **Create order**: 5-step composer (What / Where & When / Menu / Media / Review). Large
  selector cards, bottom-sheet pickers, animated step transitions.
- **Order detail**: header card, attachment section with image grid and waveform voice notes,
  menu item list with mention chips, acknowledgements with avatar stack, threaded activity
  with distinct system events, compose bar.
- **Settings**: profile card, sync status, theme chips, switches, sign out.

## Media

- Photos: picked with `expo-image-picker`, shown as thumbnails, expandable in a sheet.
- Voice notes: recorded with `expo-av` (the module bundled for Expo SDK 51 — `expo-audio` is
  not available on this SDK), rendered as a fake waveform + play button. Playback wiring is
  Phase 6/7; the visual control is present now.

## What stays out of scope

No billing, pricing, tax, accounting, reports, admin, master-data mutation, user management,
permission management, or system configuration UI. The design system intentionally has no
"data table" or "admin form" pattern.
