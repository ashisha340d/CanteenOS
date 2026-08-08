import { ERROR_CODES } from '@menuboard/shared';
import { attachmentsApi } from '../api';
import { ApiError } from '../api/client';
import { getDb } from '../db/client';
import { nowIso } from '../utils/date';
import { backoffDelayMs } from './backoff';

const BATCH_SIZE = 5;

interface PendingAttachmentRow {
  id: string;
  owner_type: string;
  owner_id: string | null;
  kind: string;
  file_name: string;
  local_path: string;
  mime_type: string;
  size_bytes: number;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  upload_attempts: number;
  updated_at: string;
}

/**
 * Uploads captured attachment bytes independently of the entity sync queue.
 * On success the local row keeps its local_path (cache) and records the server storage_path
 * and UPLOADED state so the sync push can bind the attachment to its owner.
 */
export async function runMediaUpload(): Promise<void> {
  const rows = await listUploadableRows();
  if (rows.length === 0) return;

  for (const row of rows.slice(0, BATCH_SIZE)) {
    const attempts = row.upload_attempts + 1;
    try {
      const result = await attachmentsApi.upload({
        fileUri: row.local_path,
        fileName: row.file_name,
        mimeType: row.mime_type,
        attachmentId: row.id,
        ownerType: row.owner_type as 'ORDER' | 'THREAD_MESSAGE',
        ownerId: row.owner_id,
        durationMs: row.duration_ms,
        width: row.width,
        height: row.height,
      });

      const db = await getDb();
      await db.runAsync(
        `UPDATE attachments
         SET upload_state = 'UPLOADED', upload_attempts = 0, storage_path = ?,
             updated_at = ?, sync_state = 'PENDING'
         WHERE id = ?`,
        [result.attachment.storagePath, nowIso(), row.id],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      const delayMs = backoffDelayMs(attempts);
      const nextAttemptAt = new Date(Date.now() + delayMs).toISOString();

      const db = await getDb();
      await db.runAsync(
        `UPDATE attachments
         SET upload_state = 'FAILED', upload_attempts = ?, updated_at = ?
         WHERE id = ?`,
        [attempts, nextAttemptAt, row.id],
      );

      // Terminal media errors (unsupported type, too large) should not be retried forever.
      const terminalCode =
        error instanceof ApiError &&
        (error.code === ERROR_CODES.UNSUPPORTED_MEDIA_TYPE || error.code === ERROR_CODES.PAYLOAD_TOO_LARGE);
      if (terminalCode || attempts >= 10) {
        await db.runAsync(
          `UPDATE attachments SET upload_state = 'FAILED', sync_state = 'FAILED', sync_error = ?
           WHERE id = ?`,
          [message, row.id],
        );
      }
    }
  }
}

async function listUploadableRows(): Promise<PendingAttachmentRow[]> {
  const db = await getDb();
  const candidates = await db.getAllAsync<PendingAttachmentRow>(
    `SELECT id, owner_type, owner_id, kind, file_name, local_path, mime_type, size_bytes,
            duration_ms, width, height, upload_attempts, updated_at
     FROM attachments
     WHERE local_path IS NOT NULL
       AND upload_state IN ('PENDING', 'FAILED')
     ORDER BY created_at ASC`,
  );

  const now = Date.now();
  return candidates
    .filter((row) => {
      if (row.upload_attempts === 0) return true;
      return now >= Date.parse(row.updated_at);
    })
    .slice(0, BATCH_SIZE);
}
