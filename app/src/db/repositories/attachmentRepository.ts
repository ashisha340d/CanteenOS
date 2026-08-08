import type { AttachmentDto, AttachmentKind, AttachmentOwnerType } from '@menuboard/shared';
import { SyncOp } from '@menuboard/shared';
import type * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import { getDb } from '../client';
import type { AttachmentRow } from '../models';
import { attachmentsApi } from '../../api/attachments';
import { newId } from '../../utils/uuid';
import { nowIso } from '../../utils/date';
import { syncQueueRepository } from './syncQueueRepository';

const ATTACHMENT_CACHE_DIR = `${FileSystem.cacheDirectory}menuboard/attachments/`;

function toDto(row: AttachmentRow): AttachmentDto {
  return {
    id: row.id,
    ownerType: row.owner_type as AttachmentOwnerType,
    ownerId: row.owner_id,
    kind: row.kind as AttachmentKind,
    fileName: row.file_name,
    storagePath: row.storage_path ?? '',
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    durationMs: row.duration_ms,
    width: row.width,
    height: row.height,
    checksum: row.checksum,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    syncSeq: row.server_sync_seq,
    revision: row.revision,
  };
}

function runInTx(
  db: SQLite.SQLiteDatabase,
  tx: SQLite.SQLiteDatabase | undefined,
  work: () => Promise<void>,
): Promise<void> {
  return tx ? work() : db.withTransactionAsync(work);
}

export interface LocalAttachmentInput {
  ownerType: AttachmentOwnerType;
  ownerId: string | null;
  kind: AttachmentKind;
  fileName: string;
  localPath: string;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  uploadedBy: string;
}

