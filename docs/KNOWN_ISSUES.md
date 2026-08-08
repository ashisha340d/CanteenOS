# MenuBoard — Known Issues (as of Phase 7 / v1.0)

This is an honest list of what is deliberately deferred past v1, or verified only partially,
with the reason in each case. Nothing here was silently dropped — each item was flagged in an
earlier phase's build record and is carried forward rather than papered over.

## 1. Real device / emulator sync convergence — not exercised

**Status: unverified end-to-end on real hardware or an emulator.**

Phase 5 built the full offline sync engine (durable outbox, cursor-paged pull applied
atomically, backoff, Socket.IO hint-only reconnection) and it passes `npm run typecheck` /
`npm run lint`, and the server side of push/pull/convergence is exercised by
`backend/scripts/smoke.mjs`'s "Offline sync" section (offline-created order pushed, replayed
push does not duplicate, pull returns the new order). What has **not** been run is the actual
device-side scenario: create data while genuinely offline on a real Android device or emulator,
reconnect, and confirm it converges with a second device that was online the whole time. No
sandbox available across Phases 3–7 has had emulator or live-network access to a physical/virtual
Android device. **Action for whoever ships this:** run that scenario manually before calling v1
sync fully verified.

## 2. Push notification delivery — verified against Expo's API surface, not a real device

Phase 6 wired up Expo push token registration and dispatch, and `backend/scripts/smoke.mjs`
covers token registration and confirms notification creation is not blocked by push dispatch.
The actual delivery of a push notification to a real device's notification tray has not been
observed, for the same reason as #1 — no environment with a real device or Expo Go install was
available to any build agent in this project.

## 3. True OS-level background sync — not implemented, by design choice

The sync engine runs on a 30-second foreground timer plus app-active/network-reconnect triggers,
not `expo-background-fetch`/`expo-task-manager`. This was a deliberate Phase 5 decision to avoid
adding new native modules before the core engine had been exercised end-to-end (see
`tasks/PHASE_5.md`'s build record). If product requirements demand sync while the app is fully
backgrounded or killed, this needs a follow-up phase — it is not a bug, it is unbuilt scope.

## 4. Sync pull query plan — checked against a small seeded dataset only

Phase 7 ran `EXPLAIN` against `orders.changedSince` (the sync pull hot path) and its
`order_items` equivalent using `backend/scripts/explain-sync-pull.mjs`. The seeded dataset has
only 19 orders, which is not a "realistic size" — at that scale MariaDB's optimiser sometimes
prefers a full table scan simply because scanning 19 rows is cheaper than using an index, which
tells us nothing about behaviour at, say, 100k+ orders. With the cursor near the current maximum
(the common steady-state case: a device polling that is mostly caught up), the existing
`ix_orders_sync_seq` index was already used with a `range` scan and 2 examined rows — reasonable.
**No new index was added**, per this phase's explicit instruction to add one only where `EXPLAIN`
justifies it against real evidence, and the evidence available does not justify one. **Action for
whoever ships this:** re-run `explain-sync-pull.mjs` after loading a realistic multi-tenant,
multi-thousand-order dataset (or against a copy of real production data) before assuming the
current index set is sufficient at scale. If it shows the cold-start full pull path (cursor=0,
a brand new device's first sync) degrading, a composite `(board_id, sync_seq)` index on `orders`
and `order_items` is the first thing to try — reasoned from the query shape, not verified here.

## 5. Admin bundle size — reduced, not eliminated

The single ~730 kB (post Phase 3) admin JS chunk has been route-level code-split
(`admin/src/routes.tsx` now lazy-loads every page past the dashboard) and vendor-chunked
(`admin/vite.config.ts` `manualChunks` for React/router, MUI, and TanStack Query + axios). The
initial `index` chunk is now ~32 kB and most individual pages are 1–10 kB, but the MUI vendor
chunk itself is ~500 kB (just over Vite's 500 kB warning threshold) because MUI core is large and
used by nearly every page regardless of route. Splitting MUI further (e.g. isolating
`@mui/icons-material`, or replacing the custom `DataTable`/`Modal` with lighter primitives) was
judged out of scope for a "hardening, not a rewrite" phase — MUI usage is a Phase 3 architectural
decision, not a Phase 7 concern.

## 6. Attachment upload idempotency — addressed narrowly, not exhaustively

Phase 5's build record flagged that a retried `POST /attachments/upload` after a crash between
the bytes landing and the client learning about it would hit a duplicate-key error on the
client-supplied `attachmentId` instead of responding idempotently. Phase 7 added a narrow fix:
`AttachmentService.upload` now catches an `ER_DUP_ENTRY` on that insert, looks up the existing
row, and — only if its checksum matches the just-uploaded bytes — returns that existing row as a
successful response instead of a 500, cleaning up any redundantly re-stored duplicate file. This
is not exhaustively tested against real concurrent-request races (two simultaneous requests with
the same `attachmentId`, rather than a sequential retry) — the transaction serializes the insert,
so a genuine race would have one request succeed and the other observe the duplicate-key path
correctly, but this has not been load-tested.

## 7. Report query mismatch (`status` filter) — pre-existing, not touched this phase

`shared/src/dto/reports.ts`'s `ReportQuery` declares an optional `status?: OrderStatus[]`, but
`reportQuerySchema` in `backend/src/validation/schemas.ts` does not accept a `status` query
parameter — sending one is rejected as `VALIDATION_FAILED`. This was flagged in `docs/API.md`
§17 before Phase 7 and is **not** the bug this phase was specifically asked to fix (that was the
attachment-delete authorization gap, addressed above). It is left as-is because closing it means
picking a side (extend the schema, or trim the DTO) and either is a small API-surface change that
`docs/AGENTS.md`'s process asks be flagged rather than silently decided by whichever agent
happens to touch it last. Flagging it here again so it isn't lost.

## 8. Accessibility — a light pass only, not a WCAG audit

Phase 7's accessibility pass was scoped as "fix what's cheap and clearly correct," not a full
audit. What was checked and fixed is listed in the Phase 7 build record / final summary. What was
**not** done: colour-contrast measurement against WCAG AA thresholds, screen-reader walkthroughs
on a real device (VoiceOver/TalkBack), or a systematic keyboard-navigation pass through every
Admin Portal page beyond the shared `DataTable`/`Modal` components. A dedicated accessibility
phase would be needed before making any compliance claim.

## 9. Horizontally-scaled rate limiting

`express-rate-limit`'s default in-memory store is correct for a single backend process and is
what MenuBoard ships with. It is documented (here, in `docs/ARCHITECTURE.md` §10, and in
`backend/.env.example`) that running more than one backend instance behind a load balancer
without switching to a shared store (e.g. Redis-backed) effectively multiplies every rate limit
ceiling by the instance count. No shared store was added — doing so is infrastructure choice
(which store, which client library) that belongs to whoever operates the real deployment, not a
default this codebase should force.
