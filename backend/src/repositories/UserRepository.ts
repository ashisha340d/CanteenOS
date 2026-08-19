import type { UserRole, UserStatus } from '@menuboard/shared';
import { allocateSyncSeq } from '../db/syncSeq';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { CountRow, UserRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

export interface UserListFilter {
  search?: string;
  role?: UserRole;
  status?: UserStatus;
  includeDeleted?: boolean;
  limit: number;
  offset: number;
  sortBy?: 'name' | 'username' | 'role' | 'created_at';
  sortDir?: 'asc' | 'desc';
}

export interface InsertUserInput {
  id: string;
  employeeCode: string | null;
  name: string;
  username: string;
  phone: string | null;
  email: string | null;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
  createdBy: string | null;
}

export interface UpdateUserInput {
  employeeCode?: string | null;
  name?: string;
  phone?: string | null;
  email?: string | null;
  role?: UserRole;
  status?: UserStatus;
  passwordHash?: string;
  mustChangePassword?: boolean;
  avatarPath?: string | null;
}

const SELECT_COLUMNS = `
  id, employee_code, name, username, phone, email, password_hash, role, status,
  avatar_path, must_change_password, last_login_at, created_by,
  created_at, updated_at, deleted_at, revision, sync_seq`;

const SORTABLE_COLUMNS: Record<string, string> = {
  name: 'name',
  username: 'username',
  role: 'role',
  created_at: 'created_at',
};

/**
 * SQL only. Business rules (who may change a role, password policy, audit) live in
 * UserService.
 */
export class UserRepository {
  async findById(db: Db, id: string, options: { includeDeleted?: boolean } = {}) {
    const deletedClause = options.includeDeleted === true ? '' : ' AND deleted_at IS NULL';
    return selectOne<UserRow>(
      db,
      `SELECT ${SELECT_COLUMNS} FROM users WHERE id = ?${deletedClause}`,
      [id],
    );
  }

  async findByIds(db: Db, ids: readonly string[]): Promise<UserRow[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    return selectRows<UserRow>(
      db,
      `SELECT ${SELECT_COLUMNS} FROM users WHERE id IN (${placeholders})`,
      ids,
    );
  }

  /** Active accounts holding any of these roles — the audience for an escalation. */
  async findActiveByRoles(db: Db, roles: readonly UserRole[]): Promise<UserRow[]> {
    if (roles.length === 0) return [];
    const placeholders = roles.map(() => '?').join(', ');
    return selectRows<UserRow>(
      db,
      `SELECT ${SELECT_COLUMNS} FROM users
        WHERE deleted_at IS NULL AND status = 'ACTIVE' AND role IN (${placeholders})`,
      roles,
    );
  }

  /**
   * Resolves a login identifier against username, phone or email in one pass, so the
   * client does not have to declare which kind it typed.
   */
  async findByIdentifier(db: Db, identifier: string) {
    return selectOne<UserRow>(
      db,
      `SELECT ${SELECT_COLUMNS} FROM users
        WHERE deleted_at IS NULL AND (username = ? OR phone = ? OR email = ?)
        LIMIT 1`,
      [identifier, identifier, identifier],
    );
  }

  async findByUsername(db: Db, username: string) {
    return selectOne<UserRow>(
      db,
      `SELECT ${SELECT_COLUMNS} FROM users WHERE username = ? AND deleted_at IS NULL`,
      [username],
    );
  }

  async list(db: Db, filter: UserListFilter): Promise<{ rows: UserRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.includeDeleted !== true) conditions.push('deleted_at IS NULL');
    if (filter.role) {
      conditions.push('role = ?');
      params.push(filter.role);
    }
    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter.search) {
      conditions.push('(name LIKE ? OR username LIKE ? OR phone LIKE ? OR email LIKE ?)');
      const like = `%${filter.search}%`;
      params.push(like, like, like, like);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    // The validation schema only bounds sortBy's length, so the column name must be
    // whitelisted here — it is the last line of defense against injection via ORDER BY.
    const sortColumn = SORTABLE_COLUMNS[filter.sortBy ?? 'name'] ?? 'name';
    const sortDir = filter.sortDir === 'desc' ? 'DESC' : 'ASC';

    const rows = await selectRows<UserRow>(
      db,
      `SELECT ${SELECT_COLUMNS} FROM users ${where}
        ORDER BY ${sortColumn} ${sortDir}, id ASC
        LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );

    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM users ${where}`,
      params,
    );

    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  async insert(db: Db, input: InsertUserInput): Promise<UserRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();

    await mutate(
      db,
      `INSERT INTO users
        (id, employee_code, name, username, phone, email, password_hash, role, status,
         must_change_password, created_by, created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.employeeCode,
        input.name,
        input.username,
        input.phone,
        input.email,
        input.passwordHash,
        input.role,
        input.status,
        input.mustChangePassword ? 1 : 0,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );

    const row = await this.findById(db, input.id);
    if (row === null) throw new Error(`Inserted user ${input.id} could not be read back`);
    return row;
  }

  async update(db: Db, id: string, input: UpdateUserInput): Promise<UserRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];

    const push = (column: string, value: unknown): void => {
      assignments.push(`${column} = ?`);
      params.push(value);
    };

    if (input.employeeCode !== undefined) push('employee_code', input.employeeCode);
    if (input.name !== undefined) push('name', input.name);
    if (input.phone !== undefined) push('phone', input.phone);
    if (input.email !== undefined) push('email', input.email);
    if (input.role !== undefined) push('role', input.role);
    if (input.status !== undefined) push('status', input.status);
    if (input.passwordHash !== undefined) push('password_hash', input.passwordHash);
    if (input.mustChangePassword !== undefined) {
      push('must_change_password', input.mustChangePassword ? 1 : 0);
    }
    if (input.avatarPath !== undefined) push('avatar_path', input.avatarPath);

    // Nothing to change — return current state instead of emitting invalid SQL.
    if (assignments.length === 0) return this.findById(db, id);

    const syncSeq = await allocateSyncSeq(db);
    assignments.push('updated_at = ?', 'revision = revision + 1', 'sync_seq = ?');
    params.push(toDbDateTime(), syncSeq, id);

    await mutate(
      db,
      `UPDATE users SET ${assignments.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
    return this.findById(db, id);
  }

  /** Soft delete — the tombstone has to replicate to offline devices. */
  async softDelete(db: Db, id: string): Promise<void> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE users
         SET deleted_at = ?, status = 'INACTIVE', updated_at = ?,
             revision = revision + 1, sync_seq = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [now, now, syncSeq, id],
    );
  }

  /**
   * Login bookkeeping. Deliberately does NOT allocate a sync_seq: a login is not a change
   * other devices need, and stamping it would push a pull page for every sign-in.
   */
  async touchLastLogin(db: Db, id: string): Promise<void> {
    await mutate(db, 'UPDATE users SET last_login_at = ? WHERE id = ?', [toDbDateTime(), id]);
  }

  async countByRole(db: Db, role: UserRole): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      "SELECT COUNT(*) AS total FROM users WHERE role = ? AND deleted_at IS NULL AND status = 'ACTIVE'",
      [role],
    );
    return row === null ? 0 : Number(row.total);
  }

  async changedSince(db: Db, cursor: number, limit: number): Promise<UserRow[]> {
    return selectRows<UserRow>(
      db,
      `SELECT ${SELECT_COLUMNS} FROM users WHERE sync_seq > ? ORDER BY sync_seq ASC LIMIT ?`,
      [cursor, limit],
    );
  }
}

export const userRepository = new UserRepository();
