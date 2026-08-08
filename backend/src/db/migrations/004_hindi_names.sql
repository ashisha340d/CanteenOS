-- MenuBoard 004 — Hindi names for the menu catalogue
--
-- The Employee board renders in Hindi. Dish and category names are *not* machine-translated:
-- "Dal Makhani" has one correct Devanagari spelling that the kitchen already uses, and a
-- translation engine would produce a different one on every call, drifting away from what is
-- written on the counter. So the Hindi name is authored alongside the English one and stored.
--
-- Static interface labels (दिनांक, समय, मेहमान) are a different problem — a fixed vocabulary
-- with no per-row variation — and live in the app's own dictionary rather than the database.
--
-- Both columns are nullable. A row without a Hindi name falls back to the English one, so
-- the catalogue stays usable while it is being translated rather than showing blanks.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE menu_categories
  ADD COLUMN name_hi VARCHAR(150) NULL AFTER name;

ALTER TABLE menu_items
  ADD COLUMN name_hi VARCHAR(180) NULL AFTER name,
  -- Units are spoken aloud on the floor ("प्लेट्स", "कप"), so they need the same treatment.
  ADD COLUMN unit_hi VARCHAR(40)  NULL AFTER unit;

-- Seeds the units that repeat across almost every catalogue, so the Hindi board is legible
-- immediately rather than after a full translation pass. Item names stay null until authored.
UPDATE menu_items SET unit_hi = CASE UPPER(unit)
    WHEN 'NOS'    THEN 'नग'
    WHEN 'PLATE'  THEN 'प्लेट'
    WHEN 'PLATES' THEN 'प्लेट्स'
    WHEN 'KG'     THEN 'किलो'
    WHEN 'GM'     THEN 'ग्राम'
    WHEN 'LTR'    THEN 'लीटर'
    WHEN 'ML'     THEN 'एमएल'
    WHEN 'CUP'    THEN 'कप'
    WHEN 'CUPS'   THEN 'कप'
    WHEN 'TRAY'   THEN 'ट्रे'
    WHEN 'PCS'    THEN 'पीस'
    WHEN 'PIECE'  THEN 'पीस'
    ELSE NULL
  END
  WHERE unit_hi IS NULL;
