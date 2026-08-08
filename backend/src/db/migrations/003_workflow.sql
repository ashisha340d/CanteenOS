-- MenuBoard 003 — role, order lifecycle, recipes, shopping lists and alarms
--
-- Brings the schema up to the operational specification:
--   * EMPLOYEE joins the role enum as a view-only tier.
--   * The order lifecycle gains PREPARATION and DONE, and COMPLETED is renamed DELIVERED.
--     On Shopping and Billed are deliberately *not* statuses — they are timestamps, because
--     a bill can be processed without the order being Done and a shopping list can be
--     raised at any point. `deriveOrderDisplayStatus` in @menuboard/shared folds the three
--     into the single pill the UI shows.
--   * Order lines become append-only: cancelling stamps a timestamp instead of deleting,
--     so the feed can keep the line struck through with its replacement beneath it.
--   * Recipes, shopping lists and alarm settings arrive as first-class tables.
--
-- Same conventions as 001: CHAR(36) UUIDs, DATETIME(3) UTC, soft delete, revision, sync_seq.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ------------------------------------------------------------------------ users

ALTER TABLE users
  MODIFY role ENUM('SUPER_ADMIN','ADMIN','MANAGER','USER','EMPLOYEE')
    NOT NULL DEFAULT 'USER';

-- ----------------------------------------------------------------------- boards

-- ON_HOLD sits between active and archived: the board still appears on the home list, dimmed,
-- but takes no new work.
ALTER TABLE boards
  MODIFY status ENUM('ACTIVE','ARCHIVED','ON_HOLD') NOT NULL DEFAULT 'ACTIVE';

-- ---------------------------------------------------------------------- orders

-- Widen first so both the old and the new member exist, rewrite the data, then drop
-- COMPLETED. Doing it in one MODIFY would silently coerce every completed order to the
-- enum's first member.
ALTER TABLE orders
  MODIFY status ENUM('PENDING','ACKNOWLEDGED','PREPARATION','WORK_IN_PROGRESS',
                     'COMPLETED','DELIVERED','DONE','CANCELLED')
    NOT NULL DEFAULT 'PENDING';

UPDATE orders SET status = 'DELIVERED' WHERE status = 'COMPLETED';

ALTER TABLE orders
  MODIFY status ENUM('PENDING','ACKNOWLEDGED','PREPARATION','WORK_IN_PROGRESS',
                     'DELIVERED','DONE','CANCELLED')
    NOT NULL DEFAULT 'PENDING';

