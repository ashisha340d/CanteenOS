import { syncEngine } from './syncEngine';

/**
 * ============================================================================================
 * PHASE 5 BOUNDARY — this module is now a thin bootstrap, not the primary sync seam.
 * ============================================================================================
 *
 * Phase 4 used this file as the entire REST→SQLite bridge: it called plain REST endpoints
 * on demand and upserted the results. Phase 5 replaced that with the real offline-first sync
 * engine under `src/sync/*`:
 *
 *   - `pushWorker.ts` drains the `sync_queue` outbox to `POST /api/v1/sync/push`.
 *   - `pullWorker.ts` pages through `POST /api/v1/sync/pull` using the persisted cursor.
 *   - `applyChangeSet.ts` applies each pull page in dependency order inside one transaction.
 *   - `mediaUploader.ts` POSTs attachment bytes to `/attachments/upload` independently.
 *   - `socketClient.ts` listens to Socket.IO hints and triggers pulls; it never writes payloads.
 *   - `syncEngine.ts` coordinates push → media upload → pull on a periodic timer and on reconnect.
 *
 * This function now performs only the first synchronous sync after login/signup, then hands
 * off to the engine for background/periodic work. Screens continue to read only from SQLite.
 * ============================================================================================
 */

/** One-time bootstrap after authentication. The engine takes over from here. */
export async function populateInitialData(_userId: string): Promise<void> {
  await syncEngine.runFullSync();
}

/** Kept as an alias for pull-to-refresh / manual refresh actions. */
export async function refreshFromServer(): Promise<void> {
  await syncEngine.runFullSync();
}
