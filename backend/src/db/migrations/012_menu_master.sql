-- MenuBoard 012 — Menu Master
--
-- Extends the existing food-item master (`menu_items`, previously flat: one category, one
-- name, one image, no price) into a normalized Menu Master without renaming, repurposing or
-- dropping anything. `menu_items` stays exactly what it always was: the Food Item Master.
-- `menu_categories` stays the global category master.
--
-- New hierarchy layered on top:
--
--   menu_items (Food Item Master, UNCHANGED)
--     -> menus                        configurable menu definitions (VSK, PUBLIC, SATSANGEE, ...)
--         -> menu_category_assignments   a global category, reused per menu, with per-menu overrides
--         -> menu_item_assignments       a food item, offered on that menu, with per-menu overrides
--             -> menu_item_variants          the actual sellable configuration + price
--
-- A food item is never duplicated across menus: the same `menu_items.id` is referenced by as
-- many `menu_item_assignments` rows (one per menu) as needed. Menu-specific description,
-- preparation method, visibility and pricing all live on the assignment/variant, never on the
-- global food item.
--
-- Conventions carried over unchanged from 001_core_schema.sql: InnoDB / utf8mb4_unicode_ci,
-- CHAR(36) UUID primary keys, created_at/updated_at DATETIME(3) stamped by the app, deleted_at
-- soft delete, revision for optimistic concurrency, sync_seq for delta sync.
--
-- Polymorphic routing tables (media_assignments, counter_routes, printing_routes,
-- modifier_assignments) follow the same pattern already used by `attachments`
-- (owner_type ENUM + owner_id CHAR(36), no FK — the referenced tables differ by row) rather
-- than inventing a new convention.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ------------------------------------------------------------------------- menus

