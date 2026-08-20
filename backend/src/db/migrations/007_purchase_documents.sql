-- ---------------------------------------------------------------------------------------
-- Purchase management, part 4: the fast direct procurement chain and vendor accounting.
--
--   Purchase Entry -> Goods Receipt (+QC, +destinations) -> Purchase Invoice
--                                   |                            |
--                             Stock Ledger              Vendor Ledger -> Accounts Payable
--                                                                              |
--                                                                       Vendor Payment
--
-- Purchase Requirement and Purchase Order arrive in a later migration; the columns that will
-- reference them (`purchase_order_id`, `purchase_order_line_id`) are declared here as plain
-- nullable UUIDs without a foreign key, and are constrained once those tables exist. Declaring
-- them now means the direct-purchase path and the ordered path write the same rows.
--
-- Money is DECIMAL(14,2), quantities DECIMAL(14,3), unit rates DECIMAL(14,4) and tax rates
-- DECIMAL(6,3) — the same scales used by pos_orders and by the inventory core.
-- ---------------------------------------------------------------------------------------

-- --------------------------------------------------------------- purchase entries ---
--
-- The fast path. A user picks a supplier, types lines, and posts; everything downstream is
-- generated. It is a first-class document rather than a wizard step, so a half-typed bill can
-- be left as a draft and picked up later.
CREATE TABLE IF NOT EXISTS `purchase_entries` (
  `id`                     char(36)     NOT NULL,
  `entry_number`           varchar(30)  NOT NULL,
  `daily_sequence`         int(10) unsigned NOT NULL,
  `business_date`          date         NOT NULL,
  `supplier_id`            char(36)     NOT NULL,
  `purchase_type`          enum('STOCK','EXPENSE','ASSET','OTHER') NOT NULL DEFAULT 'STOCK',
  `entry_mode`             enum('QUICK','DETAILED','BILL_SCAN') NOT NULL DEFAULT 'QUICK',
  `status`                 enum('DRAFT','READY','POSTED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  -- The supplier's own bill number, in their format. Ours is `entry_number`.
  `supplier_invoice_number` varchar(60) DEFAULT NULL,
  `supplier_invoice_date`  date         DEFAULT NULL,
  `due_date`               date         DEFAULT NULL,
  `credit_days`            int(10) unsigned NOT NULL DEFAULT 0,
  `payment_method`         enum('CASH','UPI','BANK','CARD','CHEQUE','CREDIT','OTHER') NOT NULL DEFAULT 'CASH',
  `payment_reference`      varchar(120) DEFAULT NULL,
  `receiving_location_id`  char(36)     DEFAULT NULL,
  `purchase_order_id`      char(36)     DEFAULT NULL,
  `reference`              varchar(120) DEFAULT NULL,
  `notes`                  varchar(1000) DEFAULT NULL,
  `attachment_id`          char(36)     DEFAULT NULL,
  `bill_scan_id`           char(36)     DEFAULT NULL,
  -- Place of supply drives CGST+SGST versus IGST. Snapshotted from the supplier at entry time
  -- so a later edit to the supplier master cannot silently restate a posted bill's tax.
  `supplier_state_code`    varchar(2)   DEFAULT NULL,
  `is_inter_state`         tinyint(1)   NOT NULL DEFAULT 0,
  `subtotal_amount`        decimal(14,2) NOT NULL DEFAULT 0.00,
  `discount_amount`        decimal(14,2) NOT NULL DEFAULT 0.00,
  `taxable_amount`         decimal(14,2) NOT NULL DEFAULT 0.00,
  `cgst_amount`            decimal(14,2) NOT NULL DEFAULT 0.00,
  `sgst_amount`            decimal(14,2) NOT NULL DEFAULT 0.00,
  `igst_amount`            decimal(14,2) NOT NULL DEFAULT 0.00,
  `cess_amount`            decimal(14,2) NOT NULL DEFAULT 0.00,
  `tax_amount`             decimal(14,2) NOT NULL DEFAULT 0.00,
  `round_off_amount`       decimal(14,2) NOT NULL DEFAULT 0.00,
  `other_charges`          decimal(14,2) NOT NULL DEFAULT 0.00,
  `total_amount`           decimal(14,2) NOT NULL DEFAULT 0.00,
  `paid_amount`            decimal(14,2) NOT NULL DEFAULT 0.00,
  `outstanding_amount`     decimal(14,2) NOT NULL DEFAULT 0.00,
  -- What the supplier's own bill claims, when it is known. Compared against our recomputation
  -- and raised as an exception on a mismatch; never used in place of it.
  `supplier_total_amount`  decimal(14,2) DEFAULT NULL,
  `goods_receipt_id`       char(36)     DEFAULT NULL,
  `purchase_invoice_id`    char(36)     DEFAULT NULL,
  `created_by`             char(36)     NOT NULL,
  `posted_by`              char(36)     DEFAULT NULL,
  `posted_at`              datetime(3)  DEFAULT NULL,
  `cancelled_by`           char(36)     DEFAULT NULL,
  `cancelled_at`           datetime(3)  DEFAULT NULL,
  `cancel_reason`          varchar(300) DEFAULT NULL,
  `created_at`             datetime(3)  NOT NULL,
  `updated_at`             datetime(3)  NOT NULL,
  `revision`               int(10) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_purchase_entries_number` (`entry_number`),
  UNIQUE KEY `uq_purchase_entries_sequence` (`business_date`,`daily_sequence`),
  KEY `ix_purchase_entries_supplier` (`supplier_id`,`business_date`),
  KEY `ix_purchase_entries_status` (`status`,`business_date`),
  KEY `ix_purchase_entries_bill` (`supplier_id`,`supplier_invoice_number`),
  KEY `ix_purchase_entries_date` (`business_date`),
  KEY `ix_purchase_entries_location` (`receiving_location_id`),
  KEY `ix_purchase_entries_po` (`purchase_order_id`),
  KEY `fk_purchase_entries_created_by` (`created_by`),
  KEY `fk_purchase_entries_posted_by` (`posted_by`),
  KEY `fk_purchase_entries_cancelled_by` (`cancelled_by`),
  CONSTRAINT `fk_purchase_entries_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `entities` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_purchase_entries_location` FOREIGN KEY (`receiving_location_id`) REFERENCES `inventory_locations` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_purchase_entries_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_purchase_entries_posted_by` FOREIGN KEY (`posted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_purchase_entries_cancelled_by` FOREIGN KEY (`cancelled_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `purchase_entry_lines` (
  `id`                  char(36)     NOT NULL,
  `entry_id`            char(36)     NOT NULL,
  `product_id`          char(36)     DEFAULT NULL,
  -- An expense line (freight, unloading) has no product. Enforced by the CHECK below.
  `description`         varchar(200) DEFAULT NULL,
  `supplier_sku`        varchar(60)  DEFAULT NULL,
  `quantity`            decimal(14,3) NOT NULL DEFAULT 0.000,
  `purchase_uom_id`     char(36)     DEFAULT NULL,
  `stock_uom_id`        char(36)     DEFAULT NULL,
  `conversion_factor`   decimal(18,6) NOT NULL DEFAULT 1.000000,
  -- quantity × conversion_factor. Stored so the stock posting never has to re-derive it.
  `stock_quantity`      decimal(14,3) NOT NULL DEFAULT 0.000,
  `rate`                decimal(14,4) NOT NULL DEFAULT 0.0000,
  `discount_percent`    decimal(6,3) NOT NULL DEFAULT 0.000,
  `discount_amount`     decimal(14,2) NOT NULL DEFAULT 0.00,
  `gross_amount`        decimal(14,2) NOT NULL DEFAULT 0.00,
  `taxable_amount`      decimal(14,2) NOT NULL DEFAULT 0.00,
  `tax_profile_id`      char(36)     DEFAULT NULL,
  `tax_rate`            decimal(6,3) NOT NULL DEFAULT 0.000,
  `cgst_amount`         decimal(14,2) NOT NULL DEFAULT 0.00,
  `sgst_amount`         decimal(14,2) NOT NULL DEFAULT 0.00,
  `igst_amount`         decimal(14,2) NOT NULL DEFAULT 0.00,
  `cess_amount`         decimal(14,2) NOT NULL DEFAULT 0.00,
  `tax_amount`          decimal(14,2) NOT NULL DEFAULT 0.00,
  `line_total`          decimal(14,2) NOT NULL DEFAULT 0.00,
  `batch_number`        varchar(60)  DEFAULT NULL,
  `manufacturing_date`  date         DEFAULT NULL,
  `expiry_date`         date         DEFAULT NULL,
  -- Received/accepted/rejected live on the line so the quick path can take a whole bill in
  -- one grid without opening a separate receipt screen. The GRN copies them.
  `received_quantity`   decimal(14,3) NOT NULL DEFAULT 0.000,
  `accepted_quantity`   decimal(14,3) NOT NULL DEFAULT 0.000,
  `rejected_quantity`   decimal(14,3) NOT NULL DEFAULT 0.000,
  `rejection_reason`    enum('DAMAGED','EXPIRED','NEAR_EXPIRY','QUALITY','WRONG_PRODUCT','SHORT_SUPPLY','EXCESS_SUPPLY','CONTAMINATED','TEMPERATURE','PACKAGING','OTHER') DEFAULT NULL,
  `destination_location_id` char(36) DEFAULT NULL,
  `purchase_order_line_id`  char(36) DEFAULT NULL,
  `notes`               varchar(500) DEFAULT NULL,
  `sort_order`          int(11)      NOT NULL DEFAULT 0,
  `created_at`          datetime(3)  NOT NULL,
  `updated_at`          datetime(3)  NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_purchase_entry_lines_entry` (`entry_id`,`sort_order`),
  KEY `ix_purchase_entry_lines_product` (`product_id`),
  KEY `ix_purchase_entry_lines_destination` (`destination_location_id`),
  KEY `fk_purchase_entry_lines_tax_profile` (`tax_profile_id`),
  KEY `fk_purchase_entry_lines_purchase_uom` (`purchase_uom_id`),
  KEY `fk_purchase_entry_lines_stock_uom` (`stock_uom_id`),
  CONSTRAINT `fk_purchase_entry_lines_entry` FOREIGN KEY (`entry_id`) REFERENCES `purchase_entries` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  -- No ON UPDATE CASCADE: MariaDB will not allow a cascading column inside a CHECK, and the
  -- `ck_..._subject` constraint below needs to read `product_id`. Product ids are immutable
  -- UUIDs, so there is no update for the cascade to have carried anyway.
  CONSTRAINT `fk_purchase_entry_lines_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`),
  CONSTRAINT `fk_purchase_entry_lines_tax_profile` FOREIGN KEY (`tax_profile_id`) REFERENCES `tax_profiles` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_purchase_entry_lines_purchase_uom` FOREIGN KEY (`purchase_uom_id`) REFERENCES `uoms` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_purchase_entry_lines_stock_uom` FOREIGN KEY (`stock_uom_id`) REFERENCES `uoms` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_purchase_entry_lines_destination` FOREIGN KEY (`destination_location_id`) REFERENCES `inventory_locations` (`id`) ON UPDATE CASCADE,
  -- A line is either a product or a described expense; never neither.
  CONSTRAINT `ck_purchase_entry_lines_subject` CHECK (`product_id` IS NOT NULL OR `description` IS NOT NULL),
  CONSTRAINT `ck_purchase_entry_lines_conversion` CHECK (`conversion_factor` > 0),
  -- Accepted plus rejected cannot exceed what was received. This is the invariant that keeps
  -- "only accepted quantity becomes stock" honest.
  CONSTRAINT `ck_purchase_entry_lines_qc` CHECK (`accepted_quantity` + `rejected_quantity` <= `received_quantity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------ goods receipts ---
CREATE TABLE IF NOT EXISTS `goods_receipts` (
  `id`                 char(36)     NOT NULL,
  `grn_number`         varchar(30)  NOT NULL,
  `daily_sequence`     int(10) unsigned NOT NULL,
  `business_date`      date         NOT NULL,
  `receipt_date`       date         NOT NULL,
  `supplier_id`        char(36)     NOT NULL,
  `purchase_entry_id`  char(36)     DEFAULT NULL,
  `purchase_order_id`  char(36)     DEFAULT NULL,
  `delivery_note`      varchar(60)  DEFAULT NULL,
  `location_id`        char(36)     NOT NULL,
  `status`             enum('DRAFT','PENDING_QC','QC_DONE','POSTED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `notes`              varchar(1000) DEFAULT NULL,
  `received_by`        char(36)     DEFAULT NULL,
  `qc_by`              char(36)     DEFAULT NULL,
  `qc_at`              datetime(3)  DEFAULT NULL,
  `created_by`         char(36)     NOT NULL,
  `posted_by`          char(36)     DEFAULT NULL,
  `posted_at`          datetime(3)  DEFAULT NULL,
  `cancelled_by`       char(36)     DEFAULT NULL,
  `cancelled_at`       datetime(3)  DEFAULT NULL,
  `created_at`         datetime(3)  NOT NULL,
  `updated_at`         datetime(3)  NOT NULL,
  `revision`           int(10) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_goods_receipts_number` (`grn_number`),
  UNIQUE KEY `uq_goods_receipts_sequence` (`business_date`,`daily_sequence`),
  KEY `ix_goods_receipts_supplier` (`supplier_id`,`business_date`),
  KEY `ix_goods_receipts_status` (`status`,`business_date`),
  KEY `ix_goods_receipts_entry` (`purchase_entry_id`),
  KEY `ix_goods_receipts_po` (`purchase_order_id`),
  KEY `ix_goods_receipts_location` (`location_id`),
  KEY `fk_goods_receipts_created_by` (`created_by`),
  KEY `fk_goods_receipts_received_by` (`received_by`),
  KEY `fk_goods_receipts_qc_by` (`qc_by`),
  KEY `fk_goods_receipts_posted_by` (`posted_by`),
  KEY `fk_goods_receipts_cancelled_by` (`cancelled_by`),
  CONSTRAINT `fk_goods_receipts_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `entities` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_goods_receipts_entry` FOREIGN KEY (`purchase_entry_id`) REFERENCES `purchase_entries` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_goods_receipts_location` FOREIGN KEY (`location_id`) REFERENCES `inventory_locations` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_goods_receipts_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_goods_receipts_received_by` FOREIGN KEY (`received_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_goods_receipts_qc_by` FOREIGN KEY (`qc_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_goods_receipts_posted_by` FOREIGN KEY (`posted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_goods_receipts_cancelled_by` FOREIGN KEY (`cancelled_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `goods_receipt_lines` (
  `id`                     char(36)     NOT NULL,
  `goods_receipt_id`       char(36)     NOT NULL,
  `product_id`             char(36)     NOT NULL,
  `purchase_entry_line_id` char(36)     DEFAULT NULL,
  `purchase_order_line_id` char(36)     DEFAULT NULL,
  `ordered_quantity`       decimal(14,3) NOT NULL DEFAULT 0.000,
  `previously_received`    decimal(14,3) NOT NULL DEFAULT 0.000,
  `billed_quantity`        decimal(14,3) NOT NULL DEFAULT 0.000,
  `received_quantity`      decimal(14,3) NOT NULL DEFAULT 0.000,
  `accepted_quantity`      decimal(14,3) NOT NULL DEFAULT 0.000,
  `rejected_quantity`      decimal(14,3) NOT NULL DEFAULT 0.000,
  `purchase_uom_id`        char(36)     DEFAULT NULL,
  `stock_uom_id`           char(36)     DEFAULT NULL,
  `conversion_factor`      decimal(18,6) NOT NULL DEFAULT 1.000000,
  `accepted_stock_quantity` decimal(14,3) NOT NULL DEFAULT 0.000,
  `purchase_rate`          decimal(14,4) NOT NULL DEFAULT 0.0000,
  `batch_number`           varchar(60)  DEFAULT NULL,
  `manufacturing_date`     date         DEFAULT NULL,
  `expiry_date`            date         DEFAULT NULL,
  `batch_id`               char(36)     DEFAULT NULL,
  `qc_status`              enum('PENDING','ACCEPTED','PARTIAL','REJECTED') NOT NULL DEFAULT 'PENDING',
  `rejection_reason`       enum('DAMAGED','EXPIRED','NEAR_EXPIRY','QUALITY','WRONG_PRODUCT','SHORT_SUPPLY','EXCESS_SUPPLY','CONTAMINATED','TEMPERATURE','PACKAGING','OTHER') DEFAULT NULL,
  `rejection_notes`        varchar(300) DEFAULT NULL,
  `notes`                  varchar(500) DEFAULT NULL,
  `sort_order`             int(11)      NOT NULL DEFAULT 0,
  `created_at`             datetime(3)  NOT NULL,
  `updated_at`             datetime(3)  NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_goods_receipt_lines_receipt` (`goods_receipt_id`,`sort_order`),
  KEY `ix_goods_receipt_lines_product` (`product_id`),
  KEY `ix_goods_receipt_lines_entry_line` (`purchase_entry_line_id`),
  KEY `ix_goods_receipt_lines_po_line` (`purchase_order_line_id`),
  KEY `fk_goods_receipt_lines_batch` (`batch_id`),
  KEY `fk_goods_receipt_lines_purchase_uom` (`purchase_uom_id`),
  KEY `fk_goods_receipt_lines_stock_uom` (`stock_uom_id`),
  CONSTRAINT `fk_goods_receipt_lines_receipt` FOREIGN KEY (`goods_receipt_id`) REFERENCES `goods_receipts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_goods_receipt_lines_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_goods_receipt_lines_entry_line` FOREIGN KEY (`purchase_entry_line_id`) REFERENCES `purchase_entry_lines` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_goods_receipt_lines_batch` FOREIGN KEY (`batch_id`) REFERENCES `stock_batches` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_goods_receipt_lines_purchase_uom` FOREIGN KEY (`purchase_uom_id`) REFERENCES `uoms` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_goods_receipt_lines_stock_uom` FOREIGN KEY (`stock_uom_id`) REFERENCES `uoms` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `ck_goods_receipt_lines_qc` CHECK (`accepted_quantity` + `rejected_quantity` <= `received_quantity`),
  CONSTRAINT `ck_goods_receipt_lines_conversion` CHECK (`conversion_factor` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------- split receiving destinations ---
--
-- The table that makes "100 kg received, 60 to the warehouse and 40 to the day store" a real
-- movement pair rather than a fiction. One row per destination per received line; the common
-- case of a single destination is simply one row.
--
-- The service asserts that the destination quantities sum to the line's accepted quantity —
-- a sum cannot be expressed as a row-level CHECK, so it is enforced in the posting engine and
-- surfaced as the DESTINATION_SPLIT_MISMATCH exception.
CREATE TABLE IF NOT EXISTS `goods_receipt_line_destinations` (
  `id`                    char(36)     NOT NULL,
  `goods_receipt_line_id` char(36)     NOT NULL,
  `location_id`           char(36)     NOT NULL,
  `quantity`              decimal(14,3) NOT NULL,
  `notes`                 varchar(300) DEFAULT NULL,
  `sort_order`            int(11)      NOT NULL DEFAULT 0,
  `created_at`            datetime(3)  NOT NULL,
  `updated_at`            datetime(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_grn_line_destination` (`goods_receipt_line_id`,`location_id`),
  KEY `ix_grn_line_destination_location` (`location_id`),
  CONSTRAINT `fk_grn_line_destination_line` FOREIGN KEY (`goods_receipt_line_id`) REFERENCES `goods_receipt_lines` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_grn_line_destination_location` FOREIGN KEY (`location_id`) REFERENCES `inventory_locations` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `ck_grn_line_destination_qty` CHECK (`quantity` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- purchase invoices ---
CREATE TABLE IF NOT EXISTS `purchase_invoices` (
  `id`                    char(36)     NOT NULL,
  `invoice_number`        varchar(30)  NOT NULL,
  `daily_sequence`        int(10) unsigned NOT NULL,
  `business_date`         date         NOT NULL,
  `supplier_id`           char(36)     NOT NULL,
  `supplier_invoice_number` varchar(60) NOT NULL,
  `supplier_invoice_date` date         NOT NULL,
  `due_date`              date         DEFAULT NULL,
  `credit_days`           int(10) unsigned NOT NULL DEFAULT 0,
  `purchase_entry_id`     char(36)     DEFAULT NULL,
  `goods_receipt_id`      char(36)     DEFAULT NULL,
  `purchase_order_id`     char(36)     DEFAULT NULL,
  `location_id`           char(36)     DEFAULT NULL,
  `status`                enum('DRAFT','PENDING_APPROVAL','APPROVED','POSTED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `match_status`          enum('MATCHED','QUANTITY_DIFFERENCE','RATE_DIFFERENCE','TAX_DIFFERENCE','PRODUCT_DIFFERENCE','UNMATCHED','REQUIRES_APPROVAL') NOT NULL DEFAULT 'MATCHED',
  `payment_method`        enum('CASH','UPI','BANK','CARD','CHEQUE','CREDIT','OTHER') NOT NULL DEFAULT 'CASH',
  `payment_status`        enum('UNPAID','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED') NOT NULL DEFAULT 'UNPAID',
  `supplier_state_code`   varchar(2)   DEFAULT NULL,
  `is_inter_state`        tinyint(1)   NOT NULL DEFAULT 0,
  `subtotal_amount`       decimal(14,2) NOT NULL DEFAULT 0.00,
  `discount_amount`       decimal(14,2) NOT NULL DEFAULT 0.00,
  `taxable_amount`        decimal(14,2) NOT NULL DEFAULT 0.00,
  `cgst_amount`           decimal(14,2) NOT NULL DEFAULT 0.00,
  `sgst_amount`           decimal(14,2) NOT NULL DEFAULT 0.00,
  `igst_amount`           decimal(14,2) NOT NULL DEFAULT 0.00,
  `cess_amount`           decimal(14,2) NOT NULL DEFAULT 0.00,
  `tax_amount`            decimal(14,2) NOT NULL DEFAULT 0.00,
  `round_off_amount`      decimal(14,2) NOT NULL DEFAULT 0.00,
  `other_charges`         decimal(14,2) NOT NULL DEFAULT 0.00,
  `total_amount`          decimal(14,2) NOT NULL DEFAULT 0.00,
  `paid_amount`           decimal(14,2) NOT NULL DEFAULT 0.00,
  `outstanding_amount`    decimal(14,2) NOT NULL DEFAULT 0.00,
  `reference`             varchar(120) DEFAULT NULL,
  `notes`                 varchar(1000) DEFAULT NULL,
  `attachment_id`         char(36)     DEFAULT NULL,
  `created_by`            char(36)     NOT NULL,
  `approved_by`           char(36)     DEFAULT NULL,
  `approved_at`           datetime(3)  DEFAULT NULL,
  `posted_by`             char(36)     DEFAULT NULL,
  `posted_at`             datetime(3)  DEFAULT NULL,
  `cancelled_by`          char(36)     DEFAULT NULL,
  `cancelled_at`          datetime(3)  DEFAULT NULL,
  `created_at`            datetime(3)  NOT NULL,
  `updated_at`            datetime(3)  NOT NULL,
  `revision`              int(10) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_purchase_invoices_number` (`invoice_number`),
  UNIQUE KEY `uq_purchase_invoices_sequence` (`business_date`,`daily_sequence`),
  -- The duplicate-bill guarantee. Supplier + their invoice number can exist exactly once, so
  -- a double-posted bill is refused by the database rather than by a check somebody
  -- remembered to write. Cancelled invoices keep their row and therefore their claim on the
  -- number, which is correct: re-entering a cancelled bill should be a deliberate act.
  UNIQUE KEY `uq_purchase_invoices_supplier_bill` (`supplier_id`,`supplier_invoice_number`),
  KEY `ix_purchase_invoices_supplier` (`supplier_id`,`business_date`),
  KEY `ix_purchase_invoices_status` (`status`,`business_date`),
  KEY `ix_purchase_invoices_payment` (`payment_status`,`due_date`),
  KEY `ix_purchase_invoices_due` (`due_date`,`outstanding_amount`),
  KEY `ix_purchase_invoices_entry` (`purchase_entry_id`),
  KEY `ix_purchase_invoices_grn` (`goods_receipt_id`),
  KEY `ix_purchase_invoices_match` (`match_status`,`status`),
  KEY `fk_purchase_invoices_created_by` (`created_by`),
  KEY `fk_purchase_invoices_approved_by` (`approved_by`),
  KEY `fk_purchase_invoices_posted_by` (`posted_by`),
  KEY `fk_purchase_invoices_cancelled_by` (`cancelled_by`),
  KEY `fk_purchase_invoices_location` (`location_id`),
  CONSTRAINT `fk_purchase_invoices_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `entities` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_purchase_invoices_entry` FOREIGN KEY (`purchase_entry_id`) REFERENCES `purchase_entries` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_purchase_invoices_grn` FOREIGN KEY (`goods_receipt_id`) REFERENCES `goods_receipts` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_purchase_invoices_location` FOREIGN KEY (`location_id`) REFERENCES `inventory_locations` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_purchase_invoices_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_purchase_invoices_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_purchase_invoices_posted_by` FOREIGN KEY (`posted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_purchase_invoices_cancelled_by` FOREIGN KEY (`cancelled_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `purchase_invoice_lines` (
  `id`                     char(36)     NOT NULL,
  `invoice_id`             char(36)     NOT NULL,
  `product_id`             char(36)     DEFAULT NULL,
  `description`            varchar(200) DEFAULT NULL,
  `goods_receipt_line_id`  char(36)     DEFAULT NULL,
  `purchase_entry_line_id` char(36)     DEFAULT NULL,
  `quantity`               decimal(14,3) NOT NULL DEFAULT 0.000,
  `uom_id`                 char(36)     DEFAULT NULL,
  `rate`                   decimal(14,4) NOT NULL DEFAULT 0.0000,
  `discount_percent`       decimal(6,3) NOT NULL DEFAULT 0.000,
  `discount_amount`        decimal(14,2) NOT NULL DEFAULT 0.00,
  `gross_amount`           decimal(14,2) NOT NULL DEFAULT 0.00,
  `taxable_amount`         decimal(14,2) NOT NULL DEFAULT 0.00,
  `tax_profile_id`         char(36)     DEFAULT NULL,
  `hsn_sac_code`           varchar(20)  DEFAULT NULL,
  `tax_rate`               decimal(6,3) NOT NULL DEFAULT 0.000,
  `cgst_amount`            decimal(14,2) NOT NULL DEFAULT 0.00,
  `sgst_amount`            decimal(14,2) NOT NULL DEFAULT 0.00,
  `igst_amount`            decimal(14,2) NOT NULL DEFAULT 0.00,
  `cess_amount`            decimal(14,2) NOT NULL DEFAULT 0.00,
  `tax_amount`             decimal(14,2) NOT NULL DEFAULT 0.00,
  `line_total`             decimal(14,2) NOT NULL DEFAULT 0.00,
  `notes`                  varchar(500) DEFAULT NULL,
  `sort_order`             int(11)      NOT NULL DEFAULT 0,
  `created_at`             datetime(3)  NOT NULL,
  `updated_at`             datetime(3)  NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_purchase_invoice_lines_invoice` (`invoice_id`,`sort_order`),
  KEY `ix_purchase_invoice_lines_product` (`product_id`),
  KEY `ix_purchase_invoice_lines_grn_line` (`goods_receipt_line_id`),
  KEY `fk_purchase_invoice_lines_tax_profile` (`tax_profile_id`),
  KEY `fk_purchase_invoice_lines_uom` (`uom_id`),
  CONSTRAINT `fk_purchase_invoice_lines_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `purchase_invoices` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  -- Non-cascading for the same reason as purchase_entry_lines: the subject CHECK reads it.
  CONSTRAINT `fk_purchase_invoice_lines_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`),
  CONSTRAINT `fk_purchase_invoice_lines_grn_line` FOREIGN KEY (`goods_receipt_line_id`) REFERENCES `goods_receipt_lines` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_purchase_invoice_lines_tax_profile` FOREIGN KEY (`tax_profile_id`) REFERENCES `tax_profiles` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_purchase_invoice_lines_uom` FOREIGN KEY (`uom_id`) REFERENCES `uoms` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `ck_purchase_invoice_lines_subject` CHECK (`product_id` IS NOT NULL OR `description` IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------- vendor ledger ---
--
-- The subsidiary ledger for suppliers. Append-only for the same reason the stock ledger is:
-- a supplier balance that can be edited is a supplier balance nobody can defend.
--
-- Sign convention, stated once: kept from the supplier's point of view. CREDIT increases what
-- we owe them, DEBIT reduces it. So an invoice is a credit and paying it is a debit.
--
-- `running_balance` is the balance for that supplier after this entry, maintained under a row
-- lock on the supplier in the same transaction. Denormalised so a statement reads without a
-- window function, and so a broken chain is detectable.
CREATE TABLE IF NOT EXISTS `vendor_ledger_entries` (
  `id`               char(36)     NOT NULL,
  `entry_seq`        bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `supplier_id`      char(36)     NOT NULL,
  `business_date`    date         NOT NULL,
  `transaction_type` enum('OPENING_BALANCE','PURCHASE_INVOICE','PAYMENT','PURCHASE_RETURN','DEBIT_MEMO','CREDIT_MEMO','ADVANCE','ADJUSTMENT') NOT NULL,
  `document_number`  varchar(30)  DEFAULT NULL,
  `source_type`      varchar(40)  NOT NULL,
  `source_id`        char(36)     NOT NULL,
  `reference`        varchar(120) DEFAULT NULL,
  `narration`        varchar(300) DEFAULT NULL,
  `debit_amount`     decimal(14,2) NOT NULL DEFAULT 0.00,
  `credit_amount`    decimal(14,2) NOT NULL DEFAULT 0.00,
  `running_balance`  decimal(14,2) NOT NULL DEFAULT 0.00,
  `occurred_at`      datetime(3)  NOT NULL,
  `actor_id`         char(36)     DEFAULT NULL,
  `created_at`       datetime(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vendor_ledger_seq` (`entry_seq`),
  KEY `ix_vendor_ledger_statement` (`supplier_id`,`entry_seq`),
  KEY `ix_vendor_ledger_date` (`supplier_id`,`business_date`),
  KEY `ix_vendor_ledger_source` (`source_type`,`source_id`),
  KEY `ix_vendor_ledger_type` (`transaction_type`,`business_date`),
  KEY `fk_vendor_ledger_actor` (`actor_id`),
  CONSTRAINT `fk_vendor_ledger_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `entities` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_vendor_ledger_actor` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  -- An entry moves money one way. Both sides populated is a bug in the caller.
  CONSTRAINT `ck_vendor_ledger_one_side` CHECK (
    (`debit_amount` > 0 AND `credit_amount` = 0) OR
    (`credit_amount` > 0 AND `debit_amount` = 0) OR
    (`debit_amount` = 0 AND `credit_amount` = 0 AND `transaction_type` = 'OPENING_BALANCE')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------- accounts payable ---
--
-- One row per invoice that leaves a liability. `outstanding_amount` is maintained as payments
-- allocate against it; the invoice's own amount is never touched, so what the supplier
-- originally claimed survives however the settlement plays out.
CREATE TABLE IF NOT EXISTS `accounts_payable` (
  `id`                 char(36)     NOT NULL,
  `supplier_id`        char(36)     NOT NULL,
  `purchase_invoice_id` char(36)    NOT NULL,
  `document_number`    varchar(30)  NOT NULL,
  `supplier_invoice_number` varchar(60) DEFAULT NULL,
  `invoice_date`       date         NOT NULL,
  `due_date`           date         DEFAULT NULL,
  `credit_days`        int(10) unsigned NOT NULL DEFAULT 0,
  `original_amount`    decimal(14,2) NOT NULL,
  `paid_amount`        decimal(14,2) NOT NULL DEFAULT 0.00,
  `adjusted_amount`    decimal(14,2) NOT NULL DEFAULT 0.00,
  `outstanding_amount` decimal(14,2) NOT NULL,
  `status`             enum('UNPAID','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED') NOT NULL DEFAULT 'UNPAID',
  -- Queued for payment by someone holding PAYABLE_SUBMIT; the payment run reads this.
  `is_queued`          tinyint(1)   NOT NULL DEFAULT 0,
  `queued_by`          char(36)     DEFAULT NULL,
  `queued_at`          datetime(3)  DEFAULT NULL,
  `notes`              varchar(500) DEFAULT NULL,
  `created_at`         datetime(3)  NOT NULL,
  `updated_at`         datetime(3)  NOT NULL,
  `version`            int(10) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_accounts_payable_invoice` (`purchase_invoice_id`),
  KEY `ix_accounts_payable_supplier` (`supplier_id`,`status`),
  KEY `ix_accounts_payable_due` (`due_date`,`status`),
  KEY `ix_accounts_payable_outstanding` (`status`,`outstanding_amount`),
  KEY `ix_accounts_payable_queue` (`is_queued`,`due_date`),
  KEY `fk_accounts_payable_queued_by` (`queued_by`),
  CONSTRAINT `fk_accounts_payable_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `entities` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_accounts_payable_invoice` FOREIGN KEY (`purchase_invoice_id`) REFERENCES `purchase_invoices` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_accounts_payable_queued_by` FOREIGN KEY (`queued_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ck_accounts_payable_amounts` CHECK (
    `paid_amount` >= 0 AND `adjusted_amount` >= 0 AND `original_amount` >= 0
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- vendor payments ---
CREATE TABLE IF NOT EXISTS `vendor_payments` (
  `id`               char(36)     NOT NULL,
  `payment_number`   varchar(30)  NOT NULL,
  `daily_sequence`   int(10) unsigned NOT NULL,
  `business_date`    date         NOT NULL,
  `supplier_id`      char(36)     NOT NULL,
  `payment_date`     date         NOT NULL,
  `method`           enum('CASH','UPI','BANK','CARD','CHEQUE','CREDIT','OTHER') NOT NULL DEFAULT 'CASH',
  `status`           enum('DRAFT','SCHEDULED','POSTED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `amount`           decimal(14,2) NOT NULL,
  -- Paid without naming an invoice: an advance, or money on account. Allocated later.
  `unallocated_amount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `reference`        varchar(120) DEFAULT NULL,
  `instrument_number` varchar(60) DEFAULT NULL,
  `instrument_date`  date         DEFAULT NULL,
  `bank_name`        varchar(120) DEFAULT NULL,
  `notes`            varchar(500) DEFAULT NULL,
  -- Set when the payment was made as part of posting a cash purchase, so a settled bill can
  -- be traced from either end.
  `purchase_entry_id` char(36)    DEFAULT NULL,
  `created_by`       char(36)     NOT NULL,
  `posted_by`        char(36)     DEFAULT NULL,
  `posted_at`        datetime(3)  DEFAULT NULL,
  `cancelled_by`     char(36)     DEFAULT NULL,
  `cancelled_at`     datetime(3)  DEFAULT NULL,
  `created_at`       datetime(3)  NOT NULL,
  `updated_at`       datetime(3)  NOT NULL,
  `revision`         int(10) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vendor_payments_number` (`payment_number`),
  UNIQUE KEY `uq_vendor_payments_sequence` (`business_date`,`daily_sequence`),
  KEY `ix_vendor_payments_supplier` (`supplier_id`,`business_date`),
  KEY `ix_vendor_payments_status` (`status`,`business_date`),
  KEY `ix_vendor_payments_entry` (`purchase_entry_id`),
  KEY `fk_vendor_payments_created_by` (`created_by`),
  KEY `fk_vendor_payments_posted_by` (`posted_by`),
  KEY `fk_vendor_payments_cancelled_by` (`cancelled_by`),
  CONSTRAINT `fk_vendor_payments_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `entities` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_vendor_payments_entry` FOREIGN KEY (`purchase_entry_id`) REFERENCES `purchase_entries` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_vendor_payments_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_vendor_payments_posted_by` FOREIGN KEY (`posted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_vendor_payments_cancelled_by` FOREIGN KEY (`cancelled_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ck_vendor_payments_amount` CHECK (`amount` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Which invoices a payment settled, and by how much. A payment with no allocation row is an
-- advance; the sum of allocations may never exceed the payment amount.
CREATE TABLE IF NOT EXISTS `vendor_payment_allocations` (
  `id`                  char(36)     NOT NULL,
  `payment_id`          char(36)     NOT NULL,
  `accounts_payable_id` char(36)     NOT NULL,
  `purchase_invoice_id` char(36)     NOT NULL,
  `allocated_amount`    decimal(14,2) NOT NULL,
  `created_at`          datetime(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vendor_payment_allocation` (`payment_id`,`accounts_payable_id`),
  KEY `ix_vendor_payment_allocations_payable` (`accounts_payable_id`),
  KEY `ix_vendor_payment_allocations_invoice` (`purchase_invoice_id`),
  CONSTRAINT `fk_vendor_payment_allocations_payment` FOREIGN KEY (`payment_id`) REFERENCES `vendor_payments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_vendor_payment_allocations_payable` FOREIGN KEY (`accounts_payable_id`) REFERENCES `accounts_payable` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_vendor_payment_allocations_invoice` FOREIGN KEY (`purchase_invoice_id`) REFERENCES `purchase_invoices` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `ck_vendor_payment_allocations_amount` CHECK (`allocated_amount` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------- purchase exceptions ---
--
-- What is wrong with a document, attached to the document rather than raised as a dialog and
-- forgotten. The UI is exception-driven: a clean purchase carries none of these and posts in
-- one keystroke; anything else shows exactly what is wrong and what would resolve it.
--
-- An OVERRIDABLE exception posts only when someone explicitly confirms it, and that
-- confirmation is recorded here — which is what makes "who waved this through" answerable.
CREATE TABLE IF NOT EXISTS `purchase_exceptions` (
  `id`             char(36)     NOT NULL,
  `document_type`  varchar(40)  NOT NULL,
  `document_id`    char(36)     NOT NULL,
  `document_line_id` char(36)   DEFAULT NULL,
  `code`           varchar(48)  NOT NULL,
  `severity`       enum('INFO','WARNING','OVERRIDABLE','BLOCKING') NOT NULL DEFAULT 'WARNING',
  `message`        varchar(500) NOT NULL,
  `expected_value` varchar(120) DEFAULT NULL,
  `actual_value`   varchar(120) DEFAULT NULL,
  `is_resolved`    tinyint(1)   NOT NULL DEFAULT 0,
  `resolved_by`    char(36)     DEFAULT NULL,
  `resolved_at`    datetime(3)  DEFAULT NULL,
  `resolution_note` varchar(300) DEFAULT NULL,
  `created_at`     datetime(3)  NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_purchase_exceptions_document` (`document_type`,`document_id`),
  KEY `ix_purchase_exceptions_open` (`document_type`,`is_resolved`,`severity`),
  KEY `ix_purchase_exceptions_code` (`code`,`created_at`),
  KEY `fk_purchase_exceptions_resolved_by` (`resolved_by`),
  CONSTRAINT `fk_purchase_exceptions_resolved_by` FOREIGN KEY (`resolved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------- purchase price history ---
--
-- One row per product per posted purchase. Denormalised from the invoice lines on purpose:
-- price history is read constantly (last rate on every entry line, anomaly detection on every
-- post, supplier comparison on demand) and reconstructing it from documents each time would
-- make the fast path slow.
CREATE TABLE IF NOT EXISTS `purchase_price_history` (
  `id`              char(36)     NOT NULL,
  `product_id`      char(36)     NOT NULL,
  `supplier_id`     char(36)     NOT NULL,
  `business_date`   date         NOT NULL,
  `source_type`     varchar(40)  NOT NULL,
  `source_id`       char(36)     NOT NULL,
  `document_number` varchar(30)  DEFAULT NULL,
  `quantity`        decimal(14,3) NOT NULL DEFAULT 0.000,
  `uom_id`          char(36)     DEFAULT NULL,
  `rate`            decimal(14,4) NOT NULL DEFAULT 0.0000,
  `discount_percent` decimal(6,3) NOT NULL DEFAULT 0.000,
  `tax_rate`        decimal(6,3) NOT NULL DEFAULT 0.000,
  -- Rate after discount, per STOCK unit. The only figure that is comparable across suppliers
  -- who quote in different pack sizes, which is the entire point of keeping this table.
  `net_rate_per_stock_unit` decimal(14,4) NOT NULL DEFAULT 0.0000,
  `created_at`      datetime(3)  NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_price_history_product_date` (`product_id`,`business_date`),
  KEY `ix_price_history_supplier_product` (`supplier_id`,`product_id`,`business_date`),
  KEY `ix_price_history_source` (`source_type`,`source_id`),
  KEY `fk_price_history_uom` (`uom_id`),
  CONSTRAINT `fk_price_history_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_price_history_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `entities` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_price_history_uom` FOREIGN KEY (`uom_id`) REFERENCES `uoms` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Close the loop from a purchase entry to what it generated, now that both tables exist.
ALTER TABLE `purchase_entries`
  ADD CONSTRAINT `fk_purchase_entries_grn` FOREIGN KEY (`goods_receipt_id`) REFERENCES `goods_receipts` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_purchase_entries_invoice` FOREIGN KEY (`purchase_invoice_id`) REFERENCES `purchase_invoices` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
