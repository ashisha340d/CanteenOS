# Phase 7 — Production Stabilization

**Status: Complete** (built and verified — see §Build record below). This file is kept as the
historical brief and acceptance record.

## Model / effort

Sonnet (or equivalent) · Low effort.

## Prerequisite

All previous phases (3–6) complete.

## Mission

Prepare MenuBoard Version 1.0 for production.

## Scope

Bug Fixes · Performance Optimization · Memory Optimization · Type Safety · Lint Cleanup ·
Accessibility · Code Cleanup · Unit Tests · Integration Tests · Documentation.

- **Unit tests**: `resolveConflict`, `resolveCursor`, `buildOrderNumber`, status transitions,
  the capability matrix, password policy, media path resolution.
- **Integration tests**: auth and refresh-token rotation, order lifecycle, sync push/pull
  convergence, the Android capability boundary (forbidden capabilities never reachable),
  billing immutability.
- **Convert the existing smoke scripts into the integration suite** rather than discarding
  them — `backend/scripts/smoke.mjs` and `smoke-socket.mjs` already encode over a hundred
  verified behaviours.
- **Security pass**: HTTPS-only posture (`FORCE_HTTPS`), re-verify no capability leak to
  Android, confirm rate limits, review the audit trail for coverage gaps.
- **Performance pass**: verify the sync pull query plans against a seeded dataset of
  realistic size; add indexes only where `EXPLAIN` justifies them. Address the admin bundle
  size warning from the Phase 3 build (`vite build` currently emits a single ~730 kB JS
  chunk) via route-level code-splitting if it's still present.
- **Production checklist**: real `JWT_SECRET` (not the dev placeholder currently in
  `backend/.env`), `TRUST_PROXY` behind a proxy, `FORCE_HTTPS`, `LOG_LEVEL=info`, migrations
  applied, backups, the shared in-memory rate-limit-store caveat (correct for a single
  instance; horizontal scaling needs a shared store).
