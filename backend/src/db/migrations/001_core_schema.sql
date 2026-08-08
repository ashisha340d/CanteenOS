-- MenuBoard 001 — core schema
--
-- Conventions applied to every table in this file:
--   * InnoDB / utf8mb4 / utf8mb4_unicode_ci.
--   * id CHAR(36) UUID v4. Primary keys are client-generatable so a fully offline Android
--     device can create complete entities with no server round trip.
--   * created_at / updated_at DATETIME(3) UTC. Applications write these explicitly; no
--     ON UPDATE clauses, so that sync writes stay deterministic.
--   * deleted_at DATETIME(3) NULL — soft delete, because a delete must replicate to
--     offline devices as a tombstone.
--   * revision INT UNSIGNED — bumped on each server-applied update, used for optimistic
--     concurrency (STALE_WRITE).
--   * sync_seq BIGINT UNSIGNED — global monotonic cursor allocated from sync_counter on
--     every insert and update. Delta pull is `WHERE sync_seq > :cursor`.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ---------------------------------------------------------------- infrastructure

-- Migration ledger.
CREATE TABLE IF NOT EXISTS schema_migrations (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(190)  NOT NULL,
  checksum      CHAR(64)      NOT NULL,
  applied_at    DATETIME(3)   NOT NULL,
  duration_ms   INT UNSIGNED  NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_schema_migrations_name (name)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Single-row monotonic allocator backing sync_seq. Incremented with
-- `UPDATE sync_counter SET value = LAST_INSERT_ID(value + 1) WHERE id = 1`, which is
-- atomic, row-locked and portable across MariaDB and MySQL.
CREATE TABLE IF NOT EXISTS sync_counter (
  id     TINYINT UNSIGNED    NOT NULL,
  value  BIGINT UNSIGNED     NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

INSERT INTO sync_counter (id, value) VALUES (1, 0)
  ON DUPLICATE KEY UPDATE id = id;

-- ------------------------------------------------------------------------ users

CREATE TABLE IF NOT EXISTS users (
  id                    CHAR(36)      NOT NULL,
  employee_code         VARCHAR(50)   NULL,
  name                  VARCHAR(150)  NOT NULL,
  username              VARCHAR(100)  NOT NULL,
  phone                 VARCHAR(20)   NULL,
  email                 VARCHAR(190)  NULL,
  password_hash         VARCHAR(255)  NOT NULL,
  role                  ENUM('SUPER_ADMIN','ADMIN','MANAGER','USER') NOT NULL DEFAULT 'USER',
  status                ENUM('ACTIVE','INACTIVE','SUSPENDED')        NOT NULL DEFAULT 'ACTIVE',
  avatar_path           VARCHAR(500)  NULL,
  must_change_password  TINYINT(1)    NOT NULL DEFAULT 0,
  last_login_at         DATETIME(3)   NULL,
  created_by            CHAR(36)      NULL,
  created_at            DATETIME(3)   NOT NULL,
  updated_at            DATETIME(3)   NOT NULL,
  deleted_at            DATETIME(3)   NULL,
  revision              INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq              BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_phone (phone),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_employee_code (employee_code),
  KEY ix_users_sync_seq (sync_seq),
  KEY ix_users_role_status (role, status),
  CONSTRAINT fk_users_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------- boards

CREATE TABLE IF NOT EXISTS boards (
  id           CHAR(36)      NOT NULL,
  name         VARCHAR(120)  NOT NULL,
  description  VARCHAR(1000) NULL,
  status       ENUM('ACTIVE','ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
  created_by   CHAR(36)      NOT NULL,
  created_at   DATETIME(3)   NOT NULL,
  updated_at   DATETIME(3)   NOT NULL,
  deleted_at   DATETIME(3)   NULL,
  revision     INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_boards_sync_seq (sync_seq),
  KEY ix_boards_status (status, deleted_at),
  KEY ix_boards_name (name),
  CONSTRAINT fk_boards_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Membership is never hard-deleted or tombstoned by row removal: re-adding a removed
-- member reactivates the same row, so the UNIQUE key stays stable.
CREATE TABLE IF NOT EXISTS board_members (
  id          CHAR(36)      NOT NULL,
  board_id    CHAR(36)      NOT NULL,
  user_id     CHAR(36)      NOT NULL,
  board_role  ENUM('OWNER','MANAGER','MEMBER','VIEWER') NOT NULL DEFAULT 'MEMBER',
  status      ENUM('ACTIVE','INVITED','REMOVED')        NOT NULL DEFAULT 'ACTIVE',
  joined_at   DATETIME(3)   NULL,
  invited_by  CHAR(36)      NULL,
  created_at  DATETIME(3)   NOT NULL,
  updated_at  DATETIME(3)   NOT NULL,
  deleted_at  DATETIME(3)   NULL,
  revision    INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_board_members_board_user (board_id, user_id),
  KEY ix_board_members_sync_seq (sync_seq),
  KEY ix_board_members_user (user_id, status),
  CONSTRAINT fk_board_members_board FOREIGN KEY (board_id) REFERENCES boards (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_board_members_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_board_members_invited_by FOREIGN KEY (invited_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------------------- masters

CREATE TABLE IF NOT EXISTS activity_types (
  id           CHAR(36)      NOT NULL,
  name         VARCHAR(120)  NOT NULL,
  description  VARCHAR(1000) NULL,
  icon         VARCHAR(60)   NULL,
  status       ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  sort_order   INT           NOT NULL DEFAULT 0,
  is_system    TINYINT(1)    NOT NULL DEFAULT 0,
  created_by   CHAR(36)      NULL,
  created_at   DATETIME(3)   NOT NULL,
  updated_at   DATETIME(3)   NOT NULL,
  deleted_at   DATETIME(3)   NULL,
  revision     INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_activity_types_name (name),
  KEY ix_activity_types_sync_seq (sync_seq),
  KEY ix_activity_types_status (status, sort_order),
  CONSTRAINT fk_activity_types_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS menu_categories (
  id           CHAR(36)      NOT NULL,
  name         VARCHAR(120)  NOT NULL,
  description  VARCHAR(1000) NULL,
  image_path   VARCHAR(500)  NULL,
  status       ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  sort_order   INT           NOT NULL DEFAULT 0,
  created_by   CHAR(36)      NULL,
  created_at   DATETIME(3)   NOT NULL,
  updated_at   DATETIME(3)   NOT NULL,
  deleted_at   DATETIME(3)   NULL,
  revision     INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_menu_categories_name (name),
  KEY ix_menu_categories_sync_seq (sync_seq),
  KEY ix_menu_categories_status (status, sort_order),
  CONSTRAINT fk_menu_categories_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS menu_items (
  id           CHAR(36)      NOT NULL,
  category_id  CHAR(36)      NOT NULL,
  name         VARCHAR(150)  NOT NULL,
  unit         VARCHAR(30)   NOT NULL DEFAULT 'NOS',
  image_path   VARCHAR(500)  NULL,
  status       ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  sort_order   INT           NOT NULL DEFAULT 0,
  created_by   CHAR(36)      NULL,
  created_at   DATETIME(3)   NOT NULL,
  updated_at   DATETIME(3)   NOT NULL,
  deleted_at   DATETIME(3)   NULL,
  revision     INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_menu_items_category_name (category_id, name),
  KEY ix_menu_items_sync_seq (sync_seq),
  KEY ix_menu_items_status (status, sort_order),
  KEY ix_menu_items_name (name),
  CONSTRAINT fk_menu_items_category FOREIGN KEY (category_id) REFERENCES menu_categories (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_menu_items_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------- orders

CREATE TABLE IF NOT EXISTS orders (
  id                CHAR(36)      NOT NULL,
  order_number      VARCHAR(30)   NOT NULL,
  board_id          CHAR(36)      NOT NULL,
  activity_type_id  CHAR(36)      NULL,
  custom_activity   VARCHAR(150)  NULL,
  venue             VARCHAR(200)  NOT NULL,
  pax               INT UNSIGNED  NOT NULL DEFAULT 0,
  required_date     DATE          NOT NULL,
  required_time     TIME          NOT NULL,
  priority          ENUM('LOW','NORMAL','HIGH','URGENT') NOT NULL DEFAULT 'NORMAL',
  status            ENUM('PENDING','ACKNOWLEDGED','WORK_IN_PROGRESS','COMPLETED','CANCELLED')
                      NOT NULL DEFAULT 'PENDING',
  completed_at      DATETIME(3)   NULL,
  completed_by      CHAR(36)      NULL,
  created_by        CHAR(36)      NOT NULL,
  created_at        DATETIME(3)   NOT NULL,
  updated_at        DATETIME(3)   NOT NULL,
  deleted_at        DATETIME(3)   NULL,
  revision          INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_order_number (order_number),
  KEY ix_orders_sync_seq (sync_seq),
  KEY ix_orders_board_date (board_id, required_date, required_time),
  KEY ix_orders_board_status (board_id, status),
  KEY ix_orders_created_by (created_by),
  KEY ix_orders_required_date (required_date),
  KEY ix_orders_activity (activity_type_id),
  CONSTRAINT fk_orders_board FOREIGN KEY (board_id) REFERENCES boards (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  -- RESTRICT on both actions, not SET NULL: MariaDB refuses a CHECK constraint over a column
  -- whose foreign key can modify it, and ck_orders_activity_present below is the more valuable
  -- guarantee. RESTRICT costs nothing here because activity types are soft-deleted rather than
  -- removed, and UUID primary keys are never updated.
  CONSTRAINT fk_orders_activity FOREIGN KEY (activity_type_id) REFERENCES activity_types (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_orders_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_orders_completed_by FOREIGN KEY (completed_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  -- An order is described either by a catalogued activity type or by free text, never
  -- by neither. Mirrored in zod and in OrderService for a usable error message.
  CONSTRAINT ck_orders_activity_present
    CHECK (activity_type_id IS NOT NULL OR custom_activity IS NOT NULL)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- mentioned_user_ids is a JSON array of user UUIDs — see docs/SCOPE.md decision 3.
CREATE TABLE IF NOT EXISTS order_items (
  id                  CHAR(36)        NOT NULL,
  order_id            CHAR(36)        NOT NULL,
  menu_item_id        CHAR(36)        NOT NULL,
  quantity            DECIMAL(12,3)   NOT NULL DEFAULT 0.000,
  unit                VARCHAR(30)     NOT NULL DEFAULT 'NOS',
  notes               VARCHAR(1000)   NULL,
  mentioned_user_ids  LONGTEXT        NULL CHECK (mentioned_user_ids IS NULL OR JSON_VALID(mentioned_user_ids)),
  sort_order          INT             NOT NULL DEFAULT 0,
  created_at          DATETIME(3)     NOT NULL,
  updated_at          DATETIME(3)     NOT NULL,
  deleted_at          DATETIME(3)     NULL,
  revision            INT UNSIGNED    NOT NULL DEFAULT 1,
  sync_seq            BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_order_items_sync_seq (sync_seq),
  KEY ix_order_items_order (order_id, sort_order),
  KEY ix_order_items_menu_item (menu_item_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_order_items_menu_item FOREIGN KEY (menu_item_id) REFERENCES menu_items (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ----------------------------------------------------------------- attachments

-- Polymorphic owner (ORDER | THREAD_MESSAGE). owner_id is nullable so a device can
-- upload media before the owning entity has been pushed, then bind it on sync.
CREATE TABLE IF NOT EXISTS attachments (
  id            CHAR(36)      NOT NULL,
  owner_type    ENUM('ORDER','THREAD_MESSAGE') NOT NULL,
  owner_id      CHAR(36)      NULL,
  kind          ENUM('IMAGE','VOICE_NOTE','DOCUMENT') NOT NULL,
  file_name     VARCHAR(255)  NOT NULL,
  storage_path  VARCHAR(500)  NOT NULL,
  mime_type     VARCHAR(120)  NOT NULL,
  size_bytes    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  duration_ms   INT UNSIGNED  NULL,
  width         INT UNSIGNED  NULL,
  height        INT UNSIGNED  NULL,
  checksum      CHAR(64)      NULL,
  uploaded_by   CHAR(36)      NOT NULL,
  created_at    DATETIME(3)   NOT NULL,
  updated_at    DATETIME(3)   NOT NULL,
  deleted_at    DATETIME(3)   NULL,
  revision      INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_attachments_sync_seq (sync_seq),
  KEY ix_attachments_owner (owner_type, owner_id),
  KEY ix_attachments_uploaded_by (uploaded_by),
  CONSTRAINT fk_attachments_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------------- thread & acks

-- One discussion thread per order. message_type = 'SYSTEM' rows materialise the Order
-- Detail "History" section (docs/SCOPE.md decision 2); author_id is NULL for those.
CREATE TABLE IF NOT EXISTS thread_messages (
  id                  CHAR(36)        NOT NULL,
  order_id            CHAR(36)        NOT NULL,
  parent_message_id   CHAR(36)        NULL,
  author_id           CHAR(36)        NULL,
  message_type        ENUM('USER','SYSTEM') NOT NULL DEFAULT 'USER',
  body                VARCHAR(4000)   NULL,
  mentioned_user_ids  LONGTEXT        NULL CHECK (mentioned_user_ids IS NULL OR JSON_VALID(mentioned_user_ids)),
  system_event        VARCHAR(50)     NULL,
  system_meta         LONGTEXT        NULL CHECK (system_meta IS NULL OR JSON_VALID(system_meta)),
  created_at          DATETIME(3)     NOT NULL,
  updated_at          DATETIME(3)     NOT NULL,
  deleted_at          DATETIME(3)     NULL,
  revision            INT UNSIGNED    NOT NULL DEFAULT 1,
  sync_seq            BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_thread_messages_sync_seq (sync_seq),
  KEY ix_thread_messages_order (order_id, created_at),
  KEY ix_thread_messages_parent (parent_message_id),
  KEY ix_thread_messages_author (author_id),
  CONSTRAINT fk_thread_messages_order FOREIGN KEY (order_id) REFERENCES orders (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_thread_messages_parent FOREIGN KEY (parent_message_id) REFERENCES thread_messages (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_thread_messages_author FOREIGN KEY (author_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS acknowledgements (
  id               CHAR(36)        NOT NULL,
  order_id         CHAR(36)        NOT NULL,
  user_id          CHAR(36)        NOT NULL,
  acknowledged_at  DATETIME(3)     NOT NULL,
  note             VARCHAR(1000)   NULL,
  created_at       DATETIME(3)     NOT NULL,
  updated_at       DATETIME(3)     NOT NULL,
  deleted_at       DATETIME(3)     NULL,
  revision         INT UNSIGNED    NOT NULL DEFAULT 1,
  sync_seq         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_acknowledgements_order_user (order_id, user_id),
  KEY ix_acknowledgements_sync_seq (sync_seq),
  KEY ix_acknowledgements_user (user_id),
  CONSTRAINT fk_acknowledgements_order FOREIGN KEY (order_id) REFERENCES orders (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_acknowledgements_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------------- notifications

CREATE TABLE IF NOT EXISTS notifications (
  id         CHAR(36)      NOT NULL,
  user_id    CHAR(36)      NOT NULL,
  type       ENUM('NEW_ORDER','MENTION','THREAD_REPLY','ACKNOWLEDGEMENT','STATUS_CHANGED','BOARD_INVITATION')
               NOT NULL,
  title      VARCHAR(200)  NOT NULL,
  body       VARCHAR(1000) NULL,
  board_id   CHAR(36)      NULL,
  order_id   CHAR(36)      NULL,
  actor_id   CHAR(36)      NULL,
  data       LONGTEXT      NULL CHECK (data IS NULL OR JSON_VALID(data)),
  read_at    DATETIME(3)   NULL,
  created_at DATETIME(3)   NOT NULL,
  updated_at DATETIME(3)   NOT NULL,
  deleted_at DATETIME(3)   NULL,
  revision   INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_notifications_sync_seq (sync_seq),
  KEY ix_notifications_user_unread (user_id, read_at, created_at),
  KEY ix_notifications_order (order_id),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_notifications_board FOREIGN KEY (board_id) REFERENCES boards (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_notifications_order FOREIGN KEY (order_id) REFERENCES orders (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_notifications_actor FOREIGN KEY (actor_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ------------------------------------------------------------- refresh tokens

-- One row per device. Rotated on every refresh; `replaced_by` forms a chain so reuse of a
-- consumed token can be detected and the whole device chain revoked.
-- push_token lives here rather than in a separate table (docs/SCOPE.md decision 5).
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           CHAR(36)      NOT NULL,
  user_id      CHAR(36)      NOT NULL,
  token_hash   CHAR(64)      NOT NULL,
  device_id    VARCHAR(120)  NOT NULL,
  device_name  VARCHAR(150)  NULL,
  client_type  ENUM('ANDROID','ADMIN') NOT NULL DEFAULT 'ANDROID',
  push_token   VARCHAR(255)  NULL,
  ip           VARCHAR(64)   NULL,
  user_agent   VARCHAR(400)  NULL,
  expires_at   DATETIME(3)   NOT NULL,
  revoked_at   DATETIME(3)   NULL,
  replaced_by  CHAR(36)      NULL,
  last_used_at DATETIME(3)   NULL,
  created_at   DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_tokens_hash (token_hash),
  KEY ix_refresh_tokens_user_device (user_id, device_id),
  KEY ix_refresh_tokens_expires (expires_at),
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ------------------------------------------------------------------ audit logs

-- Append-only. Never updated or deleted by application code.
CREATE TABLE IF NOT EXISTS audit_logs (
  id          CHAR(36)      NOT NULL,
  actor_id    CHAR(36)      NULL,
  actor_role  ENUM('SUPER_ADMIN','ADMIN','MANAGER','USER') NULL,
  action      VARCHAR(80)   NOT NULL,
  entity_type VARCHAR(60)   NOT NULL,
  entity_id   VARCHAR(64)   NULL,
  board_id    CHAR(36)      NULL,
  before_data LONGTEXT      NULL CHECK (before_data IS NULL OR JSON_VALID(before_data)),
  after_data  LONGTEXT      NULL CHECK (after_data IS NULL OR JSON_VALID(after_data)),
  ip          VARCHAR(64)   NULL,
  user_agent  VARCHAR(400)  NULL,
  request_id  CHAR(36)      NULL,
  created_at  DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_audit_logs_entity (entity_type, entity_id, created_at),
  KEY ix_audit_logs_actor (actor_id, created_at),
  KEY ix_audit_logs_board (board_id, created_at),
  KEY ix_audit_logs_action (action, created_at),
  CONSTRAINT fk_audit_logs_actor FOREIGN KEY (actor_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------------------------- billing exports

-- Immutable snapshot produced only by an explicit Admin action. `snapshot` is frozen JSON
-- and is never recomputed; operational orders are untouched by generation.
CREATE TABLE IF NOT EXISTS billing_exports (
  id              CHAR(36)      NOT NULL,
  board_id        CHAR(36)      NULL,
  period_from     DATE          NOT NULL,
  period_to       DATE          NOT NULL,
  billing_version INT UNSIGNED  NOT NULL DEFAULT 1,
  status          ENUM('GENERATED','FINALIZED','CANCELLED') NOT NULL DEFAULT 'GENERATED',
  total_orders    INT UNSIGNED  NOT NULL DEFAULT 0,
  total_pax       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  snapshot        LONGTEXT      NOT NULL CHECK (JSON_VALID(snapshot)),
  checksum        CHAR(64)      NOT NULL,
  notes           VARCHAR(1000) NULL,
  generated_by    CHAR(36)      NOT NULL,
  generated_at    DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_billing_exports_board_period (board_id, period_from, period_to),
  KEY ix_billing_exports_generated_at (generated_at),
  CONSTRAINT fk_billing_exports_board FOREIGN KEY (board_id) REFERENCES boards (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_billing_exports_generated_by FOREIGN KEY (generated_by) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ------------------------------------------------------------------- sync logs

CREATE TABLE IF NOT EXISTS sync_logs (
  id             CHAR(36)      NOT NULL,
  user_id        CHAR(36)      NULL,
  device_id      VARCHAR(120)  NULL,
  direction      ENUM('PUSH','PULL') NOT NULL,
  cursor_from    BIGINT UNSIGNED NULL,
  cursor_to      BIGINT UNSIGNED NULL,
  entity_counts  LONGTEXT      NULL CHECK (entity_counts IS NULL OR JSON_VALID(entity_counts)),
  pushed_count   INT UNSIGNED  NOT NULL DEFAULT 0,
  applied_count  INT UNSIGNED  NOT NULL DEFAULT 0,
  conflict_count INT UNSIGNED  NOT NULL DEFAULT 0,
  failed_count   INT UNSIGNED  NOT NULL DEFAULT 0,
  status         ENUM('OK','PARTIAL','ERROR') NOT NULL DEFAULT 'OK',
  error          VARCHAR(1000) NULL,
  started_at     DATETIME(3)   NOT NULL,
  finished_at    DATETIME(3)   NULL,
  duration_ms    INT UNSIGNED  NULL,
  PRIMARY KEY (id),
  KEY ix_sync_logs_user_device (user_id, device_id, started_at),
  KEY ix_sync_logs_started (started_at),
  CONSTRAINT fk_sync_logs_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------------------------------- settings

-- Server-side configuration managed by the Admin Portal Settings page
-- (docs/SCOPE.md decision 6).
CREATE TABLE IF NOT EXISTS settings (
  setting_key  VARCHAR(120)  NOT NULL,
  value        LONGTEXT      NOT NULL CHECK (JSON_VALID(value)),
  description  VARCHAR(500)  NULL,
  updated_by   CHAR(36)      NULL,
  updated_at   DATETIME(3)   NOT NULL,
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_settings_updated_by FOREIGN KEY (updated_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
