# MenuBoard — Design System & UI/UX Vision

**Both clients are held to a premium product standard.** Density and delight are not a
trade-off: the Admin Portal is dense *and* handcrafted. It is explicitly not a Material
Design demo, a Bootstrap admin, or an enterprise CRUD screen.

- **Admin Portal (`admin/`)** — a web tool operations staff sit at for extended sessions to
  manage boards, users, masters, reports and billing. Dense and fast, but typographically
  driven, layered, and quietly animated. Reference points are Linear, Stripe Dashboard and
  Raycast — not Ant Design.
- **Android app (`app/`)** — the operational app kitchen/floor staff use for hours every day
  to create and discuss orders. Consumer-grade feel: gesture-driven, spatial, tactile.

Both share the same discipline: no magic numbers, one design-tokens module per client, one
set of core components reused everywhere, deliberate motion, and a consistent interaction
vocabulary. Neither copies the other's layout — a table that reads well on a desktop grid
would read badly on a phone — but they share the same tokens, tone and level of finish.

### The four rules

1. **Information first, emotion second, beauty always, speed above everything.** If an
   effect costs legibility or a frame, it goes.
2. **Motion communicates state.** Nothing animates for decoration. Everything that appears,
   moves or changes says what happened.
3. **Empty, loading and error are designed states**, never blank space, never a bare
   spinner, never a raw error code.
4. **No hard-coded values.** Every colour, radius, duration and shadow comes from
   `admin/src/theme/tokens.ts`.

## Part 0 — Design tokens (`admin/src/theme/tokens.ts`)

The single source of truth. `buildTheme()` in `admin/src/theme/index.ts` maps these onto the
MUI theme and attaches them at `theme.tokens`, so any component can read them via
`useTheme()` without importing the module.

| Token group | Contents |
| --- | --- |
| `fontFamily` | System stack — no webfont, so there is no swap and no network dependency |
| `tracking` | Optical letter-spacing; negative for large text, positive for small |
| `radius` | `xs 6 · sm 9 · md 13 · lg 18 · xl 24 · pill` |
| `motion.duration` | `instant 90 · fast 140 · base 200 · slow 300 · deliberate 460` (ms) |
| `motion.ease` | `out` (default), `inOut`, `spring` (for things that appear) |
| `lightPalette` / `darkPalette` / `contrastPalette` | Canvas, three surface levels, borders, three text levels, accent |
| `lightStatus` / `darkStatus` / `contrastStatus` | Six semantic tones, each `{ fg, bg, border, solid }` |
| `elevation()` | Two-layer shadows — tight contact shadow plus wide diffuse one |
| `layout` | Sidebar width, top bar height, content max width |

**Three skins**: `light`, `dark`, `brand` (high contrast, for bright kitchens and screens
viewed at an angle). Dark mode is supported from day one, not retrofitted.

**Status colour maps to meaning, not to enum value.** Six tones — `neutral`, `info`,
`progress`, `success`, `danger`, `muted` — cover thirteen statuses. A reader learns four
colours; they never learn thirteen. `StatusChip` owns that mapping; pages never pick a
colour themselves.

### Shared primitives (`admin/src/components/ui/`)

| Component | Responsibility |
| --- | --- |
| `PageHeader` | The one title treatment: eyebrow, large title, subtitle, meta, actions |
| `EmptyState` | Designed empty/no-results state with a drawn (not imported) mark |
| `Skeletons` | `TableSkeleton`, `CardGridSkeleton`, `StatGridSkeleton` — shaped like the content, staggered in |
| `StatTile` | A single figure sized to be read across a room; `emphasis` for the one number that demands action |
| `StatusChip` | Semantic status pill; pulses while a status is live |

`DataTable` and `EntityCardGrid` both delegate their loading and empty states to these, so
no page renders a spinner or an empty grey box.

## Part A — Admin Portal (`admin/`) standards

Applies to every grid, form, and page in `admin/`.

### A.1 Grid / DataTable standard

- **Row double-click → Edit**: if the grid belongs to a CRUD resource, double-clicking a row
  opens the same CRUD form used for editing (the existing "Edit" action), pre-filled with
  that row's data. Don't require the user to click the Edit button.
