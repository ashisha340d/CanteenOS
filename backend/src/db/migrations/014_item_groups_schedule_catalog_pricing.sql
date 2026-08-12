-- MenuBoard 014 — Item groups, food item schedules, per-catalogue variant pricing
--
-- Three independent additions to the Menu Master, none of which touch the existing
-- menus -> menu_item_assignments -> menu_item_variants hierarchy:
--
--   1. item_groups / item_group_assignments — a reusable tag master (A La Carte, Combo
--      Eligible, Set Menu, ...) attached to the Food Item Master (menu_items), many-to-many.
--      Same shape as counters/counter_routes, just scoped to the food item rather than a
--      menu-specific assignment/variant.
--   2. counter_routes.entity_type widened to also allow 'MENU_ITEM' — a route pinned to the
--      food item itself (global, not per-menu) reuses the existing polymorphic table rather
--      than inventing a parallel one.
--   3. menu_items.always_available + menu_item_schedules — per food item, per weekday, per
--      shift availability, following the same day_of_week convention as menu_schedules.
--   4. menu_item_variant_catalog_prices — lets a specific menu (catalogue) override a
--      variant's price without touching the variant's own base price.
--
-- Conventions carried over unchanged from 001_core_schema.sql / 012_menu_master.sql: InnoDB /
-- utf8mb4_unicode_ci, CHAR(36) UUID primary keys, created_at/updated_at DATETIME(3) stamped by
-- the app, deleted_at soft delete, revision for optimistic concurrency, sync_seq for delta sync.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ------------------------------------------------------------------------- item groups

-- Reusable tag master for the Food Item Master (À La Carte, Combo Eligible, Set Menu, ...).
-- Identical shape to `counters`.
CREATE TABLE IF NOT EXISTS item_groups (
  id           CHAR(36)      NOT NULL,
  name         VARCHAR(120)  NOT NULL,
  code         VARCHAR(60)   NULL,
  description  VARCHAR(1000) NULL,
  status       ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  sort_order   INT           NOT NULL DEFAULT 0,
  created_by   CHAR(36)      NULL,
  created_at   DATETIME(3)   NOT NULL,
  updated_at   DATETIME(3)   NOT NULL,
  deleted_at   DATETIME(3)   NULL,
  revision     INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_item_groups_name (name),
  UNIQUE KEY uq_item_groups_code (code),
  KEY ix_item_groups_sync_seq (sync_seq),
  KEY ix_item_groups_status (status, sort_order),
  CONSTRAINT fk_item_groups_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Many-to-many between the Food Item Master and item_groups.
CREATE TABLE IF NOT EXISTS item_group_assignments (
  id            CHAR(36)      NOT NULL,
  food_item_id  CHAR(36)      NOT NULL,
  group_id      CHAR(36)      NOT NULL,
  status        ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by    CHAR(36)      NULL,
  created_at    DATETIME(3)   NOT NULL,
  updated_at    DATETIME(3)   NOT NULL,
  deleted_at    DATETIME(3)   NULL,
  revision      INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_item_group_assignments (food_item_id, group_id),
  KEY ix_item_group_assignments_sync_seq (sync_seq),
  KEY ix_item_group_assignments_food_item (food_item_id, status),
  KEY ix_item_group_assignments_group (group_id),
  CONSTRAINT fk_iga_food_item FOREIGN KEY (food_item_id) REFERENCES menu_items (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_iga_group FOREIGN KEY (group_id) REFERENCES item_groups (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_iga_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ------------------------------------------------------------------- counter routes widen

-- A food item may now route directly to service counters (global to the item, not per-menu),
-- reusing the same polymorphic counter_routes table rather than a new one.
ALTER TABLE counter_routes
  MODIFY COLUMN entity_type ENUM('MENU_ITEM_ASSIGNMENT','MENU_ITEM_VARIANT','MENU_ITEM') NOT NULL;

-- --------------------------------------------------------------- food item schedules

-- When TRUE, the food item ignores menu_item_schedules below and is always available.
ALTER TABLE menu_items
  ADD COLUMN always_available TINYINT(1) NOT NULL DEFAULT 1 AFTER base_price;

-- Per food item, per weekday, per shift availability. Absence of a row for a given
-- (food_item_id, day_of_week, shift) means "not explicitly configured"; resolution to a
-- default is application logic, not a DB constraint.
CREATE TABLE IF NOT EXISTS menu_item_schedules (
  id            CHAR(36)      NOT NULL,
  food_item_id  CHAR(36)      NOT NULL,
  day_of_week   TINYINT UNSIGNED NOT NULL COMMENT '0=Sunday..6=Saturday',
  shift         ENUM('MORNING','EVENING') NOT NULL,
  is_available  TINYINT(1)    NOT NULL DEFAULT 1,
  created_by    CHAR(36)      NULL,
  created_at    DATETIME(3)   NOT NULL,
  updated_at    DATETIME(3)   NOT NULL,
  deleted_at    DATETIME(3)   NULL,
  revision      INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_menu_item_schedules (food_item_id, day_of_week, shift),
  KEY ix_menu_item_schedules_sync_seq (sync_seq),
  KEY ix_menu_item_schedules_food_item (food_item_id, day_of_week, shift),
  CONSTRAINT fk_mis_food_item FOREIGN KEY (food_item_id) REFERENCES menu_items (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_mis_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT ck_menu_item_schedules_day CHECK (day_of_week BETWEEN 0 AND 6)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ------------------------------------------------------------ variant catalogue pricing

-- Lets a specific catalogue (a `menus` row) override the price of a specific variant without
-- touching the variant's own base price.
CREATE TABLE IF NOT EXISTS menu_item_variant_catalog_prices (
  id           CHAR(36)      NOT NULL,
  variant_id   CHAR(36)      NOT NULL,
  menu_id      CHAR(36)      NOT NULL,
  price        DECIMAL(12,2) NOT NULL,
  status       ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by   CHAR(36)      NULL,
  created_at   DATETIME(3)   NOT NULL,
  updated_at   DATETIME(3)   NOT NULL,
  deleted_at   DATETIME(3)   NULL,
  revision     INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_menu_item_variant_catalog_prices (variant_id, menu_id),
  KEY ix_menu_item_variant_catalog_prices_sync_seq (sync_seq),
  KEY ix_menu_item_variant_catalog_prices_variant (variant_id, status),
  KEY ix_menu_item_variant_catalog_prices_menu (menu_id),
  CONSTRAINT fk_mivcp_variant FOREIGN KEY (variant_id) REFERENCES menu_item_variants (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_mivcp_menu FOREIGN KEY (menu_id) REFERENCES menus (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_mivcp_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
