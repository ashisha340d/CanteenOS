-- MenuBoard 013 — Variants and pricing belong to the Food Item Master, not a menu
--
-- Correction to 012_menu_master.sql: a `menu_item_variant` was originally scoped to a
-- `menu_item_assignment` (one food item on one specific menu), which meant the same dish could
-- have different variants/prices per menu. That is not the intended model. A `menu` (VSK,
-- PUBLIC, SATSANGEE) is just a named block of which food items/categories it offers — nothing
-- about what a dish is called, how it's portioned, or what it costs varies by menu. That
-- belongs on the Food Item Master (`menu_items`) itself, exactly like `name_hi`/`unit_hi`
-- already do. `menu_item_assignments` keeps everything that legitimately IS menu-specific:
-- display overrides, preparation notes, visibility, channel availability.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE menu_items
  ADD COLUMN base_price DECIMAL(12,2) NULL AFTER unit_hi;

-- Best-effort backfill from whatever the assignments happened to hold; a food item already
-- unpriced on every assignment stays NULL (menu-item-level "no price set yet" is unaffected).
UPDATE menu_items mi
  JOIN (
    SELECT food_item_id, MAX(base_price) AS base_price
    FROM menu_item_assignments
    WHERE base_price IS NOT NULL
    GROUP BY food_item_id
  ) x ON x.food_item_id = mi.id
  SET mi.base_price = x.base_price;

ALTER TABLE menu_item_assignments
  DROP COLUMN base_price;

ALTER TABLE menu_item_variants
  ADD COLUMN food_item_id CHAR(36) NULL AFTER id;

UPDATE menu_item_variants v
  JOIN menu_item_assignments a ON a.id = v.menu_item_assignment_id
  SET v.food_item_id = a.food_item_id;

ALTER TABLE menu_item_variants
  MODIFY COLUMN food_item_id CHAR(36) NOT NULL;

ALTER TABLE menu_item_variants
  DROP FOREIGN KEY fk_miv_assignment,
  DROP KEY uq_menu_item_variants_code,
  DROP KEY ix_menu_item_variants_assignment,
  DROP COLUMN menu_item_assignment_id,
  ADD UNIQUE KEY uq_menu_item_variants_code (food_item_id, variant_code),
  ADD KEY ix_menu_item_variants_food_item (food_item_id, status, sort_order),
  ADD CONSTRAINT fk_miv_food_item FOREIGN KEY (food_item_id) REFERENCES menu_items (id)
    ON DELETE RESTRICT ON UPDATE CASCADE;
