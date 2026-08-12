-- MenuBoard 016 — Media may be attached to a food item directly
--
-- Mirrors 014/015's widening of counter_routes/printing_routes: a photograph belongs to the
-- dish, not to one menu's copy of it, so media_assignments accepts 'MENU_ITEM' alongside the
-- per-menu levels. Assignment-level and variant-level images still win over it when present.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE media_assignments
  MODIFY COLUMN entity_type
    ENUM('MENU','MENU_CATEGORY_ASSIGNMENT','MENU_ITEM_ASSIGNMENT','MENU_ITEM_VARIANT','MENU_ITEM')
    NOT NULL;