export const attachmentRepository = {
  async upsertMany(
    rows: AttachmentDto[],
    localPathById?: Map<string, string>,
    tx?: SQLite.SQLiteDatabase,
  ): Promise<void> {
    if (rows.length === 0) return;
    const db = tx ?? (await getDb());
    await runInTx(db, tx, async () => {
      for (const a of rows) {
        await db.runAsync(
          `INSERT INTO attachments (id, owner_type, owner_id, kind, file_name, storage_path,
             local_path, mime_type, size_bytes, duration_ms, width, height, checksum,
             uploaded_by, upload_state, upload_attempts, cached_at, created_at, updated_at,
             deleted_at, revision, server_sync_seq, sync_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UPLOADED', 0, NULL, ?, ?, ?, ?, ?, 'SYNCED')
           ON CONFLICT(id) DO UPDATE SET
             storage_path = excluded.storage_path, updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at, revision = excluded.revision,
             server_sync_seq = excluded.server_sync_seq, sync_state = 'SYNCED'`,
          [
            a.id, a.ownerType, a.ownerId, a.kind, a.fileName, a.storagePath,
            localPathById?.get(a.id) ?? null, a.mimeType, a.sizeBytes, a.durationMs, a.width,
            a.height, a.checksum, a.uploadedBy, a.createdAt, a.updatedAt, a.deletedAt,
            a.revision, a.syncSeq,
          ],
        );
      }
    });
  },

  async listForOwner(ownerType: AttachmentOwnerType, ownerId: string): Promise<AttachmentDto[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<AttachmentRow>(
      `SELECT * FROM attachments WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [ownerType, ownerId],
    );
    return rows.map(toDto);
  },

  /** Attachments for many owners at once, grouped by owner id — one query for a feed. */
  async listForOwners(
    ownerType: AttachmentOwnerType,
    ownerIds: readonly string[],
  ): Promise<Map<string, AttachmentDto[]>> {
    const map = new Map<string, AttachmentDto[]>();
    if (ownerIds.length === 0) return map;
    const db = await getDb();
    const placeholders = ownerIds.map(() => '?').join(',');
    const rows = await db.getAllAsync<AttachmentRow>(
      `SELECT * FROM attachments WHERE owner_type = ? AND owner_id IN (${placeholders})
       AND deleted_at IS NULL ORDER BY created_at ASC`,
      [ownerType, ...ownerIds],
    );
    for (const row of rows) {
      // `owner_id` is nullable — a photo captured before its message exists is bound later.
      // Those rows cannot belong to any owner in the requested set, so they are skipped.
      if (row.owner_id === null) continue;
      const list = map.get(row.owner_id) ?? [];
      list.push(toDto(row));
      map.set(row.owner_id, list);
    }
    return map;
  },

  /** Captured on-device (photo/voice note) before upload. Local-first: PENDING upload state. */
  async captureLocal(input: LocalAttachmentInput): Promise<AttachmentDto> {
    const now = nowIso();
    const attachment: AttachmentDto = {
      id: newId(),
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      kind: input.kind,
      fileName: input.fileName,
      storagePath: '',
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      durationMs: input.durationMs ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      checksum: null,
      uploadedBy: input.uploadedBy,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      syncSeq: 0,
      revision: 1,
    };
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO attachments (id, owner_type, owner_id, kind, file_name, storage_path,
         local_path, mime_type, size_bytes, duration_ms, width, height, checksum, uploaded_by,
         upload_state, upload_attempts, cached_at, created_at, updated_at, deleted_at,
         revision, server_sync_seq, sync_state)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, 'PENDING', 0, NULL, ?, ?, NULL, 1, 0, 'PENDING')`,
      [
        attachment.id, attachment.ownerType, attachment.ownerId, attachment.kind,
        attachment.fileName, input.localPath, attachment.mimeType, attachment.sizeBytes,
        attachment.durationMs, attachment.width, attachment.height, attachment.uploadedBy,
        attachment.createdAt, attachment.updatedAt,
      ],
    );
    // Attachment upload itself is Phase 5/6 territory (multipart upload + bind); the local
    // outbox entry lets Phase 5's uploader find this row deterministically.
    await syncQueueRepository.enqueue({
      entity: 'attachments',
      entityId: attachment.id,
      op: SyncOp.UPSERT,
      payload: {
        id: attachment.id, ownerType: attachment.ownerType, ownerId: attachment.ownerId,
        kind: attachment.kind, localPath: input.localPath
      },
    });
    return attachment;
  },

  /** Rebinds a captured-but-unowned attachment (e.g. picked before the order existed). */
  async bindOwner(id: string, ownerType: AttachmentOwnerType, ownerId: string): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `UPDATE attachments SET owner_type = ?, owner_id = ?, updated_at = ? WHERE id = ?`,
      [ownerType, ownerId, nowIso(), id],
    );
    await syncQueueRepository.enqueue({
      entity: 'attachments',
      entityId: id,
      op: SyncOp.UPSERT,
      payload: { id, ownerType, ownerId, bind: true },
    });
  },

  async localPathsForIds(ids: readonly string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (ids.length === 0) return map;
    const db = await getDb();
    const placeholders = ids.map(() => '?').join(',');
    const rows = await db.getAllAsync<{ id: string; local_path: string | null }>(
      `SELECT id, local_path FROM attachments WHERE id IN (${placeholders}) AND local_path IS NOT NULL`,
      [...ids],
    );
    for (const row of rows) {
      if (row.local_path) map.set(row.id, row.local_path);
    }
    return map;
  },

  async localPathFor(id: string): Promise<string | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ local_path: string | null }>(
      'SELECT local_path FROM attachments WHERE id = ?',
      [id],
    );
    return row?.local_path ?? null;
  },

  /** Batch summary for order cards: returns {imageCount, voiceCount} per ownerId. */
  async countByOwnerIds(
    ownerType: AttachmentOwnerType,
    ownerIds: readonly string[],
  ): Promise<Map<string, { imageCount: number; voiceCount: number }>> {
    const map = new Map<string, { imageCount: number; voiceCount: number }>();
    if (ownerIds.length === 0) return map;
    const db = await getDb();
    const placeholders = ownerIds.map(() => '?').join(',');
    const rows = await db.getAllAsync<{ owner_id: string; kind: string; c: number }>(
      `SELECT owner_id, kind, COUNT(*) as c FROM attachments
       WHERE owner_type = ? AND owner_id IN (${placeholders}) AND deleted_at IS NULL
       GROUP BY owner_id, kind`,
      [ownerType, ...ownerIds],
    );
    for (const row of rows) {
      const existing = map.get(row.owner_id) ?? { imageCount: 0, voiceCount: 0 };
      if (row.kind === 'IMAGE') existing.imageCount = row.c;
      if (row.kind === 'VOICE_NOTE') existing.voiceCount = row.c;
      map.set(row.owner_id, existing);
    }
    return map;
  },

  /**
   * Returns a locally-usable URI for an attachment, lazily downloading and caching remote
   * files by checksum. The cached file path is written back to `local_path` so repeat views
   * are instant and offline. Returns `null` when no local or downloadable source exists.
   */
  async resolveLocalPath(attachment: AttachmentDto): Promise<string | null> {
    const existingLocal = await this.localPathFor(attachment.id);
    if (existingLocal) {
      const info = await FileSystem.getInfoAsync(existingLocal);
      if (info.exists) return existingLocal;
    }

    if (!attachment.storagePath || !attachment.checksum) return null;

    const cacheFile = `${ATTACHMENT_CACHE_DIR}${attachment.checksum}`;
    const cached = await FileSystem.getInfoAsync(cacheFile);
    if (cached.exists) {
      await this.associateCachedPath(attachment.id, cacheFile);
      return cacheFile;
    }

    try {
      const url = await attachmentsApi.getSignedUrl(attachment.id);
      await FileSystem.makeDirectoryAsync(ATTACHMENT_CACHE_DIR, { intermediates: true });
      await FileSystem.downloadAsync(url, cacheFile);
      await this.associateCachedPath(attachment.id, cacheFile);
      return cacheFile;
    } catch (error) {
      console.warn('Failed to download attachment', attachment.id, error);
      return null;
    }
  },

  async associateCachedPath(id: string, localPath: string): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      'UPDATE attachments SET local_path = ?, cached_at = ? WHERE id = ?',
      [localPath, nowIso(), id],
    );
  },
};
