-- MenuBoard 011 — YouTube Recipe Downloader staging table
--
-- One row per YouTube URL a user asked to import. The row is created immediately (QUEUED)
-- and the background processor advances status/progress as it downloads, transcribes and
-- analyses the video. The extracted structured recipe is stored as JSON on the row — it is
-- staging data, NOT the Recipe Master; only an explicit "Save to Recipe Master" during
-- review creates a real `recipes` row, at which point `recipe_id` links the two.
--
-- No `revision`/`sync_seq`: this table is Admin-Portal-only staging data and never syncs to
-- the Android app. Soft delete (`deleted_at`) matches the rest of the schema.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS youtube_recipe_imports (
  id                    CHAR(36)      NOT NULL,
  youtube_url           VARCHAR(500)  NOT NULL,
  youtube_video_id      VARCHAR(20)   NOT NULL,
  video_title           VARCHAR(300)  NULL,
  channel_name          VARCHAR(200)  NULL,
  duration_sec          INT UNSIGNED  NULL,
  thumbnail_url         VARCHAR(500)  NULL,
  status                ENUM('QUEUED','DOWNLOADING','TRANSCRIBING','OCR','ANALYZING','READY','FAILED','SAVED')
                        NOT NULL DEFAULT 'QUEUED',
  progress_percent      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  status_message        VARCHAR(300)  NULL,
  transcript            MEDIUMTEXT    NULL,
  ocr_text              MEDIUMTEXT    NULL,
  extracted_recipe_json MEDIUMTEXT    NULL,
  error_message         VARCHAR(1000) NULL,
  recipe_id             CHAR(36)      NULL,
  created_by            CHAR(36)      NULL,
  created_at            DATETIME(3)   NOT NULL,
  updated_at            DATETIME(3)   NOT NULL,
  deleted_at            DATETIME(3)   NULL,
  completed_at          DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY ix_youtube_imports_status (status),
  KEY ix_youtube_imports_created (created_at),
  CONSTRAINT fk_youtube_imports_recipe FOREIGN KEY (recipe_id) REFERENCES recipes (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_youtube_imports_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