ALTER TABLE orders
  ADD COLUMN shopping_generated_at DATETIME(3) NULL AFTER completed_by,
  ADD COLUMN billed_at             DATETIME(3) NULL AFTER shopping_generated_at,
  ADD COLUMN billing_export_id     CHAR(36)    NULL AFTER billed_at,
  ADD COLUMN done_at               DATETIME(3) NULL AFTER billing_export_id,
  ADD COLUMN done_by               CHAR(36)    NULL AFTER done_at,
  ADD KEY ix_orders_billed (billed_at),
  ADD CONSTRAINT fk_orders_done_by FOREIGN KEY (done_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_orders_billing_export FOREIGN KEY (billing_export_id)
    REFERENCES billing_exports (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- Orders that were already delivered before this migration keep their completion stamp; the
-- new done_at stays null so they remain in the active set until someone closes them out.

-- ----------------------------------------------------------------- order items

-- A cancelled line is never removed — the feed shows it struck through, with its
-- replacement (if any) inserted directly beneath. replaced_by_item_id is self-referential
-- and nullable, so the chain terminates at whichever line is currently live.
ALTER TABLE order_items
  ADD COLUMN cancelled_at        DATETIME(3) NULL AFTER sort_order,
  ADD COLUMN cancelled_by        CHAR(36)    NULL AFTER cancelled_at,
  ADD COLUMN replaced_by_item_id CHAR(36)    NULL AFTER cancelled_by,
  ADD KEY ix_order_items_cancelled (order_id, cancelled_at),
  ADD CONSTRAINT fk_order_items_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_order_items_replaced_by FOREIGN KEY (replaced_by_item_id)
    REFERENCES order_items (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- --------------------------------------------------------------------- recipes

-- One recipe per menu item, stated for base_pax servings. Scaling happens on read so that
-- changing an order's pax never rewrites recipe data.
CREATE TABLE IF NOT EXISTS recipes (
  id            CHAR(36)      NOT NULL,
  menu_item_id  CHAR(36)      NOT NULL,
  base_pax      INT UNSIGNED  NOT NULL DEFAULT 1,
  instructions  TEXT          NULL,
  status        ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by    CHAR(36)      NULL,
  created_at    DATETIME(3)   NOT NULL,
  updated_at    DATETIME(3)   NOT NULL,
  deleted_at    DATETIME(3)   NULL,
  revision      INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recipes_menu_item (menu_item_id),
  KEY ix_recipes_sync_seq (sync_seq),
  CONSTRAINT fk_recipes_menu_item FOREIGN KEY (menu_item_id) REFERENCES menu_items (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_recipes_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT ck_recipes_base_pax CHECK (base_pax > 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Ingredients are free text rather than a foreign key to menu_items: a recipe's inputs are
-- raw goods (atta, jeera, refined oil), which are not on the sellable menu.
CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id          CHAR(36)        NOT NULL,
  recipe_id   CHAR(36)        NOT NULL,
  name        VARCHAR(150)    NOT NULL,
  quantity    DECIMAL(12,3)   NOT NULL DEFAULT 0.000,
  unit        VARCHAR(30)     NOT NULL DEFAULT 'GM',
  notes       VARCHAR(500)    NULL,
  sort_order  INT             NOT NULL DEFAULT 0,
  created_at  DATETIME(3)     NOT NULL,
  updated_at  DATETIME(3)     NOT NULL,
  deleted_at  DATETIME(3)     NULL,
  revision    INT UNSIGNED    NOT NULL DEFAULT 1,
  sync_seq    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_recipe_ingredients_sync_seq (sync_seq),
  KEY ix_recipe_ingredients_recipe (recipe_id, sort_order),
  CONSTRAINT fk_recipe_ingredients_recipe FOREIGN KEY (recipe_id) REFERENCES recipes (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------------------------- shopping lists

-- source_order_ids is a JSON array rather than a join table — a list is generated once and
-- read as a unit, and the array travels through sync as part of the row.
CREATE TABLE IF NOT EXISTS shopping_lists (
  id            CHAR(36)      NOT NULL,
  board_id      CHAR(36)      NOT NULL,
  title         VARCHAR(200)  NOT NULL,
  status        ENUM('OPEN','PURCHASED','CANCELLED') NOT NULL DEFAULT 'OPEN',
  order_ids     LONGTEXT      NULL CHECK (order_ids IS NULL OR JSON_VALID(order_ids)),
  notes         VARCHAR(1000) NULL,
  generated_by  CHAR(36)      NOT NULL,
  generated_at  DATETIME(3)   NOT NULL,
  created_at    DATETIME(3)   NOT NULL,
  updated_at    DATETIME(3)   NOT NULL,
  deleted_at    DATETIME(3)   NULL,
  revision      INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_shopping_lists_sync_seq (sync_seq),
  KEY ix_shopping_lists_board (board_id, generated_at),
  CONSTRAINT fk_shopping_lists_board FOREIGN KEY (board_id) REFERENCES boards (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_shopping_lists_generated_by FOREIGN KEY (generated_by) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shopping_list_items (
  id                CHAR(36)        NOT NULL,
  shopping_list_id  CHAR(36)        NOT NULL,
  ingredient_name   VARCHAR(150)    NOT NULL,
  quantity          DECIMAL(12,3)   NOT NULL DEFAULT 0.000,
  unit              VARCHAR(30)     NOT NULL DEFAULT 'GM',
  purchased         TINYINT(1)      NOT NULL DEFAULT 0,
  notes             VARCHAR(500)    NULL,
  sort_order        INT             NOT NULL DEFAULT 0,
  source_order_ids  LONGTEXT        NULL CHECK (source_order_ids IS NULL OR JSON_VALID(source_order_ids)),
  created_at        DATETIME(3)     NOT NULL,
  updated_at        DATETIME(3)     NOT NULL,
  deleted_at        DATETIME(3)     NULL,
  revision          INT UNSIGNED    NOT NULL DEFAULT 1,
  sync_seq          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_shopping_list_items_sync_seq (sync_seq),
  KEY ix_shopping_list_items_list (shopping_list_id, sort_order),
  CONSTRAINT fk_shopping_list_items_list FOREIGN KEY (shopping_list_id)
    REFERENCES shopping_lists (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------------- notifications

-- Alarms are delivered through the existing notification pipeline; `data` carries the
-- alertType and the sound slot so the client knows which buzzer to play.
ALTER TABLE notifications
  MODIFY type ENUM('NEW_ORDER','MENTION','THREAD_REPLY','ACKNOWLEDGEMENT','STATUS_CHANGED',
                   'BOARD_INVITATION','ALERT') NOT NULL;

-- ---------------------------------------------------------------------- alerts

-- Organisation-wide alarm configuration: exactly one row per alert type, seeded below with
-- the defaults in ALERT_DEFAULTS so the four alarms exist before an admin ever opens the
-- settings screen.
CREATE TABLE IF NOT EXISTS alert_settings (
  id                    CHAR(36)      NOT NULL,
  alert_type            ENUM('NEW_INCOMING','DELIVERY_WARNING','CRITICAL_ALERT','PREP_CALL')
                          NOT NULL,
  enabled               TINYINT(1)    NOT NULL DEFAULT 1,
  lead_minutes          INT UNSIGNED  NOT NULL DEFAULT 0,
  sound                 ENUM('NORMAL','WARNING','CRITICAL') NOT NULL DEFAULT 'NORMAL',
  repeat_until_ack      TINYINT(1)    NOT NULL DEFAULT 1,
  repeat_every_seconds  INT UNSIGNED  NOT NULL DEFAULT 60,
  target_roles          LONGTEXT      NULL CHECK (target_roles IS NULL OR JSON_VALID(target_roles)),
  updated_by            CHAR(36)      NULL,
  created_at            DATETIME(3)   NOT NULL,
  updated_at            DATETIME(3)   NOT NULL,
  deleted_at            DATETIME(3)   NULL,
  revision              INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq              BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_alert_settings_type (alert_type),
  KEY ix_alert_settings_sync_seq (sync_seq),
  CONSTRAINT fk_alert_settings_updated_by FOREIGN KEY (updated_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- One row per buzzer slot. The file itself lives in `attachments`; a null attachment means
-- nothing has been uploaded and clients fall back to vibration only.
CREATE TABLE IF NOT EXISTS alert_sounds (
  slot           ENUM('NORMAL','WARNING','CRITICAL') NOT NULL,
  attachment_id  CHAR(36)      NULL,
  file_name      VARCHAR(255)  NULL,
  storage_path   VARCHAR(500)  NULL,
  updated_by     CHAR(36)      NULL,
  created_at     DATETIME(3)   NOT NULL,
  updated_at     DATETIME(3)   NOT NULL,
  revision       INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (slot),
  KEY ix_alert_sounds_sync_seq (sync_seq),
  CONSTRAINT fk_alert_sounds_attachment FOREIGN KEY (attachment_id) REFERENCES attachments (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_alert_sounds_updated_by FOREIGN KEY (updated_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Seeded with the same numbers as ALERT_DEFAULTS. UUIDs are fixed rather than generated so
-- re-running against a partially migrated database is a no-op.
INSERT INTO alert_settings
  (id, alert_type, enabled, lead_minutes, sound, repeat_until_ack, repeat_every_seconds,
   target_roles, created_at, updated_at)
VALUES
  ('a1e00000-0000-4000-8000-000000000001', 'NEW_INCOMING',     1,   0, 'NORMAL',   1, 60,
   '["MANAGER","USER","EMPLOYEE"]', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('a1e00000-0000-4000-8000-000000000002', 'DELIVERY_WARNING', 1,  30, 'WARNING',  1, 60,
   '["MANAGER","USER","EMPLOYEE"]', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('a1e00000-0000-4000-8000-000000000003', 'CRITICAL_ALERT',   1,  10, 'CRITICAL', 1, 30,
   '["MANAGER","USER","EMPLOYEE"]', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('a1e00000-0000-4000-8000-000000000004', 'PREP_CALL',        1, 120, 'NORMAL',   1, 60,
   '["MANAGER","USER","EMPLOYEE"]', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE alert_type = alert_type;

INSERT INTO alert_sounds (slot, created_at, updated_at) VALUES
  ('NORMAL',   UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('WARNING',  UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('CRITICAL', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE slot = slot;
