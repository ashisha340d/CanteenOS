# MenuBoard Mobile — Codebase Reference

A module-level map of the `app/` workspace: what each part is, how the pieces fit together,
and where the code currently falls short of its own documentation.

This file is **descriptive** — it records what the code does today. It is not a contract.
When this document and the files under [Authoritative documents](#authoritative-documents)
disagree, those documents win and this one is wrong.

---

## Contents

1. [What this workspace is](#1-what-this-workspace-is)
2. [Authoritative documents](#2-authoritative-documents)
3. [Stack](#3-stack)
4. [Setup, run, verify](#4-setup-run-verify)
5. [Directory map](#5-directory-map)
6. [Routing layer — `app/`](#6-routing-layer--app)
7. [Source modules — `src/`](#7-source-modules--src)
8. [Cross-cutting contracts](#8-cross-cutting-contracts)
9. [Platform targets](#9-platform-targets)
10. [Hard exclusions](#10-hard-exclusions)
11. [Known gaps](#11-known-gaps)

---

## 1. What this workspace is

The Android operational app for MenuBoard — the surface kitchen and floor staff use to
create orders, discuss them, attach photos and voice notes, acknowledge them, and move them
through status. It is offline-first: everything works with no connectivity and converges
when the network returns.

It is **not** an npm workspace member. Metro and npm workspaces interact badly, so
`@menuboard/shared` is consumed as a `file:../shared` dependency and resolves to
`shared/dist`. Build shared before installing here.

Built across Phases 4–7: Phase 4 (setup, SQLite, auth, screens), Phase 5 (real sync engine),
Phase 6 (push notifications, media), Phase 7 (feed, recipes, shopping, voice).

## 2. Authoritative documents

| Document | Role |
| --- | --- |
| [`../AGENTS.md`](../AGENTS.md) | Mobile conventions — stack, folder rules, data-flow rule, sync boundary, RBAC convention |
| [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) | Visual authority for this client: tokens, primitives, screen patterns |
| [`stitch_structured_order_board/logistics_utility_system/DESIGN.md`](./stitch_structured_order_board/logistics_utility_system/DESIGN.md) | The raw design system spec (colors, typography, spacing) that `src/theme/tokens.ts` implements verbatim |
| [`stitch_structured_order_board/*/`](./stitch_structured_order_board/) | Stitch-generated screen mockups — `screen.png` + `code.html` per screen |
| [`../README.md`](../README.md) | Setup and run instructions |
| [`../../docs/MENUBOARD_SPEC.md`](../../docs/MENUBOARD_SPEC.md) | Product contract — scope, hard exclusions, product decisions |
| [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) | Technical contract — topology, layering, §6 offline sync contract, §7 auth |
| [`../../docs/API.md`](../../docs/API.md) | REST + Socket.IO wire contract |
| [`../../docs/DATABASE.md`](../../docs/DATABASE.md) / [`../../docs/sqlite-schema.sql`](../../docs/sqlite-schema.sql) | Schema and rationale — but see [Known gaps §11.4](#114-sqlite-schemasql-is-stale) |
| [`../../docs/AGENTS.md`](../../docs/AGENTS.md) | General repo-wide agent rules |
| [`../../tasks/PHASE_*.md`](../../tasks/) | Per-phase build briefs |

Stitch mockups present: `my_boards_multi_board_home`, `employee_view`, `create_new_order`,
`create_new_order_restored_flow`, `create_new_order_review_send_flow`,
`create_new_order_voice_command_revamp`, `order_board_completed_state_transition`,
`archive_activity_item_summaries`, `manage_users_access`, `add_user_form`,
`logistics_utility_system`. Three have placeholder 28-byte `screen.png` files
(`create_new_order_review_send_flow`, `manage_users_access`,
`order_board_completed_state_transition`) — only their `code.html` is usable.

## 3. Stack

| Concern | Choice |
| --- | --- |
| Runtime | Expo SDK 51 (managed) + React Native 0.74.5 + React 18.2 |
| Language | TypeScript, strict — inherits `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`) |
| Navigation | Expo Router 3.5 (file-based, `app/app/`) |
| State | Zustand 4.5 — session/UI only, never domain data |
| Local DB | expo-sqlite 14 (Android) / sql.js + IndexedDB (web) |
| HTTP | axios 1.7 — exactly one instance |
| Realtime | socket.io-client 4.7 |
| Motion | react-native-reanimated 3.10 + react-native-gesture-handler 2.16 |
| Sheets | @gorhom/bottom-sheet 4.6 |
| Media | expo-image-picker, expo-av, expo-file-system, expo-image-manipulator |
| Push | expo-notifications |
| Connectivity | @react-native-community/netinfo |
| Secrets | expo-secure-store (Android) / `localStorage` (web dev only) |

`expo-av` is used rather than `expo-audio`: the latter is not bundled for SDK 51 and must not
be introduced until the app upgrades SDK.

## 4. Setup, run, verify

```bash
# once, from the repo root — app/ resolves @menuboard/shared to shared/dist
npm run build --workspace @menuboard/shared

cd app
npm install

npm run start      # Expo dev server; 'a' for Android emulator
npm run web        # browser target; copies sql-wasm.wasm first
npm run typecheck  # tsc --noEmit, strict
npm run lint       # eslint
```

Backend must be running (`npm run dev:backend` from repo root). API base URL comes from
`app.json` → `expo.extra.apiBaseUrl` (default `http://10.0.2.2:4000/api/v1`, the Android
emulator alias for host `localhost`) or `apiBaseUrlWeb` (`http://localhost:4000/api/v1`).
Point `apiBaseUrl` at your LAN IP for a physical device.

Seeded accounts (e.g. `user1` / `MenuBoard@2026`) are flagged `mustChangePassword`, so first
sign-in routes to the forced password-change screen.

**Status at time of writing:** `npm run typecheck` and `npm run lint` both pass clean.

## 5. Directory map

```
app/
├── app/                      Expo Router routes only — thin, wire screens to src/*
├── src/
│   ├── api/                  The single axios funnel, one module per backend domain
│   ├── db/                   Schema, connection, migrations, row models, repositories
│   ├── sync/                 Offline sync engine (push/pull/media/socket/scheduler)
│   ├── state/                Zustand stores — session and UI only
│   ├── theme/                Design tokens — the only source of colour/spacing/type
│   ├── permissions/          Capability-gating hooks over the shared matrix
│   ├── components/           Shared presentational primitives (+ feed/ subfolder)
│   ├── voice/                Voice-order capture and transcription
│   ├── hooks/                Cross-screen hooks
│   ├── i18n/                 English/Hindi static labels
│   ├── types/                Ambient declarations
│   └── utils/                uuid, dates, media, device id, token storage
├── android/                  Prebuilt native project
├── docs/                     This file, DESIGN_SYSTEM.md, Stitch mockups
├── public/sql-wasm.wasm      Copied from node_modules by scripts/, gitignored
├── scripts/copy-sqljs-wasm.js
├── app.json                  Expo config — permissions, plugins, extra.apiBaseUrl*
└── AGENTS.md                 Mobile conventions
```

## 6. Routing layer — `app/`

Routes contain no business logic beyond wiring a screen to `src/*`. All 13 route files:

### Root

| Route | File | Purpose |
| --- | --- | --- |
| `_layout` | `_layout.tsx` | Root layout. Opens the DB, bootstraps auth + preferences, starts/stops the sync engine on sign-in/out, and owns **all** route gating via `useAuthGate`. Wraps the tree in `GestureHandlerRootView` (required by Gorhom) and `SafeAreaProvider`. |
| `/` | `index.tsx` | Landing redirect. The real decision is in `_layout`; this just gives the router somewhere to stand before the first `replace` fires. |
| `/login` | `login.tsx` | Public. Identifier + password + remember-me. |
| `/change-password` | `change-password.tsx` | Forced password change gate. |

`useAuthGate` is the single place route protection is decided — screens never re-implement a
redirect. Public: `login`, `change-password`. Everything else requires `status === 'signedIn'`.

| `/settings` | Profile card, sync status, theme chips, notification-sound switch, sign out. Device prefs only. Reached from the top-bar gear, not a tab. |
| `/notifications` | Per-user notification list with type icons, unread treatment, mark-all-read, deep-link to order or board. Reached from the top-bar bell. |

### Tabs — `(tabs)/`

The four destinations from the mockups. `boards` is the landing screen.

| Route | Purpose |
| --- | --- |
| `boards` | "Command Center" — one card per board with deterministic icon, last-activity preview, open-order count badge, `BoardStatusChip`. Matches `my_boards_multi_board_home`. |
| `orders` | "Pending Requirements" — every open order across your boards, flattened, each with facts and its menu-requirements panel. Matches `create_new_order`'s list. |
| `users` | "Manage Users" — directory with role chips and board assignments. **Read-only**, gated on `USER_READ`. See [§11.11](#1111-users-cannot-be-written-from-the-device). |
| `archive` | Delivered/closed orders with local aggregate tiles, sum-of-items headline and item summaries. Matches `archive_activity_item_summaries`. |

There is deliberately no Home tab: the board list *is* the landing screen, and a separate
Home duplicated it. Settings and Notifications moved to the top app bar, as every mockup shows.

### Board and order routes

| Route | Purpose |
| --- | --- |
| `boards/[boardId]/index` | **The board feed — the screen the product is about.** One chronological stream of structured order cards, acknowledgements, messages, voice notes and system lines. Messages naming an order are indented beneath it. There is no separate "chat" and no separate "order list". |
| `boards/[boardId]/create-order` | 5-step composer: What / Where & When / Menu / Media / Review, with animated step transitions, bottom-sheet pickers, photo capture and voice recording. |
| `orders/[orderId]/index` | Order detail: header, attachments with image grid and voice players, menu items with mention chips, acknowledgements with avatar stack, thread, compose bar, status-change sheet. Available transitions come from the shared state machine (`canTransitionOrderStatus`), so the sheet can never offer a move the server would reject; `isOrderLocked` freezes a billed order. |
| `orders/[orderId]/edit` | Edit an existing order. |

## 7. Source modules — `src/`

### `theme/` — design tokens

`tokens.ts` is the single source of truth, implementing `DESIGN.md` verbatim. No colour,
spacing value, radius, shadow or duration is written literally anywhere else.

Exports: `colors`, `spacing` (8px rhythm + named tokens), `radii` (soft 4px/8px rounding),
`typography` (6 real steps: `headlineLg`, `headlineMd`, `bodyMd`, `bodySm`, `dataMono`,
`labelCaps`), `fonts`, `shadows` (sm/md/lg — deliberately whisper-quiet, depth comes from
tonal layers), `motion` (durations + three Reanimated spring configs + easings), `layout`.

The brand is **deep indigo** (`primary #102b88`) with emerald reserved exclusively for
completed/delivered and amber for delay/attention. `colors` also carries an explicitly
labelled **legacy block** — numbered aliases (`primary600`, `gray500`, `statusCompleted`…)
remapped onto the new palette so unmigrated screens stay coherent. Each alias is meant to be
deleted as its last screen is rewritten; see [§11.5](#115-the-token-migration-is-stranded).

### `components/` — shared primitives

**Chrome** (added to match the mockups): `TopAppBar` — one bar in two shapes, a *destination*
bar (brand glyph, title, right-hand actions) and a *transactional* bar (back arrow, centred
title), differing only by which slots are filled. `TabBar` — the custom bottom navigation,
custom because the active state is a filled emerald pill wrapping icon and label, which
`tabBarActiveTintColor` can only tint. `StatusChip` / `BoardStatusChip` — the badge-style chip
(light fill, dark text, hairline border). `StructuredDataBlock` / `ItemQuantityList` — the
label-caps key + data-mono value grid and the dish/quantity panel.

**Core**: `Card` (the single card primitive), `PressableScale` (0.97 spring on press — never
ship a dead tap), `PrimaryButton` (variants primary/secondary/danger/ghost, sizes md/sm),
`FormInput`, `SearchInput`, `StatusBadge` (dot + label, derives display status via the shared
`deriveOrderDisplayStatus`), `AvatarStack`, `OrderCard`, `EmptyState`, `LoadingScreen`,
`ThemedBottomSheet`, `PickerSheet` (searchable — replaces every native select and `Alert`),
`RecipeSheet`.

`components/feed/` holds the board-feed vocabulary: `OrderFeedCard`, `MessageBubble` +
`SystemLine`, `ComposeBar`, `VoiceNotePlayer` (deterministic waveform derived from the
attachment id, so it is stable across renders), `FeedPrimitives` (`LabelCaps`, `DataMono`,
`DataRow`, `DateSeparator`), and `systemEventText.ts` (bilingual system-event phrasing).

Every list animates in with `FadeInUp` and a staggered delay; the create-order composer
cross-fades steps with `FadeInRight`/`FadeOutLeft`.

### `db/` — local SQLite

The **sole render source**. Screens read here and nowhere else.

- `schema.ts` — `SCHEMA_VERSION = 4` plus every `CREATE TABLE`/`CREATE INDEX`.
- `client.ts` — one connection for the app's lifetime, plus a versioned migration runner
  keyed on `settings.db_schema_version`. Because tables are a cache of server-authoritative
  data and unpushed local writes live in `sync_queue` with their own payloads, migrations
  legitimately drop affected tables and rewind the sync cursor to refetch. v2 widened
  `thread_messages` into the board feed, v3 added billing/shopping/done stamps plus recipes
  and shopping lists, v4 added Hindi catalogue names.
- `sqliteDriver.ts` / `.web.ts` — platform-resolved connection opener (see [§9](#9-platform-targets)).
- `models/index.ts` — row types, snake_case, 1:1 with the schema columns.
- `repositories/` — the CRUD/query layer. **Screens call these, never raw SQL.**

Tables, grouped: users, boards, board_members · stations, activity_types, menu_categories,
menu_items (read-only master cache) · orders, order_items · thread_messages,
acknowledgements, attachments, notifications · recipes, recipe_ingredients · shopping_lists,
shopping_list_items · sync_queue, settings, alert_settings.

Repositories follow two patterns:

- **`*Local` methods** (`createLocal`, `updateLocal`, `acknowledgeLocal`, `postLocal`,
  `captureLocal`, `deleteLocal`, `markReadLocal`) — write SQLite optimistically with
  `sync_state = 'PENDING'`, then append a `sync_queue` row. Return the DTO so the UI updates
  instantly.
- **Transaction-aware `upsertMany`/`replace*`** — accept an optional `tx` and join it if
  given, else open their own. Used by the pull path; always land rows as `SYNCED`.

### `api/` — the axios funnel

`client.ts` owns the only axios instance in the app. It resolves the base URL per platform,
attaches `Authorization`, `X-Client-Type: ANDROID` and `X-Device-Id` on every request, and
maps the server envelope through `unwrap()` into a typed `ApiError` carrying the server's
`code` and `details`.

Token refresh implements rotating-refresh discipline: concurrent 401s share one in-flight
refresh promise and are replayed after it resolves; a `_retried` flag prevents loops;
`REFRESH_REUSED` clears the session outright.

Domain modules: `auth`, `boards`, `orders`, `masters`, `notifications`, `sync`,
`attachments`, `voiceModel`. All but `voiceModel` are re-exported from `index.ts`.

Never construct a second axios instance, and never call `fetch` against the backend from a
screen.

### `sync/` — the offline engine

```
syncEngine  ──►  pushWorker  ──►  mediaUploader  ──►  pullWorker
                (drain outbox)   (upload bytes)     (apply deltas)
```

Triggered on a 30 s foreground timer, on app foreground/resume, immediately on a NetInfo
offline→online transition, and on any socket hint. A re-entrancy guard prevents overlapping
cycles.

- **`pushWorker`** drains `sync_queue` through `POST /sync/push`, sending each row's `id` as
  `clientOpId`. All five per-item results are handled distinctly: `APPLIED`/`DUPLICATE`
  dequeue and mark `SYNCED`; `SUPERSEDED` adopts `serverEntity`; `REJECTED` dequeues, marks
  `FAILED` and surfaces the error; `FAILED` keeps the row and retries with backoff. One bad
  item never blocks the batch.
- **`pullWorker`** calls `POST /sync/pull` with the persisted cursor, applies each page in
  `SYNC_ENTITIES` dependency order inside **one** transaction, and advances the cursor
  *inside that same transaction* — so a failed apply refetches the same page rather than
  skipping it. Loops while `hasMore`.
- **`applyChangeSet`** is the single path writing pulled rows into SQLite, always via each
  repository's transaction-aware method. Attachments resolve existing local paths first so
  cached media survives.
- **`mediaUploader`** uploads bytes via `POST /attachments/upload` on its own backoff,
  independent of the entity queue. On success it records the server `storage_path`, marks
  `UPLOADED`, and flags `sync_state = 'PENDING'` so the next push binds the row to its owner.
  Terminal errors (`UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`, ≥10 attempts) stop retrying.
- **`socketClient`** listens to all server events as **hints only** — it never writes a
  socket payload to SQLite, it just calls `runPull()`.
- **`backoff.ts`** — 2/4/8/16/32/60 s, capped, with ±25 % jitter.
- **`networkMonitor.ts`** — NetInfo wrapper that fires only on the offline→online edge.
- **`populateFromServer.ts`** — now a thin post-login bootstrap that hands off to the engine.

### `state/` — Zustand stores

Session and UI only. A store must never hold a list of orders.

- `authStore` — `status`, `user`, `capabilities`, `mustChangePassword`, `isBootstrapping`,
  plus `bootstrap` / `login` / `logout` / `changePassword` / `refreshLocalData`. Access token
  lives in memory only; the refresh token goes to secure storage and only when "remember me"
  is set.
- `syncStatusStore` — real `sync_queue` depth, connectivity, socket state, syncing flag, last
  terminal error.
- `uiStore` — theme preference and notification sound, persisted to the `settings` table.
  Device prefs only, per ARCHITECTURE §3.
- `languageStore` — active language for the `en`/`hi` split.

### `permissions/`

Visibility is driven by the shared capability matrix, never a hardcoded role check.

- `useCapabilities()` — the caller's effective global capabilities, with
  `ANDROID_FORBIDDEN_CAPABILITIES` filtered client-side *on top of* the server already
  stripping them from the token. Belt and braces: no UI path can surface billing, reports,
  user management, permission management, master-data writes or system settings.
- `useBoardCapability(boardId, capability)` — additionally folds in the caller's
  `board_members` role from SQLite, mirroring the backend's two-plane authorisation
  (ARCHITECTURE §7).

If a screen needs a capability nobody has in `ROLE_CAPABILITIES` / `BOARD_ROLE_CAPABILITIES`,
that is a `shared/` gap — flag it, don't add a client-only check the server won't enforce.

### `voice/` — voice-ordering

Intended flow: record 16 kHz mono WAV → transcribe on-device with Whisper → parse the
transcript against the board's menu catalogue → present a draft the user confirms.

- `audioRecorder.ts` — expo-av capture at Whisper's required 16 kHz mono, to the cache
  directory, with live metering for the waveform.
- `whisperModule.ts` — JS face of a `MenuBoardWhisper` native module (`sha256File`,
  `initContext`, `releaseContext`, `transcribe`).
- `transcriptionEngine.ts` — picks Whisper on Android, or the Web Speech API in a browser.
- `voiceModelManager.ts` — voice-pack lifecycle with three invariants: nothing is activated
  unverified, the metadata file is written last so its presence means "installed", and an
  update never destroys a working model.
- `useVoiceOrder.ts` — orchestrates one capture. Deliberately stops at a parsed draft and
  never submits: the spec requires user confirmation, and keeping submit out of the hook
  makes that structural rather than a rule someone must remember.

**This subsystem does not currently work on a device — see [§11.1](#111-the-whisper-native-module-does-not-exist).**

### `i18n/`

English and Hindi, ~34 static UI labels in a flat `STRINGS` map, with `t()` falling back to
English. Helpers: `tCount()` for `{n}` substitution, `weekdayName()`.

Catalogue names are **not** translated at runtime. Each dish carries one Devanagari spelling
the kitchen already uses, stored on the row as `nameHi`; `menuItemName()`, `menuItemUnit()`
and `menuCategoryName()` read it and fall back to English. A translation engine would invent
a different spelling on each call and disagree with what is written on the counter.

### `utils/` and `hooks/`

`uuid` (client-generatable ids), `date` (ISO-8601 helpers + display formatting), `deviceId`
(stable per-install, Android ID where available), `secureStorage` / `secureTokenStore`
(access token in memory, refresh token in keychain), `jsonArray` (JSON TEXT column helpers),
`attachmentPicker`, `imageCompression`, `pushNotifications` (Expo token registration, skipped
gracefully without an EAS project id).

`hooks/useVoiceNoteRecorder.ts` is separate from the voice-order path: it records compressed
AAC/M4A at 44.1 kHz for feed voice notes, and rejects takes under 700 ms as mis-taps.

## 8. Cross-cutting contracts

### The data-flow rule

**Every screen reads from SQLite. No screen renders from an API response.**

```
user action → repository writes SQLite (optimistic) → screen re-reads SQLite → UI updates
                        │
                        └─→ repository enqueues a sync_queue row (outbox)
```

Never call the REST client from a screen to perform a local-first write.

### Order lifecycle

Linear status flow, validated server-side (`INVALID_STATUS_TRANSITION`):

```
PENDING → ACKNOWLEDGED → PREPARATION → WORK_IN_PROGRESS → DELIVERED → DONE
                                                              CANCELLED (terminal)
```

`OrderDisplayStatus` is a superset adding two cross-cutting pills derived by
`deriveOrderDisplayStatus`: `ON_SHOPPING` (shopping list raised, work not yet started) and
`BILLED` (frozen). Cancellation outranks everything; billing outranks status.

Business rules worth not re-breaking:

- The **first acknowledgement auto-advances** a `PENDING` order to `ACKNOWLEDGED`.
- A thread reply notifies **thread participants** (prior authors + creator), not every board
  member. Mentions always notify.
- `COMPLETED`/`DONE` and `CANCELLED` are terminal — no edit, no reopen.
- Order numbers are **device-generated**, not server-sequential: `ORD-YYYYMMDD-XXXXXX`.
  Offline creation makes coordination impossible.
- Order history **is** the thread — status changes, acks and edits are `thread_messages` rows
  with `message_type = 'SYSTEM'`. There is no history table.

## 9. Platform targets

Android is the shipping target. `npm run web` exists so screens, repositories and sync logic
can be iterated on in a browser without an emulator rebuild — it does not relax the Android
exclusion. Two modules have no usable SDK 51 web build, so each has a platform-resolved
driver that Metro picks automatically. **Android is untouched by both.**

| Concern | Android | Web | Why |
| --- | --- | --- | --- |
| SQLite | `db/sqliteDriver.ts` → expo-sqlite | `db/sqliteDriver.web.ts` → sql.js (wasm) + IndexedDB | expo-sqlite 14 ships no web implementation; real support lands in SDK 52 |
| Refresh token | `utils/secureStorage.ts` → expo-secure-store | `utils/secureStorage.web.ts` → `localStorage` | expo-secure-store's web build is `export default {}` |

Notes: the browser DB is real SQLite, so schema, foreign keys and transactions behave as on
device — but it lives in wasm memory and serialises to IndexedDB ~200 ms after each write, so
a hard tab kill can lose the last moment of work. `window.__resetMenuBoardDb()` wipes it.
`public/sql-wasm.wasm` is copied from `node_modules` by `scripts/copy-sqljs-wasm.js` and is
gitignored — never edit or commit it. **`localStorage` is not secure storage**; the web driver
is for development only.

## 10. Scope — and which document is authoritative

> **`docs/MENUBOARD_SPEC.md` and `docs/ARCHITECTURE.md` are out of date on this point.**
> `shared/` is the current specification. Confirmed with the project owner; the docs still
> need updating.

The older contracts describe a structural Android exclusion — no user management, reports,
billing or administration on the phone, enforced by stripping
`ANDROID_FORBIDDEN_CAPABILITIES` from the token at login. That is no longer the design.
`shared/src/permissions/index.ts:207`:

```ts
/**
 * Deliberately empty. The original split assumed a desktop Admin Portal owned users,
 * masters, billing and reports; the current specification puts all of it in the phone —
 * Users and Archive are bottom-nav destinations, an Admin bills from the order card, and
 * alarm sounds are configured in Settings. Role remains the only gate.
 */
export const ANDROID_FORBIDDEN_CAPABILITIES: readonly Capability[] = [];
```

Corroborating evidence that `shared/` is newer:

- A **fifth global role**, `EMPLOYEE` — *"View-only. Sees the Hindi board and nothing else"* —
  which is exactly the `employee_view` mockup. `MENUBOARD_SPEC` still says four roles.
- New capabilities `ORDER_DONE`, `BILLING_PROCESS`, `ALERT_CONFIG` matching mockup affordances.
- All 11 Stitch mockups show the same Boards/Orders/Users/Archive navigation.

**So: role is the only gate.** Build against `ROLE_CAPABILITIES` /
`BOARD_ROLE_CAPABILITIES` via `useCapabilities` / `useBoardCapability`, exactly as before —
the difference is that a capability the user's role grants is now reachable on Android.

Two traps this leaves behind:

1. The enforcement machinery is still wired (`backend/src/middleware/authorize.ts` still checks
   the array), it is just checking an empty list. Adding a capability back to that array
   re-walls it instantly — which is the stated reason it was kept.
2. Several backend files still carry comments asserting things are Android-forbidden
   (`UserService`, `BillingService`, `ReportService`, `MasterService`, `user.routes.ts`,
   `AdminController`). **Those comments are now false.** Do not treat them as the contract.

---

## 11. Known gaps

Verified against the code as it stands. Recorded here so nobody rediscovers them.

### 11.1 The Whisper native module does not exist

`src/voice/whisperModule.ts` binds `NativeModules.MenuBoardWhisper` and its docstring points
at `android/app/src/main/java/com/menuboard/whisper/` and `docs/VOICE.md`. **Neither exists.**
`android/app/src/main/java/com/menuboard/app/` contains only `MainActivity.kt` and
`MainApplication.kt`, and there is no `VOICE.md` anywhere in the repo.

Consequence: `isWhisperAvailable()` is always false on Android, so the whole chain
(`useVoiceOrder` → `transcriptionEngine` → `voiceModelManager` → the `/voice-model` API
module and its server manifest) is unreachable on the shipping target. The only working path
is the browser Web Speech API, which is cloud-based and explicitly ruled out by the spec.

This also means the largest feature in the Stitch mockups
(`create_new_order_voice_command_revamp`) has no working implementation behind it.

The JS side is written defensively rather than stubbed — `requireModule()` throws a clear
"run `npx expo prebuild`" message instead of returning fake data, and `sha256File` refuses to
return a placeholder digest because a verification step that can silently pass is worse than
none. So this is a missing native half, not fake code.

### 11.2 ~~The dual-font system is never applied~~ — FIXED

Inter (400/500/600/700) and JetBrains Mono 500 now load via `@expo-google-fonts/*` in
`src/theme/useAppFonts.ts`; `_layout.tsx` gates first paint on them but unblocks on load
failure rather than wedging behind a splash. Each `typography` step carries its own
`fontFamily`, and all 144 call sites were migrated.

Two things to know when adding styles:

- **The weight *is* the family.** RN on Android cannot synthesise bold from a regular file, so
  `fontWeight: '700'` without `fontFamily: fonts.sansBold` silently renders regular. Prefer
  spreading a whole step (`...typography.bodyMd`) over picking `size`/`weight` off it.
- `node scripts/verify-font-families.js` audits every site and fails on a missing *or*
  weight-mismatched family. Run it after touching text styles.

### 11.3 Navigation targets with no route file

The following routes had no matching screen and caused Expo Router's "Unmatched Route" error. The call sites were removed rather than left as dead ends; the screens can be reintroduced when the features are implemented.

| Target | Called from | Status |
| --- | --- | --- |
| `/boards/new` | `app/(tabs)/boards.tsx` — the `+` button in the boards header | Removed |
| `/boards/[boardId]/members` | `app/boards/[boardId]/index.tsx` — header people icon | Removed |
| `/orders/[orderId]/shopping` | `app/boards/[boardId]/index.tsx` — order card shopping action | Hidden |

### 11.4 `sqlite-schema.sql` is stale

`docs/sqlite-schema.sql` is missing 5 tables (`recipes`, `recipe_ingredients`,
`shopping_lists`, `shopping_list_items`, `alert_settings`) and several columns
(`orders.shopping_generated_at` / `billed_at` / `billing_export_id` / `done_at` / `done_by`,
`order_items.cancelled_at` / `cancelled_by` / `replaced_by_item_id`,
`menu_categories.name_hi`, `menu_items.name_hi` / `unit_hi`).

This is **not** a runtime bug — `db/client.ts` migrates correctly to `SCHEMA_VERSION = 4`.
But `schema.ts` opens with "Verbatim from `docs/sqlite-schema.sql` — do not hand-edit", and
`docs/AGENTS.md` treats that SQL file as immutable contract. Today the doc and the code
disagree, and **the code is correct**. The doc needs regenerating from `schema.ts`.

### 11.5 The token migration is partly stranded

The legacy alias block in `tokens.ts` documents itself as shrinking to nothing as screens are
rewritten. The feed components and the four tab screens use the new semantic tokens, but
`settings.tsx`, `notifications.tsx` and most shared primitives still run on legacy names
(`primary600`, `gray500`, `warning700`…), so the block cannot be deleted yet.

The hardcoded `tabBarActiveTintColor: '#2563EB'` is gone — the tab bar is now `TabBar`, which
is fully tokenised.

### 11.6 ~~Navigation does not match the mockups~~ — FIXED

Navigation is now Boards / Orders / Users / Archive with the emerald active pill, per the
mockups. Home was removed (it duplicated Boards); Settings and Notifications became stack
routes reached from `TopAppBar`. See [§10](#10-scope--and-which-document-is-authoritative)
for why Users is no longer an exclusion.

### 11.7 Two token-refresh races

- `sync/socketClient.ts` calls `performRefresh()` directly instead of joining the shared
  `refreshPromise` in `api/client.ts`. A simultaneous socket + REST 401 fires two refreshes;
  under rotating-refresh discipline one gets `REFRESH_REUSED` and signs the user out.
- `api/client.ts` does a non-atomic check-then-set when persisting the rotated refresh token,
  so a concurrent refresh can overwrite a newer token with an older one.

### 11.8 `sync_queue.sequence` allocation is not atomic

`syncQueueRepository.enqueue` computes `SELECT MAX(sequence) + 1` and inserts in a separate
statement, outside a transaction. Two concurrent enqueues can collide — and `sequence` is
exactly what guarantees dependency ordering when the outbox drains.

### 11.9 Two competing "is syncing" flags

Screens read `useAuthStore(s => s.isSyncing)` for pull-to-refresh, while the sync engine
writes `useSyncStatusStore.setSyncing()`. Background syncs show no spinner; manual refreshes
do not update sync status.

### 11.10 Users cannot be written from the device

`users` and `board_members` are in `SYNC_ENTITIES` (pulled as a read-only cache) but **not** in
`PUSHABLE_ENTITIES`, so there is no outbox path for creating a user or changing a board
assignment. The Users tab is therefore read-only, and the `add_user_form` /
`manage_users_access` write affordances are unbuilt.

Unblocking it needs one of two decisions, both outside a screen:

1. **Add the entities to the shared push contract** — `PUSHABLE_ENTITIES`, plus backend
   handling in the sync push path. Keeps user management offline-capable and consistent with
   every other write.
2. **Accept an online-only REST call** via a new `src/api/users.ts`, the way login and
   change-password already bypass the outbox. App-only, but the action then fails offline.

Option 2 is app-local and cheap; option 1 is the architecturally consistent one.

### 11.11 Model gaps against the mockups

Fields the designs need that the schema does not have. All require coordinated
`shared/` + `backend/` + `docs/sqlite-schema.sql` changes, so they are **not** implemented:

| Field | Needed by | Notes |
| --- | --- | --- |
| `orders.notes` | `create_new_order` ("Notes: instructions for Canteen team…"), `employee_view` (कस्टमर नोट) | Only `order_items.notes` exists today. An order-level note has nowhere to live. |
| Board default / starred | `my_boards_multi_board_home` ("Set Default", star glyph on the active board) | No column, and it is arguably per-user rather than per-board. |

### 11.12 Smaller items

- `shoppingRepository.listForBoard` is an N+1 — one items query per list.
- `shoppingRepository.findLatestForOrder` matches order ids with `LIKE` against a JSON array
  column, so it cannot use an index and can match on a substring.
- `mediaUploader`'s success path is not atomic across the upload call and the DB update; a
  crash between them re-uploads the file.
- System-event strings in `components/feed/systemEventText.ts` are inlined bilingually rather
  than living in `src/i18n`, so a third language would need that file edited too.
