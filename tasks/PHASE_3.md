# Phase 3 — Admin Portal

**Status: Complete** (built and verified — see §6). This file is kept as the historical
brief and acceptance record; do not restart or redesign this phase. If a later phase needs a
change here, stop and report it per `docs/AGENTS.md` rather than editing this phase's code
unilaterally.

## Model / effort

Sonnet (or equivalent) · Medium effort.

## Mission

Build the complete React Admin Portal, consuming the existing REST API only.

## Scope

Authentication · Dashboard · Users · Boards · Board Members · Stations · Activity Types ·
Menu Categories · Menu Items · Permissions · Reports · Settings · Billing Generation · Audit
Log Viewer.

## Requirements

- Consume existing REST APIs only (see `docs/API.md`). Do not create new APIs.
- Do not modify `backend/`, `app/`, or `shared/`.
- Do not redesign the database.
- Stack: React + Vite + TypeScript (strict) + MUI, as `admin/` — an `@menuboard/admin` npm
  workspace member, consuming `@menuboard/shared`'s compiled output for every type, enum and
  capability check.
- Follow `docs/DESIGN_SYSTEM.md` Part A (grid, modal, app-shell standards) for every page —
  build one shared `DataTable` and one shared `Modal` component, reuse everywhere.
- Auth: `clientType: 'ADMIN'` on login, stable per-browser `deviceId`, access token in
  memory only, refresh token persisted only when "remember me" is checked, single-flight
  refresh queue on concurrent 401s, forced-password-change gate, capability-driven
  navigation (never a hardcoded role check).
- Billing UI: explicit confirmation step, show `billingVersion`/`checksum`/`generatedBy`/
  `generatedAt`, never compute or display a derived money total, treat regeneration as a new
  version not an update, present an empty-period `409 CONFLICT` as "no completed orders."

## Deliverables

Complete Admin Portal · Responsive UI · Validation · Error handling · Production-ready code.

## Acceptance criteria

- [x] `npm run build --workspace @menuboard/admin` passes under `strict`
- [x] `npm run lint --workspace @menuboard/admin` passes
- [x] Login, forced password change, and logout work end to end against the real backend
- [x] Concurrent 401s trigger exactly one refresh call (single-flight queue implemented)
- [x] All fourteen pages implemented and reachable; nav filtered by capability
- [x] All seven reports render; no eighth report exists anywhere in the code
- [x] Billing generate → snapshot view → finalise works, with the confirmation step
- [x] No billing, pricing or tax field anywhere outside the Billing page
- [x] No files under `backend/`, `shared/`, or `app/` were modified

## Build record

Built by an autonomous agent as an `@menuboard/admin` workspace: React 18 + Vite + TS strict
+ MUI v6 + TanStack Query v5 + Axios + React Router v6.

Shared infrastructure built once and reused everywhere: `components/DataTable/DataTable.tsx`
(sort/resize/reorder columns, reorder rows, localStorage-persisted grid state),
`components/Modal/Modal.tsx` (draggable/resizable, double-Escape close, Enter-advances-focus,
focus-selects-text, in-progress form persistence), `components/ListToolbar.tsx` (instant
search + filter drawer + linear pagination bar), `components/EntityCardGrid.tsx` (card view),
`components/SearchPickerField.tsx` (search-picker replacing native selects),
`layouts/AppShell.tsx` (3 skins + Sign out, top-right).

A custom MUI-based `DataTable` was used instead of MUI X `DataGridPro`, because column
reordering is a Pro-licensed feature there — a bespoke table avoids introducing a paid
dependency.

**Verification performed after the build agent's own review** (the build agent's sandbox
could not execute `npm`/`tsc`/`vite`/`eslint`; a follow-up pass with real tool access did):
`npm install` at the repo root, `npm run build --workspace @menuboard/shared`, then `npm run
build --workspace @menuboard/admin` — this surfaced and fixed 7 real TypeScript errors (a
generic-constraint issue in `usePersistedFormState` used by six form modals, one
possibly-undefined access in `AppShell.tsx`, and a Rollup/CommonJS interop issue resolving
named exports from the `@menuboard/shared` workspace link, fixed via `vite.config.ts`
`optimizeDeps`/`commonjsOptions`), then `npm run lint --workspace @menuboard/admin` — this
surfaced a missing `eslint-plugin-react-hooks` registration in `.eslintrc.cjs` (the plugin
was a devDependency and used via inline disable-comments, but never registered), now fixed.
After fixes: build, lint, and a live run against the real backend (`npm run dev:backend` +
`npm run dev --workspace @menuboard/admin`) all pass.

## Known gaps / judgment calls (flagged by the build agent, not silently papered over)

1. The Boards nav item is gated on `BOARD_READ_ALL` (SUPER_ADMIN/ADMIN only), even though
   `GET /boards` itself scopes results to memberships for other roles rather than rejecting
   them outright. A MANAGER could technically use the endpoint but currently won't see the
   nav entry — a reasonable but debatable interpretation of "Boards management is an
   admin-primary feature."
2. `BoardMembersPage` has no explicit 403/error UI if a non-privileged user reaches it
   directly by URL. The backend still enforces `requireBoardAccess`, so nothing is insecure
   — it's a UX gap (no visible error banner), not a security gap.
