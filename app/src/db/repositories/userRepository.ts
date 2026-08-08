import type { UserDto } from '@menuboard/shared';
import type { UserRole, UserStatus } from '@menuboard/shared';
import type * as SQLite from 'expo-sqlite';
import { getDb } from '../client';
import type { UserRow } from '../models';

function toDto(row: UserRow): UserDto {
  return {
    id: row.id,
    employeeCode: row.employee_code,
    name: row.name,
    username: row.username,
    phone: row.phone,
    email: row.email,
    role: row.role as UserRole,
    status: row.status as UserStatus,
    avatarPath: row.avatar_path,
    lastLoginAt: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    syncSeq: row.server_sync_seq,
    revision: row.revision,
  };
}

export const userRepository = {
  async upsertMany(users: UserDto[], tx?: SQLite.SQLiteDatabase): Promise<void> {
    if (users.length === 0) return;
    const db = tx ?? (await getDb());
    const apply = async (): Promise<void> => {
      for (const u of users) {
        await db.runAsync(
          `INSERT INTO users (id, employee_code, name, username, phone, email, role, status,
             avatar_path, created_at, updated_at, deleted_at, revision, server_sync_seq, sync_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED')
           ON CONFLICT(id) DO UPDATE SET
             employee_code = excluded.employee_code, name = excluded.name,
             username = excluded.username, phone = excluded.phone, email = excluded.email,
             role = excluded.role, status = excluded.status, avatar_path = excluded.avatar_path,
             updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
             revision = excluded.revision, server_sync_seq = excluded.server_sync_seq,
             sync_state = 'SYNCED'`,
          [
            u.id, u.employeeCode, u.name, u.username, u.phone, u.email, u.role, u.status,
            u.avatarPath, u.createdAt, u.updatedAt, u.deletedAt, u.revision, u.syncSeq,
          ],
        );
      }
    };
    if (tx) {
      await apply();
    } else {
      await db.withTransactionAsync(apply);
    }
  },

  async findById(id: string): Promise<UserDto | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
    return row ? toDto(row) : null;
  },

  async listByIds(ids: readonly string[]): Promise<UserDto[]> {
    if (ids.length === 0) return [];
    const db = await getDb();
    const placeholders = ids.map(() => '?').join(',');
    const rows = await db.getAllAsync<UserRow>(
      `SELECT * FROM users WHERE id IN (${placeholders})`,
      [...ids],
    );
    return rows.map(toDto);
  },

  async listAll(): Promise<UserDto[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<UserRow>(
      `SELECT * FROM users WHERE deleted_at IS NULL ORDER BY name ASC`,
    );
    return rows.map(toDto);
  },
};
