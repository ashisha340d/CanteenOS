# MenuBoard Mobile App (`app/`) — Agent Rules

This is the Android operational app for MenuBoard (Phase 4, extended by Phases 5–7). Read
`docs/MENUBOARD_SPEC.md`, `docs/ARCHITECTURE.md` (including its offline-first sync contract),
`docs/DATABASE.md`, `docs/sqlite-schema.sql` and `docs/DESIGN_SYSTEM.md` before changing
anything here — this file documents *conventions*, those documents are the *contract*.

## Stack

- **Expo (managed) + React Native + TypeScript**, strict mode matching `tsconfig.base.json`
  at the repo root (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, etc).
- **Expo Router** for navigation (file-based routes under `app/app/`). Route groups:
  `login`, `change-password` are public; `(tabs)/*`, `boards/*`, `orders/*` are gated by the
  auth store (see `app/_layout.tsx`'s `useAuthGate`).
- **Zustand** for session/UI state only (`src/state/*`). Domain data (boards, orders,
  threads, acknowledgements, notifications, masters) always lives in SQLite — a store must
  never hold a list of orders, only things like "am I signed in" or "what theme is picked".
- **expo-sqlite** for local storage — the *only* place screens read from. See "Data flow"
  below.
- **A single axios-backed API funnel** — `src/api/client.ts` is the only axios instance in
  the app. Every domain concern (`auth`, `boards`, `orders`, `masters`, `notifications`)
  gets its own thin module under `src/api/` that calls through it. Never construct a second
  axios instance or call `fetch` against the backend directly from a screen.
- **An offline outbox** (`sync_queue`, via `src/db/repositories/syncQueueRepository.ts`).
  Every local-first write appends a row here. See "Sync phase boundary" below for what does
  and does not touch it yet.
- Media: `expo-image-picker` (photos), `expo-av` (voice note recording/playback — `expo-audio`
  is not bundled for Expo SDK 51 and must not be introduced until/unless the app upgrades
  SDK), `expo-file-system` (local paths), `expo-notifications` (push delivery wired in
  Phase 6), `@react-native-community/netinfo` (connectivity, wired in from Phase 5 onward).
- **Motion**: `react-native-reanimated` + `react-native-gesture-handler` for spring press
  feedback, list enter animations, and step transitions. Babel plugin:
  `react-native-reanimated/plugin`.
- **Bottom sheets**: `@gorhom/bottom-sheet` for all confirmation/selection/picker
  surfaces, replacing native `Alert` and `<Picker>` usage. The app root already wraps the
  tree in `GestureHandlerRootView` (required by Gorhom).

`@menuboard/shared` is consumed as an npm `file:../shared` dependency (see `package.json`),
**not** an npm workspace member (Metro and npm workspaces interact badly — same reason
`docs/ARCHITECTURE.md` gives for the equivalent backend/admin distinction). Run
`npm run build --workspace @menuboard/shared` at the repo root before `npm install` here,
since the dependency resolves to `shared/dist`.

## Folder layout

```
app/
├── app/                        Expo Router routes only — no business logic here beyond
│   │                           wiring a screen to src/*. Keep screens thin.
│   ├── _layout.tsx             Root layout: DB init, auth bootstrap, route gating
│   ├── index.tsx                Redirect target
│   ├── login.tsx / change-password.tsx
│   ├── (tabs)/                 Home, Boards, Notifications, Settings
│   ├── boards/[boardId]/       Board detail (today/upcoming/completed), Create Order
│   └── orders/[orderId]/       Order Detail, Edit Order
├── src/
│   ├── api/                    The axios funnel — one module per backend domain
│   ├── db/
│   │   ├── schema.ts           Verbatim from docs/sqlite-schema.sql — do not hand-edit
│   │   │                       without updating that doc first
│   │   ├── client.ts           Single connection + versioned migration runner
│   │   ├── models/             Row types, snake_case, 1:1 with sqlite-schema.sql columns
│   │   └── repositories/       CRUD/query layer. Screens call these, never raw SQL.
│   ├── sync/
│   │   └── populateFromServer.ts   REST→SQLite population seam — see below
│   ├── state/                  Zustand stores (session/UI only)
│   ├── theme/                  Design tokens: colors, spacing, typography, radii,
│   │                           shadows, motion. All UI consumes from here.
│   ├── permissions/            Capability-gating hooks (see below)
│   ├── components/             Shared presentational components
│   └── utils/                  uuid, date formatting, JSON column helpers, device id,
│                               secure token storage
└── AGENTS.md                   this file
```

## Design system

The full visual system is documented in `docs/DESIGN_SYSTEM.md` and implemented in
`src/theme/tokens.ts` plus shared components. Key rules for this app:

- **No magic numbers** — every color, spacing value, radius, shadow and timing constant
  comes from `src/theme/tokens.ts`.
- **Surfaces are Cards** — `src/components/Card.tsx` is the single card primitive: soft
  shadow, rounded corners, subtle border. Use it for every grouped content block.
- **Touch feedback** — wrap tappable rows/buttons in `PressableScale` for a spring-driven
  scale-down. Primary actions use `PrimaryButton`. Never ship a dead tap.
- **Pickers are bottom sheets** — selection of activity type, priority, master items and
  status changes all use `PickerSheet` / `ThemedBottomSheet`, never a native `<select>` or
  `Alert`.
- **Lists animate in** — order, board and notification lists use `FadeInUp` with staggered
  delays via `react-native-reanimated`.
- **Order cards are rich objects** — `OrderCard` shows status badge + priority dot, key
  meta, avatar stack of thread participants, attachment hints, and pending-sync cue.

## Data flow — the one rule that matters most

**Every screen reads from SQLite. No screen renders from an API response.** Writes go:

```
user action → repository writes SQLite (optimistic) → screen re-reads SQLite → UI updates
                                    │
                                    └─→ repository enqueues a sync_queue row (outbox)
```

A repository method with `Local` in its name (`createLocal`, `updateLocal`,
`acknowledgeLocal`, `postLocal`, `withdrawLocal`, `captureLocal`) follows exactly this
pattern: write, then enqueue. Never call the REST client directly from a screen to perform
one of these actions.

## Sync phase boundary — read before adding anything sync-shaped

Phase 5 implemented the real offline-first sync engine described in `docs/ARCHITECTURE.md` §6.
`src/sync/populateFromServer.ts` is now a thin bootstrap only: it performs the first sync
after login, then hands off to the background engine. The engine lives in `src/sync/`:

- `pushWorker.ts` drains `sync_queue` through `POST /api/v1/sync/push`, sending each queue
  row's `id` as `clientOpId`. It handles all five per-item results: `APPLIED`/`DUPLICATE`
  dequeue and mark `SYNCED`; `SUPERSEDED` adopts `serverEntity`; `REJECTED` dequeue, mark
  `FAILED`, and surface the error; `FAILED` keeps the row and retries with exponential
  backoff. A single bad item never blocks the rest of the batch.
- `pullWorker.ts` calls `POST /api/v1/sync/pull` with the persisted cursor, applies each page
  in `SYNC_ENTITIES` dependency order inside one SQLite transaction, and advances the cursor
  only after that transaction commits. It loops while `hasMore` is true.
- `applyChangeSet.ts` is the single path that writes pulled server rows into SQLite; every
  entity uses its repository's transaction-aware `upsertMany`/`replace*` method inside the
  same outer transaction.
- `mediaUploader.ts` uploads attachment bytes via `POST /attachments/upload` with its own
  backoff, independently of the entity sync queue. On success it records the server
  `storage_path` and `UPLOADED` state; the sync push then binds the row to its owner.
- `socketClient.ts` connects with the access token and listens to all server events as hints
  only. It never writes a socket payload to SQLite; each event triggers `runPull()`. If the
  socket disconnects due to an expired token, it reuses `src/api/client.ts`'s `performRefresh()`.
- `syncEngine.ts` coordinates push → media upload → pull on a 30 s foreground timer, on app
  foreground/resume via `RootLayout`, and immediately on a NetInfo reconnect transition.
- `useSyncStatusStore` exposes real pending count, connectivity, socket state, syncing flag,
  and the last terminal error; existing Home/Settings UI already consumes it.

Nothing in `app/app/*` screens renders directly from API responses. They continue to read
from SQLite, and the sync engine keeps SQLite converged with the server.

## RBAC / permission-gating convention

- Drive visibility from `@menuboard/shared`'s capability matrix, never a hardcoded role
  check. `src/permissions/useCapabilities.ts` gives you the caller's effective
  (server-granted, Android-forbidden-list-filtered) global capabilities.
  `src/permissions/useBoardCapability.ts` additionally folds in the caller's board
  membership role for board-scoped capabilities (`ORDER_CREATE`, `THREAD_POST`, etc.),
  reading `board_members` from SQLite — mirroring the backend's two-plane authorisation
  described in `docs/ARCHITECTURE.md` §7.
- `ANDROID_FORBIDDEN_CAPABILITIES` is filtered client-side on top of the server already
  stripping it from the token, so no UI path can ever surface billing, reports, user
  management, permission management, master-data writes or system settings.
- If a screen or action needs a capability that is not in `ROLE_CAPABILITIES` /
  `BOARD_ROLE_CAPABILITIES` for anyone who should have it, that is a `shared/` gap — stop
  and flag it; do not add a client-only permission check that the server doesn't enforce.

## What must never appear in `app/`

Per `docs/MENUBOARD_SPEC.md` §3 / `docs/ARCHITECTURE.md` §3: billing, pricing, tax, accounting,
reporting, administration, master-data mutation (stations/activity types/menu
categories/menu items are read-only here), user management, permission management, system
configuration. If a task looks like it needs one of these, it is out of scope for `app/` —
say so instead of building it.

## Verification commands

```bash
npm run build --workspace @menuboard/shared   # from repo root, once, before installing here
cd app
npm install
npm run typecheck     # tsc --noEmit, strict
npm run lint          # eslint
npm run start          # expo start — press 'a' for an Android emulator, or scan the QR code
npm run web            # expo start --web — browser development target, see below
```

The backend must be running (`npm run dev:backend` from the repo root) and reachable at the
URL in `app.json`'s `expo.extra.apiBaseUrl` (defaults to `http://10.0.2.2:4000/api/v1`, the
Android-emulator alias for the host machine's `localhost`; change it to your LAN IP for a
physical device).

