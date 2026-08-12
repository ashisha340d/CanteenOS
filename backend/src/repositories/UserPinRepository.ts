import { mutate, selectOne, type Db } from '../db/types';
import type { UserPinRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

export class UserPinRepository {
  async findByUserId(db: Db, userId: string): Promise<UserPinRow | null> {
    return selectOne<UserPinRow>(
      db,
      'SELECT user_id, pin_hash, failed_attempts, locked_until, created_at, updated_at FROM user_pins WHERE user_id = ?',
      [userId],
    );
  }

  async upsert(
    db: Db,
    userId: string,
    pinHash: string,
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO user_pins (user_id, pin_hash, failed_attempts, locked_until, created_at, updated_at)
       VALUES (?, ?, 0, NULL, ?, ?)
       ON DUPLICATE KEY UPDATE
         pin_hash = VALUES(pin_hash),
         failed_attempts = 0,
         locked_until = NULL,
         updated_at = VALUES(updated_at)`,
      [userId, pinHash, now, now],
    );
  }

  async remove(db: Db, userId: string): Promise<void> {
    await mutate(db, 'DELETE FROM user_pins WHERE user_id = ?', [userId]);
  }

  async incrementFailedAttempt(db: Db, userId: string): Promise<void> {
    await mutate(
      db,
      `UPDATE user_pins
       SET failed_attempts = failed_attempts + 1, updated_at = ?
       WHERE user_id = ?`,
      [toDbDateTime(), userId],
    );
  }

  async setLockedUntil(db: Db, userId: string, lockedUntil: Date): Promise<void> {
    await mutate(
      db,
      'UPDATE user_pins SET locked_until = ?, updated_at = ? WHERE user_id = ?',
      [toDbDateTime(lockedUntil), toDbDateTime(), userId],
    );
  }

  async resetAttempts(db: Db, userId: string): Promise<void> {
    await mutate(
      db,
      'UPDATE user_pins SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE user_id = ?',
      [toDbDateTime(), userId],
    );
  }
}

export const userPinRepository = new UserPinRepository();
