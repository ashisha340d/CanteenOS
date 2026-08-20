-- ---------------------------------------------------------------------------------------
-- Purchase management, part 3: grant the new capabilities to the roles that hold them.
--
-- `role_capabilities` is seeded by migration, not at runtime — PermissionsCacheService reads
-- the live table and never back-fills it from code. So a capability that exists in
-- shared/src/permissions but has no row here is one that nobody can exercise: every route
-- guarded by it answers 403, including for an Admin.
--
-- The grants below were generated from ROLE_CAPABILITIES itself
-- (backend/scripts/gen-purchase-capability-sql.mjs) rather than typed out. Thirty-seven
-- capabilities across five roles is a hundred-odd chances to mistype one, and a mistyped
-- grant is either a screen nobody can open or a privilege nobody intended.
--
-- The split, in one line: a Manager buys the goods and posts the purchase including settling
-- it in cash; an Admin additionally approves the things that move money or rewrite a balance
-- with no supplier delivery behind them; a User reads the product master, sees their own
-- shelf, counts it and receives a transfer into it.
--
-- ON DUPLICATE KEY UPDATE makes this idempotent, which matters because these grants may
-- already have been applied by hand on a database that ran ahead of this migration.
-- ---------------------------------------------------------------------------------------

-- 37 capabilities, 108 grants.
--
-- Grants per role:
--   SUPER_ADMIN  37/37
--   ADMIN        37/37
--   MANAGER      30/37
--   USER          4/37
--   EMPLOYEE      0/37

INSERT INTO `role_capabilities` (`role`, `capability`, `updated_by`, `updated_at`) VALUES
  ('ADMIN', 'inventory.location.manage', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'inventory.read', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'inventory.uom.manage', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'product.read', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'product.write', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.credit_memo.approve', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.credit_memo.create', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.debit_memo.approve', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.debit_memo.create', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.entry.create', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.invoice.approve', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.invoice.create', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.order.approve', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.order.create', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.payable.read', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.payable.submit', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.payment.create', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.post', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.qc', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.read', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.receive', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.report.read', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.requirement.approve', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.requirement.create', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.return.approve', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.return.create', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.supplier_product.manage', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'purchase.vendor_ledger.read', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'stock.adjustment.approve', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'stock.adjustment.create', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'stock.count.approve', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'stock.count.create', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'stock.ledger.read', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'stock.transfer.approve', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'stock.transfer.create', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'stock.transfer.dispatch', NULL, UTC_TIMESTAMP(3)),
  ('ADMIN', 'stock.transfer.receive', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'inventory.location.manage', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'inventory.read', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'inventory.uom.manage', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'product.read', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'product.write', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'purchase.credit_memo.create', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'purchase.debit_memo.create', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'purchase.entry.create', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'purchase.invoice.create', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'purchase.order.create', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'purchase.payable.read', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'purchase.payable.submit', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'purchase.post', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'purchase.qc', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'purchase.read', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'purchase.receive', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'purchase.report.read', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'purchase.requirement.approve', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'purchase.requirement.create', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'purchase.return.create', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'purchase.supplier_product.manage', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'purchase.vendor_ledger.read', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'stock.adjustment.create', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'stock.count.approve', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'stock.count.create', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'stock.ledger.read', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'stock.transfer.approve', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'stock.transfer.create', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'stock.transfer.dispatch', NULL, UTC_TIMESTAMP(3)),
  ('MANAGER', 'stock.transfer.receive', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'inventory.location.manage', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'inventory.read', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'inventory.uom.manage', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'product.read', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'product.write', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.credit_memo.approve', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.credit_memo.create', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.debit_memo.approve', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.debit_memo.create', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.entry.create', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.invoice.approve', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.invoice.create', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.order.approve', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.order.create', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.payable.read', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.payable.submit', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.payment.create', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.post', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.qc', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.read', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.receive', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.report.read', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.requirement.approve', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.requirement.create', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.return.approve', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.return.create', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.supplier_product.manage', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'purchase.vendor_ledger.read', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'stock.adjustment.approve', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'stock.adjustment.create', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'stock.count.approve', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'stock.count.create', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'stock.ledger.read', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'stock.transfer.approve', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'stock.transfer.create', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'stock.transfer.dispatch', NULL, UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'stock.transfer.receive', NULL, UTC_TIMESTAMP(3)),
  ('USER', 'inventory.read', NULL, UTC_TIMESTAMP(3)),
  ('USER', 'product.read', NULL, UTC_TIMESTAMP(3)),
  ('USER', 'stock.count.create', NULL, UTC_TIMESTAMP(3)),
  ('USER', 'stock.transfer.receive', NULL, UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `capability` = VALUES(`capability`);

