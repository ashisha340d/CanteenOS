import type { ClientType } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { RefreshTokenRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

export interface InsertRefreshTokenInput {
  id: string;
  userId: string;
  tokenHash: string;
  deviceId: string;
  deviceName: string | null;
  clientType: ClientType;
  ip: string | null;
  userAgent: string | null;
  expiresAt: Date;
}

const SELECT_COLUMNS = `
  id, user_id, token_hash, device_id, device_name, client_type, push_token, ip, user_agent,
  expires_at, revoked_at, replaced_by, last_used_at, created_at`;

export class RefreshTokenRepository {
  async insert(db: Db, input: InsertRefreshTokenInput): Promise<void> {
    await mutate(
      db,
      `INSERT INTO refresh_tokens
        (id, user_id, token_hash, device_id, device_name, client_type, ip, user_agent,
         expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.userId,
        input.tokenHash,
        input.deviceId,
        input.deviceName,
        input.clientType,
        input.ip,
        input.userAgent,
        toDbDateTime(input.expiresAt),
        toDbDateTime(),
      ],
    );
  }

  /**
   * Looks up by hash regardless of revocation state — the caller needs to distinguish
   * "unknown token" from "already-consumed token", because the latter signals theft.
   */
  async findByHash(db: Db, tokenHash: string): Promise<RefreshTokenRow | null> {
    return selectOne<RefreshTokenRow>(
      db,
      `SELECT ${SELECT_COLUMNS} FROM refresh_tokens WHERE token_hash = ?`,
      [tokenHash],
    );
  }

  async findActiveByUserDevice(
    db: Db,
    userId: string,
    deviceId: string,
  ): Promise<RefreshTokenRow[]> {
    return selectRows<RefreshTokenRow>(
      db,
      `SELECT ${SELECT_COLUMNS} FROM refresh_tokens
        WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC`,
      [userId, deviceId, toDbDateTime()],
    );
  }

  /** Marks a token consumed and links it to its replacement, forming the rotation chain. */
  async rotate(db: Db, id: string, replacedById: string): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      'UPDATE refresh_tokens SET revoked_at = ?, replaced_by = ?, last_used_at = ? WHERE id = ?',
      [now, replacedById, now, id],
    );
  }

  async revoke(db: Db, id: string): Promise<void> {
    await mutate(
      db,
      'UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
      [toDbDateTime(), id],
    );
  }

  async revokeByHash(db: Db, tokenHash: string): Promise<void> {
    await mutate(
      db,
      'UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
      [toDbDateTime(), tokenHash],
    );
  }

  async revokeAllForUser(db: Db, userId: string): Promise<number> {
    const result = await mutate(
      db,
      'UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
      [toDbDateTime(), userId],
    );
    return result.affectedRows;
  }

  /**
   * Revokes every live token for one device. Used on refresh-reuse detection: if a
   * consumed token is presented again, the chain may be in an attacker's hands, so the
   * whole device is cut off and forced to re-authenticate.
   */
  async revokeDeviceChain(db: Db, userId: string, deviceId: string): Promise<number> {
    const result = await mutate(
      db,
      `UPDATE refresh_tokens SET revoked_at = ?
        WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL`,
      [toDbDateTime(), userId, deviceId],
    );
    return result.affectedRows;
  }

  async setPushToken(
    db: Db,
    userId: string,
    deviceId: string,
    pushToken: string | null,
  ): Promise<void> {
    await mutate(
      db,
      `UPDATE refresh_tokens SET push_token = ?
        WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL`,
      [pushToken, userId, deviceId],
    );
  }

  /** Distinct live push tokens for a set of users, for notification fan-out. */
  async findPushTokensForUsers(db: Db, userIds: readonly string[]): Promise<
    { userId: string; pushToken: string }[]
  > {
    if (userIds.length === 0) return [];
    const placeholders = userIds.map(() => '?').join(', ');
    const rows = await selectRows<RefreshTokenRow & { push_token: string }>(
      db,
      `SELECT DISTINCT user_id, push_token FROM refresh_tokens
        WHERE user_id IN (${placeholders})
          AND push_token IS NOT NULL
          AND revoked_at IS NULL
          AND expires_at > ?`,
      [...userIds, toDbDateTime()],
    );
    return rows.map((row) => ({ userId: row.user_id, pushToken: row.push_token }));
  }

  /** Housekeeping: drop rows that are expired or long revoked. */
  /** Invalidates a push token when the provider reports it as stale. */
  async clearPushToken(db: Db, pushToken: string): Promise<number> {
    const result = await mutate(
      db,
      'UPDATE refresh_tokens SET push_token = NULL WHERE push_token = ? AND revoked_at IS NULL',
      [pushToken],
    );
    return result.affectedRows;
  }

  async purgeExpired(db: Db, olderThan: Date): Promise<number> {
    const result = await mutate(
      db,
      'DELETE FROM refresh_tokens WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)',
      [toDbDateTime(olderThan), toDbDateTime(olderThan)],
    );
    return result.affectedRows;
  }
}

export const refreshTokenRepository = new RefreshTokenRepository();
