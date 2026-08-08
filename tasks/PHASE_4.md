# Phase 4 — React Native Application

**Status: Complete** (built and verified — see §6). Excludes synchronization (that's
Phase 5). This file is kept as the historical brief and acceptance record; do not restart or
redesign this phase. If a later phase needs a change here, stop and report it per
`docs/AGENTS.md` rather than editing this phase's code unilaterally.

## Model / effort

Sonnet (or equivalent) · Medium effort.

## Mission

Build the complete React Native application, excluding synchronization.

## Scope

Authentication · Navigation · Home · Boards · Today's Orders · Upcoming Orders · Completed
Orders · Create Order · Edit Order · Order Details · Discussion Thread UI · Acknowledgements
UI · Notifications · Settings · SQLite Models · SQLite Repositories · State Management.

## Requirements

- Every screen reads only from SQLite. Never read directly from the REST API on render.
- Do not implement synchronization (no `sync_queue` drain, no `/sync/push` or `/sync/pull`
  calls, no conflict resolution, no Socket.IO client) — Phase 5's job.
- Do not modify `backend/`, `admin/`, or `shared/`.
- Stack: Expo + React Native + TypeScript (strict), Expo Router, Zustand (session/UI state
  only — domain data always lives in SQLite), `expo-sqlite`, a single axios-backed API
  funnel. `app/` is **not** an npm workspace member (Metro/npm workspaces interact badly);
  it consumes `@menuboard/shared` via `file:../shared`.
- Implement `docs/sqlite-schema.sql` exactly via a versioned migration runner.
- Auth: same rotating-refresh discipline as the Admin Portal, `clientType: 'ANDROID'`,
  stable device id, "remember login" persists the refresh token via secure storage.
- RBAC-gate every screen/action from `shared/src/permissions`, filtered client-side against
  `ANDROID_FORBIDDEN_CAPABILITIES` on top of the server already stripping it from the token.
- Follow `docs/DESIGN_SYSTEM.md` Part B (the full design vision) for every screen — this is
  a premium consumer-app bar, not an enterprise CRUD look.
- **The one seam Phase 5 needs**: since real sync doesn't exist yet, populate SQLite via a
  narrow, clearly isolated on-demand REST→SQLite bridge (not the sync engine) so the app has
  real data to display and is fully testable end to end. Document this boundary precisely so
  Phase 5 can find and replace it.

## Deliverables

Complete mobile application · SQLite integration · Production-ready UI (per
`docs/DESIGN_SYSTEM.md` Part B) · `app/AGENTS.md` documenting stack/conventions.

## Acceptance criteria

- [x] `tsc --noEmit` (strict) passes
- [x] `eslint` passes (warnings for unused imports are acceptable; zero errors)
- [x] Login, forced password change, and logout work end to end against the real backend
- [x] All screens in scope implemented and reachable
- [x] No module/screen/route/API-client/store-slice/SQLite-column exists anywhere for
      billing, pricing, tax, accounting, reporting, administration, master-data mutation,
      user management, permission management, or system configuration
- [x] The REST→SQLite population seam is isolated in one module and documented
- [x] No files under `backend/`, `admin/`, or `shared/` were modified

## Build record

Built by an autonomous agent. SQLite schema/migration runner (`src/db/schema.ts`,
`src/db/client.ts`, verbatim from `docs/sqlite-schema.sql`), row models (`src/db/models`),
repositories for every table, Zustand stores for auth/session/UI/sync-status, a single axios
funnel with rotating-refresh handling (queued concurrent 401s, `REFRESH_REUSED` → forced
logout), RBAC hooks (`useCapabilities`, `useBoardCapability`), and all required screens.

**Sync/population boundary**: `app/src/sync/populateFromServer.ts` — the entire REST-to-
SQLite bridge for this phase. Calls plain REST endpoints and upserts into SQLite via the
repositories. Never touches `sync_queue`, never calls `/sync/push` or `/sync/pull`, no
conflict resolution/retry/Socket.IO. Local-first writes (`createLocal`, `updateLocal`,
`acknowledgeLocal`, `postLocal`, `withdrawLocal`, `captureLocal`) write SQLite immediately
and enqueue a `sync_queue` row, but nothing drains that queue yet — that's Phase 5. This
boundary is documented in the module's header comment and in `app/AGENTS.md`.

A follow-up design-vision pass (per `docs/DESIGN_SYSTEM.md` Part B) reworked every screen:
design tokens module (`src/theme/tokens.ts`), `react-native-reanimated` +
`react-native-gesture-handler` for motion, `@gorhom/bottom-sheet` for pickers/confirmations,
a rich `OrderCard` component, a step-by-step Create Order composer, and a thread screen with
waveform-style voice-note rows, photo thumbnail grids, and mention chips.

**Verification performed after the build agent's own review** (the build agent's sandbox
could not execute `npm`/`tsc`/`eslint`/`expo`; a follow-up pass with real tool access did):
`npm install` inside `app/` initially failed — `expo-audio@~0.1.2` does not exist for Expo
SDK 51 (SDK 51's bundled audio module is `expo-av@~14.0.7`; `expo-audio` was introduced for
later SDKs). Fixed by replacing `expo-audio` with `expo-av` in `package.json`, `app.json`
(removed its config plugin entry), the voice-recording code in
`app/boards/[boardId]/create-order.tsx`, and the two docs that referenced it (`app/AGENTS.md`,
`app/docs/DESIGN_SYSTEM.md`). After that fix: `npm install`, `npm run typecheck` (strict,
clean after fixing a duplicate `StyleSheet` key in `settings.tsx`, a `StyleProp`-typing issue
in `PressableScale`/`PrimaryButton`, and an `unknown`-typed refresh response in
`authStore.ts`), and `npm run lint` (clean after adding a missing root `.eslintrc.js` — none
existed, so ESLint had nothing to run against) all pass, with only unused-import warnings
remaining.

## Risk areas flagged by the build agent, now resolved or to re-check at runtime

- `expo-audio` API mismatch — **resolved**, replaced with `expo-av` (see above).
- Gorhom bottom sheets / Reanimated springs on a real Android device or emulator — not yet
  exercised on-device, only typechecked; do this before considering Phase 4 fully closed.
- Expo Router dynamic-route param typing under `noUncheckedIndexedAccess` — compiles clean,
  but worth a second look if route params ever carry optional fields.
