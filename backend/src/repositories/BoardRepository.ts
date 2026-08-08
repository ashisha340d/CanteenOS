import type { BoardRole, BoardStatus, MemberStatus } from '@menuboard/shared';
import { allocateSyncSeq } from '../db/syncSeq';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { BoardMemberRow, BoardRow, CountRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

export interface BoardListFilter {
  search?: string;
  status?: BoardStatus;
  /** When set, restricts to boards belonging to this station. */
  stationId?: string;
  /** When set, restricts to boards this user is an ACTIVE member of. */
  memberUserId?: string;
  limit: number;
  offset: number;
  sortBy?: 'name' | 'status' | 'created_at';
  sortDir?: 'asc' | 'desc';
}

const SORTABLE_COLUMNS: Record<string, string> = {
  name: 'b.name',
  status: 'b.status',
  created_at: 'b.created_at',
};

const BOARD_COLUMNS = `
  id, station_id, name, description, color, photo_path, status, created_by,
  created_at, updated_at, deleted_at, revision, sync_seq`;

const MEMBER_COLUMNS = `
  bm.id, bm.board_id, bm.user_id, bm.board_role, bm.status, bm.joined_at, bm.invited_by,
  bm.created_at, bm.updated_at, bm.deleted_at, bm.revision, bm.sync_seq`;

export class BoardRepository {
  async findById(db: Db, id: string, options: { includeDeleted?: boolean } = {}) {
    const deletedClause = options.includeDeleted === true ? '' : ' AND deleted_at IS NULL';
    return selectOne<BoardRow>(
      db,
      `SELECT ${BOARD_COLUMNS} FROM boards WHERE id = ?${deletedClause}`,
      [id],
    );
  }

  async list(db: Db, filter: BoardListFilter): Promise<{ rows: BoardRow[]; total: number }> {
    const conditions = ['b.deleted_at IS NULL'];
    const params: unknown[] = [];
    let join = '';

    if (filter.memberUserId !== undefined) {
      join = `INNER JOIN board_members bm
                ON bm.board_id = b.id AND bm.user_id = ? AND bm.status = 'ACTIVE'
                   AND bm.deleted_at IS NULL`;
      params.push(filter.memberUserId);
    }
    if (filter.stationId !== undefined) {
      conditions.push('b.station_id = ?');
      params.push(filter.stationId);
    }
    if (filter.status) {
      conditions.push('b.status = ?');
      params.push(filter.status);
    }
    if (filter.search) {
      conditions.push('(b.name LIKE ? OR b.description LIKE ?)');
      const like = `%${filter.search}%`;
      params.push(like, like);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    // The validation schema only bounds sortBy's length, so the column name must be
    // whitelisted here — it is the last line of defense against injection via ORDER BY.
    const sortColumn = SORTABLE_COLUMNS[filter.sortBy ?? 'name'] ?? 'b.name';
    const sortDir = filter.sortDir === 'desc' ? 'DESC' : 'ASC';

    const rows = await selectRows<BoardRow>(
      db,
      `SELECT b.id, b.station_id, b.name, b.description, b.color, b.photo_path, b.status,
              b.created_by, b.created_at, b.updated_at, b.deleted_at, b.revision, b.sync_seq,
              s.name AS station_name
         FROM boards b ${join}
         LEFT JOIN stations s ON s.id = b.station_id
        ${where}
        ORDER BY ${sortColumn} ${sortDir}, b.id ASC
        LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );

    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(DISTINCT b.id) AS total FROM boards b ${join} ${where}`,
      params,
    );

    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  async insert(
    db: Db,
    input: {
      id: string;
      stationId: string;
      name: string;
      description: string | null;
      color: string | null;
      photoPath: string | null;
      status: BoardStatus;
      createdBy: string;
    },
  ): Promise<BoardRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();

    await mutate(
      db,
      `INSERT INTO boards
        (id, station_id, name, description, color, photo_path, status, created_by,
         created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.stationId,
        input.name,
        input.description,
        input.color,
        input.photoPath,
        input.status,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );

    const row = await this.findById(db, input.id);
    if (row === null) throw new Error(`Inserted board ${input.id} could not be read back`);
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: {
      stationId?: string;
      name?: string;
      description?: string | null;
      color?: string | null;
      photoPath?: string | null;
      status?: BoardStatus;
    },
  ): Promise<BoardRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];

    if (input.stationId !== undefined) {
      assignments.push('station_id = ?');
      params.push(input.stationId);
    }
    if (input.name !== undefined) {
      assignments.push('name = ?');
      params.push(input.name);
    }
    if (input.description !== undefined) {
      assignments.push('description = ?');
      params.push(input.description);
    }
    if (input.color !== undefined) {
      assignments.push('color = ?');
      params.push(input.color);
    }
    if (input.photoPath !== undefined) {
      assignments.push('photo_path = ?');
      params.push(input.photoPath);
    }
    if (input.status !== undefined) {
      assignments.push('status = ?');
      params.push(input.status);
    }
    if (assignments.length === 0) return this.findById(db, id);

    const syncSeq = await allocateSyncSeq(db);
    assignments.push('updated_at = ?', 'revision = revision + 1', 'sync_seq = ?');
    params.push(toDbDateTime(), syncSeq, id);

    await mutate(
      db,
      `UPDATE boards SET ${assignments.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<void> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE boards SET deleted_at = ?, status = 'ARCHIVED', updated_at = ?,
              revision = revision + 1, sync_seq = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, syncSeq, id],
    );
  }

  async changedSince(db: Db, cursor: number, limit: number, forUserId: string | null) {
    // A device only receives boards it can see; an unscoped pull would leak board names.
    if (forUserId === null) {
      return selectRows<BoardRow>(
        db,
        `SELECT ${BOARD_COLUMNS} FROM boards WHERE sync_seq > ? ORDER BY sync_seq ASC LIMIT ?`,
        [cursor, limit],
      );
    }
    return selectRows<BoardRow>(
      db,
      `SELECT b.id, b.station_id, b.name, b.description, b.color, b.photo_path, b.status,
              b.created_by, b.created_at, b.updated_at, b.deleted_at, b.revision, b.sync_seq
         FROM boards b
        INNER JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = ?
        WHERE b.sync_seq > ?
        ORDER BY b.sync_seq ASC
        LIMIT ?`,
      [forUserId, cursor, limit],
    );
  }

  /* ------------------------------------------------------------------ members */

  async findMember(db: Db, boardId: string, userId: string): Promise<BoardMemberRow | null> {
    return selectOne<BoardMemberRow>(
      db,
      `SELECT ${MEMBER_COLUMNS} FROM board_members bm WHERE bm.board_id = ? AND bm.user_id = ?`,
      [boardId, userId],
    );
  }

  /**
   * Effective board role, or null when the caller is not an active member. This is the
   * single query the authorisation guard depends on.
   */
  async findActiveRole(db: Db, boardId: string, userId: string): Promise<BoardRole | null> {
    const row = await selectOne<BoardMemberRow>(
      db,
      `SELECT ${MEMBER_COLUMNS} FROM board_members bm
        WHERE bm.board_id = ? AND bm.user_id = ? AND bm.status = 'ACTIVE' AND bm.deleted_at IS NULL`,
      [boardId, userId],
    );
    return row === null ? null : row.board_role;
  }

  async listMembers(
    db: Db,
    boardId: string,
    options: { includeRemoved?: boolean } = {},
  ): Promise<BoardMemberRow[]> {
    const statusClause = options.includeRemoved === true ? '' : " AND bm.status = 'ACTIVE'";
    return selectRows<BoardMemberRow>(
      db,
      `SELECT ${MEMBER_COLUMNS}, u.name AS user_name, u.avatar_path AS user_avatar_path
         FROM board_members bm
        INNER JOIN users u ON u.id = bm.user_id
        WHERE bm.board_id = ? AND bm.deleted_at IS NULL${statusClause}
        ORDER BY FIELD(bm.board_role, 'OWNER','MANAGER','MEMBER','VIEWER'), u.name ASC`,
      [boardId],
    );
  }

  async listMembersForBoards(db: Db, boardIds: readonly string[]): Promise<BoardMemberRow[]> {
    if (boardIds.length === 0) return [];
    const placeholders = boardIds.map(() => '?').join(', ');
    return selectRows<BoardMemberRow>(
      db,
      `SELECT ${MEMBER_COLUMNS}, u.name AS user_name, u.avatar_path AS user_avatar_path
         FROM board_members bm
        INNER JOIN users u ON u.id = bm.user_id
        WHERE bm.board_id IN (${placeholders}) AND bm.deleted_at IS NULL AND bm.status = 'ACTIVE'
        ORDER BY u.name ASC`,
      boardIds,
    );
  }

  /** Board roles the user currently holds, across every board they are an active member of. */
  async listActiveRolesForUser(db: Db, userId: string): Promise<BoardRole[]> {
    const rows = await selectRows<BoardMemberRow>(
      db,
      `SELECT ${MEMBER_COLUMNS} FROM board_members bm
        WHERE bm.user_id = ? AND bm.status = 'ACTIVE' AND bm.deleted_at IS NULL`,
      [userId],
    );
    return rows.map((row) => row.board_role);
  }

  async listBoardIdsForUser(db: Db, userId: string): Promise<string[]> {
    const rows = await selectRows<BoardMemberRow>(
      db,
      `SELECT ${MEMBER_COLUMNS} FROM board_members bm
        WHERE bm.user_id = ? AND bm.status = 'ACTIVE' AND bm.deleted_at IS NULL`,
      [userId],
    );
    return rows.map((row) => row.board_id);
  }

  /**
   * Adds or reactivates a membership. Re-adding a removed member reuses the same row so the
   * UNIQUE (board_id, user_id) key stays satisfied and the id remains stable for clients
   * that already cached it.
   */
  async upsertMember(
    db: Db,
    input: {
      id: string;
      boardId: string;
      userId: string;
      boardRole: BoardRole;
      status: MemberStatus;
      invitedBy: string | null;
    },
  ): Promise<BoardMemberRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    const joinedAt = input.status === 'ACTIVE' ? now : null;

    await mutate(
      db,
      `INSERT INTO board_members
        (id, board_id, user_id, board_role, status, joined_at, invited_by,
         created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE
         board_role = VALUES(board_role),
         status     = VALUES(status),
         joined_at  = COALESCE(board_members.joined_at, VALUES(joined_at)),
         invited_by = VALUES(invited_by),
         deleted_at = NULL,
         updated_at = VALUES(updated_at),
         revision   = board_members.revision + 1,
         sync_seq   = VALUES(sync_seq)`,
      [
        input.id,
        input.boardId,
        input.userId,
        input.boardRole,
        input.status,
        joinedAt,
        input.invitedBy,
        now,
        now,
        syncSeq,
      ],
    );

    const row = await this.findMember(db, input.boardId, input.userId);
    if (row === null) throw new Error('Upserted board member could not be read back');
    return row;
  }

  /** Removal is a status change, not a tombstone — see docs/DATABASE.md. */
  async removeMember(db: Db, boardId: string, userId: string): Promise<void> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE board_members
          SET status = 'REMOVED', updated_at = ?, revision = revision + 1, sync_seq = ?
        WHERE board_id = ? AND user_id = ?`,
      [now, syncSeq, boardId, userId],
    );
  }

  async countOwners(db: Db, boardId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM board_members
        WHERE board_id = ? AND board_role = 'OWNER' AND status = 'ACTIVE' AND deleted_at IS NULL`,
      [boardId],
    );
    return row === null ? 0 : Number(row.total);
  }

  async membersChangedSince(db: Db, cursor: number, limit: number, forUserId: string | null) {
    if (forUserId === null) {
      return selectRows<BoardMemberRow>(
        db,
        `SELECT ${MEMBER_COLUMNS} FROM board_members bm
          WHERE bm.sync_seq > ? ORDER BY bm.sync_seq ASC LIMIT ?`,
        [cursor, limit],
      );
    }
    // Every membership row of every board the user belongs to — the Acknowledgements panel
    // needs the full member list to compute who is still pending.
    return selectRows<BoardMemberRow>(
      db,
      `SELECT ${MEMBER_COLUMNS} FROM board_members bm
        WHERE bm.sync_seq > ?
          AND bm.board_id IN (
            SELECT board_id FROM board_members
             WHERE user_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL
          )
        ORDER BY bm.sync_seq ASC
        LIMIT ?`,
      [cursor, forUserId, limit],
    );
  }
}

export const boardRepository = new BoardRepository();
