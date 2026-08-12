SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE menu_item_variants
  ADD COLUMN allow_decimal_quantity TINYINT(1) NOT NULL DEFAULT 0 AFTER is_default;

ALTER TABLE menu_item_assignments
  ADD COLUMN allow_decimal_quantity TINYINT(1) NOT NULL DEFAULT 0 AFTER delivery_available;

ALTER TABLE pos_order_items
  ADD COLUMN allow_decimal_quantity TINYINT(1) NOT NULL DEFAULT 0 AFTER line_total;

-- Convenience default: items sold by weight or volume usually need decimal quantities.
UPDATE menu_item_variants SET allow_decimal_quantity = 1 WHERE UPPER(unit) IN ('KG','GM','G','L','ML');
UPDATE menu_item_assignments SET allow_decimal_quantity = 1 WHERE UPPER(unit) IN ('KG','GM','G','L','ML');

UPDATE pos_order_items poi
  JOIN menu_item_variants v ON v.id = poi.variant_id
   SET poi.allow_decimal_quantity = v.allow_decimal_quantity
 WHERE poi.status = 'ACTIVE';
