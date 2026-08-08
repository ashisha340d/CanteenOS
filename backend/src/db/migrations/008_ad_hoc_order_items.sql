-- MenuBoard 008 — ad-hoc (custom) order items
--
-- A kitchen cannot wait for an Admin to register a master record mid-service, so an order
-- line may now name its dish as free text instead of pointing at `menu_items`.
--
-- The line names its dish in exactly one of two ways, enforced by `ck_order_items_dish`:
--   menu_item_id set, custom_item_name null  — a catalogued dish
--   menu_item_id null, custom_item_name set  — an ad-hoc dish typed on the spot
--
-- This is order-scoped free text and deliberately does NOT create a `menu_items` row: the
-- Android master cache stays read-only (docs/MENUBOARD_SPEC.md §3). Anything that needs a
-- catalogued dish — recipe scaling, shopping-list generation — skips ad-hoc lines, and
-- billing groups them under a synthetic category.
--
-- Why this is five statements rather than one ALTER:
--
--   * MariaDB refuses a CHECK that references a column being MODIFYed or ADDed in the same
--     ALTER, so the shape change has to land before the constraint that reads it.
--   * MariaDB 10.6 also refuses a CHECK referencing a column that participates in a foreign
--     key with ON UPDATE CASCADE — a cascading update would have to re-evaluate the check —
--     and fk_order_items_menu_item was declared that way in 001. The cascade was never
--     reachable: menu_items.id is an immutable generated UUID, so an id update cannot occur.
--     It is narrowed to ON UPDATE RESTRICT here, which changes no observable behaviour and
--     lets the invariant be enforced by the database rather than by the service alone.
--     ON DELETE RESTRICT is retained: deleting a catalogued dish must not erase order history.
--
-- `IF NOT EXISTS` on the new column keeps the file re-runnable, because an earlier revision
-- of this migration failed partway (the constraint was rejected after the columns landed).

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE order_items
  MODIFY COLUMN menu_item_id CHAR(36) NULL;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS custom_item_name VARCHAR(150) NULL AFTER menu_item_id;

-- Dropped and re-added in two statements, not one: InnoDB cannot reuse a foreign key name
-- within a single ALTER (errno 121, "Duplicate key on write or update").
ALTER TABLE order_items
  DROP FOREIGN KEY IF EXISTS fk_order_items_menu_item;

ALTER TABLE order_items
  ADD CONSTRAINT fk_order_items_menu_item FOREIGN KEY (menu_item_id) REFERENCES menu_items (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE order_items
  ADD CONSTRAINT ck_order_items_dish
    CHECK ((menu_item_id IS NULL) <> (custom_item_name IS NULL));
