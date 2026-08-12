-- MenuBoard 021 — GST classification reference data and reusable tax treatment
--
-- Two deliberately separate concepts, per the data integrity rule in docs/GST_HSN_SAC.md:
--
--   hsn_sac_master  classification reference data, owned by the official GST/GSTN dataset.
--                   Never hand-authored; every row arrives via a "Sync GST Master" run and is
--                   deactivated (never deleted) when it leaves the authoritative dataset.
--   tax_profiles    the application's own reusable tax treatment. Rates live HERE and only
--                   here, because the official dataset carries code + description only.
--
-- A food item assigns a tax profile; a variant may override it. Neither ever stores a rate.
--
-- No `revision`/`sync_seq` on hsn_sac_master or gst_sync_runs: like youtube_recipe_imports
-- (011) these are Admin-Portal-only and never sync to the Android app. tax_profiles does not
-- sync either — the phone takes no part in tax treatment — so it is soft-delete + timestamps
-- without the sync columns, matching 011 rather than 012.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ------------------------------------------------------------- classification reference

CREATE TABLE IF NOT EXISTS hsn_sac_master (
  id                CHAR(36)      NOT NULL,
  code              VARCHAR(20)   NOT NULL,
  code_type         ENUM('HSN','SAC') NOT NULL,
  description       TEXT          NOT NULL,
  -- Derived from `code` during import, not supplied by the source file. HSN only; the SAC
  -- sheet has no chapter/heading decomposition, so these stay NULL for services.
  chapter           VARCHAR(4)    NULL,
  heading           VARCHAR(8)    NULL,
  sub_heading       VARCHAR(12)   NULL,
  is_active         TINYINT(1)    NOT NULL DEFAULT 1,
  source            VARCHAR(40)   NOT NULL DEFAULT 'GST/GSTN',
  -- The official workbook carries no version field. `source_version` is the file's own
  -- dcterms:modified date, `source_checksum` its SHA-256 — together they identify a dataset
  -- revision without inventing one.
  source_version    VARCHAR(64)   NULL,
  source_checksum   CHAR(64)      NULL,
  first_synced_at   DATETIME(3)   NOT NULL,
  last_synced_at    DATETIME(3)   NOT NULL,
  deactivated_at    DATETIME(3)   NULL,
  created_at        DATETIME(3)   NOT NULL,
  updated_at        DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hsn_sac_code (code_type, code),
  KEY ix_hsn_sac_code (code),
  KEY ix_hsn_sac_active (is_active, code_type),
  FULLTEXT KEY ft_hsn_sac_description (description)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- One row per "Sync GST Master" run. The synchronization audit log required by the spec;
-- kept as its own table rather than folded into audit_log because a run carries a fixed set
-- of counters that deserve real columns.
CREATE TABLE IF NOT EXISTS gst_sync_runs (
  id                   CHAR(36)      NOT NULL,
  started_at           DATETIME(3)   NOT NULL,
  completed_at         DATETIME(3)   NULL,
  started_by           CHAR(36)      NULL,
  source               VARCHAR(40)   NOT NULL DEFAULT 'GST/GSTN',
  source_url           VARCHAR(500)  NULL,
  source_version       VARCHAR(64)   NULL,
  source_checksum      CHAR(64)      NULL,
  records_downloaded   INT UNSIGNED  NOT NULL DEFAULT 0,
  records_added        INT UNSIGNED  NOT NULL DEFAULT 0,
  records_updated      INT UNSIGNED  NOT NULL DEFAULT 0,
  records_deactivated  INT UNSIGNED  NOT NULL DEFAULT 0,
  records_unchanged    INT UNSIGNED  NOT NULL DEFAULT 0,
  records_failed       INT UNSIGNED  NOT NULL DEFAULT 0,
  status               ENUM('RUNNING','SUCCESS','FAILED') NOT NULL DEFAULT 'RUNNING',
  error_details        TEXT          NULL,
  created_at           DATETIME(3)   NOT NULL,
  updated_at           DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_gst_sync_runs_started (started_at),
  CONSTRAINT fk_gst_sync_runs_user FOREIGN KEY (started_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ------------------------------------------------------------- tax treatment

CREATE TABLE IF NOT EXISTS tax_profiles (
  id                 CHAR(36)      NOT NULL,
  code               VARCHAR(40)   NOT NULL,
  name               VARCHAR(120)  NOT NULL,
  description        VARCHAR(500)  NULL,
  -- RESTRICT: a classification row referenced by a profile must never vanish. Sync only ever
  -- deactivates rows anyway, but the constraint states the intent to the database.
  hsn_sac_id         CHAR(36)      NULL,
  supply_type        ENUM('GOODS','SERVICE') NOT NULL,
  gst_taxability     ENUM('TAXABLE','EXEMPT','NIL_RATED','ZERO_RATED','NON_GST')
                     NOT NULL DEFAULT 'TAXABLE',
  gst_rate           DECIMAL(6,3)  NOT NULL DEFAULT 0.000,
  cgst_rate          DECIMAL(6,3)  NOT NULL DEFAULT 0.000,
  sgst_rate          DECIMAL(6,3)  NOT NULL DEFAULT 0.000,
  igst_rate          DECIMAL(6,3)  NOT NULL DEFAULT 0.000,
  cess_rate          DECIMAL(6,3)  NOT NULL DEFAULT 0.000,
  price_is_inclusive TINYINT(1)    NOT NULL DEFAULT 1,
  itc_eligibility    ENUM('AVAILABLE','NOT_AVAILABLE','PARTIAL') NOT NULL DEFAULT 'NOT_AVAILABLE',
  effective_from     DATE          NULL,
  effective_to       DATE          NULL,
  exemption_reason   VARCHAR(300)  NULL,
  regulatory_notes   VARCHAR(200)  NULL,
  status             ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  sort_order         INT           NOT NULL DEFAULT 0,
  created_by         CHAR(36)      NULL,
  created_at         DATETIME(3)   NOT NULL,
  updated_at         DATETIME(3)   NOT NULL,
  deleted_at         DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tax_profiles_code (code),
  KEY ix_tax_profiles_status (status, sort_order),
  CONSTRAINT fk_tax_profiles_hsn_sac FOREIGN KEY (hsn_sac_id) REFERENCES hsn_sac_master (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_tax_profiles_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ------------------------------------------------------------- assignment

-- The Food Item Master assigns a profile. RESTRICT so a profile in use cannot be hard-deleted.
ALTER TABLE menu_items
  ADD COLUMN tax_profile_id CHAR(36) NULL AFTER base_price,
  ADD KEY ix_menu_items_tax_profile (tax_profile_id),
  ADD CONSTRAINT fk_menu_items_tax_profile FOREIGN KEY (tax_profile_id)
    REFERENCES tax_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- NULL means "inherit from the food item" — the default. A non-NULL value is an explicit,
-- deliberate per-variant override.
ALTER TABLE menu_item_variants
  ADD COLUMN tax_profile_id CHAR(36) NULL AFTER price,
  ADD KEY ix_menu_item_variants_tax_profile (tax_profile_id),
  ADD CONSTRAINT fk_menu_item_variants_tax_profile FOREIGN KEY (tax_profile_id)
    REFERENCES tax_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------- capabilities

-- 010 moved the role -> capability matrix into the database, so new capabilities must be
-- seeded here as well as declared in shared/src/permissions.
INSERT INTO role_capabilities (role, capability, updated_at) VALUES
  ('EMPLOYEE',    'tax.read',      UTC_TIMESTAMP(3)),
  ('USER',        'tax.read',      UTC_TIMESTAMP(3)),
  ('MANAGER',     'tax.read',      UTC_TIMESTAMP(3)),
  ('ADMIN',       'tax.read',      UTC_TIMESTAMP(3)),
  ('ADMIN',       'tax.write',     UTC_TIMESTAMP(3)),
  ('ADMIN',       'tax.sync',      UTC_TIMESTAMP(3)),
  ('ADMIN',       'tax.override',  UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'tax.read',      UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'tax.write',     UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'tax.sync',      UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'tax.override',  UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE role = role;
