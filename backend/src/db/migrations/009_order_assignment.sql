-- MenuBoard 009 — order assignment
--
-- An order can now be handed to a specific board member: who owns getting it done, as
-- distinct from who raised it (`created_by`) and who finished it (`done_by`).
--
-- Deliberately *not* folded into `orders.status`: an order may be assigned before anyone has
-- acknowledged it, and handed to someone else mid-service, neither of which should move the
-- lifecycle. `assigned_at` is stamped alongside so the feed can say when the handover
-- happened without reading the audit log.
--
-- ON DELETE SET NULL, unlike `created_by`'s RESTRICT: an order must always remember who
-- raised it, but an unassigned order is a perfectly ordinary state, so deleting a user simply
-- returns their work to the pool rather than blocking the delete.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS assigned_to CHAR(36) NULL AFTER created_by,
  ADD COLUMN IF NOT EXISTS assigned_at DATETIME(3) NULL AFTER assigned_to;

ALTER TABLE orders
  ADD KEY ix_orders_assigned (assigned_to, status);

ALTER TABLE orders
  ADD CONSTRAINT fk_orders_assigned_to FOREIGN KEY (assigned_to) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE RESTRICT;
