import type { CounterMessageDirection, CounterMessageKind } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db, type RowDataPacket } from '../db/types';
import { toDbDateTime } from '../utils/time';

export interface CounterMessageRow extends RowDataPacket {
  id: string;
  counter_id: string;
  direction: CounterMessageDirection;
  kind: CounterMessageKind;
  body: string;
  body_hi: string | null;
  pos_order_id: string | null;
  order_number: string | null;
  sender_id: string | null;
  sender_name: string | null;
  read_at: string | null;
  created_at: string;
}

export interface CounterUnreadRow extends RowDataPacket {
  counter_id: string;
  unread: number;
}

export interface CounterOrderTagRow extends RowDataPacket {
  pos_order_id: string;
  message_count: number;
  unread_count: number;
}

const COLUMNS = `id, counter_id, direction, kind, body, body_hi, pos_order_id, order_number,
  sender_id, sender_name, read_at, created_at`;

/**
 * The admin↔counter message log. One table, both directions, ordered by time — a conversation
 * is a single sequence, and splitting it by sender would only mean re-merging it on read.
 */
export class CounterChatRepository {
  async insert(
    db: Db,
    row: {
      id: string;
      counterId: string;
      direction: CounterMessageDirection;
      kind: CounterMessageKind;
      body: string;
      orderId: string | null;
      orderNumber: string | null;
      senderId: string | null;
      senderName: string | null;
    },
  ): Promise<void> {
    await mutate(
      db,
      `INSERT INTO counter_messages
         (id, counter_id, direction, kind, body, body_hi, pos_order_id, order_number,
          sender_id, sender_name, read_at, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?)`,
      [
        row.id,
        row.counterId,
        row.direction,
        row.kind,
        row.body,
        row.orderId,
        row.orderNumber,
        row.senderId,
        row.senderName,
        toDbDateTime(),
      ],
    );
  }

  async findById(db: Db, id: string): Promise<CounterMessageRow | null> {
    return selectOne<CounterMessageRow>(
      db,
      `SELECT ${COLUMNS} FROM counter_messages WHERE id = ?`,
      [id],
    );
  }

  /**
   * A counter's thread: the newest `limit` messages, flipped back into reading order. Taking
   * the tail rather than the head is what lets a screen that has been live for weeks open its
   * thread without dragging every message it ever received across the wire.
   *
   * `limit` is interpolated because MySQL will not take a placeholder in LIMIT under prepared
   * statements; it is forced through `Math.floor` on a caller-supplied constant, never a
   * request value.
   */
  async listThread(db: Db, counterId: string, limit: number): Promise<CounterMessageRow[]> {
    const capped = Math.max(1, Math.floor(limit));
    const rows = await selectRows<CounterMessageRow>(
      db,
      `SELECT ${COLUMNS} FROM counter_messages
        WHERE counter_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ${capped}`,
      [counterId],
    );
    return rows.reverse();
  }

  /** The newest message on each counter, for the admin's counter list. */
  async listLatestPerCounter(db: Db): Promise<CounterMessageRow[]> {
    return selectRows<CounterMessageRow>(
      db,
      `SELECT ${COLUMNS} FROM counter_messages cm
        WHERE cm.id = (
          SELECT sub.id FROM counter_messages sub
           WHERE sub.counter_id = cm.counter_id
           ORDER BY sub.created_at DESC, sub.id DESC
           LIMIT 1
        )`,
    );
  }

  /** Unread counts per counter for one direction — i.e. what is waiting on one side. */
  async unreadByCounter(db: Db, direction: CounterMessageDirection): Promise<CounterUnreadRow[]> {
    return selectRows<CounterUnreadRow>(
      db,
      `SELECT counter_id, COUNT(*) AS unread FROM counter_messages
        WHERE direction = ? AND read_at IS NULL
        GROUP BY counter_id`,
      [direction],
    );
  }

  async unreadCount(
    db: Db,
    counterId: string,
    direction: CounterMessageDirection,
  ): Promise<number> {
    const row = await selectOne<{ unread: number } & RowDataPacket>(
      db,
      `SELECT COUNT(*) AS unread FROM counter_messages
        WHERE counter_id = ? AND direction = ? AND read_at IS NULL`,
      [counterId, direction],
    );
    return Number(row?.unread ?? 0);
  }

  /**
   * Marks everything the calling side has now seen. Keyed on direction rather than on a message
   * id: "I have read this thread" is the action a person actually takes at a counter, and a
   * per-message receipt would be a promise neither of these interfaces makes.
   */
  async markRead(db: Db, counterId: string, direction: CounterMessageDirection): Promise<void> {
    await mutate(
      db,
      `UPDATE counter_messages SET read_at = ?
        WHERE counter_id = ? AND direction = ? AND read_at IS NULL`,
      [toDbDateTime(), counterId, direction],
    );
  }

  /**
   * Empties a counter's thread. A hard delete, not a soft one: this is chatter, not a record —
   * nothing references it, nothing audits it, and a "cleared" conversation that quietly stayed
   * in the table would be a promise broken rather than kept.
   */
  async deleteThread(db: Db, counterId: string): Promise<number> {
    const result = await mutate(db, `DELETE FROM counter_messages WHERE counter_id = ?`, [
      counterId,
    ]);
    return result.affectedRows;
  }

  /** Fills in the Hindi rendering once the translator has answered. Best-effort by design. */
  async setBodyHi(db: Db, id: string, bodyHi: string): Promise<void> {
    await mutate(db, `UPDATE counter_messages SET body_hi = ? WHERE id = ?`, [bodyHi, id]);
  }

  /**
   * Which of a counter's orders carry messages. Answered separately from the board queue on
   * purpose: the queue is what a wall screen re-reads every few seconds, and a chat feature has
   * no business widening it.
   */
  async listOrderTags(db: Db, counterId: string): Promise<CounterOrderTagRow[]> {
    return selectRows<CounterOrderTagRow>(
      db,
      `SELECT pos_order_id,
              COUNT(*) AS message_count,
              SUM(CASE WHEN direction = 'TO_COUNTER' AND read_at IS NULL THEN 1 ELSE 0 END)
                AS unread_count
         FROM counter_messages
        WHERE counter_id = ? AND pos_order_id IS NOT NULL
        GROUP BY pos_order_id`,
      [counterId],
    );
  }
}

export const counterChatRepository = new CounterChatRepository();
