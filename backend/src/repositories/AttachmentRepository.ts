import type { AttachmentKind, AttachmentOwnerType } from '@menuboard/shared';
import { allocateSyncSeq, allocateSyncSeqBlock } from '../db/syncSeq';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { AttachmentRow, CountRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

export interface InsertAttachmentInput {
  id: string;
  ownerType: AttachmentOwnerType;
  /** Null when the owning order or message has not been pushed yet. */
  ownerId: string | null;
  kind: AttachmentKind;
  fileName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  checksum: string | null;
  uploadedBy: string;
}

const COLUMNS = `
  id, owner_type, owner_id, kind, file_name, storage_path, mime_type, size_bytes,
  duration_ms, width, height, checksum, uploaded_by,
  created_at, updated_at, deleted_at, revision, sync_seq`;

export class AttachmentRepository {
  async findById(db: Db, id: string, options: { includeDeleted?: boolean } = {}) {
    const deletedClause = options.includeDeleted === true ? '' : ' AND deleted_at IS NULL';
    return selectOne<AttachmentRow>(
      db,
      `SELECT ${COLUMNS} FROM attachments WHERE id = ?${deletedClause}`,
      [id],
    );
  }

  async findByIds(db: Db, ids: readonly string[]): Promise<AttachmentRow[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    return selectRows<AttachmentRow>(
      db,
      `SELECT ${COLUMNS} FROM attachments WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
      ids,
    );
  }

  async listForOwner(
    db: Db,
    ownerType: AttachmentOwnerType,
    ownerId: string,
  ): Promise<AttachmentRow[]> {
    return selectRows<AttachmentRow>(
      db,
      `SELECT ${COLUMNS} FROM attachments
        WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL
        ORDER BY created_at ASC`,
      [ownerType, ownerId],
    );
  }

  async listForOwners(
    db: Db,
    ownerType: AttachmentOwnerType,
    ownerIds: readonly string[],
  ): Promise<AttachmentRow[]> {
    if (ownerIds.length === 0) return [];
    const placeholders = ownerIds.map(() => '?').join(', ');
    return selectRows<AttachmentRow>(
      db,
      `SELECT ${COLUMNS} FROM attachments
        WHERE owner_type = ? AND owner_id IN (${placeholders}) AND deleted_at IS NULL
        ORDER BY created_at ASC`,
      [ownerType, ...ownerIds],
    );
  }

  async countForOwner(
    db: Db,
    ownerType: AttachmentOwnerType,
    ownerId: string,
  ): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM attachments
        WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL`,
      [ownerType, ownerId],
    );
    return row === null ? 0 : Number(row.total);
  }

  async insert(db: Db, input: InsertAttachmentInput): Promise<AttachmentRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();

    await mutate(
      db,
      `INSERT INTO attachments
        (id, owner_type, owner_id, kind, file_name, storage_path, mime_type, size_bytes,
         duration_ms, width, height, checksum, uploaded_by,
         created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.ownerType,
        input.ownerId,
        input.kind,
        input.fileName,
        input.storagePath,
        input.mimeType,
        input.sizeBytes,
        input.durationMs,
        input.width,
        input.height,
        input.checksum,
        input.uploadedBy,
        now,
        now,
        syncSeq,
      ],
    );

    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted attachment could not be read back');
    return row;
  }

  /**
   * Binds orphan attachments to their owner once that owner exists. Only rows with a NULL
   * owner_id are eligible, so this cannot re-parent someone else's media.
   */
  async bindToOwner(
    db: Db,
    ids: readonly string[],
    ownerType: AttachmentOwnerType,
    ownerId: string,
    uploadedBy: string,
  ): Promise<number> {
    if (ids.length === 0) return 0;

    const firstSeq = await allocateSyncSeqBlock(db, ids.length);
    const now = toDbDateTime();
    let bound = 0;

    for (const [index, id] of ids.entries()) {
      const result = await mutate(
        db,
        `UPDATE attachments
            SET owner_type = ?, owner_id = ?, updated_at = ?,
                revision = revision + 1, sync_seq = ?
          WHERE id = ?
            AND uploaded_by = ?
            AND deleted_at IS NULL
            AND (owner_id IS NULL OR (owner_type = ? AND owner_id = ?))`,
        [ownerType, ownerId, now, firstSeq + index, id, uploadedBy, ownerType, ownerId],
      );
      bound += result.affectedRows;
    }
    return bound;
  }

  /** Tombstone only. The file on disk is reclaimed by the orphan sweep, never inline. */
  async softDelete(db: Db, id: string): Promise<void> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE attachments SET deleted_at = ?, updated_at = ?, revision = revision + 1, sync_seq = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, syncSeq, id],
    );
  }

  /**
   * Unbound uploads older than `olderThan` — a device that captured media and never
   * completed the order. Returned so the caller can delete the files and the rows.
   */
  async findOrphans(db: Db, olderThan: Date, limit: number): Promise<AttachmentRow[]> {
    return selectRows<AttachmentRow>(
      db,
      `SELECT ${COLUMNS} FROM attachments
        WHERE owner_id IS NULL AND created_at < ? AND deleted_at IS NULL
        ORDER BY created_at ASC LIMIT ?`,
      [toDbDateTime(olderThan), limit],
    );
  }

  async hardDelete(db: Db, id: string): Promise<void> {
    await mutate(db, 'DELETE FROM attachments WHERE id = ?', [id]);
  }

  async changedSince(
    db: Db,
    cursor: number,
    limit: number,
    boardIds: readonly string[],
    userId: string,
  ): Promise<AttachmentRow[]> {
    const placeholders = boardIds.length > 0 ? boardIds.map(() => '?').join(', ') : 'NULL';
    // Three visibility paths: attached to an order on an accessible board, attached to a
    // message on such a board, or still unbound but uploaded by this user.
    return selectRows<AttachmentRow>(
      db,
      `SELECT a.id, a.owner_type, a.owner_id, a.kind, a.file_name, a.storage_path, a.mime_type,
              a.size_bytes, a.duration_ms, a.width, a.height, a.checksum, a.uploaded_by,
              a.created_at, a.updated_at, a.deleted_at, a.revision, a.sync_seq
         FROM attachments a
        WHERE a.sync_seq > ?
          AND (
            (a.owner_type = 'ORDER' AND a.owner_id IN (
                SELECT id FROM orders WHERE board_id IN (${placeholders})))
            OR (a.owner_type = 'THREAD_MESSAGE' AND a.owner_id IN (
                SELECT tm.id FROM thread_messages tm
                 WHERE tm.board_id IN (${placeholders})))
            OR (a.owner_id IS NULL AND a.uploaded_by = ?)
          )
        ORDER BY a.sync_seq ASC LIMIT ?`,
      [cursor, ...boardIds, ...boardIds, userId, limit],
    );
  }
}

export const attachmentRepository = new AttachmentRepository();