- **Row double-click → Drill-down (master-detail)**: if the grid represents a parent/master
  entity with a related child/detail list (e.g. Category → Items, Board → Members),
  double-clicking a row navigates to the child grid/page scoped to that parent, instead of
  opening the parent's own edit form. Drill-down takes priority over edit when both exist on
  the same grid.
- **Default decision rule for a new grid**: decide once, up front — if the entity has a
  related child/detail list, it drills down (with an explicit Back button, see below); if it
  does not, it opens the CRUD form/modal for that row. A grid must do exactly one of the two,
  never neither.
- **Drill-down gets a Back button**: every drill-down page renders an explicit "Back"
  control that returns to the parent grid, in addition to any browser/router back
  navigation. Don't rely on the browser back button alone.
- **Sortable, resizable, draggable/reorderable columns**: every column header supports
  click-to-sort and drag-to-resize; headers also support drag-and-drop reordering.
- **Persist grid state**: column widths, column order, and sort state are saved per grid
  identifier (localStorage) and restored on load. Any new state added to the grid must be
  persisted the same way.
- **Draggable row sort**: if a grid represents an explicitly ordered list (`sortOrder`/
  `position`/rank concept — e.g. stations), rows are reorderable via drag-and-drop, and the
  new order is saved to the backend, not just local state.
- **Card / Grid view toggle**: every listing page offers both a table view and a card view of
  the same data/filters, with a toggle near the view. Sorting, filtering, paging and
  selection state carry over when switching views.
- **Top search bar**: every listing page's toolbar has an incremental/instant "Google-style"
  search box (searches as you type) on the left, a filter panel/drawer on the side, and
  pagination plus other list controls (page size, view toggle, export) in a single linear
  control bar. This toolbar pattern is specific to the Admin Portal — it does not apply to
  the Android app.

Build one shared `DataTable`/`DataGrid` component (TypeScript, MUI-based) that implements
these behaviors once; every listing page consumes it rather than reimplementing ad hoc
tables. See `admin/src/components/DataTable/`.

### A.2 Modal / Form keyboard UX standard

Applies to every CRUD form rendered inside the Admin Portal's shared modal component
(`admin/src/components/Modal/`).

- **Enter moves focus forward**: pressing Enter in an `input`/`select` (not `textarea`)
  advances focus to the next focusable field in the modal, rather than submitting or doing
  nothing. Implemented centrally — don't reimplement per-form.
- **Focus selects existing text**: focusing (click or Tab) any single-line `input`/
  `textarea` selects its current value, so typing immediately replaces it.
- **Modals remember position/size and are drag/resize-able**, keyed by the modal's id.
  Persisting this state — position, size, and in-progress form values on unintended close —
  is essential; don't drop it to simplify a new form.
- **Double-Escape closes the modal**: a single Escape press must not dismiss the form (to
  avoid losing input from an accidental tap); the user presses Escape twice in quick
  succession to close/cancel.
- **Reuse the shared record form, don't fork it**: when the same entity can be created from
  more than one place (its own CRUD page, and a picker embedded in another form), both call
  the same extracted form component rather than each maintaining its own copy.
- **No spin buttons on number inputs**: `input[type="number"]` never shows the browser's
  up/down spin control, and scrolling the mouse wheel while a number field is focused blurs
  it instead of changing its value. Handled once, globally.
- **Combo boxes for large/lookup lists become a search picker**: a plain select is fine for a
  short fixed list; any field selecting from a growing master/catalog list uses a
  Google-like instant-search modal picker instead.

### A.3 App shell standard

- **Theme/skin switcher + Sign out, top-right**: the global header has a persistent top-right
  control cluster offering 3 basic skins/themes (light, dark, and one brand/high-contrast
  variant) plus Sign out, always visible, not buried in a nested menu. Theme choice persists
  per user (localStorage).

## Part B — Android app (`app/`) design vision

You are not building another enterprise CRUD app, an admin dashboard, or a default
component-library demo. MenuBoard's Android app is a premium operational product people use
for hours every day — it must feel enjoyable, every interaction intentional, every screen
handcrafted, every animation purposeful. The reaction should be "this feels like a premium
product," not "this looks like a business app."

### B.1 Philosophy, in priority order

1. Information First
2. Emotion Second
3. Beauty Always
4. Speed Above Everything

The UI must be elegant, minimal, modern, premium, clean, timeless, high-density but
readable, touch-friendly, fast.

