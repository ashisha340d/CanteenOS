-- ---------------------------------------------------------------------------------------
-- Purchase management, part 1 of N: the masters everything else hangs off.
--
-- Units, inventory locations, the product master, per-location stock policy, the supplier
-- product mapping, and the purchase-facing columns on the existing entity master.
--
-- Two deliberate decisions are worth stating here rather than leaving to be inferred:
--
-- 1. `products` supersedes `ingredients` as the single item master, and does it without
--    breaking anything. Every column `ingredients` had is reproduced here under the same
--    name and type, and every existing row is copied across keeping its id. That means
--    `recipe_ingredients.ingredient_id` still resolves, the `ingredients` sync entity still
--    serialises identically, and the Android app's cached recipes are untouched — while the
--    master itself gains units, tax, batch policy, valuation and reorder levels. The old
--    table is left in place, unread, so this migration is reversible by inspection.
--
-- 2. Vendors are `entities` of type VENDOR, not a new table. That master already carries
--    gstin, state_code, credit_limit and account_balance, and POS already settles account
--    payments against it. A second vendor master would be a second version of the truth.
-- ---------------------------------------------------------------------------------------

-- ------------------------------------------------------------------ units of measure ---
--
-- Conversion is held as a single factor to the dimension's base unit rather than as an
-- N×N conversion table: KG -> GM is 1000 and litres never convert to grams, so one column
-- expresses everything that is universally true. Conversions that are *not* universal — a
-- CASE holding 12 of one product and 24 of another — belong to the product and the supplier
-- mapping, and are held there.
CREATE TABLE IF NOT EXISTS `uoms` (
  `id`             char(36)     NOT NULL,
  `code`           varchar(16)  NOT NULL,
  `name`           varchar(60)  NOT NULL,
  `dimension`      enum('WEIGHT','VOLUME','COUNT','LENGTH','PACK') NOT NULL,
  `is_base`        tinyint(1)   NOT NULL DEFAULT 0,
  `factor_to_base` decimal(18,6) NOT NULL DEFAULT 1.000000,
  `decimal_places` tinyint(3) unsigned NOT NULL DEFAULT 3,
  `status`         enum('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `sort_order`     int(11)      NOT NULL DEFAULT 0,
  `created_by`     char(36)     DEFAULT NULL,
  `created_at`     datetime(3)  NOT NULL,
  `updated_at`     datetime(3)  NOT NULL,
  `deleted_at`     datetime(3)  DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_uoms_code` (`code`),
  KEY `ix_uoms_dimension` (`dimension`,`status`,`sort_order`),
  KEY `fk_uoms_created_by` (`created_by`),
  CONSTRAINT `fk_uoms_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ck_uoms_factor_positive` CHECK (`factor_to_base` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The units a canteen actually buys and stores in. Seeded rather than left empty because a
-- product master with no units is unusable, and these are not opinions — a kilogram is a
-- thousand grams everywhere. UUIDs are deterministic so a re-run is a no-op.
INSERT INTO `uoms` (`id`,`code`,`name`,`dimension`,`is_base`,`factor_to_base`,`decimal_places`,`sort_order`,`created_at`,`updated_at`)
VALUES
  ('00000000-0000-4000-a000-000000000101','GM','Gram','WEIGHT',1,1.000000,3,10,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
  ('00000000-0000-4000-a000-000000000102','KG','Kilogram','WEIGHT',0,1000.000000,3,20,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
  ('00000000-0000-4000-a000-000000000103','QTL','Quintal','WEIGHT',0,100000.000000,3,30,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
  ('00000000-0000-4000-a000-000000000104','ML','Millilitre','VOLUME',1,1.000000,3,40,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
  ('00000000-0000-4000-a000-000000000105','LTR','Litre','VOLUME',0,1000.000000,3,50,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
  ('00000000-0000-4000-a000-000000000106','NOS','Number','COUNT',1,1.000000,0,60,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
  ('00000000-0000-4000-a000-000000000107','DOZ','Dozen','COUNT',0,12.000000,0,70,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
  ('00000000-0000-4000-a000-000000000108','PKT','Packet','PACK',1,1.000000,0,80,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
  ('00000000-0000-4000-a000-000000000109','BOX','Box','PACK',0,1.000000,0,90,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
  ('00000000-0000-4000-a000-000000000110','BAG','Bag','PACK',0,1.000000,0,100,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
  ('00000000-0000-4000-a000-000000000111','CASE','Case','PACK',0,1.000000,0,110,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
  ('00000000-0000-4000-a000-000000000112','TIN','Tin','PACK',0,1.000000,0,120,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
  ('00000000-0000-4000-a000-000000000113','BTL','Bottle','PACK',0,1.000000,0,130,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `code` = VALUES(`code`);

-- --------------------------------------------------------------- inventory locations ---
--
-- The store master. This is what makes "60 kg to the warehouse, 40 kg to the day store" a
-- real distinction rather than a note in a comments field.
--
-- `allows_negative_stock` is per location and defaults to off. A warehouse must never go
-- negative — that is a counting error. A kitchen that issues before the paperwork catches up
-- legitimately can, and forcing it not to would simply stop service.
CREATE TABLE IF NOT EXISTS `inventory_locations` (
  `id`                    char(36)     NOT NULL,
  `code`                  varchar(40)  NOT NULL,
  `name`                  varchar(120) NOT NULL,
  `name_hi`               varchar(150) DEFAULT NULL,
  `kind`                  enum('WAREHOUSE','DAY_STORE','KITCHEN','PRODUCTION_STORE','BAKERY_STORE','BAR_COUNTER','DEPARTMENT_STORE','DIRECT_CONSUMPTION','OTHER') NOT NULL DEFAULT 'OTHER',
  `parent_id`             char(36)     DEFAULT NULL,
  `counter_id`            char(36)     DEFAULT NULL,
  `station_id`            char(36)     DEFAULT NULL,
  `department`            varchar(120) DEFAULT NULL,
  `is_default_receiving`  tinyint(1)   NOT NULL DEFAULT 0,
  `allows_negative_stock` tinyint(1)   NOT NULL DEFAULT 0,
  `status`                enum('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `sort_order`            int(11)      NOT NULL DEFAULT 0,
  `notes`                 varchar(1000) DEFAULT NULL,
  `created_by`            char(36)     DEFAULT NULL,
  `created_at`            datetime(3)  NOT NULL,
  `updated_at`            datetime(3)  NOT NULL,
  `deleted_at`            datetime(3)  DEFAULT NULL,
  `revision`              int(10) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_inventory_locations_code` (`code`),
  KEY `ix_inventory_locations_kind` (`kind`,`status`,`sort_order`),
  KEY `ix_inventory_locations_parent` (`parent_id`),
  KEY `ix_inventory_locations_counter` (`counter_id`),
  KEY `ix_inventory_locations_station` (`station_id`),
  KEY `fk_inventory_locations_created_by` (`created_by`),
  CONSTRAINT `fk_inventory_locations_parent` FOREIGN KEY (`parent_id`) REFERENCES `inventory_locations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_inventory_locations_counter` FOREIGN KEY (`counter_id`) REFERENCES `counters` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_inventory_locations_station` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_inventory_locations_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A main store and a day store, so a purchase can be received the moment this migration
-- lands. Anything beyond these two is site-specific and is created through the UI.
INSERT INTO `inventory_locations` (`id`,`code`,`name`,`kind`,`is_default_receiving`,`allows_negative_stock`,`sort_order`,`created_at`,`updated_at`)
VALUES
  ('00000000-0000-4000-b000-000000000001','WH-MAIN','Main Warehouse','WAREHOUSE',1,0,10,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
  ('00000000-0000-4000-b000-000000000002','DAY-STORE','Day Store','DAY_STORE',0,0,20,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `code` = VALUES(`code`);

-- ------------------------------------------------------------------- product master ---
--
-- The first thirteen columns are, deliberately, exactly the columns `ingredients` has, with
-- the same names and types. That is what lets the recipe master, the sync engine and the
-- mobile cache carry on reading this table as if nothing happened. Everything after them is
-- what purchasing needs and the recipe-only master never had.
CREATE TABLE IF NOT EXISTS `products` (
  -- ---- legacy-compatible surface: must stay byte-for-byte what `ingredients` exposed ----
  `id`                     char(36)     NOT NULL,
  `category_id`            char(36)     DEFAULT NULL,
  `name`                   varchar(180) NOT NULL,
  `name_hi`                varchar(180) DEFAULT NULL,
  `unit`                   varchar(30)  NOT NULL DEFAULT 'GM',
  `status`                 enum('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `sort_order`             int(11)      NOT NULL DEFAULT 0,
  `created_by`             char(36)     DEFAULT NULL,
  `created_at`             datetime(3)  NOT NULL,
  `updated_at`             datetime(3)  NOT NULL,
  `deleted_at`             datetime(3)  DEFAULT NULL,
  `revision`               int(10) unsigned NOT NULL DEFAULT 1,
  `sync_seq`               bigint(20) unsigned NOT NULL DEFAULT 0,
  -- ---- identification -------------------------------------------------------------------
  `code`                   varchar(40)  DEFAULT NULL,
  `barcode`                varchar(64)  DEFAULT NULL,
  `brand`                  varchar(120) DEFAULT NULL,
  `description`            varchar(1000) DEFAULT NULL,
  `kind`                   enum('STOCK','SERVICE','EXPENSE','ASSET') NOT NULL DEFAULT 'STOCK',
  -- ---- tax ------------------------------------------------------------------------------
  `hsn_sac_id`             char(36)     DEFAULT NULL,
  `tax_profile_id`         char(36)     DEFAULT NULL,
  -- ---- units --------------------------------------------------------------------------
  -- `unit` above stays the human-readable stock unit the recipe screens already show.
  -- `stock_uom_id` is the same thing resolved to the unit master, and is what stock maths
  -- uses. Purchase unit and its factor let a bill in CASE become a balance in NOS.
  `stock_uom_id`           char(36)     DEFAULT NULL,
  `purchase_uom_id`        char(36)     DEFAULT NULL,
  `purchase_conversion_factor` decimal(18,6) NOT NULL DEFAULT 1.000000,
  `pack_size`              varchar(60)  DEFAULT NULL,
  -- ---- batch & expiry -------------------------------------------------------------------
  `is_batch_tracked`       tinyint(1)   NOT NULL DEFAULT 0,
  `is_expiry_tracked`      tinyint(1)   NOT NULL DEFAULT 0,
  `shelf_life_days`        int(10) unsigned DEFAULT NULL,
  `batch_issue_policy`     enum('FEFO','FIFO') NOT NULL DEFAULT 'FEFO',
  -- ---- valuation ------------------------------------------------------------------------
  -- Costs carry four decimals, not two: a spice priced per gram is genuinely ₹0.0125, and
  -- rounding that to the rupee-paise scale would compound into a visible valuation error.
  `valuation_method`       enum('MOVING_AVERAGE','FIFO','STANDARD') NOT NULL DEFAULT 'MOVING_AVERAGE',
  `standard_cost`          decimal(14,4) DEFAULT NULL,
  `moving_average_cost`    decimal(14,4) NOT NULL DEFAULT 0.0000,
  `last_purchase_rate`     decimal(14,4) DEFAULT NULL,
  `last_purchased_at`      datetime(3)  DEFAULT NULL,
  -- ---- planning -------------------------------------------------------------------------
  `default_location_id`    char(36)     DEFAULT NULL,
  `preferred_supplier_id`  char(36)     DEFAULT NULL,
  `min_stock`              decimal(14,3) DEFAULT NULL,
  `reorder_level`          decimal(14,3) DEFAULT NULL,
  `max_stock`              decimal(14,3) DEFAULT NULL,
  `lead_time_days`         int(10) unsigned DEFAULT NULL,
  `is_purchasable`         tinyint(1)   NOT NULL DEFAULT 1,
  `is_stocked`             tinyint(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_products_name` (`name`),
  UNIQUE KEY `uq_products_code` (`code`),
  KEY `ix_products_sync_seq` (`sync_seq`),
  KEY `ix_products_category` (`category_id`),
  KEY `ix_products_status` (`status`,`sort_order`),
  KEY `ix_products_barcode` (`barcode`),
  KEY `ix_products_kind` (`kind`,`status`),
  KEY `ix_products_purchasable` (`is_purchasable`,`status`),
  KEY `ix_products_reorder` (`is_stocked`,`status`,`reorder_level`),
  KEY `fk_products_created_by` (`created_by`),
  KEY `fk_products_hsn_sac` (`hsn_sac_id`),
  KEY `fk_products_tax_profile` (`tax_profile_id`),
  KEY `fk_products_stock_uom` (`stock_uom_id`),
  KEY `fk_products_purchase_uom` (`purchase_uom_id`),
  KEY `fk_products_default_location` (`default_location_id`),
  KEY `fk_products_preferred_supplier` (`preferred_supplier_id`),
  CONSTRAINT `fk_products_category` FOREIGN KEY (`category_id`) REFERENCES `ingredient_categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_products_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_products_hsn_sac` FOREIGN KEY (`hsn_sac_id`) REFERENCES `hsn_sac_master` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_products_tax_profile` FOREIGN KEY (`tax_profile_id`) REFERENCES `tax_profiles` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_products_stock_uom` FOREIGN KEY (`stock_uom_id`) REFERENCES `uoms` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_products_purchase_uom` FOREIGN KEY (`purchase_uom_id`) REFERENCES `uoms` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_products_default_location` FOREIGN KEY (`default_location_id`) REFERENCES `inventory_locations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_products_preferred_supplier` FOREIGN KEY (`preferred_supplier_id`) REFERENCES `entities` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ck_products_conversion_positive` CHECK (`purchase_conversion_factor` > 0),
  CONSTRAINT `ck_products_levels_ordered` CHECK (
    `max_stock` IS NULL OR `min_stock` IS NULL OR `max_stock` >= `min_stock`
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Carry the recipe ingredient master across, keeping every id. This is what makes the
-- change invisible to recipes, to sync and to the phone. Re-running is a no-op.
INSERT INTO `products`
  (`id`,`category_id`,`name`,`name_hi`,`unit`,`status`,`sort_order`,`created_by`,
   `created_at`,`updated_at`,`deleted_at`,`revision`,`sync_seq`,`kind`,`is_purchasable`,`is_stocked`)
SELECT
  i.`id`, i.`category_id`, i.`name`, i.`name_hi`, i.`unit`, i.`status`, i.`sort_order`, i.`created_by`,
  i.`created_at`, i.`updated_at`, i.`deleted_at`, i.`revision`, i.`sync_seq`, 'STOCK', 1, 1
FROM `ingredients` i
WHERE NOT EXISTS (SELECT 1 FROM `products` p WHERE p.`id` = i.`id`);

-- Resolve each carried-over product's stock unit to the unit master where the code matches
-- one we seeded. Anything unrecognised keeps its free-text `unit` and is linked by hand.
UPDATE `products` p
  JOIN `uoms` u ON u.`code` = UPPER(TRIM(p.`unit`))
   SET p.`stock_uom_id` = u.`id`,
       p.`purchase_uom_id` = u.`id`
 WHERE p.`stock_uom_id` IS NULL;

-- --------------------------------------------------- per-location stock policy ---
--
-- Reorder levels are per location because they have to be: a day store holding two days of
-- flour and a warehouse holding two months of it are the same product with entirely
-- different thresholds. The product-level columns remain the fallback.
CREATE TABLE IF NOT EXISTS `product_locations` (
  `id`                     char(36)     NOT NULL,
  `product_id`             char(36)     NOT NULL,
  `location_id`            char(36)     NOT NULL,
  `min_stock`              decimal(14,3) DEFAULT NULL,
  `reorder_level`          decimal(14,3) DEFAULT NULL,
  `max_stock`              decimal(14,3) DEFAULT NULL,
  `is_default_destination` tinyint(1)   NOT NULL DEFAULT 0,
  `bin`                    varchar(60)  DEFAULT NULL,
  `status`                 enum('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_by`             char(36)     DEFAULT NULL,
  `created_at`             datetime(3)  NOT NULL,
  `updated_at`             datetime(3)  NOT NULL,
  `deleted_at`             datetime(3)  DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_product_locations` (`product_id`,`location_id`),
  KEY `ix_product_locations_location` (`location_id`,`status`),
  KEY `ix_product_locations_reorder` (`location_id`,`reorder_level`),
  KEY `fk_product_locations_created_by` (`created_by`),
  CONSTRAINT `fk_product_locations_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_product_locations_location` FOREIGN KEY (`location_id`) REFERENCES `inventory_locations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_product_locations_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ck_product_locations_levels_ordered` CHECK (
    `max_stock` IS NULL OR `min_stock` IS NULL OR `max_stock` >= `min_stock`
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------- supplier product mapping ---
--
-- What the supplier calls the thing, versus what we call it. This is the table that makes
-- bill-scanning work: a scanned line says "AMUL TAAZA 1L POUCH / SKU 4471" and this is what
-- turns that into our product id, our unit, and a rate we can sanity-check.
CREATE TABLE IF NOT EXISTS `supplier_products` (
  `id`                   char(36)     NOT NULL,
  `supplier_id`          char(36)     NOT NULL,
  `product_id`           char(36)     NOT NULL,
  `supplier_sku`         varchar(60)  DEFAULT NULL,
  `supplier_product_name` varchar(200) DEFAULT NULL,
  `barcode`              varchar(64)  DEFAULT NULL,
  `purchase_uom_id`      char(36)     DEFAULT NULL,
  `conversion_factor`    decimal(18,6) NOT NULL DEFAULT 1.000000,
  `pack_size`            varchar(60)  DEFAULT NULL,
  `last_rate`            decimal(14,4) DEFAULT NULL,
  `last_purchased_at`    datetime(3)  DEFAULT NULL,
  `lead_time_days`       int(10) unsigned DEFAULT NULL,
  `is_preferred`         tinyint(1)   NOT NULL DEFAULT 0,
  `status`               enum('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `notes`                varchar(500) DEFAULT NULL,
  `created_by`           char(36)     DEFAULT NULL,
  `created_at`           datetime(3)  NOT NULL,
  `updated_at`           datetime(3)  NOT NULL,
  `deleted_at`           datetime(3)  DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_supplier_products` (`supplier_id`,`product_id`),
  UNIQUE KEY `uq_supplier_products_sku` (`supplier_id`,`supplier_sku`),
  KEY `ix_supplier_products_product` (`product_id`,`status`),
  KEY `ix_supplier_products_barcode` (`barcode`),
  KEY `ix_supplier_products_preferred` (`product_id`,`is_preferred`,`status`),
  KEY `fk_supplier_products_uom` (`purchase_uom_id`),
  KEY `fk_supplier_products_created_by` (`created_by`),
  CONSTRAINT `fk_supplier_products_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `entities` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_supplier_products_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_supplier_products_uom` FOREIGN KEY (`purchase_uom_id`) REFERENCES `uoms` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_supplier_products_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ck_supplier_products_conversion_positive` CHECK (`conversion_factor` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------- vendor columns on the entity master ---
--
-- Added to `entities` rather than to a new vendor table. Prefixed `vendor_` so it is obvious
-- at a glance which columns are meaningless on a CUSTOMER or EMPLOYEE row, and so nothing
-- here can collide with a future column on the shared part of the master.
ALTER TABLE `entities`
  ADD COLUMN `vendor_payment_terms`     varchar(200) DEFAULT NULL AFTER `credit_limit`,
  ADD COLUMN `vendor_credit_days`       int(10) unsigned NOT NULL DEFAULT 0 AFTER `vendor_payment_terms`,
  ADD COLUMN `vendor_bank_name`         varchar(120) DEFAULT NULL AFTER `vendor_credit_days`,
  ADD COLUMN `vendor_bank_account`      varchar(50)  DEFAULT NULL AFTER `vendor_bank_name`,
  ADD COLUMN `vendor_bank_ifsc`         varchar(15)  DEFAULT NULL AFTER `vendor_bank_account`,
  ADD COLUMN `vendor_opening_balance`   decimal(14,2) NOT NULL DEFAULT 0.00 AFTER `vendor_bank_ifsc`,
  -- An unapproved supplier can still be transacted with, but posting raises an overridable
  -- exception. Defaulting to approved keeps every existing vendor working unchanged.
  ADD COLUMN `vendor_is_approved`       tinyint(1)   NOT NULL DEFAULT 1 AFTER `vendor_opening_balance`,
  ADD COLUMN `vendor_default_location_id` char(36)   DEFAULT NULL AFTER `vendor_is_approved`,
  ADD KEY `ix_entities_vendor` (`type`,`status`,`vendor_is_approved`),
  ADD KEY `fk_entities_vendor_default_location` (`vendor_default_location_id`),
  ADD CONSTRAINT `fk_entities_vendor_default_location` FOREIGN KEY (`vendor_default_location_id`) REFERENCES `inventory_locations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- A supplier's GSTIN is how a scanned bill finds them, so it needs to be searchable. It is
-- deliberately not UNIQUE: the column is nullable, blank on most rows, and a group that
-- trades under one GSTIN through two ledgers is normal.
ALTER TABLE `entities`
  ADD KEY `ix_entities_gstin` (`gstin`);

-- --------------------------------------------------- recipes point at products now ---
--
-- The column keeps its name. `recipe_ingredients.ingredient_id` now resolves against
-- `products`, whose ids were copied from `ingredients` above, so every existing recipe row
-- still points at exactly the same thing it pointed at before. Nothing outside this file
-- needs to know: not the DTOs, not the sync entity names, not the phone.
ALTER TABLE `recipe_ingredients`
  DROP FOREIGN KEY `fk_recipe_ingredients_ingredient`;

ALTER TABLE `recipe_ingredients`
  ADD CONSTRAINT `fk_recipe_ingredients_product` FOREIGN KEY (`ingredient_id`) REFERENCES `products` (`id`) ON UPDATE CASCADE;

-- ------------------------------------------------------------------------ settings ---
--
-- Purchase tolerances live in `settings` so a site can tune them without a deploy. The
-- values match the PURCHASE_TOLERANCE defaults in shared/src/constants.
INSERT INTO `settings` (`setting_key`,`value`,`description`,`updated_at`)
VALUES
  ('purchase.rate_variance_percent','10','Rate above last purchase rate by more than this percent is flagged',UTC_TIMESTAMP(3)),
  ('purchase.quantity_over_receipt_percent','5','Receiving more than this percent over the ordered quantity is an exception',UTC_TIMESTAMP(3)),
  ('purchase.invoice_total_tolerance','1','Rupee gap allowed between the supplier total and our recomputation',UTC_TIMESTAMP(3)),
  ('purchase.tax_tolerance','1','Rupee gap allowed between tax billed and tax computed',UTC_TIMESTAMP(3)),
  ('purchase.near_expiry_days','30','Goods expiring within this many days are flagged at receipt',UTC_TIMESTAMP(3)),
  ('purchase.ocr_confidence_floor','0.75','Below this OCR confidence a field must be confirmed by a human',UTC_TIMESTAMP(3)),
  ('purchase.allow_negative_stock','false','Whether stock issues may drive a location balance below zero',UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `setting_key` = VALUES(`setting_key`);
