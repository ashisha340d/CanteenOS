import { LIMITS, type OrderDto } from '@menuboard/shared';
import { syncApi } from '../api';
import { getDb } from '../db/client';
import { orderRepository, settingsRepository, threadRepository, SETTINGS_KEYS } from '../db/repositories';
import { getOrCreateDeviceId } from '../utils/deviceId';
import { nowIso } from '../utils/date';
import { applyChangeSet } from './applyChangeSet';
import { useSyncStatusStore } from '../state/syncStatusStore';
import { notifyNewOrders, playNewMessageAlert } from '../alerts/newOrderAlert';

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
  const newMessageIds: string[] = [];

  console.log(`[SYNC] runPull starting from cursor ${startCursor}`);

  try {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      while (true) {
        console.log(`[SYNC] pulling cursor=${cursor}`);
        const response = await syncApi.pull({
          deviceId,
          cursor,
          limit: LIMITS.SYNC_PULL_LIMIT_DEFAULT,
        });

        console.log(
          `[SYNC] pull response: cursor=${response.cursor}, hasMore=${response.hasMore}, ` +
          `users=${response.changes.users.length}, stations=${response.changes.stations.length}, ` +
          `boards=${response.changes.boards.length}, orders=${response.changes.orders.length}, ` +
          `order_items=${response.changes.order_items.length}`,
        );

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

        // Same test for chat: a message this device has never stored, written by someone else.
        // System rows are skipped — they are the order's own paperwork and the order alert has
        // already sounded for them.
        if (startCursor > 0 && response.changes.thread_messages.length > 0) {
          const currentUserId = await settingsRepository.get<string>(SETTINGS_KEYS.CURRENT_USER_ID);
          for (const message of response.changes.thread_messages) {
            if (message.deletedAt !== null) continue;
            if (message.messageType === 'SYSTEM') continue;
            if (message.authorId === currentUserId) continue;
            if (!(await threadRepository.existsById(message.id))) newMessageIds.push(message.id);
          }
        }

        await applyChangeSet(response.changes, db);
        await settingsRepository.set(SETTINGS_KEYS.SYNC_CURSOR, response.cursor, db);

        cursor = response.cursor;
        if (!response.hasMore) break;
      }

      const lastSyncAt = nowIso();
      await settingsRepository.set(SETTINGS_KEYS.LAST_SYNC_AT, lastSyncAt, db);
      console.log(`[SYNC] runPull completed, lastSyncAt=${lastSyncAt}`);
    });

    await useSyncStatusStore.getState().refresh();

    // Flash ids are registered synchronously inside notifyNewOrders, so they are already set
    // when the dataVersion bump below makes the feed reload.
    if (newOrders.length > 0) {
      void notifyNewOrders(newOrders);
    }

    // Only when no order sounded this cycle: an order arrives with its own ORDER_CREATED row
    // plus any replies, and firing both buzzers back to back reads as one garbled noise.
    if (newMessageIds.length > 0 && newOrders.length === 0) {
      void playNewMessageAlert(newMessageIds);
    }

    // The cursor only advances when the server actually returned changes, so this is the
    // "new data landed in SQLite" signal the screens re-read on.
    if (cursor > startCursor) {
      console.log(`[SYNC] bumping dataVersion (cursor advanced ${startCursor} -> ${cursor})`);
      useSyncStatusStore.getState().bumpDataVersion();
    } else {
      console.log('[SYNC] no new server changes to apply');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[SYNC] runPull failed: ${message}`);
    throw error;
  }
}
