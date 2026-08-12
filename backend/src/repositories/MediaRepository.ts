import type { MasterStatus, MediaEntityType, MediaRole, MediaType } from '@menuboard/shared';
import { allocateSyncSeq } from '../db/syncSeq';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { CountRow, MediaAssetRow, MediaAssignmentRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * The Menu Master media library: a reusable asset table plus a polymorphic assignment table,
 * modelled on the `media_library` / `product_images` split already proven at
 * github.com/ashisha340d/mtcstudio (server/database/db.js), adapted to this project's UUID /
 * soft-delete / revision / sync_seq conventions instead of that project's INT auto-increment
 * style.
 */

export interface MediaAssetListFilter {
  search?: string;
  status?: MasterStatus;
  /** Only assets with zero ACTIVE assignments — mirrors mtcstudio's `unassigned=1` filter. */
  unassignedOnly?: boolean;
  limit: number;
  offset: number;
}

const ASSET_COLUMNS = `
  id, file_name, storage_path, mime_type, file_extension, size_bytes, width, height,
  media_type, title, alt_text, checksum, status, created_by,
  created_at, updated_at, deleted_at, revision, sync_seq`;

export class MediaAssetRepository {
  async findById(db: Db, id: string) {
    return selectOne<MediaAssetRow>(
      db,
      `SELECT ${ASSET_COLUMNS} FROM media_assets WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  async list(db: Db, filter: MediaAssetListFilter): Promise<{ rows: MediaAssetRow[]; total: number }> {
    const conditions: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter.search) {
      conditions.push('(file_name LIKE ? OR title LIKE ? OR alt_text LIKE ?)');
      params.push(`%${filter.search}%`, `%${filter.search}%`, `%${filter.search}%`);
    }
    if (filter.unassignedOnly) {
      conditions.push(
        `id NOT IN (SELECT media_id FROM media_assignments WHERE deleted_at IS NULL)`,
      );
    }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const rows = await selectRows<MediaAssetRow>(
      db,
      `SELECT ${ASSET_COLUMNS} FROM media_assets ${where}
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM media_assets ${where}`,
      params,
    );
    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  async insert(
    db: Db,
    input: {
      id: string;
      fileName: string;
      storagePath: string;
      mimeType: string;
      fileExtension: string | null;
      sizeBytes: number;
      width: number | null;
      height: number | null;
      mediaType: MediaType;
      title: string | null;
      altText: string | null;
      checksum: string | null;
      createdBy: string | null;
    },
  ): Promise<MediaAssetRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO media_assets
        (id, file_name, storage_path, mime_type, file_extension, size_bytes, width, height,
         media_type, title, alt_text, checksum, status, created_by, created_at, updated_at,
         revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.fileName,
        input.storagePath,
        input.mimeType,
        input.fileExtension,
        input.sizeBytes,
        input.width,
        input.height,
        input.mediaType,
        input.title,
        input.altText,
        input.checksum,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted media asset could not be read back');
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: Partial<{ title: string | null; altText: string | null; status: MasterStatus }>,
  ): Promise<MediaAssetRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (input.title !== undefined) {
      assignments.push('title = ?');
      params.push(input.title);
    }
    if (input.altText !== undefined) {
      assignments.push('alt_text = ?');
      params.push(input.altText);
    }
    if (input.status !== undefined) {
      assignments.push('status = ?');
      params.push(input.status);
    }
    if (assignments.length === 0) return this.findById(db, id);
    const syncSeq = await allocateSyncSeq(db);
    await mutate(
      db,
      `UPDATE media_assets SET ${assignments.join(', ')}, updated_at = ?, revision = revision + 1, sync_seq = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), syncSeq, id],
    );
    return this.findById(db, id);
  }

  /** Hard-checks whether any other entity still links this asset before a caller deletes it. */
  async countActiveAssignments(db: Db, mediaId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      'SELECT COUNT(*) AS total FROM media_assignments WHERE media_id = ? AND deleted_at IS NULL',
      [mediaId],
    );
    return row === null ? 0 : Number(row.total);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE media_assets SET deleted_at = ?, status = 'INACTIVE', updated_at = ?,
              revision = revision + 1, sync_seq = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, syncSeq, id],
    );
    return result.affectedRows > 0;
  }
}

/* ------------------------------------------------------------------ media assignments */