## Developing in a browser

Android stays the shipping target — the exclusion in docs/MENUBOARD_SPEC.md §"The Android
exclusion is structural" is unchanged, and nothing about the web target relaxes it. `npm run
web` exists so screens, repositories and sync logic can be iterated on in Chrome/Edge without
an emulator rebuild for every change.

Two Expo modules have no usable web build on SDK 51, so each has a platform-resolved driver.
Metro picks the `.web.ts` file automatically; **Android is untouched by both**:

| Concern | Android | Web | Why |
| --- | --- | --- | --- |
| SQLite | `src/db/sqliteDriver.ts` → expo-sqlite | `src/db/sqliteDriver.web.ts` → sql.js (wasm) + IndexedDB | expo-sqlite 14.x ships **no** web implementation; its `NativeDatabase` is a stub that is not a constructor. Real support lands in expo-sqlite 15 / SDK 52. |
| Refresh token | `src/utils/secureStorage.ts` → expo-secure-store | `src/utils/secureStorage.web.ts` → `localStorage` | expo-secure-store's web build is `export default {}`. |

The web target also reads `expo.extra.apiBaseUrlWeb` (`http://localhost:4000/api/v1`) instead
of `apiBaseUrl`, because a browser cannot resolve the `10.0.2.2` emulator alias. The backend
already accepts `localhost` origins outside production (`utils/originAllowlist.ts`), so no
CORS change is needed.

Notes and limits:

- `public/sql-wasm.wasm` is copied out of `node_modules` by `scripts/copy-sqljs-wasm.js`,
  which the `web` script runs first. It is gitignored — never edit or commit it.
- The browser database is real SQLite, so the schema, foreign keys, upserts and transactions
  behave as they do on device. It lives in wasm memory and is serialised whole to IndexedDB
  ~200ms after each write, so a hard tab kill can lose the last moment of work.
- `window.__resetMenuBoardDb()` in the devtools console wipes the browser database and starts
  the next reload from a fresh schema.
- **`localStorage` is not secure storage.** The web driver exists for development; do not
  point a production web build at it.
- Media paths (`expo-file-system` attachment caching, `expo-av` voice notes) still fall back
  to Expo's own web shims and are not covered by the drivers above.
