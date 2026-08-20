-- ---------------------------------------------------------------------------------------
-- Purchase management, part 2: the inventory core.
--
-- Three tables carry the weight here and it is worth being explicit about how they relate,
-- because getting this wrong is how inventory systems quietly start lying:
--
--   stock_ledger    append-only history. Never updated, never deleted. Every row records one
--                   movement of one product at one location, and every row names the document
--                   that caused it. This is the truth.
--   stock_balances  a materialised cache of "what is on hand right now", maintained inside the
--                   same transaction as the ledger rows that move it. It exists purely so the
--                   till and the purchase screen do not have to sum a million-row history. It
--                   is derivable from the ledger and can be rebuilt from it at any time.
--   stock_batches   the identity of a batch — its number, manufacture and expiry — held once
--                   rather than repeated on every movement.
--
-- The ledger is the record of account; the balance is an optimisation. If they ever disagree
-- the ledger is right, and `scripts/verify-stock-integrity.mjs` will say so.
-- ---------------------------------------------------------------------------------------

-- ------------------------------------------------------------------------- batches ---
--
-- A batch belongs to a product, not to a location: the same delivery of milk split across the
-- day store and the kitchen is one batch in two places, and it must expire in both on the same
-- day. Quantities therefore live on the balance, not here.
CREATE TABLE IF NOT EXISTS `stock_batches` (
  `id`                  char(36)     NOT NULL,
  `product_id`          char(36)     NOT NULL,
  `batch_number`        varchar(60)  DEFAULT NULL,
  `manufacturing_date`  date         DEFAULT NULL,
  `expiry_date`         date         DEFAULT NULL,
  `supplier_id`         char(36)     DEFAULT NULL,
  `first_received_at`   datetime(3)  NOT NULL,
  `initial_quantity`    decimal(14,3) NOT NULL DEFAULT 0.000,
  `unit_cost`           decimal(14,4) NOT NULL DEFAULT 0.0000,
  `source_type`         enum('GOODS_RECEIPT','PURCHASE_RETURN','STOCK_TRANSFER','STOCK_ADJUSTMENT','STOCK_COUNT','OPENING_BALANCE','PRODUCTION_ORDER','POS_ORDER') NOT NULL DEFAULT 'GOODS_RECEIPT',
  `source_id`           char(36)     DEFAULT NULL,
  `status`              enum('ACTIVE','EXHAUSTED','EXPIRED','QUARANTINED') NOT NULL DEFAULT 'ACTIVE',
  `notes`               varchar(500) DEFAULT NULL,
  `created_by`          char(36)     DEFAULT NULL,
  `created_at`          datetime(3)  NOT NULL,
  `updated_at`          datetime(3)  NOT NULL,
  PRIMARY KEY (`id`),
  -- One batch number per product. Two deliveries quoting the same number are the same batch,
  -- which is what lets a second receipt top up a batch rather than fragment it. NULL batch
  -- numbers do not collide in MySQL, so untracked products are unaffected.
  UNIQUE KEY `uq_stock_batches_product_number` (`product_id`,`batch_number`),
  KEY `ix_stock_batches_expiry` (`expiry_date`,`status`),
  KEY `ix_stock_batches_product_expiry` (`product_id`,`status`,`expiry_date`),
  KEY `ix_stock_batches_source` (`source_type`,`source_id`),
  KEY `fk_stock_batches_supplier` (`supplier_id`),
  KEY `fk_stock_batches_created_by` (`created_by`),
  CONSTRAINT `fk_stock_batches_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_batches_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `entities` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_batches_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ck_stock_batches_dates` CHECK (
    `expiry_date` IS NULL OR `manufacturing_date` IS NULL OR `expiry_date` >= `manufacturing_date`
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------- stock ledger ---
--
-- Append-only. There is deliberately no `updated_at`, no `deleted_at` and no `revision`: a
-- movement that turns out to be wrong is corrected by posting the opposite movement, never by
-- editing history. Nothing in the application issues UPDATE or DELETE against this table.
--
-- `ledger_seq` is a plain AUTO_INCREMENT and is the total order of movements. Wall-clock time
-- is not reliable for ordering — two receipts in the same millisecond are ordinary — and the
-- running balance has to be reconstructible in a deterministic sequence.
CREATE TABLE IF NOT EXISTS `stock_ledger` (
  `id`                char(36)     NOT NULL,
  `ledger_seq`        bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `product_id`        char(36)     NOT NULL,
  `location_id`       char(36)     NOT NULL,
  `batch_id`          char(36)     DEFAULT NULL,
  `movement_type`     enum('OPENING_STOCK','PURCHASE_RECEIPT','PURCHASE_RETURN','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT_IN','ADJUSTMENT_OUT','PRODUCTION_OUTPUT','PRODUCTION_CONSUMPTION','POS_SALE','WASTAGE','EXPIRY','DIRECT_ISSUE') NOT NULL,
  `direction`         enum('IN','OUT') NOT NULL,
  -- Held as two columns rather than one signed number so that SUM(quantity_in) and
  -- SUM(quantity_out) are both trivially indexable and a report cannot accidentally net them.
  `quantity_in`       decimal(14,3) NOT NULL DEFAULT 0.000,
  `quantity_out`      decimal(14,3) NOT NULL DEFAULT 0.000,
  `unit_cost`         decimal(14,4) NOT NULL DEFAULT 0.0000,
  `movement_value`    decimal(14,2) NOT NULL DEFAULT 0.00,
  -- The location's balance for this product *after* this movement was applied. Denormalised
  -- deliberately: it makes a stock card readable without a window function, and it is what
  -- makes tampering detectable — the chain has to add up.
  `balance_quantity`  decimal(14,3) NOT NULL DEFAULT 0.000,
  `balance_value`     decimal(14,2) NOT NULL DEFAULT 0.00,
  `source_type`       enum('GOODS_RECEIPT','PURCHASE_RETURN','STOCK_TRANSFER','STOCK_ADJUSTMENT','STOCK_COUNT','OPENING_BALANCE','PRODUCTION_ORDER','POS_ORDER') NOT NULL,
  `source_id`         char(36)     NOT NULL,
  `source_line_id`    char(36)     DEFAULT NULL,
  `source_document_number` varchar(30) DEFAULT NULL,
  -- The other end of a transfer, so a pair of movements can be shown as one line.
  `counterparty_location_id` char(36) DEFAULT NULL,
  `occurred_at`       datetime(3)  NOT NULL,
  `business_date`     date         NOT NULL,
  `actor_id`          char(36)     DEFAULT NULL,
  `notes`             varchar(500) DEFAULT NULL,
  `created_at`        datetime(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_ledger_seq` (`ledger_seq`),
  -- The stock card: one product at one location in movement order.
  KEY `ix_stock_ledger_card` (`product_id`,`location_id`,`ledger_seq`),
  KEY `ix_stock_ledger_location_date` (`location_id`,`business_date`),
  KEY `ix_stock_ledger_product_date` (`product_id`,`business_date`),
  -- Every movement must be traceable back to its document, and a document must be able to
  -- list everything it moved. This index is what makes a reversal findable.
  KEY `ix_stock_ledger_source` (`source_type`,`source_id`),
  KEY `ix_stock_ledger_batch` (`batch_id`),
  KEY `ix_stock_ledger_movement` (`movement_type`,`business_date`),
  KEY `ix_stock_ledger_actor` (`actor_id`),
  CONSTRAINT `fk_stock_ledger_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_ledger_location` FOREIGN KEY (`location_id`) REFERENCES `inventory_locations` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_ledger_batch` FOREIGN KEY (`batch_id`) REFERENCES `stock_batches` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_ledger_counterparty` FOREIGN KEY (`counterparty_location_id`) REFERENCES `inventory_locations` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_ledger_actor` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  -- A movement goes one way. Both columns populated, or neither, is a bug in the caller and
  -- the database refuses it rather than storing an unreadable row.
  CONSTRAINT `ck_stock_ledger_one_direction` CHECK (
    (`direction` = 'IN'  AND `quantity_in` > 0 AND `quantity_out` = 0) OR
    (`direction` = 'OUT' AND `quantity_out` > 0 AND `quantity_in` = 0)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------ stock balances ---
--
-- One row per product + location + batch. `version` is an optimistic lock; the posting engine
-- also takes a row lock with SELECT ... FOR UPDATE, so two receipts of the same product into
-- the same store serialise instead of racing and losing one of the movements.
--
-- `batch_key` exists because MySQL does not treat NULLs as equal in a unique index, so a
-- UNIQUE over a nullable batch_id would happily allow unlimited duplicate untracked rows.
-- Collapsing NULL to '-' makes the constraint mean what it says.
--
-- It would ideally be a generated column, but MariaDB 10.6 rejects IFNULL/COALESCE/CASE in a
-- GENERATED ALWAYS AS clause here. So the application sets it and the CHECK constraint at the
-- foot of the table makes the database, rather than a convention, the thing that guarantees
-- the two always agree. The CHECK is written without function calls for the same reason, and
-- the batch foreign key drops ON UPDATE CASCADE because MariaDB will not allow a cascading
-- column inside a CHECK — no loss, since batch ids are immutable UUIDs.
CREATE TABLE IF NOT EXISTS `stock_balances` (
  `id`                char(36)     NOT NULL,
  `product_id`        char(36)     NOT NULL,
  `location_id`       char(36)     NOT NULL,
  `batch_id`          char(36)     DEFAULT NULL,
  `batch_key`         char(36)     NOT NULL DEFAULT '-',
  `quantity`          decimal(14,3) NOT NULL DEFAULT 0.000,
  -- Committed to a transfer or a production order but not yet issued. Available = quantity
  -- less this; purchase requirement suggestions read the difference, not the raw quantity.
  `reserved_quantity` decimal(14,3) NOT NULL DEFAULT 0.000,
  `average_cost`      decimal(14,4) NOT NULL DEFAULT 0.0000,
  `stock_value`       decimal(14,2) NOT NULL DEFAULT 0.00,
  `last_movement_at`  datetime(3)  DEFAULT NULL,
  `last_ledger_seq`   bigint(20) unsigned NOT NULL DEFAULT 0,
  `version`           int(10) unsigned NOT NULL DEFAULT 1,
  `created_at`        datetime(3)  NOT NULL,
  `updated_at`        datetime(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_balances` (`product_id`,`location_id`,`batch_key`),
  KEY `ix_stock_balances_location` (`location_id`,`quantity`),
  KEY `ix_stock_balances_product` (`product_id`,`quantity`),
  KEY `ix_stock_balances_batch` (`batch_id`),
  -- Drives the "what is running out" panel without scanning the whole table.
  KEY `ix_stock_balances_nonzero` (`product_id`,`location_id`,`quantity`),
  CONSTRAINT `fk_stock_balances_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_balances_location` FOREIGN KEY (`location_id`) REFERENCES `inventory_locations` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_balances_batch` FOREIGN KEY (`batch_id`) REFERENCES `stock_batches` (`id`),
  CONSTRAINT `ck_stock_balances_reserved` CHECK (`reserved_quantity` >= 0),
  -- The unique index above only means what it claims if this holds.
  CONSTRAINT `ck_stock_balances_batch_key` CHECK (
    (`batch_id` IS NULL     AND `batch_key` = '-') OR
    (`batch_id` IS NOT NULL AND `batch_key` = `batch_id`)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------- stock adjustments ---
CREATE TABLE IF NOT EXISTS `stock_adjustments` (
  `id`                char(36)     NOT NULL,
  `adjustment_number` varchar(30)  NOT NULL,
  `daily_sequence`    int(10) unsigned NOT NULL,
  `business_date`     date         NOT NULL,
  `location_id`       char(36)     NOT NULL,
  `reason`            enum('COUNT_VARIANCE','WASTAGE','EXPIRY','DAMAGE','THEFT','OPENING','CORRECTION','OTHER') NOT NULL DEFAULT 'CORRECTION',
  `status`            enum('DRAFT','SUBMITTED','APPROVED','POSTED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `stock_count_id`    char(36)     DEFAULT NULL,
  `notes`             varchar(1000) DEFAULT NULL,
  `total_in_value`    decimal(14,2) NOT NULL DEFAULT 0.00,
  `total_out_value`   decimal(14,2) NOT NULL DEFAULT 0.00,
  `created_by`        char(36)     NOT NULL,
  `submitted_by`      char(36)     DEFAULT NULL,
  `submitted_at`      datetime(3)  DEFAULT NULL,
  `approved_by`       char(36)     DEFAULT NULL,
  `approved_at`       datetime(3)  DEFAULT NULL,
  `posted_by`         char(36)     DEFAULT NULL,
  `posted_at`         datetime(3)  DEFAULT NULL,
  `cancelled_by`      char(36)     DEFAULT NULL,
  `cancelled_at`      datetime(3)  DEFAULT NULL,
  `created_at`        datetime(3)  NOT NULL,
  `updated_at`        datetime(3)  NOT NULL,
  `revision`          int(10) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_adjustments_number` (`adjustment_number`),
  UNIQUE KEY `uq_stock_adjustments_sequence` (`business_date`,`daily_sequence`),
  KEY `ix_stock_adjustments_status` (`status`,`business_date`),
  KEY `ix_stock_adjustments_location` (`location_id`,`business_date`),
  KEY `ix_stock_adjustments_count` (`stock_count_id`),
  KEY `fk_stock_adjustments_created_by` (`created_by`),
  KEY `fk_stock_adjustments_approved_by` (`approved_by`),
  KEY `fk_stock_adjustments_posted_by` (`posted_by`),
  KEY `fk_stock_adjustments_submitted_by` (`submitted_by`),
  KEY `fk_stock_adjustments_cancelled_by` (`cancelled_by`),
  CONSTRAINT `fk_stock_adjustments_location` FOREIGN KEY (`location_id`) REFERENCES `inventory_locations` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_adjustments_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_adjustments_submitted_by` FOREIGN KEY (`submitted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_adjustments_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_adjustments_posted_by` FOREIGN KEY (`posted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_adjustments_cancelled_by` FOREIGN KEY (`cancelled_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `stock_adjustment_lines` (
  `id`               char(36)     NOT NULL,
  `adjustment_id`    char(36)     NOT NULL,
  `product_id`       char(36)     NOT NULL,
  `batch_id`         char(36)     DEFAULT NULL,
  `direction`        enum('IN','OUT') NOT NULL,
  `quantity`         decimal(14,3) NOT NULL,
  `unit_cost`        decimal(14,4) NOT NULL DEFAULT 0.0000,
  `line_value`       decimal(14,2) NOT NULL DEFAULT 0.00,
  `system_quantity`  decimal(14,3) DEFAULT NULL,
  `reason`           enum('COUNT_VARIANCE','WASTAGE','EXPIRY','DAMAGE','THEFT','OPENING','CORRECTION','OTHER') DEFAULT NULL,
  `notes`            varchar(500) DEFAULT NULL,
  `sort_order`       int(11)      NOT NULL DEFAULT 0,
  `created_at`       datetime(3)  NOT NULL,
  `updated_at`       datetime(3)  NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_stock_adjustment_lines_adjustment` (`adjustment_id`,`sort_order`),
  KEY `ix_stock_adjustment_lines_product` (`product_id`),
  KEY `fk_stock_adjustment_lines_batch` (`batch_id`),
  CONSTRAINT `fk_stock_adjustment_lines_adjustment` FOREIGN KEY (`adjustment_id`) REFERENCES `stock_adjustments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_adjustment_lines_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_adjustment_lines_batch` FOREIGN KEY (`batch_id`) REFERENCES `stock_batches` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `ck_stock_adjustment_lines_qty` CHECK (`quantity` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------- stock counts ---
--
-- Counting is separate from adjusting. A count records what was physically found; approving it
-- produces an adjustment, and that adjustment is what touches stock. Keeping them apart is what
-- lets a disputed count be recounted without having already rewritten the balance.
CREATE TABLE IF NOT EXISTS `stock_counts` (
  `id`             char(36)     NOT NULL,
  `count_number`   varchar(30)  NOT NULL,
  `daily_sequence` int(10) unsigned NOT NULL,
  `business_date`  date         NOT NULL,
  `location_id`    char(36)     NOT NULL,
  `status`         enum('DRAFT','COUNTING','SUBMITTED','APPROVED','POSTED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `is_full_count`  tinyint(1)   NOT NULL DEFAULT 1,
  `notes`          varchar(1000) DEFAULT NULL,
  `adjustment_id`  char(36)     DEFAULT NULL,
  `counted_by`     char(36)     DEFAULT NULL,
  `counted_at`     datetime(3)  DEFAULT NULL,
  `created_by`     char(36)     NOT NULL,
  `submitted_by`   char(36)     DEFAULT NULL,
  `submitted_at`   datetime(3)  DEFAULT NULL,
  `approved_by`    char(36)     DEFAULT NULL,
  `approved_at`    datetime(3)  DEFAULT NULL,
  `posted_at`      datetime(3)  DEFAULT NULL,
  `cancelled_by`   char(36)     DEFAULT NULL,
  `cancelled_at`   datetime(3)  DEFAULT NULL,
  `created_at`     datetime(3)  NOT NULL,
  `updated_at`     datetime(3)  NOT NULL,
  `revision`       int(10) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_counts_number` (`count_number`),
  UNIQUE KEY `uq_stock_counts_sequence` (`business_date`,`daily_sequence`),
  KEY `ix_stock_counts_status` (`status`,`business_date`),
  KEY `ix_stock_counts_location` (`location_id`,`business_date`),
  KEY `fk_stock_counts_adjustment` (`adjustment_id`),
  KEY `fk_stock_counts_created_by` (`created_by`),
  KEY `fk_stock_counts_counted_by` (`counted_by`),
  KEY `fk_stock_counts_submitted_by` (`submitted_by`),
  KEY `fk_stock_counts_approved_by` (`approved_by`),
  KEY `fk_stock_counts_cancelled_by` (`cancelled_by`),
  CONSTRAINT `fk_stock_counts_location` FOREIGN KEY (`location_id`) REFERENCES `inventory_locations` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_counts_adjustment` FOREIGN KEY (`adjustment_id`) REFERENCES `stock_adjustments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_counts_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_counts_counted_by` FOREIGN KEY (`counted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_counts_submitted_by` FOREIGN KEY (`submitted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_counts_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_counts_cancelled_by` FOREIGN KEY (`cancelled_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `stock_count_lines` (
  `id`               char(36)     NOT NULL,
  `stock_count_id`   char(36)     NOT NULL,
  `product_id`       char(36)     NOT NULL,
  `batch_id`         char(36)     DEFAULT NULL,
  -- Snapshotted when the count sheet was raised, so the variance is against what the system
  -- believed at that moment rather than against a balance that moved while people counted.
  `system_quantity`  decimal(14,3) NOT NULL DEFAULT 0.000,
  `physical_quantity` decimal(14,3) DEFAULT NULL,
  -- Physical less system. Written by the service that records the count rather than generated,
  -- for the same MariaDB limitation described on `stock_balances.batch_key`. Stored rather
  -- than computed on read so a variance report can index and sort on it.
  `variance_quantity` decimal(14,3) NOT NULL DEFAULT 0.000,
  `unit_cost`        decimal(14,4) NOT NULL DEFAULT 0.0000,
  `reason`           enum('COUNT_VARIANCE','WASTAGE','EXPIRY','DAMAGE','THEFT','OPENING','CORRECTION','OTHER') DEFAULT NULL,
  `notes`            varchar(500) DEFAULT NULL,
  `is_counted`       tinyint(1)   NOT NULL DEFAULT 0,
  `sort_order`       int(11)      NOT NULL DEFAULT 0,
  `created_at`       datetime(3)  NOT NULL,
  `updated_at`       datetime(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_count_lines` (`stock_count_id`,`product_id`,`batch_id`),
  KEY `ix_stock_count_lines_count` (`stock_count_id`,`sort_order`),
  KEY `ix_stock_count_lines_product` (`product_id`),
  KEY `fk_stock_count_lines_batch` (`batch_id`),
  CONSTRAINT `fk_stock_count_lines_count` FOREIGN KEY (`stock_count_id`) REFERENCES `stock_counts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_count_lines_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_count_lines_batch` FOREIGN KEY (`batch_id`) REFERENCES `stock_batches` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------ posting idempotency ---
--
-- Guards against the same post being applied twice: a double-clicked Post button, a client
-- retry after a timeout that actually succeeded, or a re-submitted OCR draft. The caller
-- supplies a key (the X-Idempotency-Key header, already defined in shared constants); the
-- unique index is what makes the guarantee, not application logic.
--
-- The stored `result_id` lets a replay return the original document instead of an error, so a
-- retry looks like success to the client — which is the only behaviour that makes retrying safe.
CREATE TABLE IF NOT EXISTS `posting_idempotency` (
  `id`              char(36)     NOT NULL,
  `idempotency_key` varchar(120) NOT NULL,
  `operation`       varchar(60)  NOT NULL,
  `request_hash`    char(64)     NOT NULL,
  `result_type`     varchar(60)  DEFAULT NULL,
  `result_id`       char(36)     DEFAULT NULL,
  `result_number`   varchar(30)  DEFAULT NULL,
  `actor_id`        char(36)     DEFAULT NULL,
  `created_at`      datetime(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_posting_idempotency` (`operation`,`idempotency_key`),
  KEY `ix_posting_idempotency_created` (`created_at`),
  KEY `fk_posting_idempotency_actor` (`actor_id`),
  CONSTRAINT `fk_posting_idempotency_actor` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
