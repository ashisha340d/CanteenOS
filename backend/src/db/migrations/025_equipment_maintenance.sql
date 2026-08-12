-- MenuBoard 025 — Equipment Monitoring + Maintenance Management
--
-- One module, not two. An equipment record and its maintenance history are the same object
-- seen from two angles, so every maintenance row hangs off `equipment.id` and every ticket
-- resolves its location, supplier and asset id from the equipment rather than restating them.
--
-- Design constraints that shaped the schema, in order of how much they cost:
--
--   Low data entry is architectural.  A field user submits a photograph and (optionally) a
--   sentence. Everything else on the row — asset id, location, supplier, priority, reporter,
--   timestamps — is derived server-side, which is why so many columns here are NOT NULL with
--   a server-computed value rather than a form field. `captured_via` records which path the
--   row came in through, so the module can be measured against its own premise.
--
--   No IoT dependency.  `equipment.status` is a human/workflow column. `telemetry_device_id`
--   is a nullable string and nothing reads it: attaching a sensor later associates a device
--   with an asset without any schema change, and the module works fully with the column null
--   forever. There is deliberately no telemetry table — storing readings nobody consumes yet
--   would be building the abstraction whose obvious purpose is to host a future feature.
--
--   Files are never stored twice.  Photos, documents and voice notes are `media_assets` rows
--   (012), reached by `media_id` and served by the existing signed-URL route. This module adds
--   link tables, not a second blob store. `attachments` (001) is not reused: it is board-scoped
--   and sync-replicated, and equipment belongs to no board.
--
--   Audit stays in one place.  There is no `equipment_audit_logs` table. The global
--   `audit_logs` (001) already records actor, role, action, entity, before/after, ip, user
--   agent and request id, and splitting the trail in two would mean no single query could
--   answer "what did this person change". `maintenance_activities` is a different thing and
--   both exist: it is the operator-facing timeline ("Supplier called", "Photo added"), written
--   for people, while `audit_logs` stays the security record.
--
-- No `revision`/`sync_seq` anywhere below: like tasks (023), entities and POS (022), this
-- module is REST-served to both clients and does not take part in the Android delta-sync
-- engine, which would require a device-side schema change and a change to the sync contract.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ------------------------------------------------------------------ location tree

