-- MenuBoard 015 — Printing (Kitchen Group) routes may target a food item directly
--
-- Mirrors 014's `counter_routes` widening: a food item may now route directly to a kitchen
-- printing group (global to the item, not per-menu), reusing the same polymorphic
-- printing_routes table rather than a new one.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE printing_routes
  MODIFY COLUMN entity_type ENUM('MENU_ITEM_ASSIGNMENT','MENU_ITEM_VARIANT','MENU_ITEM') NOT NULL;