-- A configurable menu definition (VSK, PUBLIC, SATSANGEE, PUBLIC_MORNING, ...). These are
-- ordinary data rows — nothing about a menu name is hardcoded anywhere in this schema or the
-- application code that reads it.
CREATE TABLE IF NOT EXISTS menus (
  id                CHAR(36)      NOT NULL,
  code              VARCHAR(60)   NOT NULL,
  name              VARCHAR(150)  NOT NULL,
  description       VARCHAR(1000) NULL,
  status            ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  sort_order        INT           NOT NULL DEFAULT 0,
  priority          INT           NOT NULL DEFAULT 0,
  version           INT UNSIGNED  NOT NULL DEFAULT 1,
  effective_from    DATE          NULL,
  effective_until   DATE          NULL,
  -- Publish state is independent of `status`: an INACTIVE menu is disabled outright, while a
  -- published/unpublished ACTIVE menu controls whether POS/MenuBoard consumers may see it yet.
  published_at      DATETIME(3)   NULL,
  created_by        CHAR(36)      NULL,
  created_at        DATETIME(3)   NOT NULL,
  updated_at        DATETIME(3)   NOT NULL,
  deleted_at        DATETIME(3)   NULL,
  revision          INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_menus_code (code),
  KEY ix_menus_sync_seq (sync_seq),
  KEY ix_menus_status (status, sort_order),
  KEY ix_menus_published (status, published_at),
  CONSTRAINT fk_menus_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ------------------------------------------------------------- menu category assignments

-- Reuses the existing global `menu_categories` master per menu, instead of duplicating a
-- category record for every menu that wants it. Per-menu display overrides live here; the
-- category itself (name, Hindi name, master image) stays on `menu_categories`.
CREATE TABLE IF NOT EXISTS menu_category_assignments (
  id                CHAR(36)      NOT NULL,
  menu_id           CHAR(36)      NOT NULL,
  category_id       CHAR(36)      NOT NULL,
  display_name      VARCHAR(150)  NULL,
  display_name_hi   VARCHAR(180)  NULL,
  description       VARCHAR(1000) NULL,
  description_hi    VARCHAR(1000) NULL,
  status            ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  sort_order        INT           NOT NULL DEFAULT 0,
  pos_visible       TINYINT(1)    NOT NULL DEFAULT 1,
  board_visible     TINYINT(1)    NOT NULL DEFAULT 1,
  created_by        CHAR(36)      NULL,
  created_at        DATETIME(3)   NOT NULL,
  updated_at        DATETIME(3)   NOT NULL,
  deleted_at        DATETIME(3)   NULL,
  revision          INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_menu_category_assignments (menu_id, category_id),
  KEY ix_menu_category_assignments_sync_seq (sync_seq),
  KEY ix_menu_category_assignments_menu (menu_id, status, sort_order),
  KEY ix_menu_category_assignments_category (category_id),
  CONSTRAINT fk_mca_menu FOREIGN KEY (menu_id) REFERENCES menus (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_mca_category FOREIGN KEY (category_id) REFERENCES menu_categories (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_mca_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ------------------------------------------------------------------ menu item assignments

-- Offers an existing Food Item (`menu_items` row) on a specific menu. The same food item can
-- have any number of these rows — one per menu — each with its own menu-specific description,
-- preparation method, visibility and channel availability. The global food item is never
-- modified by anything that happens here.
CREATE TABLE IF NOT EXISTS menu_item_assignments (
  id                        CHAR(36)      NOT NULL,
  menu_id                   CHAR(36)      NOT NULL,
  -- References menu_items = the Food Item Master. Column named food_item_id (not
  -- menu_item_id) so it reads correctly despite the historical table name.
  food_item_id              CHAR(36)      NOT NULL,
  category_assignment_id    CHAR(36)      NULL,
  display_name              VARCHAR(150)  NULL,
  display_name_hi           VARCHAR(180)  NULL,
  description               VARCHAR(1000) NULL,
  description_hi            VARCHAR(1000) NULL,
  preparation_method        VARCHAR(2000) NULL,
  preparation_method_hi     VARCHAR(2000) NULL,
  preparation_time_minutes  INT UNSIGNED  NULL,
  unit                      VARCHAR(30)   NULL,
  -- Used only when this item has zero variants — see menu_item_variants below. Ignored the
  -- moment at least one ACTIVE variant exists for this assignment.
  base_price                DECIMAL(12,2) NULL,
  status                    ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  availability              ENUM('AVAILABLE','UNAVAILABLE','SOLD_OUT') NOT NULL DEFAULT 'AVAILABLE',
  sort_order                INT           NOT NULL DEFAULT 0,
  pos_visible               TINYINT(1)    NOT NULL DEFAULT 1,
  board_visible             TINYINT(1)    NOT NULL DEFAULT 1,
  qr_visible                TINYINT(1)    NOT NULL DEFAULT 1,
  web_visible               TINYINT(1)    NOT NULL DEFAULT 1,
  app_visible               TINYINT(1)    NOT NULL DEFAULT 1,
  dine_in_available         TINYINT(1)    NOT NULL DEFAULT 1,
  takeaway_available        TINYINT(1)    NOT NULL DEFAULT 1,
  delivery_available        TINYINT(1)    NOT NULL DEFAULT 1,
  created_by                CHAR(36)      NULL,
  created_at                DATETIME(3)   NOT NULL,
  updated_at                DATETIME(3)   NOT NULL,
  deleted_at                DATETIME(3)   NULL,
  revision                  INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq                  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_menu_item_assignments (menu_id, food_item_id),
  KEY ix_menu_item_assignments_sync_seq (sync_seq),
  KEY ix_menu_item_assignments_menu (menu_id, status, sort_order),
  KEY ix_menu_item_assignments_food_item (food_item_id),
  KEY ix_menu_item_assignments_category (category_assignment_id),
  CONSTRAINT fk_mia_menu FOREIGN KEY (menu_id) REFERENCES menus (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_mia_food_item FOREIGN KEY (food_item_id) REFERENCES menu_items (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_mia_category_assignment FOREIGN KEY (category_assignment_id)
    REFERENCES menu_category_assignments (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_mia_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------------------- menu item variants

-- The actual sellable configuration and price. A menu item assignment may have zero, one or
-- many of these — "Tiny / ₹30", "Large / ₹100", "Regular / ₹80" are ordinary rows, never
-- schema-level enum values.
CREATE TABLE IF NOT EXISTS menu_item_variants (
  id                        CHAR(36)      NOT NULL,
  menu_item_assignment_id   CHAR(36)      NOT NULL,
  variant_code              VARCHAR(60)   NULL,
  name                      VARCHAR(120)  NOT NULL,
  name_hi                   VARCHAR(150)  NULL,
  description               VARCHAR(1000) NULL,
  description_hi            VARCHAR(1000) NULL,
  portion_name              VARCHAR(80)   NULL,
  portion_name_hi           VARCHAR(100)  NULL,
  quantity                  DECIMAL(12,3) NULL,
  unit                      VARCHAR(30)   NULL,
  price                     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status                    ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  availability              ENUM('AVAILABLE','UNAVAILABLE','SOLD_OUT') NOT NULL DEFAULT 'AVAILABLE',
  sort_order                INT           NOT NULL DEFAULT 0,
  preparation_method        VARCHAR(2000) NULL,
  preparation_method_hi     VARCHAR(2000) NULL,
  preparation_time_minutes  INT UNSIGNED  NULL,
  is_default                TINYINT(1)    NOT NULL DEFAULT 0,
  created_by                CHAR(36)      NULL,
  created_at                DATETIME(3)   NOT NULL,
  updated_at                DATETIME(3)   NOT NULL,
  deleted_at                DATETIME(3)   NULL,
  revision                  INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq                  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_menu_item_variants_code (menu_item_assignment_id, variant_code),
  KEY ix_menu_item_variants_sync_seq (sync_seq),
  KEY ix_menu_item_variants_assignment (menu_item_assignment_id, status, sort_order),
  CONSTRAINT fk_miv_assignment FOREIGN KEY (menu_item_assignment_id)
    REFERENCES menu_item_assignments (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_miv_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------- media library

-- Reusable media assets, modelled on the existing `attachments` table's storage conventions
-- (mediaStorage.ts: `<kind>/<yyyy>/<mm>/<id><ext>` under config.media.root) but as a genuinely
-- reusable library rather than an order/thread-scoped upload: the same row may be linked from
-- any number of menu entities via `media_assignments` below, and deleting a link never deletes
-- the asset while another link still references it.
CREATE TABLE IF NOT EXISTS media_assets (
  id             CHAR(36)      NOT NULL,
  file_name      VARCHAR(255)  NOT NULL,
  storage_path   VARCHAR(500)  NOT NULL,
  mime_type      VARCHAR(120)  NOT NULL,
  file_extension VARCHAR(20)   NULL,
  size_bytes     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  width          INT UNSIGNED  NULL,
  height         INT UNSIGNED  NULL,
  media_type     ENUM('IMAGE','VIDEO','DOCUMENT') NOT NULL DEFAULT 'IMAGE',
  title          VARCHAR(200)  NULL,
  alt_text       VARCHAR(300)  NULL,
  checksum       CHAR(64)      NULL,
  status         ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by     CHAR(36)      NULL,
  created_at     DATETIME(3)   NOT NULL,
  updated_at     DATETIME(3)   NOT NULL,
  deleted_at     DATETIME(3)   NULL,
  revision       INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_media_assets_sync_seq (sync_seq),
  KEY ix_media_assets_status (status, deleted_at),
  KEY ix_media_assets_checksum (checksum),
  CONSTRAINT fk_media_assets_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Links a media asset to any Menu Master entity. Polymorphic by (entity_type, entity_id) —
-- same pattern as `attachments.owner_type/owner_id` — since a single foreign key cannot point
-- at four different tables. Multiple rows per entity give galleries; `is_primary` (at most one
-- TRUE per entity, enforced in the service layer alongside the transaction that sets it) gives
-- every entity kind a resolvable primary image without ever duplicating the file.
CREATE TABLE IF NOT EXISTS media_assignments (
  id           CHAR(36)      NOT NULL,
  media_id     CHAR(36)      NOT NULL,
  entity_type  ENUM('MENU','MENU_CATEGORY_ASSIGNMENT','MENU_ITEM_ASSIGNMENT','MENU_ITEM_VARIANT')
                 NOT NULL,
  entity_id    CHAR(36)      NOT NULL,
  role         ENUM('PRIMARY','GALLERY','BANNER','THUMBNAIL','COVER') NOT NULL DEFAULT 'GALLERY',
  is_primary   TINYINT(1)    NOT NULL DEFAULT 0,
  sort_order   INT           NOT NULL DEFAULT 0,
  status       ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by   CHAR(36)      NULL,
  created_at   DATETIME(3)   NOT NULL,
  updated_at   DATETIME(3)   NOT NULL,
  deleted_at   DATETIME(3)   NULL,
  revision     INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_media_assignments_sync_seq (sync_seq),
  KEY ix_media_assignments_entity (entity_type, entity_id, status, sort_order),
  KEY ix_media_assignments_media (media_id),
  CONSTRAINT fk_media_assignments_media FOREIGN KEY (media_id) REFERENCES media_assets (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_media_assignments_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------- counters

-- Operational service counters (VSK Counter, Main Counter, Satsangee Counter, ...). Reused
-- across as many routing rows as needed; never attached directly to a food item.
CREATE TABLE IF NOT EXISTS counters (
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
  UNIQUE KEY uq_counters_name (name),
  UNIQUE KEY uq_counters_code (code),
  KEY ix_counters_sync_seq (sync_seq),
  KEY ix_counters_status (status, sort_order),
  CONSTRAINT fk_counters_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Routes a menu item assignment or a specific variant to a counter. Polymorphic entity
-- reference, same reasoning as media_assignments. A variant-level row overrides its parent
-- assignment-level row for that variant; resolution is application logic, not a DB constraint.
CREATE TABLE IF NOT EXISTS counter_routes (
  id           CHAR(36)      NOT NULL,
  entity_type  ENUM('MENU_ITEM_ASSIGNMENT','MENU_ITEM_VARIANT') NOT NULL,
  entity_id    CHAR(36)      NOT NULL,
  counter_id   CHAR(36)      NOT NULL,
  status       ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by   CHAR(36)      NULL,
  created_at   DATETIME(3)   NOT NULL,
  updated_at   DATETIME(3)   NOT NULL,
  deleted_at   DATETIME(3)   NULL,
  revision     INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_counter_routes (entity_type, entity_id, counter_id),
  KEY ix_counter_routes_sync_seq (sync_seq),
  KEY ix_counter_routes_entity (entity_type, entity_id, status),
  KEY ix_counter_routes_counter (counter_id),
  CONSTRAINT fk_counter_routes_counter FOREIGN KEY (counter_id) REFERENCES counters (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_counter_routes_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------ printing groups

-- Kitchen / Bakery / Coffee / Pizza / Packing / Bar, independent of physical printer hardware.
-- Which physical printer serves a group is a deployment-time configuration concern, out of
-- scope for this table by design — changing a printer must never touch Menu Master data.
CREATE TABLE IF NOT EXISTS printing_groups (
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
  UNIQUE KEY uq_printing_groups_name (name),
  UNIQUE KEY uq_printing_groups_code (code),
  KEY ix_printing_groups_sync_seq (sync_seq),
  KEY ix_printing_groups_status (status, sort_order),
  CONSTRAINT fk_printing_groups_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- A menu item or variant may print to more than one group at once (e.g. a combo ticket to both
-- Kitchen and Packing), hence sort_order rather than a single nullable FK.
CREATE TABLE IF NOT EXISTS printing_routes (
  id                 CHAR(36)      NOT NULL,
  entity_type        ENUM('MENU_ITEM_ASSIGNMENT','MENU_ITEM_VARIANT') NOT NULL,
  entity_id          CHAR(36)      NOT NULL,
  printing_group_id  CHAR(36)      NOT NULL,
  sort_order         INT           NOT NULL DEFAULT 0,
  status             ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by         CHAR(36)      NULL,
  created_at         DATETIME(3)   NOT NULL,
  updated_at         DATETIME(3)   NOT NULL,
  deleted_at         DATETIME(3)   NULL,
  revision           INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq           BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_printing_routes (entity_type, entity_id, printing_group_id),
  KEY ix_printing_routes_sync_seq (sync_seq),
  KEY ix_printing_routes_entity (entity_type, entity_id, status, sort_order),
  KEY ix_printing_routes_group (printing_group_id),
  CONSTRAINT fk_printing_routes_group FOREIGN KEY (printing_group_id) REFERENCES printing_groups (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_printing_routes_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------- modifiers

CREATE TABLE IF NOT EXISTS modifier_groups (
  id             CHAR(36)      NOT NULL,
  name           VARCHAR(120)  NOT NULL,
  description    VARCHAR(1000) NULL,
  selection_type ENUM('SINGLE','MULTIPLE') NOT NULL DEFAULT 'MULTIPLE',
  min_select     INT UNSIGNED  NOT NULL DEFAULT 0,
  max_select     INT UNSIGNED  NULL,
  status         ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  sort_order     INT           NOT NULL DEFAULT 0,
  created_by     CHAR(36)      NULL,
  created_at     DATETIME(3)   NOT NULL,
  updated_at     DATETIME(3)   NOT NULL,
  deleted_at     DATETIME(3)   NULL,
  revision       INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_modifier_groups_name (name),
  KEY ix_modifier_groups_sync_seq (sync_seq),
  KEY ix_modifier_groups_status (status, sort_order),
  CONSTRAINT fk_modifier_groups_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Extra Cheese, Extra Sauce, Toppings, No Onion, Size Upgrade, ... — rows within a group.
CREATE TABLE IF NOT EXISTS modifiers (
  id                 CHAR(36)      NOT NULL,
  modifier_group_id  CHAR(36)      NOT NULL,
  name               VARCHAR(120)  NOT NULL,
  name_hi            VARCHAR(150)  NULL,
  price_delta        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status             ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  sort_order         INT           NOT NULL DEFAULT 0,
  created_by         CHAR(36)      NULL,
  created_at         DATETIME(3)   NOT NULL,
  updated_at         DATETIME(3)   NOT NULL,
  deleted_at         DATETIME(3)   NULL,
  revision           INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq           BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_modifiers_group_name (modifier_group_id, name),
  KEY ix_modifiers_sync_seq (sync_seq),
  KEY ix_modifiers_group (modifier_group_id, status, sort_order),
  CONSTRAINT fk_modifiers_group FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_modifiers_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS modifier_assignments (
  id                 CHAR(36)      NOT NULL,
  entity_type        ENUM('MENU_ITEM_ASSIGNMENT','MENU_ITEM_VARIANT') NOT NULL,
  entity_id          CHAR(36)      NOT NULL,
  modifier_group_id  CHAR(36)      NOT NULL,
  is_required        TINYINT(1)    NOT NULL DEFAULT 0,
  sort_order         INT           NOT NULL DEFAULT 0,
  status             ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by         CHAR(36)      NULL,
  created_at         DATETIME(3)   NOT NULL,
  updated_at         DATETIME(3)   NOT NULL,
  deleted_at         DATETIME(3)   NULL,
  revision           INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq           BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_modifier_assignments (entity_type, entity_id, modifier_group_id),
  KEY ix_modifier_assignments_sync_seq (sync_seq),
  KEY ix_modifier_assignments_entity (entity_type, entity_id, status, sort_order),
  KEY ix_modifier_assignments_group (modifier_group_id),
  CONSTRAINT fk_modifier_assignments_group FOREIGN KEY (modifier_group_id)
    REFERENCES modifier_groups (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_modifier_assignments_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------- menu schedules

-- Configurable time-based availability. `day_of_week` NULL means "every day". Nothing named
-- Morning/Evening exists here — PUBLIC_MORNING and PUBLIC_EVENING are just two `menus` rows,
-- each optionally carrying its own schedule.
CREATE TABLE IF NOT EXISTS menu_schedules (
  id           CHAR(36)      NOT NULL,
  menu_id      CHAR(36)      NOT NULL,
  day_of_week  TINYINT UNSIGNED NULL COMMENT '0=Sunday .. 6=Saturday, NULL=every day',
  start_time   TIME          NOT NULL,
  end_time     TIME          NOT NULL,
  status       ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by   CHAR(36)      NULL,
  created_at   DATETIME(3)   NOT NULL,
  updated_at   DATETIME(3)   NOT NULL,
  deleted_at   DATETIME(3)   NULL,
  revision     INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_menu_schedules_sync_seq (sync_seq),
  KEY ix_menu_schedules_menu (menu_id, status, day_of_week),
  CONSTRAINT fk_menu_schedules_menu FOREIGN KEY (menu_id) REFERENCES menus (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_menu_schedules_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT ck_menu_schedules_time CHECK (start_time < end_time)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------------- order history preservation

-- Snapshots the exact sellable configuration at sale time, so future Menu Master edits
-- (price changes, variant renames, menu deletions) can never alter a historical order line.
-- `menu_item_id` (the food item reference) is untouched and still NOT NULL for a catalogued
-- line; the columns below are purely additive.
ALTER TABLE order_items
  ADD COLUMN menu_id        CHAR(36)      NULL AFTER menu_item_id,
  ADD COLUMN variant_id     CHAR(36)      NULL AFTER menu_id,
  ADD COLUMN variant_name   VARCHAR(150)  NULL AFTER variant_id,
  ADD COLUMN unit_price     DECIMAL(12,2) NULL AFTER variant_name,
  ADD COLUMN tax_amount     DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER unit_price,
  ADD COLUMN discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER tax_amount,
  ADD COLUMN line_total     DECIMAL(14,2) NULL AFTER discount_amount,
  ADD KEY ix_order_items_menu (menu_id),
  ADD KEY ix_order_items_variant (variant_id),
  -- RESTRICT, matching fk_order_items_menu_item: nothing in this schema is ever hard-deleted
  -- (soft delete only), so this can never actually fire — it exists purely as a guarantee that
  -- no future code path can silently strand or corrupt a historical order's pricing reference.
  ADD CONSTRAINT fk_order_items_menu FOREIGN KEY (menu_id) REFERENCES menus (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT fk_order_items_variant FOREIGN KEY (variant_id) REFERENCES menu_item_variants (id)
    ON DELETE RESTRICT ON UPDATE CASCADE;
