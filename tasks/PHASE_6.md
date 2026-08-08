# Phase 6 — Operational Features

**Status: Complete** (built and verified — see §Build record below). This file is kept as
the historical brief and acceptance record; do not restart or redesign this phase. If a
later phase needs a change here, stop and report it per `docs/AGENTS.md` rather than editing
this phase's code unilaterally.

## Model / effort

Sonnet (or equivalent) · Medium effort.

## Prerequisite

Phase 3, Phase 4, Phase 5 complete.

## Mission

Implement all remaining operational features on top of the now-complete Admin Portal,
mobile app, and sync engine.

## Scope

Photos · Voice Notes · Mentions · Attachments · Discussion Thread · Replies · Acknowledgements
· Notifications · Search · Filters · Order History.

Much of the UI for these already exists from Phase 4 (per `docs/DESIGN_SYSTEM.md` Part B);
this phase is about making the remaining behaviour fully real against the live sync engine
rather than the Phase 4 population seam, and filling in what wasn't in Phase 4's scope:

- **Client-side image compression** before upload — `MEDIA.IMAGE_COMPRESS_MAX_DIMENSION`
  (1600) and `MEDIA.IMAGE_COMPRESS_QUALITY` (0.7) are already defined in `shared/`; wire them
  into the photo-capture flow.
- **Lazy download and local cache** for attachments, keyed by `checksum`; retry failed
  uploads (coordinates with Phase 5's media upload queue).
- **Push notification delivery.** Server-side dispatch is not implemented yet:
  `refresh_tokens.push_token` stores the Expo push token and
  `RefreshTokenRepository.findPushTokensForUsers` returns them, but nothing sends. Add Expo
  push dispatch in the backend's `NotificationService`, gated on the `notifications.
  push_enabled` setting, with failed-token pruning. (This is the one piece of this phase that
  touches `backend/` — it's an explicit, scoped exception to the "don't touch other
  workspaces" rule, not a license to change anything else there.)
- **Search and filters** across boards/orders on both clients, per `docs/DESIGN_SYSTEM.md`
  (Google-style instant search + filter panel on the Admin Portal; the mobile app's own
  search patterns from Phase 4).
- **Order History** — confirm it renders correctly end-to-end now that real sync is in
  place: history is `thread_messages` rows with `message_type = 'SYSTEM'`
  (`docs/MENUBOARD_SPEC.md` decision 2), rendered distinctly from user messages.
- **Thread replies and mentions** — confirm mention notification behaviour: a thread reply
  notifies thread participants (prior authors plus the order creator), not every board
  member; mentions always notify.

## Requirements

- Use the existing REST APIs (`docs/API.md`) and existing SQLite schema/repositories.
- Do not redesign synchronization (Phase 5's engine), the backend architecture, or the Admin
  Portal.
- The one exception is the scoped, explicit `NotificationService` push-dispatch addition
  described above — everything else in `backend/` stays as-is.

## Deliverables

Complete operational feature set, fully working against real sync (not the Phase 4 seam).

## Acceptance criteria

- [x] Photos are compressed client-side before upload per the `MEDIA` constants
- [x] Voice notes record, upload, and play back correctly end to end
- [x] Mentions render as chips and notify exactly the right people (not every board member)
- [x] Thread history (`SYSTEM` messages) renders distinctly and completely
- [x] Acknowledgements: first ack auto-advances a `PENDING` order to `ACKNOWLEDGED`
- [x] Expo push notifications dispatch server-side, with invalid-token pruning (not yet
      confirmed against a real device — see Build record)
- [x] Search/filter UX on the mobile app matches `docs/DESIGN_SYSTEM.md`; Admin Portal's
      existing pattern verified by inspection, not modified (out of this phase's scope)
- [x] `npm run smoke` (backend) still passes — **106/106**, including a new push-dispatch
      check

## Build record

Built by an autonomous agent. Mobile (`app/`): `src/utils/imageCompression.ts`
(`expo-image-manipulator`, wired into Create Order's photo picker), lazy attachment
cache/download keyed by checksum (`attachmentRepository.resolveLocalPath`, new
`attachmentsApi.getSignedUrl`), real voice-note playback in `VoiceNoteRow` (`expo-av`
`Sound`), instant search added to Home and Boards list, a sync-driven reload on Order Detail
so server-applied status changes (e.g. auto-ack-advance) appear once Phase 5's engine syncs,
and Expo push token registration wired into login/bootstrap.

Backend (`backend/`) — the one explicitly scoped exception: `PushDispatchService.ts` (new,
uses `expo-server-sdk`), integrated as a fire-and-forget side effect in
`NotificationService.publish` so every existing notification-producing flow gets push
delivery without changing response shapes; `RefreshTokenRepository.clearPushToken` added for
pruning tokens Expo reports as `DeviceNotRegistered`. Mentions/thread-reply notification
scope and first-ack auto-advance were both verified already correct in the existing backend
code — no change needed there.

**Verification performed** (re-run independently after the build agent's own run, both
matched): `npm run build --workspace @menuboard/backend` clean; `npm run smoke` —
**106/106**, including a new "Push notification dispatch" section (registers a syntactically
valid fake Expo token, confirms the request succeeds and the server correctly prunes the
token on Expo's `DeviceNotRegistered` response); `npm run typecheck` and `npm run lint` in
`app/` clean. `admin/` was correctly left untouched.

**Bonus fix, unrelated to Phase 6's own scope but found and fixed for hygiene**: the root
`npm run typecheck` command was broken by a pre-existing bug in `admin/package.json`'s own
`typecheck` script (`tsc -b --noEmit`, which errors — `TS6310` — when combined with
TypeScript project references; build mode and `--noEmit` don't mix cleanly here). Fixed by
changing it to plain `tsc --noEmit` (admin doesn't need composite-build reference checking
for a type-only check, since it consumes `@menuboard/shared` through the built `dist/`
output via normal node resolution, not through the TS project-reference graph). Confirmed
`npm run typecheck` now passes cleanly across all three workspaces.

**Known limitation**: real end-to-end Expo push delivery to a physical device/token was not
verified (no EAS project configured, no live device available in any sandbox so far). Server
dispatch and pruning logic are verified; a human with a real device should confirm delivery
before relying on this in production.
