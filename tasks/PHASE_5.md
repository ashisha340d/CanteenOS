# Phase 5 — Offline Synchronization Engine

**Status: Complete** (built and verified — see §Build record below). This file is kept as
the historical brief and acceptance record; do not restart or redesign this phase. If a
later phase needs a change here, stop and report it per `docs/AGENTS.md` rather than editing
this phase's code unilaterally.

## Model / effort

Opus (or equivalent) · High effort.

## Prerequisite

Phase 4 complete (it is — see `PHASE_4.md`).

## Mission

Implement the complete offline-first synchronization engine described in
`docs/ARCHITECTURE.md` §6 (folded in from the former `SYNC.md`). The server side is already
built and tested — this phase is the device half.

## Scope

Sync Queue · Upload Queue · Download Queue · Retry Queue · Conflict Resolution · Timestamp
Synchronization · Socket.IO Client · Network Monitoring · Background Synchronization · Media
Upload Queue · Pending Operations.

## What this phase replaces

Phase 4 built `app/src/sync/populateFromServer.ts` as a narrow, on-demand REST→SQLite
population seam — plain REST calls, no queue, no conflict resolution. This phase replaces
that with the real engine:

- A durable `sync_queue` outbox drain worker. The queue row's `id` is the `clientOpId` sent
  to the server, making push idempotent across retries.
- Push in queue order, max 200 items per batch (`docs/API.md` §Sync). Handle all five
  per-item results: `APPLIED` / `DUPLICATE` → dequeue; `SUPERSEDED` → adopt `serverEntity`,
  dequeue; `REJECTED` → dequeue, mark `FAILED`, surface to the user, **never retry**;
  `FAILED` → keep, retry with backoff.
- Pull with the stored cursor, applying the whole page in one SQLite transaction and only
  then advancing the cursor, so a crash mid-apply replays the page rather than skipping it.
  Loop while `hasMore`.
- Backoff: 2s, 4s, 8s, 16s, 32s, 60s, then every 60s; reset on success. A NetInfo transition
  to connected triggers an immediate drain, bypassing the current gate.
- A Socket.IO client that treats every event as a hint only — it triggers a pull, it never
  writes to SQLite directly (see `docs/API.md` for the event list and `docs/ARCHITECTURE.md`
  §6.4 for why).
- Two-stage media sync: the `attachments` row pushes with the order (already true from
  Phase 4's local-first writes); the bytes upload separately via `POST /attachments/upload`
  with their own `upload_state`/`upload_attempts` and backoff.
- Only these entities are pushable: `boards`, `orders`, `order_items`, `attachments`,
  `thread_messages`, `acknowledgements`. Anything else is rejected by server validation —
  don't attempt to push masters or users.

## Requirements

- Integrate with the existing SQLite schema and repositories from Phase 4 — do not redesign
  either.
- Integrate with the existing REST API (`docs/API.md`) — do not modify API contracts.
- Do not redesign the UI built in Phase 4; this phase is data-layer work. If a UI affordance
  is genuinely needed (e.g. a sync-status indicator), it should slot into the existing design
  system (`docs/DESIGN_SYSTEM.md` Part B), not introduce a new visual language.
- Do not modify `backend/`, `admin/`, or `shared/` database/API contracts.
- Update `app/AGENTS.md`'s "Sync phase boundary" section once `populateFromServer.ts` is
  replaced/extended, so Phase 6 has an accurate picture of the data layer.

## Deliverables

Production-ready synchronization engine · automatic recovery · reliable offline-first
behaviour.

## Acceptance criteria

- [x] Every local-first write already enqueues correctly (inherited from Phase 4) and is now
      actually drained by a background worker
- [x] Push handles all five per-item result codes correctly, including never retrying
      `REJECTED`
- [x] Pull applies pages atomically and only advances the cursor after a successful commit
- [x] Backoff schedule matches the spec exactly, with immediate drain on reconnect
- [x] Socket.IO client never writes an entity body to SQLite directly from a socket payload
- [x] Media uploads recover from interruption without re-uploading successfully-uploaded
      bytes
- [ ] A device that creates data fully offline, then reconnects, converges to the same state
      as a device that was online the whole time — **not yet exercised on a real
      emulator/device against the live backend; do this before considering Phase 5 fully
      closed** (see Build record)
- [x] `app/AGENTS.md` updated to describe the real sync engine in place of the old seam

## Build record

Built by an autonomous agent, entirely within `app/`. New: `src/api/sync.ts`,
`src/api/attachments.ts`, `src/sync/{backoff,applyChangeSet,pushWorker,pullWorker,
mediaUploader,socketClient,networkMonitor,syncEngine}.ts`. Modified: `src/api/client.ts`
(exported `performRefresh()` for socket reconnection reuse), all domain repositories (added
an optional transaction parameter so writes can join an outer transaction),
`src/state/{syncStatusStore,authStore}.ts`, `app/_layout.tsx` (starts/stops the engine with
auth state), `src/sync/populateFromServer.ts` (repurposed as a one-time bootstrap ahead of
the cursor-based pull loop). Added `socket.io-client` dependency.

Per-item push results, backoff schedule, pull atomicity, and the Socket.IO hint-only
contract were all implemented exactly per `docs/ARCHITECTURE.md` §6 / `docs/API.md` — see
the agent's full report for the exact mechanics if needed.

**Background sync**: true OS-level background execution (`expo-background-fetch`/
`expo-task-manager`) was deliberately **not** implemented, in favor of a 30s foreground
timer + app-active + network-reconnect triggers, to avoid adding new native modules before
the core engine has been exercised end-to-end. Revisit if product requirements demand sync
while the app is fully backgrounded/killed.

**Verification performed**: this agent's sandbox had real tool access (unlike Phases 3/4's
build agents) and ran `npm run typecheck`/`npm run lint` itself. Independently re-verified
after completion: `npm run typecheck` (strict, clean) and `npm run lint` (0 errors, 10
pre-existing unused-import warnings) both pass, and `npm run build` at the repo root
(shared → backend → admin) is unaffected. **Not yet verified**: an actual live-device/
emulator run against the running backend exercising real offline→online convergence — no
sandbox in this project has had emulator or live-network access. This is the one item
blocking Phase 5 from being fully closed; a human (or an agent with emulator access) should
run through: create an order while `airplane mode`/backend unreachable, confirm it queues
and the UI shows a pending-sync cue, reconnect, confirm it pushes and the order appears
correctly on a second session/device.

**Backend gap noted (not fixed, out of this phase's scope)**: `AttachmentService`'s upload
endpoint does a blind `INSERT` keyed on `attachmentId`, so a retried upload after a
post-upload-but-pre-local-state-update crash would hit a duplicate-key error instead of
returning the existing row idempotently. The client's `upload_state` tracking prevents this
in the normal path, but true crash-safety would need a server-side idempotent upsert. Worth
a look during Phase 7's stabilization pass.