CREATE TABLE IF NOT EXISTS equipment_floors (
  id           CHAR(36)      NOT NULL,
  code         VARCHAR(40)   NOT NULL,
  name         VARCHAR(120)  NOT NULL,
  -- Ground is 0, basements negative. Sorts the floor switcher without a display_order that
  -- somebody has to keep in step with reality.
  level_index  INT           NOT NULL DEFAULT 0,
  status       ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by   CHAR(36)      NULL,
  created_at   DATETIME(3)   NOT NULL,
  updated_at   DATETIME(3)   NOT NULL,
  deleted_at   DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_equipment_floors_code (code),
  KEY ix_equipment_floors_level (level_index, status),
  CONSTRAINT fk_equipment_floors_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS equipment_areas (
  id            CHAR(36)      NOT NULL,
  floor_id      CHAR(36)      NOT NULL,
  code          VARCHAR(40)   NOT NULL,
  name          VARCHAR(120)  NOT NULL,
  -- The middle segment of every asset id allocated in this area: MTC-KIT-OVN-001.
  asset_segment VARCHAR(4)    NOT NULL,
  sort_order    INT           NOT NULL DEFAULT 0,
  status        ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by    CHAR(36)      NULL,
  created_at    DATETIME(3)   NOT NULL,
  updated_at    DATETIME(3)   NOT NULL,
  deleted_at    DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_equipment_areas_code (code),
  KEY ix_equipment_areas_floor (floor_id, status, sort_order),
  CONSTRAINT fk_equipment_areas_floor FOREIGN KEY (floor_id) REFERENCES equipment_floors (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_areas_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Room, section and physical position are three columns on one row, not three tables. A
-- canteen says "Main Kitchen / Hot Line / Position 3"; modelling that as a recursive tree
-- would add two joins to every equipment read and buy nothing.
CREATE TABLE IF NOT EXISTS equipment_locations (
  id          CHAR(36)      NOT NULL,
  area_id     CHAR(36)      NOT NULL,
  name        VARCHAR(120)  NOT NULL,
  room        VARCHAR(120)  NULL,
  section     VARCHAR(120)  NULL,
  position    VARCHAR(120)  NULL,
  sort_order  INT           NOT NULL DEFAULT 0,
  status      ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by  CHAR(36)      NULL,
  created_at  DATETIME(3)   NOT NULL,
  updated_at  DATETIME(3)   NOT NULL,
  deleted_at  DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY ix_equipment_locations_area (area_id, status, sort_order),
  CONSTRAINT fk_equipment_locations_area FOREIGN KEY (area_id) REFERENCES equipment_areas (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_locations_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ------------------------------------------------------------------- categories

CREATE TABLE IF NOT EXISTS equipment_categories (
  id                     CHAR(36)      NOT NULL,
  code                   VARCHAR(60)   NOT NULL,
  name                   VARCHAR(120)  NOT NULL,
  -- Last segment of the asset id: OVN, MIX, FRZ.
  asset_segment          VARCHAR(4)    NOT NULL,
  description            VARCHAR(1000) NULL,
  -- Seeds the first maintenance schedule at registration so nobody has to think about it.
  -- Null means this category has no manufacturer-recommended interval worth guessing at.
  default_frequency      ENUM('DAILY','WEEKLY','MONTHLY','QUARTERLY','HALF_YEARLY','YEARLY','CUSTOM')
                         NULL,
  default_interval_days  SMALLINT UNSIGNED NULL,
  sort_order             INT           NOT NULL DEFAULT 0,
  status                 ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by             CHAR(36)      NULL,
  created_at             DATETIME(3)   NOT NULL,
  updated_at             DATETIME(3)   NOT NULL,
  deleted_at             DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_equipment_categories_code (code),
  KEY ix_equipment_categories_status (status, sort_order),
  CONSTRAINT fk_equipment_categories_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------------------- suppliers

-- The maintenance supplier master. `entity_id` links to the Entity master (022) when the same
-- company is already a VENDOR there, so a supplier is never entered twice; it stays nullable
-- because an equipment supplier is often a service outfit nobody has ever raised a bill for.
CREATE TABLE IF NOT EXISTS equipment_suppliers (
  id               CHAR(36)      NOT NULL,
  code             VARCHAR(40)   NOT NULL,
  name             VARCHAR(150)  NOT NULL,
  contact_person   VARCHAR(150)  NULL,
  phone            VARCHAR(30)   NULL,
  -- Digits only, E.164 without the '+', which is the form wa.me requires.
  whatsapp         VARCHAR(30)   NULL,
  email            VARCHAR(200)  NULL,
  service_category VARCHAR(150)  NULL,
  service_area     VARCHAR(200)  NULL,
  notes            VARCHAR(1000) NULL,
  entity_id        CHAR(36)      NULL,
  status           ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by       CHAR(36)      NULL,
  created_at       DATETIME(3)   NOT NULL,
  updated_at       DATETIME(3)   NOT NULL,
  deleted_at       DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_equipment_suppliers_code (code),
  KEY ix_equipment_suppliers_status (status, name),
  KEY ix_equipment_suppliers_entity (entity_id),
  CONSTRAINT fk_equipment_suppliers_entity FOREIGN KEY (entity_id) REFERENCES entities (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_suppliers_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_contacts (
  id          CHAR(36)      NOT NULL,
  supplier_id CHAR(36)      NOT NULL,
  name        VARCHAR(150)  NOT NULL,
  role        VARCHAR(120)  NULL,
  phone       VARCHAR(30)   NULL,
  whatsapp    VARCHAR(30)   NULL,
  email       VARCHAR(200)  NULL,
  is_primary  TINYINT(1)    NOT NULL DEFAULT 0,
  created_at  DATETIME(3)   NOT NULL,
  updated_at  DATETIME(3)   NOT NULL,
  deleted_at  DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY ix_supplier_contacts_supplier (supplier_id, is_primary),
  CONSTRAINT fk_supplier_contacts_supplier FOREIGN KEY (supplier_id)
    REFERENCES equipment_suppliers (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Which equipment categories a supplier actually services. Drives "suggested supplier" on a
-- new ticket for an asset that has no supplier of its own configured yet.
CREATE TABLE IF NOT EXISTS supplier_service_categories (
  supplier_id CHAR(36)    NOT NULL,
  category_id CHAR(36)    NOT NULL,
  created_at  DATETIME(3) NOT NULL,
  PRIMARY KEY (supplier_id, category_id),
  KEY ix_supplier_service_categories_category (category_id),
  CONSTRAINT fk_supplier_service_categories_supplier FOREIGN KEY (supplier_id)
    REFERENCES equipment_suppliers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_supplier_service_categories_category FOREIGN KEY (category_id)
    REFERENCES equipment_categories (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------------------- equipment

CREATE TABLE IF NOT EXISTS equipment (
  id                CHAR(36)      NOT NULL,
  -- MTC-KIT-OVN-001. Allocated by the server from the area and category segments; the
  -- numbering scheme itself is configurable through the `settings` table.
  asset_id          VARCHAR(40)   NOT NULL,
  name              VARCHAR(150)  NOT NULL,
  equipment_type    VARCHAR(120)  NULL,
  brand             VARCHAR(120)  NULL,
  model             VARCHAR(120)  NULL,
  serial_number     VARCHAR(120)  NULL,
  manufacturer      VARCHAR(150)  NULL,
  category_id       CHAR(36)      NULL,
  location_id       CHAR(36)      NULL,

  status            ENUM('OPERATIONAL','RUNNING','IDLE','NEEDS_ATTENTION','PROBLEM',
                         'UNDER_MAINTENANCE','OUT_OF_SERVICE','RETIRED')
                    NOT NULL DEFAULT 'OPERATIONAL',
  status_note       VARCHAR(500)  NULL,
  status_changed_at DATETIME(3)   NULL,

  -- Primary photograph, in the shared media library. Never a second copy of the file.
  image_media_id    CHAR(36)      NULL,
  -- Whatever was legible on the plate. JSON because equipment plates are not standardised
  -- and a column per possible specification would be mostly-null forever.
  specifications    LONGTEXT      NULL CHECK (specifications IS NULL OR JSON_VALID(specifications)),

  purchase_date     DATE          NULL,
  installation_date DATE          NULL,
  purchase_price    DECIMAL(14,2) NULL,
  invoice_number    VARCHAR(80)   NULL,
  -- Free text as printed on the bill. The structured link is `equipment_supplier_links`.
  supplier_name     VARCHAR(150)  NULL,

  -- Denormalised from the active warranty row so list queries do not join to compute a badge.
  -- Warranty *status* is never stored: it is derived from this date on every read.
  warranty_expiry   DATE          NULL,

  -- Both maintained by the maintenance workflow, never edited by hand. `next_maintenance_at`
  -- is the earliest due date across the asset's active schedules.
  last_maintenance_at DATE        NULL,
  next_maintenance_at DATE        NULL,

  -- Kept in step by the ticket workflow inside the same transaction as the ticket change, so
  -- the equipment list can rank by "most broken" without a correlated subquery per row.
  open_ticket_count     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  critical_ticket_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,

  qr_code           VARCHAR(120)  NULL,
  nfc_tag_id        VARCHAR(120)  NULL,
  -- Optional, and nothing reads it. Present so a sensor can be associated with an asset later
  -- without a schema change; see the header note on IoT.
  telemetry_device_id VARCHAR(120) NULL,

  notes             VARCHAR(2000) NULL,
  -- How the record was created. PHOTO_AI is the intended path; MANUAL is the fallback.
  captured_via      ENUM('PHOTO_AI','VOICE','QR_SCAN','NFC','DOCUMENT_OCR','MANUAL','SYSTEM')
                    NOT NULL DEFAULT 'MANUAL',
  created_by        CHAR(36)      NULL,
  created_at        DATETIME(3)   NOT NULL,
  updated_at        DATETIME(3)   NOT NULL,
  deleted_at        DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_equipment_asset_id (asset_id),
  UNIQUE KEY uq_equipment_qr_code (qr_code),
  KEY ix_equipment_status (status, deleted_at),
  KEY ix_equipment_category (category_id, status),
  KEY ix_equipment_location (location_id, status),
  KEY ix_equipment_next_maintenance (next_maintenance_at),
  KEY ix_equipment_warranty (warranty_expiry),
  KEY ix_equipment_open_tickets (open_ticket_count, critical_ticket_count),
  KEY ix_equipment_serial (serial_number),
  KEY ix_equipment_name (name),
  CONSTRAINT fk_equipment_category FOREIGN KEY (category_id)
    REFERENCES equipment_categories (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_location FOREIGN KEY (location_id)
    REFERENCES equipment_locations (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_image FOREIGN KEY (image_media_id) REFERENCES media_assets (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- An asset's supplier in a given role. Three rows maximum per asset, one per role, enforced
-- by the unique key rather than by three nullable columns on `equipment` — a supplier that is
-- deleted must not leave a dangling id on the asset.
CREATE TABLE IF NOT EXISTS equipment_supplier_links (
  id           CHAR(36)      NOT NULL,
  equipment_id CHAR(36)      NOT NULL,
  supplier_id  CHAR(36)      NOT NULL,
  role         ENUM('PRIMARY','MAINTENANCE','ALTERNATIVE') NOT NULL DEFAULT 'PRIMARY',
  -- The one a Call/WhatsApp button reaches when the user does not pick. At most one TRUE per
  -- asset, enforced in the service layer inside the transaction that sets it.
  is_default   TINYINT(1)    NOT NULL DEFAULT 0,
  created_by   CHAR(36)      NULL,
  created_at   DATETIME(3)   NOT NULL,
  updated_at   DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_equipment_supplier_links_role (equipment_id, role),
  KEY ix_equipment_supplier_links_supplier (supplier_id),
  CONSTRAINT fk_equipment_supplier_links_equipment FOREIGN KEY (equipment_id)
    REFERENCES equipment (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_supplier_links_supplier FOREIGN KEY (supplier_id)
    REFERENCES equipment_suppliers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_supplier_links_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS equipment_documents (
  id           CHAR(36)      NOT NULL,
  equipment_id CHAR(36)      NOT NULL,
  media_id     CHAR(36)      NOT NULL,
  doc_type     ENUM('WARRANTY','INVOICE','PURCHASE_BILL','INSTALLATION','SERVICE_REPORT',
                    'MAINTENANCE_INVOICE','MANUAL','CERTIFICATE','PHOTO','OTHER')
               NOT NULL DEFAULT 'OTHER',
  title        VARCHAR(200)  NULL,
  -- What OCR read, as confirmed or corrected by the uploader. Kept on the document rather
  -- than only folded into `equipment` so a wrong extraction can always be traced to its page.
  extracted    LONGTEXT      NULL CHECK (extracted IS NULL OR JSON_VALID(extracted)),
  uploaded_by  CHAR(36)      NOT NULL,
  created_at   DATETIME(3)   NOT NULL,
  updated_at   DATETIME(3)   NOT NULL,
  deleted_at   DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY ix_equipment_documents_equipment (equipment_id, doc_type, deleted_at),
  KEY ix_equipment_documents_media (media_id),
  CONSTRAINT fk_equipment_documents_equipment FOREIGN KEY (equipment_id)
    REFERENCES equipment (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_documents_media FOREIGN KEY (media_id) REFERENCES media_assets (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_documents_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- A warranty is its own row, not three columns on `equipment`, because equipment routinely
-- carries more than one (manufacturer 1 year + extended 2 years) and because the expiry that
-- matters is the latest active one, which is a query, not a field somebody maintains.
CREATE TABLE IF NOT EXISTS equipment_warranties (
  id            CHAR(36)      NOT NULL,
  equipment_id  CHAR(36)      NOT NULL,
  provider      VARCHAR(150)  NULL,
  policy_number VARCHAR(80)   NULL,
  start_date    DATE          NULL,
  expiry_date   DATE          NULL,
  months        SMALLINT UNSIGNED NULL,
  terms         VARCHAR(1000) NULL,
  document_id   CHAR(36)      NULL,
  is_active     TINYINT(1)    NOT NULL DEFAULT 1,
  created_by    CHAR(36)      NULL,
  created_at    DATETIME(3)   NOT NULL,
  updated_at    DATETIME(3)   NOT NULL,
  deleted_at    DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY ix_equipment_warranties_equipment (equipment_id, is_active, expiry_date),
  CONSTRAINT fk_equipment_warranties_equipment FOREIGN KEY (equipment_id)
    REFERENCES equipment (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_warranties_document FOREIGN KEY (document_id)
    REFERENCES equipment_documents (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_warranties_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ------------------------------------------------------------------- floor plans

CREATE TABLE IF NOT EXISTS floor_plans (
  id          CHAR(36)      NOT NULL,
  floor_id    CHAR(36)      NOT NULL,
  name        VARCHAR(120)  NOT NULL,
  media_id    CHAR(36)      NOT NULL,
  width       INT UNSIGNED  NULL,
  height      INT UNSIGNED  NULL,
  -- One active plan per floor; older uploads stay as history rather than being deleted.
  is_active   TINYINT(1)    NOT NULL DEFAULT 1,
  uploaded_by CHAR(36)      NULL,
  created_at  DATETIME(3)   NOT NULL,
  updated_at  DATETIME(3)   NOT NULL,
  deleted_at  DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY ix_floor_plans_floor (floor_id, is_active, deleted_at),
  CONSTRAINT fk_floor_plans_floor FOREIGN KEY (floor_id) REFERENCES equipment_floors (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_floor_plans_media FOREIGN KEY (media_id) REFERENCES media_assets (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_floor_plans_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Coordinates are fractions of the image (0..1), never pixels: the same pin renders correctly
-- on a phone, on a 4K monitor, and after somebody re-uploads the plan at a different size.
CREATE TABLE IF NOT EXISTS floor_plan_equipment_positions (
  id            CHAR(36)      NOT NULL,
  floor_plan_id CHAR(36)      NOT NULL,
  equipment_id  CHAR(36)      NOT NULL,
  x             DECIMAL(6,5)  NOT NULL,
  y             DECIMAL(6,5)  NOT NULL,
  placed_by     CHAR(36)      NULL,
  created_at    DATETIME(3)   NOT NULL,
  updated_at    DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  -- An asset appears at most once on a given plan, and (in practice) on one plan at a time.
  UNIQUE KEY uq_floor_plan_positions (floor_plan_id, equipment_id),
  KEY ix_floor_plan_positions_equipment (equipment_id),
  CONSTRAINT fk_floor_plan_positions_plan FOREIGN KEY (floor_plan_id) REFERENCES floor_plans (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_floor_plan_positions_equipment FOREIGN KEY (equipment_id) REFERENCES equipment (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_floor_plan_positions_placed_by FOREIGN KEY (placed_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT ck_floor_plan_positions_bounds CHECK (x >= 0 AND x <= 1 AND y >= 0 AND y <= 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------- maintenance schedules

CREATE TABLE IF NOT EXISTS maintenance_schedules (
  id                CHAR(36)      NOT NULL,
  equipment_id      CHAR(36)      NOT NULL,
  title             VARCHAR(200)  NOT NULL,
  frequency         ENUM('DAILY','WEEKLY','MONTHLY','QUARTERLY','HALF_YEARLY','YEARLY','CUSTOM')
                    NOT NULL DEFAULT 'MONTHLY',
  -- Only consulted for CUSTOM; the other frequencies carry their own day count in code.
  interval_days     SMALLINT UNSIGNED NULL,
  -- What the clock started from: installation date, purchase date, or the day it was created.
  anchor_date       DATE          NOT NULL,
  last_performed_at DATE          NULL,
  next_due_at       DATE          NOT NULL,
  reminder_days     SMALLINT UNSIGNED NOT NULL DEFAULT 7,
  assigned_to       CHAR(36)      NULL,
  supplier_id       CHAR(36)      NULL,
  instructions      VARCHAR(2000) NULL,
  is_active         TINYINT(1)    NOT NULL DEFAULT 1,
  created_by        CHAR(36)      NULL,
  created_at        DATETIME(3)   NOT NULL,
  updated_at        DATETIME(3)   NOT NULL,
  deleted_at        DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY ix_maintenance_schedules_equipment (equipment_id, is_active),
  KEY ix_maintenance_schedules_due (next_due_at, is_active, deleted_at),
  KEY ix_maintenance_schedules_assignee (assigned_to, next_due_at),
  CONSTRAINT fk_maintenance_schedules_equipment FOREIGN KEY (equipment_id)
    REFERENCES equipment (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_maintenance_schedules_assignee FOREIGN KEY (assigned_to) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_maintenance_schedules_supplier FOREIGN KEY (supplier_id)
    REFERENCES equipment_suppliers (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_maintenance_schedules_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ----------------------------------------------------------- maintenance tickets

CREATE TABLE IF NOT EXISTS maintenance_tickets (
  id               CHAR(36)      NOT NULL,
  -- MTK-YYYYMMDD-NNNN. Server-sequential like a POS bill number rather than device-generated
  -- like an order number: a ticket is raised online and is quoted to a supplier over the
  -- phone, so it must be short, countable and unambiguous.
  ticket_number    VARCHAR(30)   NOT NULL,
  business_date    DATE          NOT NULL,
  daily_sequence   INT UNSIGNED  NOT NULL,
  equipment_id     CHAR(36)      NOT NULL,
  kind             ENUM('PROBLEM','FAULT','MAINTENANCE','INSPECTION','SCHEDULED')
                   NOT NULL DEFAULT 'PROBLEM',
  status           ENUM('REPORTED','ACKNOWLEDGED','ASSIGNED','SUPPLIER_CONTACTED',
                        'TECHNICIAN_SCHEDULED','UNDER_MAINTENANCE','WAITING_FOR_PARTS',
                        'RESOLVED','VERIFIED','CLOSED','CANCELLED')
                   NOT NULL DEFAULT 'REPORTED',
  priority         ENUM('LOW','NORMAL','HIGH','CRITICAL') NOT NULL DEFAULT 'NORMAL',
  title            VARCHAR(200)  NOT NULL,
  description      VARCHAR(2000) NULL,
  problem_category ENUM('NOT_WORKING','ABNORMAL_NOISE','TEMPERATURE','LEAKAGE','ELECTRICAL',
                        'PHYSICAL_DAMAGE','PERFORMANCE','CLEANING','SAFETY','OTHER') NULL,

  reported_by      CHAR(36)      NOT NULL,
  reported_at      DATETIME(3)   NOT NULL,
  acknowledged_at  DATETIME(3)   NULL,
  assigned_to      CHAR(36)      NULL,
  supplier_id      CHAR(36)      NULL,
  scheduled_at     DATETIME(3)   NULL,
  resolved_at      DATETIME(3)   NULL,
  verified_at      DATETIME(3)   NULL,
  closed_at        DATETIME(3)   NULL,
  resolution_notes VARCHAR(2000) NULL,
  parts_required   VARCHAR(1000) NULL,
  cost_amount      DECIMAL(14,2) NULL,
  -- Set when the scheduler raised this ticket, so completing it advances that schedule.
  schedule_id      CHAR(36)      NULL,
  captured_via     ENUM('PHOTO_AI','VOICE','QR_SCAN','NFC','DOCUMENT_OCR','MANUAL','SYSTEM')
                   NOT NULL DEFAULT 'MANUAL',
  created_at       DATETIME(3)   NOT NULL,
  updated_at       DATETIME(3)   NOT NULL,
  deleted_at       DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_maintenance_tickets_number (ticket_number),
  UNIQUE KEY uq_maintenance_tickets_daily (business_date, daily_sequence),
  KEY ix_maintenance_tickets_equipment (equipment_id, status),
  KEY ix_maintenance_tickets_status (status, priority, reported_at),
  KEY ix_maintenance_tickets_assignee (assigned_to, status),
  KEY ix_maintenance_tickets_supplier (supplier_id, status),
  KEY ix_maintenance_tickets_reporter (reported_by, reported_at),
  KEY ix_maintenance_tickets_schedule (schedule_id),
  CONSTRAINT fk_maintenance_tickets_equipment FOREIGN KEY (equipment_id)
    REFERENCES equipment (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_maintenance_tickets_reporter FOREIGN KEY (reported_by) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_maintenance_tickets_assignee FOREIGN KEY (assigned_to) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_maintenance_tickets_supplier FOREIGN KEY (supplier_id)
    REFERENCES equipment_suppliers (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_maintenance_tickets_schedule FOREIGN KEY (schedule_id)
    REFERENCES maintenance_schedules (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- What was reported, kept separate from the ticket so the AI's suggestion and the human's
-- confirmation are both on the record. A ticket normally has exactly one; a technician who
-- finds a second fault while on site adds another rather than overwriting the first.
CREATE TABLE IF NOT EXISTS maintenance_problems (
  id                    CHAR(36)      NOT NULL,
  ticket_id             CHAR(36)      NOT NULL,
  category              ENUM('NOT_WORKING','ABNORMAL_NOISE','TEMPERATURE','LEAKAGE','ELECTRICAL',
                             'PHYSICAL_DAMAGE','PERFORMANCE','CLEANING','SAFETY','OTHER')
                        NOT NULL DEFAULT 'OTHER',
  description           VARCHAR(2000) NULL,
  ai_suggested_category ENUM('NOT_WORKING','ABNORMAL_NOISE','TEMPERATURE','LEAKAGE','ELECTRICAL',
                             'PHYSICAL_DAMAGE','PERFORMANCE','CLEANING','SAFETY','OTHER') NULL,
  ai_confidence         DECIMAL(4,3)  NULL,
  -- FALSE only for a category the system inferred and nobody has looked at yet.
  confirmed_by_user     TINYINT(1)    NOT NULL DEFAULT 1,
  created_by            CHAR(36)      NULL,
  created_at            DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_maintenance_problems_ticket (ticket_id),
  CONSTRAINT fk_maintenance_problems_ticket FOREIGN KEY (ticket_id)
    REFERENCES maintenance_tickets (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_maintenance_problems_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS maintenance_attachments (
  id          CHAR(36)      NOT NULL,
  ticket_id   CHAR(36)      NOT NULL,
  media_id    CHAR(36)      NOT NULL,
  kind        ENUM('PHOTO','VIDEO','VOICE','DOCUMENT') NOT NULL DEFAULT 'PHOTO',
  -- Speech-to-text for a voice note, or the vision model's reading of a photo. Editable by
  -- the author: a transcript nobody can correct is worse than no transcript.
  transcript  VARCHAR(4000) NULL,
  uploaded_by CHAR(36)      NOT NULL,
  created_at  DATETIME(3)   NOT NULL,
  updated_at  DATETIME(3)   NOT NULL,
  deleted_at  DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY ix_maintenance_attachments_ticket (ticket_id, kind, deleted_at),
  KEY ix_maintenance_attachments_media (media_id),
  CONSTRAINT fk_maintenance_attachments_ticket FOREIGN KEY (ticket_id)
    REFERENCES maintenance_tickets (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_maintenance_attachments_media FOREIGN KEY (media_id) REFERENCES media_assets (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_maintenance_attachments_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Assignment history, not the current assignee: `maintenance_tickets.assigned_to` holds that.
-- A ticket handed from an in-house electrician to the supplier and then to their technician
-- keeps all three rows, with `is_active` marking the current one.
CREATE TABLE IF NOT EXISTS maintenance_assignments (
  id               CHAR(36)      NOT NULL,
  ticket_id        CHAR(36)      NOT NULL,
  assigned_to      CHAR(36)      NULL,
  supplier_id      CHAR(36)      NULL,
  technician_name  VARCHAR(150)  NULL,
  technician_phone VARCHAR(30)   NULL,
  scheduled_at     DATETIME(3)   NULL,
  completed_at     DATETIME(3)   NULL,
  notes            VARCHAR(1000) NULL,
  assigned_by      CHAR(36)      NULL,
  is_active        TINYINT(1)    NOT NULL DEFAULT 1,
  created_at       DATETIME(3)   NOT NULL,
  updated_at       DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_maintenance_assignments_ticket (ticket_id, is_active),
  KEY ix_maintenance_assignments_assignee (assigned_to, is_active),
  KEY ix_maintenance_assignments_supplier (supplier_id),
  CONSTRAINT fk_maintenance_assignments_ticket FOREIGN KEY (ticket_id)
    REFERENCES maintenance_tickets (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_maintenance_assignments_assignee FOREIGN KEY (assigned_to) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_maintenance_assignments_supplier FOREIGN KEY (supplier_id)
    REFERENCES equipment_suppliers (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_maintenance_assignments_assigned_by FOREIGN KEY (assigned_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- The operator-facing timeline. Always written by the service that caused the event, in the
-- same transaction, so an activity row can never describe something that did not commit.
-- `summary` is prose written at write time rather than composed by each client, so the phone
-- and the portal can never word the same event differently.
CREATE TABLE IF NOT EXISTS maintenance_activities (
  id           CHAR(36)      NOT NULL,
  equipment_id CHAR(36)      NOT NULL,
  ticket_id    CHAR(36)      NULL,
  type         ENUM('EQUIPMENT_REGISTERED','EQUIPMENT_UPDATED','STATUS_CHANGED','LOCATION_CHANGED',
                    'DOCUMENT_UPLOADED','WARRANTY_RECORDED','SCHEDULE_CREATED','SCHEDULE_UPDATED',
                    'PROBLEM_REPORTED','TICKET_STATUS_CHANGED','ATTACHMENT_ADDED','NOTE_ADDED',
                    'SUPPLIER_CONTACTED','CALL_MADE','WHATSAPP_SENT','TECHNICIAN_ASSIGNED',
                    'TECHNICIAN_VISIT','PARTS_REQUIRED','PARTS_REPLACED','MAINTENANCE_COMPLETED',
                    'PROBLEM_RESOLVED','TICKET_VERIFIED','TICKET_CLOSED')
               NOT NULL,
  summary      VARCHAR(300)  NOT NULL,
  detail       VARCHAR(2000) NULL,
  metadata     LONGTEXT      NULL CHECK (metadata IS NULL OR JSON_VALID(metadata)),
  actor_id     CHAR(36)      NULL,
  actor_role   VARCHAR(20)   NULL,
  source       ENUM('PHOTO_AI','VOICE','QR_SCAN','NFC','DOCUMENT_OCR','MANUAL','SYSTEM')
               NOT NULL DEFAULT 'MANUAL',
  created_at   DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_maintenance_activities_equipment (equipment_id, created_at),
  KEY ix_maintenance_activities_ticket (ticket_id, created_at),
  KEY ix_maintenance_activities_type (type, created_at),
  CONSTRAINT fk_maintenance_activities_equipment FOREIGN KEY (equipment_id)
    REFERENCES equipment (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_maintenance_activities_ticket FOREIGN KEY (ticket_id)
    REFERENCES maintenance_tickets (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_maintenance_activities_actor FOREIGN KEY (actor_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ------------------------------------------------------------------- history logs

CREATE TABLE IF NOT EXISTS equipment_status_history (
  id           CHAR(36)      NOT NULL,
  equipment_id CHAR(36)      NOT NULL,
  from_status  ENUM('OPERATIONAL','RUNNING','IDLE','NEEDS_ATTENTION','PROBLEM',
                    'UNDER_MAINTENANCE','OUT_OF_SERVICE','RETIRED') NULL,
  to_status    ENUM('OPERATIONAL','RUNNING','IDLE','NEEDS_ATTENTION','PROBLEM',
                    'UNDER_MAINTENANCE','OUT_OF_SERVICE','RETIRED') NOT NULL,
  note         VARCHAR(500)  NULL,
  ticket_id    CHAR(36)      NULL,
  changed_by   CHAR(36)      NULL,
  created_at   DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_equipment_status_history_equipment (equipment_id, created_at),
  CONSTRAINT fk_equipment_status_history_equipment FOREIGN KEY (equipment_id)
    REFERENCES equipment (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_status_history_ticket FOREIGN KEY (ticket_id)
    REFERENCES maintenance_tickets (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_status_history_changed_by FOREIGN KEY (changed_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS equipment_location_history (
  id               CHAR(36)      NOT NULL,
  equipment_id     CHAR(36)      NOT NULL,
  from_location_id CHAR(36)      NULL,
  to_location_id   CHAR(36)      NULL,
  -- The path as it read at the time. Kept as text because renaming an area later must not
  -- rewrite what the history says happened.
  from_path        VARCHAR(400)  NULL,
  to_path          VARCHAR(400)  NULL,
  note             VARCHAR(500)  NULL,
  moved_by         CHAR(36)      NULL,
  created_at       DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_equipment_location_history_equipment (equipment_id, created_at),
  CONSTRAINT fk_equipment_location_history_equipment FOREIGN KEY (equipment_id)
    REFERENCES equipment (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_location_history_from FOREIGN KEY (from_location_id)
    REFERENCES equipment_locations (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_location_history_to FOREIGN KEY (to_location_id)
    REFERENCES equipment_locations (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_location_history_moved_by FOREIGN KEY (moved_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Written when the dialer is opened, not when the call ends: Android exposes no reliable
-- "call finished" signal without READ_CALL_LOG, which this product does not request. `status`
-- therefore starts DIALLED and `outcome` is filled by the one tap the user makes afterwards.
CREATE TABLE IF NOT EXISTS equipment_call_logs (
  id               CHAR(36)      NOT NULL,
  equipment_id     CHAR(36)      NOT NULL,
  ticket_id        CHAR(36)      NULL,
  supplier_id      CHAR(36)      NULL,
  contact_id       CHAR(36)      NULL,
  phone_number     VARCHAR(30)   NOT NULL,
  called_by        CHAR(36)      NOT NULL,
  called_at        DATETIME(3)   NOT NULL,
  status           ENUM('UNKNOWN','DIALLED','CONNECTED','MISSED','FAILED') NOT NULL DEFAULT 'DIALLED',
  outcome          ENUM('RESOLVED','TECHNICIAN_SCHEDULED','PARTS_REQUIRED','FOLLOW_UP_REQUIRED',
                        'NO_ANSWER','OTHER') NULL,
  duration_seconds INT UNSIGNED  NULL,
  notes            VARCHAR(1000) NULL,
  created_at       DATETIME(3)   NOT NULL,
  updated_at       DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_equipment_call_logs_equipment (equipment_id, called_at),
  KEY ix_equipment_call_logs_ticket (ticket_id),
  KEY ix_equipment_call_logs_supplier (supplier_id, called_at),
  KEY ix_equipment_call_logs_outcome (outcome, called_at),
  CONSTRAINT fk_equipment_call_logs_equipment FOREIGN KEY (equipment_id) REFERENCES equipment (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_call_logs_ticket FOREIGN KEY (ticket_id)
    REFERENCES maintenance_tickets (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_call_logs_supplier FOREIGN KEY (supplier_id)
    REFERENCES equipment_suppliers (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_call_logs_contact FOREIGN KEY (contact_id)
    REFERENCES supplier_contacts (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_call_logs_called_by FOREIGN KEY (called_by) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- The message body is stored because it is generated, not typed: when a supplier says "your
-- message didn't say which oven", the record shows exactly what was sent.
CREATE TABLE IF NOT EXISTS equipment_whatsapp_logs (
  id           CHAR(36)      NOT NULL,
  equipment_id CHAR(36)      NOT NULL,
  ticket_id    CHAR(36)      NULL,
  supplier_id  CHAR(36)      NULL,
  phone_number VARCHAR(30)   NOT NULL,
  message      VARCHAR(4000) NOT NULL,
  -- Media ids referenced in the message, as a JSON array. Signed URLs are minted per read and
  -- never stored: a stored URL would expire and mislead.
  media_ids    LONGTEXT      NULL CHECK (media_ids IS NULL OR JSON_VALID(media_ids)),
  sent_by      CHAR(36)      NOT NULL,
  sent_at      DATETIME(3)   NOT NULL,
  created_at   DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_equipment_whatsapp_logs_equipment (equipment_id, sent_at),
  KEY ix_equipment_whatsapp_logs_ticket (ticket_id),
  KEY ix_equipment_whatsapp_logs_supplier (supplier_id, sent_at),
  CONSTRAINT fk_equipment_whatsapp_logs_equipment FOREIGN KEY (equipment_id)
    REFERENCES equipment (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_whatsapp_logs_ticket FOREIGN KEY (ticket_id)
    REFERENCES maintenance_tickets (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_whatsapp_logs_supplier FOREIGN KEY (supplier_id)
    REFERENCES equipment_suppliers (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_equipment_whatsapp_logs_sent_by FOREIGN KEY (sent_by) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ------------------------------------------------------------------ notifications

-- Maintenance raises its own notification kinds. Extending the existing enum keeps one inbox
-- and one delivery path (in-app + push) rather than a parallel notification system.
ALTER TABLE notifications
  MODIFY type ENUM('NEW_ORDER','MENTION','THREAD_REPLY','ACKNOWLEDGEMENT','STATUS_CHANGED',
                   'BOARD_INVITATION','ALERT','MAINTENANCE_DUE','MAINTENANCE_OVERDUE',
                   'MAINTENANCE_CRITICAL','MAINTENANCE_REPORTED','MAINTENANCE_ASSIGNED',
                   'MAINTENANCE_COMPLETED','EQUIPMENT_OUT_OF_SERVICE','WARRANTY_EXPIRING',
                   'SUPPLIER_FOLLOW_UP') NOT NULL;

-- ------------------------------------------------------------------- capabilities

-- 010 moved the role -> capability matrix into the database, so new capabilities are seeded
-- here as well as declared in shared/src/permissions. The grants below mirror that file
-- exactly: reporting a problem reaches all the way down to Employee (whoever is standing in
-- front of the broken machine must be able to report it), while registering, assigning,
-- scheduling and supplier maintenance start at Manager, and deletion at Admin.
INSERT INTO role_capabilities (role, capability, updated_at) VALUES
  ('EMPLOYEE',    'equipment.view',             UTC_TIMESTAMP(3)),
  ('EMPLOYEE',    'equipment.report_problem',   UTC_TIMESTAMP(3)),
  ('EMPLOYEE',    'maintenance.view',           UTC_TIMESTAMP(3)),
  ('EMPLOYEE',    'maintenance.create',         UTC_TIMESTAMP(3)),

  ('USER',        'equipment.view',             UTC_TIMESTAMP(3)),
  ('USER',        'equipment.report_problem',   UTC_TIMESTAMP(3)),
  ('USER',        'equipment.upload_document',  UTC_TIMESTAMP(3)),
  ('USER',        'maintenance.view',           UTC_TIMESTAMP(3)),
  ('USER',        'maintenance.create',         UTC_TIMESTAMP(3)),
  ('USER',        'supplier.view',              UTC_TIMESTAMP(3)),
  ('USER',        'supplier.contact',           UTC_TIMESTAMP(3)),

  ('MANAGER',     'equipment.view',             UTC_TIMESTAMP(3)),
  ('MANAGER',     'equipment.report_problem',   UTC_TIMESTAMP(3)),
  ('MANAGER',     'equipment.upload_document',  UTC_TIMESTAMP(3)),
  ('MANAGER',     'equipment.create',           UTC_TIMESTAMP(3)),
  ('MANAGER',     'equipment.edit',             UTC_TIMESTAMP(3)),
  ('MANAGER',     'equipment.manage_location',  UTC_TIMESTAMP(3)),
  ('MANAGER',     'equipment.manage_floorplan', UTC_TIMESTAMP(3)),
  ('MANAGER',     'maintenance.view',           UTC_TIMESTAMP(3)),
  ('MANAGER',     'maintenance.create',         UTC_TIMESTAMP(3)),
  ('MANAGER',     'maintenance.assign',         UTC_TIMESTAMP(3)),
  ('MANAGER',     'maintenance.approve',        UTC_TIMESTAMP(3)),
  ('MANAGER',     'maintenance.close',          UTC_TIMESTAMP(3)),
  ('MANAGER',     'maintenance.schedule',       UTC_TIMESTAMP(3)),
  ('MANAGER',     'supplier.view',              UTC_TIMESTAMP(3)),
  ('MANAGER',     'supplier.contact',           UTC_TIMESTAMP(3)),
  ('MANAGER',     'supplier.manage',            UTC_TIMESTAMP(3)),

  ('ADMIN',       'equipment.view',             UTC_TIMESTAMP(3)),
  ('ADMIN',       'equipment.report_problem',   UTC_TIMESTAMP(3)),
  ('ADMIN',       'equipment.upload_document',  UTC_TIMESTAMP(3)),
  ('ADMIN',       'equipment.create',           UTC_TIMESTAMP(3)),
  ('ADMIN',       'equipment.edit',             UTC_TIMESTAMP(3)),
  ('ADMIN',       'equipment.delete',           UTC_TIMESTAMP(3)),
  ('ADMIN',       'equipment.manage_location',  UTC_TIMESTAMP(3)),
  ('ADMIN',       'equipment.manage_floorplan', UTC_TIMESTAMP(3)),
  ('ADMIN',       'maintenance.view',           UTC_TIMESTAMP(3)),
  ('ADMIN',       'maintenance.create',         UTC_TIMESTAMP(3)),
  ('ADMIN',       'maintenance.assign',         UTC_TIMESTAMP(3)),
  ('ADMIN',       'maintenance.approve',        UTC_TIMESTAMP(3)),
  ('ADMIN',       'maintenance.close',          UTC_TIMESTAMP(3)),
  ('ADMIN',       'maintenance.schedule',       UTC_TIMESTAMP(3)),
  ('ADMIN',       'maintenance.delete',         UTC_TIMESTAMP(3)),
  ('ADMIN',       'supplier.view',              UTC_TIMESTAMP(3)),
  ('ADMIN',       'supplier.contact',           UTC_TIMESTAMP(3)),
  ('ADMIN',       'supplier.manage',            UTC_TIMESTAMP(3)),

  ('SUPER_ADMIN', 'equipment.view',             UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'equipment.report_problem',   UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'equipment.upload_document',  UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'equipment.create',           UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'equipment.edit',             UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'equipment.delete',           UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'equipment.manage_location',  UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'equipment.manage_floorplan', UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'maintenance.view',           UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'maintenance.create',         UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'maintenance.assign',         UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'maintenance.approve',        UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'maintenance.close',          UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'maintenance.schedule',       UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'maintenance.delete',         UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'supplier.view',              UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'supplier.contact',           UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'supplier.manage',            UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE role = role;

-- ----------------------------------------------------------------- reference data

-- Equipment categories for a bakery/cafe/restaurant/QSR line. Seeded rather than left empty
-- because the asset-id scheme needs a category segment on the very first registration, and
-- asking a user to invent "OVN" before they can photograph an oven defeats the whole design.
-- Ordinary rows: rename, deactivate or add to them freely.
INSERT INTO equipment_categories
  (id, code, name, asset_segment, description, default_frequency, sort_order, status,
   created_at, updated_at)
VALUES
  (UUID(), 'OVEN',        'Oven',                'OVN', 'Deck, rack, convection and combi ovens',      'MONTHLY',   10, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  (UUID(), 'MIXER',       'Mixer',               'MIX', 'Spiral, planetary and dough mixers',          'MONTHLY',   20, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  (UUID(), 'FREEZER',     'Freezer',             'FRZ', 'Deep freezers and blast freezers',            'QUARTERLY', 30, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  (UUID(), 'REFRIGERATOR','Refrigerator',        'REF', 'Chillers, under-counter and display fridges', 'QUARTERLY', 40, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  (UUID(), 'PROOFER',     'Proofer',             'PRF', 'Proofing and retarder cabinets',              'MONTHLY',   50, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  (UUID(), 'COFFEE',      'Coffee Machine',      'COF', 'Espresso machines and grinders',              'MONTHLY',   60, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  (UUID(), 'FRYER',       'Fryer',               'FRY', 'Deep fryers and pressure fryers',             'WEEKLY',    70, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  (UUID(), 'GRILL',       'Grill / Griddle',     'GRL', 'Griddles, salamanders and char grills',       'MONTHLY',   80, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  (UUID(), 'RANGE',       'Cooking Range',       'RNG', 'Burners, ranges and stock pot stoves',        'MONTHLY',   90, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  (UUID(), 'DISHWASHER',  'Dishwasher',          'DSH', 'Hood-type and conveyor dishwashers',          'MONTHLY',  100, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  (UUID(), 'SLICER',      'Slicer / Cutter',     'SLC', 'Bread slicers, dough dividers and cutters',   'MONTHLY',  110, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  (UUID(), 'DISPLAY',     'Display Counter',     'DSP', 'Hot and cold display counters',               'QUARTERLY',120, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  (UUID(), 'EXHAUST',     'Exhaust / Ventilation','EXH','Hoods, ducting and exhaust fans',             'QUARTERLY',130, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  (UUID(), 'WATER',       'Water System',        'WTR', 'RO plants, water heaters and softeners',      'QUARTERLY',140, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  (UUID(), 'GAS',         'Gas System',          'GAS', 'Gas banks, manifolds and leak detectors',     'QUARTERLY',150, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  (UUID(), 'ELECTRICAL',  'Electrical',          'ELC', 'Panels, stabilisers and inverters',           'HALF_YEARLY',160,'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  (UUID(), 'SAFETY',      'Safety Equipment',    'SFY', 'Extinguishers, suppression and alarms',       'YEARLY',   170, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  (UUID(), 'OTHER',       'Other Equipment',     'GEN', 'Anything without a dedicated category',       NULL,       900, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE code = code;

-- A ground floor with one kitchen area, so the very first "Add Equipment" has somewhere to
-- put the thing. Both are ordinary rows and can be renamed or replaced.
INSERT INTO equipment_floors (id, code, name, level_index, status, created_at, updated_at)
VALUES (UUID(), 'GF', 'Ground Floor', 0, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE code = code;

INSERT INTO equipment_areas (id, floor_id, code, name, asset_segment, sort_order, status, created_at, updated_at)
SELECT UUID(), f.id, 'KITCHEN', 'Main Kitchen', 'KIT', 10, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
  FROM equipment_floors f
 WHERE f.code = 'GF'
   AND NOT EXISTS (SELECT 1 FROM equipment_areas a WHERE a.code = 'KITCHEN');

INSERT INTO equipment_locations (id, area_id, name, room, section, sort_order, status, created_at, updated_at)
SELECT UUID(), a.id, 'Main Kitchen', 'Kitchen', NULL, 10, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
  FROM equipment_areas a
 WHERE a.code = 'KITCHEN'
   AND NOT EXISTS (
     SELECT 1 FROM equipment_locations l WHERE l.area_id = a.id AND l.name = 'Main Kitchen'
   );

-- The asset-id scheme, configurable rather than compiled in. Read by EquipmentService when
-- allocating MTC-KIT-OVN-001: `<prefix>-<area segment>-<category segment>-<sequence>`.
INSERT INTO settings (setting_key, value, description, updated_at) VALUES
  ('equipment.assetIdPrefix', '"MTC"', 'Leading segment of every generated Asset ID.', UTC_TIMESTAMP(3)),
  ('equipment.assetIdSequenceDigits', '3', 'Zero-padded width of the numeric segment.', UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE setting_key = setting_key;