**Do not copy**: Material UI example dashboards, Bootstrap Admin, Ant Design dashboards,
enterprise ERP look, traditional POS UI, Windows Forms aesthetics, old-style Android
Material apps.

**Inspiration** (study the interaction/visual patterns, don't literally clone any one):
Linear, Notion, Craft, Arc Browser, Things 3, Superlist, Apple Journal, Apple Reminders,
Apple Calendar, Raycast, Flighty, Stripe Dashboard, Airbnb, ClickUp 3, Framer, Read.cv, The
Browser Company, and the Apple Human Interface Guidelines.

### B.2 Visual style

Floating cards, layered surfaces, generous/beautiful spacing, large confident typography,
rounded corners, soft shadows, subtle gradients, micro-interactions, depth, motion — all in
service of a premium feeling, never decoration for its own sake. Every screen must feel
intentional, alive, fast, responsive, natural.

### B.3 Motion (mandatory, but purposeful)

Everything communicates state. Cards expand naturally. Lists animate in/out. Buttons respond
immediately — no dead taps. Bottom sheets glide open/closed. Prefer spring-based animations
over linear easing. Smooth, native-feeling scrolling. Gesture-driven where it makes sense
(swipe actions, drag-to-dismiss sheets). Implemented with `react-native-reanimated` +
`react-native-gesture-handler`.

### B.4 Components

Never plain/default cards — design premium custom cards (`Card`). Never native modal
dialogs for confirmations/pickers/secondary actions — use bottom sheets
(`@gorhom/bottom-sheet`). Never native dropdowns — use searchable picker sheets
(`PickerSheet`). Never render operational data as literal spreadsheet-style tables —
transform lists into rich visual layouts. Never expose backend/data-model complexity
directly in the UI.

### B.5 Data visualization

Orders are never rows — they are objects with identity: rich cards, clear visual hierarchy,
timeline of status, status ribbons/badges, progress indicators, avatar stacks for
participants, voice-note previews (waveform-style, not a bare filename), photo previews
(thumbnail grid, not a link). Everything must be scannable within one second.

### B.6 Order experience

Creating an order feels like composing something, not filling out a form: a step-by-step
flow, large touch-friendly controls, animated transitions between steps, context preserved
moving forward/back, and a clear review step before posting.

### B.7 Thread experience

Not a WhatsApp/Slack clone — take their best interaction ideas but design a distinct,
better operational discussion interface. Voice notes feel integrated (inline playback,
waveform), not bolted-on attachments. Photos feel natural (inline, tappable to expand).
Mentions render as beautiful, distinct chips, not plain `@text`.

### B.8 Board experience

Boards feel alive: recent activity, a place for live-update affordance, presence
indicators, upcoming events, today's workload at a glance, status overview, beautiful
summaries — not a bare list of orders.

### B.9 Typography

Typography is the product here — a deliberate type scale (large titles, clear hierarchy of
sizes/weights), generous comfortable line-height and spacing, used consistently via the
shared tokens module, never ad hoc per-screen values.

### B.10 Implementation

- **Design tokens module** (`app/src/theme/tokens.ts`): colors, spacing scale, typography
  scale, radii, shadows/elevation, motion durations/easings/spring configs. Every
  screen/component consumes these — no magic numbers.
- **Core components** (`app/src/components/`): `Card`, `PressableScale` (spring-driven press
  feedback), `PrimaryButton`, `FormInput`, `SearchInput`, `StatusBadge`, `AvatarStack`,
  `ThemedBottomSheet`/`PickerSheet`, `OrderCard`.
- Full, current detail (exact tokens, patterns already implemented, screen-by-screen notes)
  lives in `app/docs/DESIGN_SYSTEM.md` and `app/AGENTS.md` — treat this document as the
  vision/authority and that one as the living implementation record; keep them in sync.

## Part C — Shared principles across both clients

- **No magic numbers.** Every color, spacing value, radius, shadow and timing constant comes
  from that client's tokens module.
- **One shared component per pattern.** Build the table/grid, modal/sheet, and button once
  per client and reuse it everywhere; never fork a bespoke version per page.
- **State that matters to the user persists.** Grid layout, modal position/size, in-progress
  form values, theme choice — all survive navigation and accidental closes.
- **Capability-driven, not hardcoded.** Visibility of any control follows the capability
  matrix from `shared/src/permissions`, never a hardcoded role check in a component.
