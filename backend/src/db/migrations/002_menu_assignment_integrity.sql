ALTER TABLE `menu_items`
  ADD COLUMN IF NOT EXISTS `description` varchar(1000) DEFAULT NULL AFTER `name_hi`,
  ADD COLUMN IF NOT EXISTS `description_hi` varchar(1000) DEFAULT NULL AFTER `description`;

ALTER TABLE `modifier_assignments`
  MODIFY COLUMN `entity_type` enum('MENU_ITEM_ASSIGNMENT','MENU_ITEM_VARIANT','MENU_ITEM') NOT NULL;

UPDATE `counter_routes` cr
LEFT JOIN `counters` c ON c.id = cr.counter_id AND c.deleted_at IS NULL
LEFT JOIN `menu_items` mi ON cr.entity_type = 'MENU_ITEM' AND mi.id = cr.entity_id AND mi.deleted_at IS NULL
LEFT JOIN `menu_item_assignments` mia ON cr.entity_type = 'MENU_ITEM_ASSIGNMENT' AND mia.id = cr.entity_id AND mia.deleted_at IS NULL
LEFT JOIN `menu_item_variants` miv ON cr.entity_type = 'MENU_ITEM_VARIANT' AND miv.id = cr.entity_id AND miv.deleted_at IS NULL
SET cr.deleted_at = UTC_TIMESTAMP(3), cr.status = 'INACTIVE', cr.updated_at = UTC_TIMESTAMP(3), cr.revision = cr.revision + 1
WHERE cr.deleted_at IS NULL
  AND (c.id IS NULL
    OR (cr.entity_type = 'MENU_ITEM' AND mi.id IS NULL)
    OR (cr.entity_type = 'MENU_ITEM_ASSIGNMENT' AND mia.id IS NULL)
    OR (cr.entity_type = 'MENU_ITEM_VARIANT' AND miv.id IS NULL));

UPDATE `printing_routes` pr
LEFT JOIN `printing_groups` pg ON pg.id = pr.printing_group_id AND pg.deleted_at IS NULL
LEFT JOIN `menu_items` mi ON pr.entity_type = 'MENU_ITEM' AND mi.id = pr.entity_id AND mi.deleted_at IS NULL
LEFT JOIN `menu_item_assignments` mia ON pr.entity_type = 'MENU_ITEM_ASSIGNMENT' AND mia.id = pr.entity_id AND mia.deleted_at IS NULL
LEFT JOIN `menu_item_variants` miv ON pr.entity_type = 'MENU_ITEM_VARIANT' AND miv.id = pr.entity_id AND miv.deleted_at IS NULL
SET pr.deleted_at = UTC_TIMESTAMP(3), pr.status = 'INACTIVE', pr.updated_at = UTC_TIMESTAMP(3), pr.revision = pr.revision + 1
WHERE pr.deleted_at IS NULL
  AND (pg.id IS NULL
    OR (pr.entity_type = 'MENU_ITEM' AND mi.id IS NULL)
    OR (pr.entity_type = 'MENU_ITEM_ASSIGNMENT' AND mia.id IS NULL)
    OR (pr.entity_type = 'MENU_ITEM_VARIANT' AND miv.id IS NULL));

UPDATE `modifier_assignments` ma
LEFT JOIN `modifier_groups` mg ON mg.id = ma.modifier_group_id AND mg.deleted_at IS NULL
LEFT JOIN `menu_items` mi ON ma.entity_type = 'MENU_ITEM' AND mi.id = ma.entity_id AND mi.deleted_at IS NULL
LEFT JOIN `menu_item_assignments` mia ON ma.entity_type = 'MENU_ITEM_ASSIGNMENT' AND mia.id = ma.entity_id AND mia.deleted_at IS NULL
LEFT JOIN `menu_item_variants` miv ON ma.entity_type = 'MENU_ITEM_VARIANT' AND miv.id = ma.entity_id AND miv.deleted_at IS NULL
SET ma.deleted_at = UTC_TIMESTAMP(3), ma.status = 'INACTIVE', ma.updated_at = UTC_TIMESTAMP(3), ma.revision = ma.revision + 1
WHERE ma.deleted_at IS NULL
  AND (mg.id IS NULL
    OR (ma.entity_type = 'MENU_ITEM' AND mi.id IS NULL)
    OR (ma.entity_type = 'MENU_ITEM_ASSIGNMENT' AND mia.id IS NULL)
    OR (ma.entity_type = 'MENU_ITEM_VARIANT' AND miv.id IS NULL));
