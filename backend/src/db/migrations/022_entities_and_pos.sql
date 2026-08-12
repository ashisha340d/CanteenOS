-- MenuBoard 022 — Entity master and Point of Sale
--
-- Two additions, in that order because the second depends on the first:
--
--   entities    the party master. One row per customer, employee, vendor or other body the
--               operation deals with, discriminated by `type`. Deliberately ONE table: the
--               same person is routinely a customer at the counter and an employee on the
--               payroll, and three parallel tables would duplicate them and lose the link.
--   pos_*       the till. A POS ticket is a different object from an operational `orders`
--               row — it has no board, no activity, no pax requirement and no offline
--               origin — so it gets its own header/line/payment tables rather than being
--               forced through a schema built for kitchen coordination.
--
-- No `revision`/`sync_seq` on the POS tables or on `entities`: like tax_profiles (021) and
-- youtube_recipe_imports (011), these are counter/Admin-Portal surfaces that never replicate
-- to the Android app, so there is no sync bookkeeping to do. `pos_orders` keeps a plain
-- `revision` column for optimistic concurrency (two terminals on one ticket), which is a
-- different concern from the sync cursor and does not imply participation in sync.
--
-- Money is DECIMAL(14,2) throughout and never a float. Rates are DECIMAL(6,3), matching
-- tax_profiles. Every amount on a line is a frozen snapshot: re-pricing the menu tomorrow
-- must not silently change a bill that was already handed to a customer.
--
-- A few foreign keys below say ON UPDATE RESTRICT where the rest of the schema says CASCADE.
-- That is not an oversight: MariaDB refuses a CHECK constraint on any column whose foreign
-- key carries a cascading referential action ("Function or expression 'x' cannot be used in
-- the CHECK clause"). 008_ad_hoc_order_items.sql already made the same trade for
-- `order_items.menu_item_id` so that `ck_order_items_dish` could exist. Primary keys here are
-- UUIDs and are never updated, so the two actions are indistinguishable in practice.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ------------------------------------------------------------------ entity master

CREATE TABLE IF NOT EXISTS entities (
  id                CHAR(36)      NOT NULL,
  -- Server-allocated per type: CUS-0001, EMP-0001, VEN-0001, OTH-0001. Human-quotable.
  code              VARCHAR(40)   NOT NULL,
  type              ENUM('CUSTOMER','EMPLOYEE','VENDOR','OTHER') NOT NULL DEFAULT 'CUSTOMER',
  name              VARCHAR(150)  NOT NULL,
  name_hi           VARCHAR(180)  NULL,
  phone             VARCHAR(30)   NULL,
  email             VARCHAR(200)  NULL,
  address           VARCHAR(500)  NULL,
  city              VARCHAR(120)  NULL,
  -- Two-digit GST state code. Decides CGST+SGST (intra-state) versus IGST (inter-state) at
  -- checkout; NULL falls back to the intra-state split, which is the canteen's normal case.
  state_code        VARCHAR(2)    NULL,
  gstin             VARCHAR(15)   NULL,
  pan               VARCHAR(10)   NULL,
  department        VARCHAR(120)  NULL,
  designation       VARCHAR(120)  NULL,
  -- An EMPLOYEE entity and the login account of the same person. SET NULL on delete: losing
  -- the account must not lose the meal history charged against the person.
  linked_user_id    CHAR(36)      NULL,
  discount_percent  DECIMAL(6,3)  NOT NULL DEFAULT 0.000,
  credit_limit      DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  -- Positive = the entity owes the operation. Moved only by ACCOUNT settlements and their
  -- reversals, inside the same transaction as the payment row that caused the change.
  account_balance   DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  notes             VARCHAR(1000) NULL,
  status            ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  sort_order        INT           NOT NULL DEFAULT 0,
  created_by        CHAR(36)      NULL,
  created_at        DATETIME(3)   NOT NULL,
  updated_at        DATETIME(3)   NOT NULL,
  deleted_at        DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_entities_code (code),
  KEY ix_entities_type_status (type, status, sort_order),
  KEY ix_entities_phone (phone),
  KEY ix_entities_name (name),
  KEY ix_entities_linked_user (linked_user_id),
  CONSTRAINT fk_entities_linked_user FOREIGN KEY (linked_user_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_entities_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ------------------------------------------------------------------ POS tickets

CREATE TABLE IF NOT EXISTS pos_orders (
  id                 CHAR(36)      NOT NULL,
  -- POS-YYYYMMDD-NNNN. Server-sequential, unlike ORD- numbers: a till is online by
  -- definition, so the offline-creation constraint that forced device-generated order
  -- numbers does not apply, and a counter must hand out a countable bill number.
  order_number       VARCHAR(30)   NOT NULL,
  daily_sequence     INT UNSIGNED  NOT NULL,
  business_date      DATE          NOT NULL,
  order_type         ENUM('DINE_IN','TAKEAWAY','DELIVERY','QUICK_SALE')
                     NOT NULL DEFAULT 'TAKEAWAY',
  status             ENUM('DRAFT','SCHEDULED','OPEN','COMPLETED','CANCELLED')
                     NOT NULL DEFAULT 'OPEN',
  payment_status     ENUM('UNPAID','PARTIAL','PAID','VOIDED') NOT NULL DEFAULT 'UNPAID',
  station_id         CHAR(36)      NULL,
  counter_id         CHAR(36)      NULL,
  -- Which menu the prices were taken from. RESTRICT, for the same reason order_items uses it:
  -- a historical bill must keep resolving to the menu it was priced against.
  menu_id            CHAR(36)      NULL,
  entity_id          CHAR(36)      NULL,
  -- Snapshot. An order raised for "Ram Kumar, 98xxx" stays that even if the entity is later
  -- renamed, merged or deactivated — and a walk-in can be named without registering at all.
  entity_type        ENUM('CUSTOMER','EMPLOYEE','VENDOR','OTHER') NULL,
  entity_name        VARCHAR(150)  NULL,
  entity_phone       VARCHAR(30)   NULL,
  entity_address     VARCHAR(500)  NULL,
  -- Free text rather than a table master: canteens and temple halls label seating ad hoc, and
  -- a maintained table registry would be a master nobody keeps current.
  table_label        VARCHAR(60)   NULL,
  pax                INT UNSIGNED  NOT NULL DEFAULT 0,
  scheduled_for      DATETIME(3)   NULL,
  notes              VARCHAR(1000) NULL,
  discount_type      ENUM('NONE','PERCENT','AMOUNT') NOT NULL DEFAULT 'NONE',
  discount_value     DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  subtotal_amount    DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  discount_amount    DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  tax_amount         DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  round_off_amount   DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total_amount       DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  paid_amount        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  balance_amount     DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  placed_at          DATETIME(3)   NULL,
  completed_at       DATETIME(3)   NULL,
  cancelled_at       DATETIME(3)   NULL,
  cancel_reason      VARCHAR(300)  NULL,
  created_by         CHAR(36)      NOT NULL,
  updated_by         CHAR(36)      NULL,
  created_at         DATETIME(3)   NOT NULL,
  updated_at         DATETIME(3)   NOT NULL,
  deleted_at         DATETIME(3)   NULL,
  -- Optimistic concurrency only. Two terminals can hold the same ticket open; the second
  -- write is rejected with STALE_WRITE rather than silently overwriting the first.
  revision           INT UNSIGNED  NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pos_orders_number (order_number),
  UNIQUE KEY uq_pos_orders_daily_sequence (business_date, daily_sequence),
  KEY ix_pos_orders_status (status, business_date),
  KEY ix_pos_orders_type_status (order_type, status),
  KEY ix_pos_orders_business_date (business_date),
  KEY ix_pos_orders_scheduled (scheduled_for),
  KEY ix_pos_orders_entity (entity_id),
  KEY ix_pos_orders_station (station_id),
  KEY ix_pos_orders_counter (counter_id),
  KEY ix_pos_orders_created_by (created_by),
  CONSTRAINT fk_pos_orders_station FOREIGN KEY (station_id) REFERENCES stations (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_pos_orders_counter FOREIGN KEY (counter_id) REFERENCES counters (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_pos_orders_menu FOREIGN KEY (menu_id) REFERENCES menus (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  -- ON UPDATE RESTRICT so `ck_pos_orders_quick_sale_anonymous` below is accepted.
  CONSTRAINT fk_pos_orders_entity FOREIGN KEY (entity_id) REFERENCES entities (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_pos_orders_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_pos_orders_updated_by FOREIGN KEY (updated_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  -- A quick sale is anonymous by definition; naming one means it is not a quick sale.
  CONSTRAINT ck_pos_orders_quick_sale_anonymous
    CHECK (order_type <> 'QUICK_SALE' OR (entity_id IS NULL AND entity_name IS NULL)),
  -- SCHEDULED without a time is not a schedule, it is a lost ticket.
  CONSTRAINT ck_pos_orders_scheduled_has_time
    CHECK (status <> 'SCHEDULED' OR scheduled_for IS NOT NULL)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pos_order_items (
  id                CHAR(36)      NOT NULL,
  pos_order_id      CHAR(36)      NOT NULL,
  -- RESTRICT on both catalogue references, mirroring order_items: a historical sale line
  -- must never be silently orphaned by a menu edit.
  menu_item_id      CHAR(36)      NULL,
  variant_id        CHAR(36)      NULL,
  custom_item_name  VARCHAR(150)  NULL,
  -- Display snapshots, resolved once at ring-up and never re-read from the catalogue.
  item_name         VARCHAR(150)  NOT NULL,
  variant_name      VARCHAR(150)  NULL,
  quantity          DECIMAL(12,3) NOT NULL DEFAULT 1.000,
  unit              VARCHAR(30)   NOT NULL DEFAULT 'NOS',
  unit_price        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  gross_amount      DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  discount_type     ENUM('NONE','PERCENT','AMOUNT') NOT NULL DEFAULT 'NONE',
  discount_value    DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  discount_amount   DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  taxable_amount    DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  tax_profile_id    CHAR(36)      NULL,
  tax_rate          DECIMAL(6,3)  NOT NULL DEFAULT 0.000,
  cgst_amount       DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  sgst_amount       DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  igst_amount       DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  cess_amount       DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  tax_amount        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  line_total        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  notes             VARCHAR(500)  NULL,
  sort_order        INT           NOT NULL DEFAULT 0,
  status            ENUM('ACTIVE','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  cancelled_at      DATETIME(3)   NULL,
  cancelled_by      CHAR(36)      NULL,
  created_at        DATETIME(3)   NOT NULL,
  updated_at        DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_pos_order_items_order (pos_order_id, sort_order),
  KEY ix_pos_order_items_menu_item (menu_item_id),
  KEY ix_pos_order_items_variant (variant_id),
  KEY ix_pos_order_items_tax_profile (tax_profile_id),
  CONSTRAINT fk_pos_order_items_order FOREIGN KEY (pos_order_id) REFERENCES pos_orders (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  -- ON UPDATE RESTRICT so `ck_pos_order_items_dish` below is accepted, as in 008.
  CONSTRAINT fk_pos_order_items_menu_item FOREIGN KEY (menu_item_id) REFERENCES menu_items (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_pos_order_items_variant FOREIGN KEY (variant_id)
    REFERENCES menu_item_variants (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_pos_order_items_tax_profile FOREIGN KEY (tax_profile_id)
    REFERENCES tax_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_pos_order_items_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  -- Exactly one of the two names the dish, same rule as order_items (008).
  CONSTRAINT ck_pos_order_items_dish
    CHECK ((menu_item_id IS NULL) <> (custom_item_name IS NULL))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pos_payments (
  id                CHAR(36)      NOT NULL,
  pos_order_id      CHAR(36)      NOT NULL,
  method            ENUM('CASH','CARD','UPI','WALLET','ACCOUNT','COMPLIMENTARY') NOT NULL,
  -- Signed. A void writes an offsetting negative row rather than deleting or editing the
  -- original, so the payment ledger is append-only and always reconstructable.
  amount            DECIMAL(14,2) NOT NULL,
  tendered_amount   DECIMAL(14,2) NULL,
  change_amount     DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  reference         VARCHAR(120)  NULL,
  notes             VARCHAR(300)  NULL,
  entity_id         CHAR(36)      NULL,
  is_reversal       TINYINT(1)    NOT NULL DEFAULT 0,
  received_by       CHAR(36)      NULL,
  received_at       DATETIME(3)   NOT NULL,
  created_at        DATETIME(3)   NOT NULL,
  updated_at        DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_pos_payments_order (pos_order_id),
  KEY ix_pos_payments_entity (entity_id),
  KEY ix_pos_payments_received (received_at),
  CONSTRAINT fk_pos_payments_order FOREIGN KEY (pos_order_id) REFERENCES pos_orders (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  -- ON UPDATE RESTRICT so `ck_pos_payments_account_named` below is accepted.
  CONSTRAINT fk_pos_payments_entity FOREIGN KEY (entity_id) REFERENCES entities (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_pos_payments_received_by FOREIGN KEY (received_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  -- Charging an account with nobody's name on it would be unrecoverable.
  CONSTRAINT ck_pos_payments_account_named
    CHECK (method <> 'ACCOUNT' OR entity_id IS NOT NULL)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ------------------------------------------------------------------ capabilities

-- 010 moved the role -> capability matrix into the database, so new capabilities must be
-- seeded here as well as declared in shared/src/permissions.
--
-- POS_READ/POS_OPERATE/POS_CHECKOUT sit at USER: a counter operator is an ordinary user, and
-- gating the till behind MANAGER would mean every canteen ran its counter as a manager.
-- ENTITY_WRITE and POS_VOID stay at MANAGER — registering a party into the master and
-- reversing a settled sale are both supervisory acts.
INSERT INTO role_capabilities (role, capability, updated_at) VALUES
  ('USER',        'entity.read',   UTC_TIMESTAMP(3)),
  ('USER',        'pos.read',      UTC_TIMESTAMP(3)),
  ('USER',        'pos.operate',   UTC_TIMESTAMP(3)),
  ('USER',        'pos.checkout',  UTC_TIMESTAMP(3)),

  ('MANAGER',     'entity.read',   UTC_TIMESTAMP(3)),
  ('MANAGER',     'entity.write',  UTC_TIMESTAMP(3)),
  ('MANAGER',     'pos.read',      UTC_TIMESTAMP(3)),
  ('MANAGER',     'pos.operate',   UTC_TIMESTAMP(3)),
  ('MANAGER',     'pos.checkout',  UTC_TIMESTAMP(3)),
  ('MANAGER',     'pos.void',      UTC_TIMESTAMP(3)),

  ('ADMIN',       'entity.read',   UTC_TIMESTAMP(3)),
  ('ADMIN',       'entity.write',  UTC_TIMESTAMP(3)),
  ('ADMIN',       'pos.read',      UTC_TIMESTAMP(3)),
  ('ADMIN',       'pos.operate',   UTC_TIMESTAMP(3)),
  ('ADMIN',       'pos.checkout',  UTC_TIMESTAMP(3)),
  ('ADMIN',       'pos.void',      UTC_TIMESTAMP(3)),

  ('SUPER_ADMIN', 'entity.read',   UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'entity.write',  UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'pos.read',      UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'pos.operate',   UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'pos.checkout',  UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'pos.void',      UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE role = role;