- **Known gaps to close or explicitly accept for v1**: Expo push delivery (Phase 6 should
  have closed this — verify), the in-memory rate limit store, server-side image processing
  (compression is a client concern by design — confirm that's still the intended posture).

## Requirements

- No new features. No API changes. No database changes. No synchronization redesign. No
  architecture changes. This phase hardens what exists; it does not extend scope.

## Deliverables

Production-ready Version 1.0 · Testing summary · Known issues · Performance summary.

## Acceptance criteria

- [x] Unit + integration test suites exist and pass, replacing/extending the smoke scripts —
      `shared` (22 tests, Vitest: `buildOrderNumber`, capability matrix, Android boundary,
      order status transitions) and `backend` (24 tests, Vitest: `resolveConflict`/
      `resolveCursor`, media path resolution, password policy) unit suites added; `smoke.mjs`
      (111 checks) and `smoke-socket.mjs` (13 checks) extended in place rather than replaced,
      per the phase brief's explicit preference — all 4 suites pass, 170 checks total
- [x] Security checklist above completed and documented — see "Security pass" in the Phase 7
      build record below and `docs/ARCHITECTURE.md` §10
- [x] Performance checklist above completed and documented, with `EXPLAIN` evidence for any
      new index — evidence gathered (`backend/scripts/explain-sync-pull.mjs`), **no new index
      added** because the only available seeded dataset (19 orders) does not justify one; see
      `docs/KNOWN_ISSUES.md` §4 for the honest caveat and what to re-check before trusting the
      current index set at production scale
- [x] `docs/` and `tasks/` reflect the actual shipped state — `docs/API.md` §11/§17 updated for
      the attachment-delete fix, `docs/ARCHITECTURE.md` §10 added, this file updated
- [x] A short "Known issues" doc lists anything deliberately deferred past v1, with why —
      `docs/KNOWN_ISSUES.md`

## Build record

Built by an autonomous agent with real tool access (npm, a running MariaDB instance, and a
running backend). Every command reported below was actually executed, not assumed.

**1. Security bug fix (the named target of this phase).** `AttachmentService.remove` checked
only "uploader, or an active non-VIEWER board member" before letting a caller delete someone
else's attachment — `ATTACHMENT_DELETE_ANY` (per `shared/src/permissions`) was never consulted,
so a plain `MEMBER` could delete another member's media. Fixed with a new
`assertMayDeleteAny` that checks the capability globally (`SUPER_ADMIN`/`ADMIN`) or per-board
(`OWNER` only — `MANAGER` does **not** hold this capability per the existing matrix, contrary to
this phase brief's paraphrase; the matrix in code is the source of truth and was not changed).
Regression coverage added to `backend/scripts/smoke.mjs` (new "Attachment delete authorization"
section, 5 checks): a MEMBER is refused (403), a MANAGER is also refused (403, since MANAGER
lacks the capability), a global ADMIN succeeds (204), a second delete 404s, and the uploader can
always delete their own attachment regardless of role.

**2. Attachment upload idempotency gap (Phase 5's flagged gap).** Fixed narrowly:
`AttachmentService.upload` now catches an `ER_DUP_ENTRY` on the retried insert, and if the
existing row's checksum matches the just-uploaded bytes, returns it as a successful idempotent
response (cleaning up any redundant re-stored file) instead of a 500. A genuine checksum mismatch
on the same id still fails loudly.

**3. Unit tests added** (Vitest, newly introduced — no test runner existed before): `shared`
(`tests/orderNumber.test.ts`, `tests/permissions.test.ts` — 22 tests) and `backend`
(`tests/passwordPolicy.test.ts`, `tests/mediaStorage.test.ts`, `tests/syncService.test.ts` — 24
tests, including `resolveConflict`/`resolveCursor` exercised directly as the private pure
functions they are). `npm run test --workspace @menuboard/shared` / `--workspace
@menuboard/backend`, 46 tests, all passing.

**4. Integration/smoke suites extended, not replaced**, per the brief's explicit preference:
`backend/scripts/smoke.mjs` (now 111 checks, up from 106) and `scripts/smoke-socket.mjs` (13
checks) both pass in full against a live backend + MariaDB.

**5. Security pass**: `TRUST_PROXY`/`FORCE_HTTPS` posture documented in
`backend/.env.example` (expanded inline) and `docs/ARCHITECTURE.md` §10 (new); the committed
`.env.example`'s `DB_PASSWORD` (a real-looking local dev value) was sanitised to a placeholder;
rate limits reviewed and found sane (distinct ceilings for API/auth/sync/upload, keyed
appropriately); the Android capability boundary was re-verified via the existing smoke checks
plus new unit coverage in `shared/tests/permissions.test.ts`; audit trail coverage reviewed
(`AuditAction` in `AuditService.ts`) and found comprehensive — no gap added or found beyond the
attachment-delete fix itself.

**6. Performance pass**: admin bundle size reduced via route-level code-splitting
(`admin/src/routes.tsx`, `React.lazy` + `Suspense` for every page past the dashboard) and vendor
chunking (`admin/vite.config.ts` `manualChunks`) — the single ~730 kB chunk is now a ~32 kB
initial chunk, 1–10 kB per-page chunks, and three vendor chunks (react/router ~23 kB, query+axios
~99 kB, MUI ~500 kB). Sync pull query plan checked with `EXPLAIN` via the new
`backend/scripts/explain-sync-pull.mjs` against the seeded dataset; **no index was added** — the
dataset (19 orders) is too small to produce trustworthy evidence either way, and adding one
without evidence would have violated this phase's own instruction. See `docs/KNOWN_ISSUES.md`.

**7. Lint/type cleanup**: all ~9 pre-existing `no-unused-vars` warnings in `app/` (flagged across
Phases 4–6) fixed (unused icon/token imports in 6 files) — `app`'s `npm run lint` is now 0
warnings, 0 errors (was 9 warnings). Full-workspace `npm run build`, `npm run typecheck`, and
`npm run lint --workspace @menuboard/admin` all verified clean after every change in this phase.

**8. Accessibility**: light pass, not a full audit. Admin Portal: every icon-only `IconButton`
across `AppShell`, `ListToolbar`, and the Users/Boards/BoardMembers/Stations/ActivityTypes/
MenuCategories/MenuItems/Billing/Audit pages now has a descriptive `aria-label` (previously only
2 of ~30 had one); `Modal`'s close button already had one. Mobile app: added
`accessibilityRole`/`accessibilityLabel` to the three genuinely icon-only actionable elements
found in the order detail screen (send button, voice-note play/pause, attachment thumbnail) —
everything else audited either already had a text label (accessible name comes for free) or is
the OS-provided Expo Router / React Navigation header back button (already accessible). Not
done: colour-contrast measurement, a screen-reader device walkthrough, or a systematic
touch-target-size audit — see `docs/KNOWN_ISSUES.md` §8.

**9. Documentation**: `docs/API.md` §11/§17 updated to reflect the attachment-delete fix instead
of describing it as an open gap; `docs/ARCHITECTURE.md` §10 "Production notes" added;
`docs/KNOWN_ISSUES.md` created; this file's acceptance checklist updated to reflect what was
actually verified, not aspirationally checked.

**10. Production checklist**: `backend/.env.example` expanded with explicit, specific guidance
for `JWT_SECRET` (must be real/random, 32+ chars, never the placeholder — matching what
`config/index.ts` already enforces at boot), `TRUST_PROXY`/`FORCE_HTTPS` (must both be true
behind a real proxy), and the in-memory rate-limit store's horizontal-scaling caveat (also
captured durably in `docs/ARCHITECTURE.md` §10, not just a comment that could bit-rot alone).

**Full verification, exact counts** (all run in this session, in this order, against a real
MariaDB instance and a live backend process):

- `npm install` at repo root: clean, 0 errors
- `npm run build` at repo root (shared → backend → admin): clean, 0 errors (admin bundle warning
  reduced but not eliminated — see §6 above and Known Issues §5)
- `npm run typecheck` at repo root (shared, backend, admin): clean, 0 errors
- `npm run lint --workspace @menuboard/admin`: clean, 0 warnings/errors
- `npm run test --workspace @menuboard/shared`: **22 passed, 0 failed**
- `npm run test --workspace @menuboard/backend`: **24 passed, 0 failed**
- `npm run smoke --workspace @menuboard/backend`: **111 passed, 0 failed**
- `npm run smoke:socket --workspace @menuboard/backend`: **13 passed, 0 failed**
- `cd app && npm run typecheck`: clean, 0 errors
- `cd app && npm run lint`: clean, 0 warnings/errors (was 9 warnings)

**Not verified in this phase, carried forward honestly** (see `docs/KNOWN_ISSUES.md` for the
full list and reasons): real device/emulator offline↔online sync convergence; real push
notification delivery to a device; sync pull index sufficiency at production scale (only a
19-row seeded dataset was available); a full accessibility audit beyond the light pass above.
