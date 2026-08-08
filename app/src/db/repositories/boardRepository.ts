import type { BoardDto, BoardMemberDto, BoardRole, BoardStatus, MemberStatus } from '@menuboard/shared';
import { SyncState } from '@menuboard/shared';
import type * as SQLite from 'expo-sqlite';
import { getDb } from '../client';
import type { BoardMemberRow, BoardRow } from '../models';

function toBoardDto(row: BoardRow): BoardDto {
  return {
    id: row.id,
    stationId: row.station_id,
    name: row.name,
    description: row.description,
    color: row.color,
    photoPath: row.photo_path,
    status: row.status as BoardStatus,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    syncSeq: row.server_sync_seq,
    revision: row.revision,
  };
}

function toMemberDto(row: BoardMemberRow, userName?: string): BoardMemberDto {
  return {
    id: row.id,
    boardId: row.board_id,
    userId: row.user_id,
    boardRole: row.board_role as BoardRole,
    status: row.status as MemberStatus,
    joinedAt: row.joined_at,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    syncSeq: row.server_sync_seq,
    revision: row.revision,
    userName,
  };
}

export const boardRepository = {
  async upsertMany(boards: BoardDto[], tx?: SQLite.SQLiteDatabase): Promise<void> {
    if (boards.length === 0) return;
    const db = tx ?? (await getDb());
    const apply = async (): Promise<void> => {
      for (const b of boards) {
        await db.runAsync(
          `INSERT INTO boards (id, station_id, name, description, color, photo_path, status,
             created_by, created_at, updated_at, deleted_at, revision, server_sync_seq,
             sync_state, sync_error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', NULL)
           ON CONFLICT(id) DO UPDATE SET
             station_id = excluded.station_id, name = excluded.name,
             description = excluded.description, color = excluded.color,
             photo_path = excluded.photo_path, status = excluded.status,
             updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
             revision = excluded.revision, server_sync_seq = excluded.server_sync_seq,
             sync_state = 'SYNCED', sync_error = NULL`,
          [
            b.id, b.stationId, b.name, b.description, b.color, b.photoPath, b.status,
            b.createdBy, b.createdAt, b.updatedAt, b.deletedAt, b.revision, b.syncSeq,
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

  async upsertMembers(members: BoardMemberDto[], tx?: SQLite.SQLiteDatabase): Promise<void> {
    if (members.length === 0) return;
    const db = tx ?? (await getDb());
    const apply = async (): Promise<void> => {
      for (const m of members) {
        await db.runAsync(
          `INSERT INTO board_members (id, board_id, user_id, board_role, status, joined_at,
             invited_by, created_at, updated_at, deleted_at, revision, server_sync_seq, sync_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED')
           ON CONFLICT(id) DO UPDATE SET
             board_role = excluded.board_role, status = excluded.status,
             joined_at = excluded.joined_at, updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at, revision = excluded.revision,
             server_sync_seq = excluded.server_sync_seq, sync_state = 'SYNCED'`,
          [
            m.id, m.boardId, m.userId, m.boardRole, m.status, m.joinedAt, m.invitedBy,
            m.createdAt, m.updatedAt, m.deletedAt, m.revision, m.syncSeq,
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

  async listForUser(userId: string): Promise<BoardDto[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<BoardRow>(
      `SELECT b.* FROM boards b
       JOIN board_members bm ON bm.board_id = b.id
       WHERE bm.user_id = ? AND bm.status = 'ACTIVE' AND b.deleted_at IS NULL
       ORDER BY b.name ASC`,
      [userId],
    );
    return rows.map(toBoardDto);
  },

  async findById(id: string): Promise<BoardDto | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<BoardRow>(
      'SELECT * FROM boards WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return row ? toBoardDto(row) : null;
  },

  async listMembers(boardId: string): Promise<BoardMemberDto[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<BoardMemberRow & { user_name: string | null }>(
      `SELECT bm.*, u.name AS user_name FROM board_members bm
       LEFT JOIN users u ON u.id = bm.user_id
       WHERE bm.board_id = ? AND bm.status = 'ACTIVE'
       ORDER BY bm.board_role ASC`,
      [boardId],
    );
    return rows.map((r) => toMemberDto(r, r.user_name ?? undefined));
  },

  /**
   * Every active membership, grouped by user — the Manage Users list.
   *
   * One query rather than a `listMembers` per board: the users screen needs the whole matrix
   * at once, and looping boards would reintroduce the N+1 this exists to avoid.
   */
  async membershipsByUser(): Promise<Map<string, { boardId: string; boardName: string; role: string }[]>> {
    const db = await getDb();
    const rows = await db.getAllAsync<{
      user_id: string;
      board_id: string;
      board_role: string;
      board_name: string | null;
    }>(
      `SELECT bm.user_id, bm.board_id, bm.board_role, b.name AS board_name
       FROM board_members bm
       JOIN boards b ON b.id = bm.board_id AND b.deleted_at IS NULL
       WHERE bm.status = 'ACTIVE'
       ORDER BY b.name ASC`,
    );
    const map = new Map<string, { boardId: string; boardName: string; role: string }[]>();
    for (const row of rows) {
      const list = map.get(row.user_id) ?? [];
      list.push({
        boardId: row.board_id,
        boardName: row.board_name ?? 'Unknown board',
        role: row.board_role,
      });
      map.set(row.user_id, list);
    }
    return map;
  },

  async findMembership(boardId: string, userId: string): Promise<BoardMemberDto | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<BoardMemberRow>(
      `SELECT * FROM board_members WHERE board_id = ? AND user_id = ? AND status = 'ACTIVE'`,
      [boardId, userId],
    );
    return row ? toMemberDto(row) : null;
  },

  /** Local-only pending count surfaced on Home; not part of the sync engine. */
  async countPendingSync(): Promise<number> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) as c FROM boards WHERE sync_state = ?`,
      [SyncState.PENDING],
    );
    return row?.c ?? 0;
  },
};