const ASSIGNMENT_COLUMNS = `
  id, media_id, entity_type, entity_id, role, is_primary, sort_order, status, created_by,
  created_at, updated_at, deleted_at, revision, sync_seq`;

export class MediaAssignmentRepository {
  async findById(db: Db, id: string) {
    return selectOne<MediaAssignmentRow>(
      db,
      `SELECT ${ASSIGNMENT_COLUMNS} FROM media_assignments WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  async listForEntity(db: Db, entityType: MediaEntityType, entityId: string) {
    return selectRows<MediaAssignmentRow>(
      db,
      `SELECT ${ASSIGNMENT_COLUMNS} FROM media_assignments
        WHERE entity_type = ? AND entity_id = ? AND deleted_at IS NULL
        ORDER BY is_primary DESC, sort_order ASC, created_at ASC`,
      [entityType, entityId],
    );
  }

  /** Bulk-loads the primary media asset id for many entities of the same type (menu-tree resolution). */
  async findPrimaryForEntities(
    db: Db,
    entityType: MediaEntityType,
    entityIds: string[],
  ): Promise<Map<string, string>> {
    if (entityIds.length === 0) return new Map();
    const placeholders = entityIds.map(() => '?').join(', ');
    const rows = await selectRows<MediaAssignmentRow & { asset_id: string }>(
      db,
      `SELECT ma.entity_id, m.id AS asset_id FROM media_assignments ma
         JOIN media_assets m ON m.id = ma.media_id
        WHERE ma.entity_type = ? AND ma.entity_id IN (${placeholders})
          AND ma.deleted_at IS NULL AND ma.is_primary = 1 AND ma.status = 'ACTIVE'`,
      [entityType, ...entityIds],
    );
    return new Map(rows.map((row) => [row.entity_id, row.asset_id]));
  }

  async insert(
    db: Db,
    input: {
      id: string;
      mediaId: string;
      entityType: MediaEntityType;
      entityId: string;
      role: MediaRole;
      isPrimary: boolean;
      sortOrder: number;
      createdBy: string | null;
    },
  ): Promise<MediaAssignmentRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO media_assignments
        (id, media_id, entity_type, entity_id, role, is_primary, sort_order, status, created_by,
         created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.mediaId,
        input.entityType,
        input.entityId,
        input.role,
        input.isPrimary ? 1 : 0,
        input.sortOrder,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted media assignment could not be read back');
    return row;
  }

  /** Clears `is_primary` on every other assignment for this entity — at most one primary at a time. */
  async clearPrimaryForEntity(
    db: Db,
    entityType: MediaEntityType,
    entityId: string,
    exceptId?: string,
  ): Promise<void> {
    const syncSeq = await allocateSyncSeq(db);
    await mutate(
      db,
      `UPDATE media_assignments SET is_primary = 0, updated_at = ?, revision = revision + 1, sync_seq = ?
        WHERE entity_type = ? AND entity_id = ? AND deleted_at IS NULL ${exceptId ? 'AND id != ?' : ''}`,
      exceptId
        ? [toDbDateTime(), syncSeq, entityType, entityId, exceptId]
        : [toDbDateTime(), syncSeq, entityType, entityId],
    );
  }

  async setPrimary(db: Db, id: string, isPrimary: boolean): Promise<MediaAssignmentRow | null> {
    const syncSeq = await allocateSyncSeq(db);
    await mutate(
      db,
      `UPDATE media_assignments SET is_primary = ?, updated_at = ?, revision = revision + 1, sync_seq = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [isPrimary ? 1 : 0, toDbDateTime(), syncSeq, id],
    );
    return this.findById(db, id);
  }

  async reorder(db: Db, id: string, sortOrder: number): Promise<void> {
    const syncSeq = await allocateSyncSeq(db);
    await mutate(
      db,
      `UPDATE media_assignments SET sort_order = ?, updated_at = ?, revision = revision + 1, sync_seq = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [sortOrder, toDbDateTime(), syncSeq, id],
    );
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE media_assignments SET deleted_at = ?, status = 'INACTIVE', updated_at = ?,
              revision = revision + 1, sync_seq = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, syncSeq, id],
    );
    return result.affectedRows > 0;
  }
}

export const mediaAssetRepository = new MediaAssetRepository();
export const mediaAssignmentRepository = new MediaAssignmentRepository();
