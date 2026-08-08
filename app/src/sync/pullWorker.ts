import { LIMITS, type OrderDto } from '@menuboard/shared';
import { syncApi } from '../api';
import { getDb } from '../db/client';
import { orderRepository, settingsRepository, SETTINGS_KEYS } from '../db/repositories';
import { getOrCreateDeviceId } from '../utils/deviceId';
import { nowIso } from '../utils/date';
import { applyChangeSet } from './applyChangeSet';
import { useSyncStatusStore } from '../state/syncStatusStore';
import { notifyNewOrders } from '../alerts/newOrderAlert';

/**
 * Pulls deltas from the server starting at the persisted cursor. Each page is applied in
 * dependency order inside a single SQLite transaction; the cursor is advanced only after
 * that transaction commits. Loop continues while `hasMore` is true.
 */
export async function runPull(): Promise<void> {
  const deviceId = await getOrCreateDeviceId();
  const startCursor = (await settingsRepository.get<number>(SETTINGS_KEYS.SYNC_CURSOR)) ?? 0;
  let cursor = startCursor;
  const newOrders: OrderDto[] = [];

  while (true) {
    const response = await syncApi.pull({
      deviceId,
      cursor,
      limit: LIMITS.SYNC_PULL_LIMIT_DEFAULT,
    });

    // Checked against SQLite *before* the change set is applied: an order in the page that
    // does not exist locally yet is one somebody else just raised. The initial bootstrap
    // (cursor 0) is exempt — everything is "new" then, and buzzing for history is noise.
    if (startCursor > 0 && response.changes.orders.length > 0) {
      const currentUserId = await settingsRepository.get<string>(SETTINGS_KEYS.CURRENT_USER_ID);
      for (const order of response.changes.orders) {
        if (order.deletedAt !== null || order.createdBy === currentUserId) continue;
        if ((await orderRepository.findById(order.id)) === null) newOrders.push(order);
      }
    }

    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await applyChangeSet(response.changes, db);
      await settingsRepository.set(SETTINGS_KEYS.SYNC_CURSOR, response.cursor, db);
    });

    cursor = response.cursor;

    if (!response.hasMore) break;
  }

  await settingsRepository.set(SETTINGS_KEYS.LAST_SYNC_AT, nowIso());
  await useSyncStatusStore.getState().refresh();

  // Flash ids are registered synchronously inside notifyNewOrders, so they are already set
  // when the dataVersion bump below makes the feed reload.
  if (newOrders.length > 0) {
    void notifyNewOrders(newOrders);
  }

  // The cursor only advances when the server actually returned changes, so this is the
  // "new data landed in SQLite" signal the screens re-read on.
  if (cursor > startCursor) {
    useSyncStatusStore.getState().bumpDataVersion();
  }
}
