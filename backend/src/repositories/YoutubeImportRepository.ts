import { YoutubeImportStatus, YOUTUBE_IMPORT_ACTIVE_STATUSES } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { YoutubeImportRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

const COLUMNS = `
  id, youtube_url, youtube_video_id, video_title, channel_name, duration_sec, thumbnail_url,
  status, progress_percent, status_message, transcript, ocr_text, extracted_recipe_json,
  error_message, recipe_id, created_by, created_at, updated_at, deleted_at, completed_at`;

export interface InsertYoutubeImportInput {
  id: string;
  youtubeUrl: string;
  youtubeVideoId: string;
  createdBy: string | null;
}

/**
 * The YouTube Recipe Downloader's staging table. Rows are written by the API (create,
 * retry, mark saved, delete) and by the background processor (metadata, progress, results,
 * errors) — everything goes through here so the two never disagree on column handling.
 */
export class YoutubeImportRepository {
  async insert(db: Db, input: InsertYoutubeImportInput): Promise<YoutubeImportRow> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO youtube_recipe_imports
        (id, youtube_url, youtube_video_id, status, progress_percent, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'QUEUED', 0, ?, ?, ?)`,
      [input.id, input.youtubeUrl, input.youtubeVideoId, input.createdBy, now, now],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted YouTube import could not be read back');
    return row;
  }

  async findById(db: Db, id: string): Promise<YoutubeImportRow | null> {
    return selectOne<YoutubeImportRow>(
      db,
      `SELECT ${COLUMNS} FROM youtube_recipe_imports WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  async list(db: Db, filter: { status?: YoutubeImportStatus } = {}): Promise<YoutubeImportRow[]> {
    const conditions = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    if (filter.status !== undefined) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    return selectRows<YoutubeImportRow>(
      db,
      `SELECT ${COLUMNS} FROM youtube_recipe_imports
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC`,
      params,
    );
  }

  /** The oldest queued row — what the background processor picks up next. */
  async findNextQueued(db: Db): Promise<YoutubeImportRow | null> {
    return selectOne<YoutubeImportRow>(
      db,
      `SELECT ${COLUMNS} FROM youtube_recipe_imports
        WHERE status = 'QUEUED' AND deleted_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1`,
    );
  }

  async updateProgress(
    db: Db,
    id: string,
    status: YoutubeImportStatus,
    progressPercent: number,
    statusMessage: string | null,
  ): Promise<void> {
    await mutate(
      db,
      `UPDATE youtube_recipe_imports
          SET status = ?, progress_percent = ?, status_message = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [status, progressPercent, statusMessage, toDbDateTime(), id],
    );
  }

  async setVideoMetadata(
    db: Db,
    id: string,
    meta: {
      videoTitle: string | null;
      channelName: string | null;
      durationSec: number | null;
      thumbnailUrl: string | null;
    },
  ): Promise<void> {
    await mutate(
      db,
      `UPDATE youtube_recipe_imports
          SET video_title = ?, channel_name = ?, duration_sec = ?, thumbnail_url = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [meta.videoTitle, meta.channelName, meta.durationSec, meta.thumbnailUrl, toDbDateTime(), id],
    );
  }

  async setTranscript(db: Db, id: string, transcript: string | null): Promise<void> {
    await mutate(
      db,
      `UPDATE youtube_recipe_imports SET transcript = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [transcript, toDbDateTime(), id],
    );
  }

  async setOcrText(db: Db, id: string, ocrText: string | null): Promise<void> {
    await mutate(
      db,
      `UPDATE youtube_recipe_imports SET ocr_text = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [ocrText, toDbDateTime(), id],
    );
  }

  async setReady(db: Db, id: string, extractedRecipeJson: string): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE youtube_recipe_imports
          SET status = 'READY', progress_percent = 100, status_message = 'Ready for review',
              extracted_recipe_json = ?, error_message = NULL, completed_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [extractedRecipeJson, now, now, id],
    );
  }

  async setFailed(db: Db, id: string, errorMessage: string): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE youtube_recipe_imports
          SET status = 'FAILED', status_message = 'Processing failed', error_message = ?,
              completed_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [errorMessage.slice(0, 1000), now, now, id],
    );
  }

  /** Reset a FAILED row for another attempt. Keeps metadata; clears results and the error. */
  async resetForRetry(db: Db, id: string): Promise<void> {
    await mutate(
      db,
      `UPDATE youtube_recipe_imports
          SET status = 'QUEUED', progress_percent = 0, status_message = NULL, error_message = NULL,
              transcript = NULL, ocr_text = NULL, extracted_recipe_json = NULL,
              completed_at = NULL, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [toDbDateTime(), id],
    );
  }

  async markSaved(db: Db, id: string, recipeId: string): Promise<void> {
    await mutate(
      db,
      `UPDATE youtube_recipe_imports
          SET status = 'SAVED', status_message = 'Saved to Recipe Master', recipe_id = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [recipeId, toDbDateTime(), id],
    );
  }

  async softDelete(db: Db, id: string): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE youtube_recipe_imports SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
  }

  /**
   * Rows a previous server process left mid-flight (it crashed or was restarted while
   * processing). Called once on boot: they go back to QUEUED so the worker retries them
   * rather than leaving them stuck at, say, "ANALYZING 70%" forever.
   */
  async requeueInterrupted(db: Db): Promise<number> {
    const inFlight = YOUTUBE_IMPORT_ACTIVE_STATUSES.filter(
      (status) => status !== YoutubeImportStatus.QUEUED,
    );
    const placeholders = inFlight.map(() => '?').join(', ');
    const result = await mutate(
      db,
      `UPDATE youtube_recipe_imports
          SET status = 'QUEUED', progress_percent = 0,
              status_message = 'Re-queued after a server restart', updated_at = ?
        WHERE status IN (${placeholders}) AND deleted_at IS NULL`,
      [toDbDateTime(), ...inFlight],
    );
    return result.affectedRows;
  }
}

export const youtubeImportRepository = new YoutubeImportRepository();
