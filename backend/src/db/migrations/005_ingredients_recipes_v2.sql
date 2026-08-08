-- MenuBoard 005 — Ingredient master, multi-variant recipes, recipe steps
--
-- Ported from the sibling "ashram_kitchen" (VSKorder) system, which already runs this exact
-- shape in production. See E:\VSKorder\HANDOVER_INGREDIENT_RECIPE.md for the full analysis
-- this migration implements.
--
-- What changes and why:
--   * `ingredient_categories` / `ingredients` arrive as a recipe-only master (name/unit/
--     category, no pricing, purchasing, stock or procurement fields — that boundary matters,
--     see docs/MENUBOARD_SPEC.md's inventory exclusion). `recipe_ingredients` now points at
--     `ingredient_id` instead of storing a free-text name, so the same "Wheat Flour" typed
--     once is reused by every recipe that needs it.
--   * `recipe_ingredients.scaling` records how a quantity grows with serving count: most
--     ingredients scale linearly, a few (salt, water) sub-linearly, and a few (tempering
--     spices, garnish) not at all. Implemented in `scaleRecipe` (shared/src/recipes).
--   * `recipes` drops its one-per-menu-item uniqueness: a dish can have several authored
--     variants (e.g. three kinds of Roti). Exactly one variant per menu item is the
--     "default" (`is_default`), enforced by a generated-column unique index, and that is the
--     variant `ShoppingListService` scales against.
--   * `recipe_steps` arrives as a first-class, ordered table — recipes gain real step-by-step
--     method text instead of one free-text `instructions` blob (kept, renamed to
--     `method_en`, with a `method_hi` counterpart).
--
-- Same conventions as 001/003: CHAR(36) UUIDs, DATETIME(3) UTC, soft delete, revision,
-- sync_seq.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ---------------------------------------------------------- ingredient categories

CREATE TABLE IF NOT EXISTS ingredient_categories (
  id            CHAR(36)      NOT NULL,
  name          VARCHAR(120)  NOT NULL,
  name_hi       VARCHAR(150)  NULL,
  status        ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  sort_order    INT           NOT NULL DEFAULT 0,
  created_by    CHAR(36)      NULL,
  created_at    DATETIME(3)   NOT NULL,
  updated_at    DATETIME(3)   NOT NULL,
  deleted_at    DATETIME(3)   NULL,
  revision      INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ingredient_categories_name (name),
  KEY ix_ingredient_categories_sync_seq (sync_seq),
  CONSTRAINT fk_ingredient_categories_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ------------------------------------------------------------------- ingredients

-- Deliberately narrow: name/unit/category only. No purchase unit, pack size, price, GST,
-- HSN or brand columns — those are a procurement concern VSKorder itself keeps in a
-- separate `ingredient_catalog` table, and MenuBoard is not an inventory system.
CREATE TABLE IF NOT EXISTS ingredients (
  id            CHAR(36)      NOT NULL,
  category_id   CHAR(36)      NULL,
  name          VARCHAR(150)  NOT NULL,
  name_hi       VARCHAR(180)  NULL,
  unit          VARCHAR(30)   NOT NULL DEFAULT 'GM',
  status        ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  sort_order    INT           NOT NULL DEFAULT 0,
  created_by    CHAR(36)      NULL,
  created_at    DATETIME(3)   NOT NULL,
  updated_at    DATETIME(3)   NOT NULL,
  deleted_at    DATETIME(3)   NULL,
  revision      INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ingredients_name (name),
  KEY ix_ingredients_sync_seq (sync_seq),
  KEY ix_ingredients_category (category_id),
  CONSTRAINT fk_ingredients_category FOREIGN KEY (category_id)
    REFERENCES ingredient_categories (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ingredients_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------------------- recipes

-- One menu item can now have several authored recipe variants (e.g. three kinds of Roti).
-- `is_default` marks the one ShoppingListService scales against.
--
-- "At most one default per menu item" is enforced in RecipeService (clearDefault runs in
-- the same transaction as promoting a new default) rather than a generated-column unique
-- index: MariaDB/InnoDB refuses a stored generated column that depends on a column
-- (`menu_item_id`) carrying an `ON UPDATE CASCADE` foreign key
-- (ER_GENERATED_COLUMN_FUNCTION_IS_NOT_ALLOWED) — verified against MariaDB 10.6. Every write
-- path for `recipes` goes through RecipeRepository, so the application-level guarantee is
-- sound here the same way docs/DATABASE.md already accepts application-level enforcement
-- elsewhere in this schema.
ALTER TABLE recipes
  DROP FOREIGN KEY fk_recipes_menu_item,
  DROP KEY uq_recipes_menu_item;

ALTER TABLE recipes
  ADD CONSTRAINT fk_recipes_menu_item FOREIGN KEY (menu_item_id) REFERENCES menu_items (id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE recipes
  CHANGE COLUMN instructions method_en TEXT NULL,
  ADD COLUMN method_hi        TEXT          NULL AFTER method_en,
  ADD COLUMN is_default       TINYINT(1)    NOT NULL DEFAULT 1 AFTER base_pax,
  ADD COLUMN prep_time_min    INT UNSIGNED  NULL AFTER is_default,
  ADD COLUMN cook_time_min    INT UNSIGNED  NULL AFTER prep_time_min,
  ADD COLUMN team_size        INT UNSIGNED  NULL AFTER cook_time_min,
  ADD COLUMN difficulty       ENUM('EASY','MEDIUM','HARD') NULL AFTER team_size,
  ADD COLUMN description_en   VARCHAR(200)  NULL AFTER difficulty,
  ADD COLUMN description_hi   VARCHAR(200)  NULL AFTER description_en,
  ADD COLUMN yield_note       VARCHAR(200)  NULL AFTER method_hi,
  ADD COLUMN chef_notes       VARCHAR(1000) NULL AFTER yield_note,
  ADD KEY ix_recipes_menu_item_default (menu_item_id, is_default);

-- Every menu item that already had exactly one (pre-migration, 1:1) recipe keeps it as the
-- default, which is already the column's DEFAULT — nothing further to backfill.

-- --------------------------------------------------------- recipe ingredients

-- Free-text `name` is replaced by a foreign key into the new `ingredients` master. Existing
-- distinct names are promoted into that master 1:1 so no authored quantity is lost.
INSERT INTO ingredients (id, name, unit, status, created_at, updated_at, revision, sync_seq)
SELECT
  UUID(),
  ri.name,
  MIN(ri.unit),
  'ACTIVE',
  NOW(3),
  NOW(3),
  1,
  0
FROM recipe_ingredients ri
WHERE ri.deleted_at IS NULL
GROUP BY ri.name
ON DUPLICATE KEY UPDATE ingredients.name = ingredients.name;

ALTER TABLE recipe_ingredients
  ADD COLUMN ingredient_id CHAR(36) NULL AFTER recipe_id,
  ADD COLUMN scaling ENUM('LINEAR','FIXED','SQRT') NOT NULL DEFAULT 'LINEAR' AFTER unit;

UPDATE recipe_ingredients ri
  INNER JOIN ingredients i ON i.name = ri.name
  SET ri.ingredient_id = i.id;

ALTER TABLE recipe_ingredients
  MODIFY COLUMN ingredient_id CHAR(36) NOT NULL,
  DROP COLUMN name,
  ADD UNIQUE KEY uq_recipe_ingredients_recipe_ingredient (recipe_id, ingredient_id),
  ADD KEY ix_recipe_ingredients_ingredient (ingredient_id),
  ADD CONSTRAINT fk_recipe_ingredients_ingredient FOREIGN KEY (ingredient_id)
    REFERENCES ingredients (id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------------ recipe steps

-- Ordered, first-class steps replacing the single `method_en` blob as the primary authoring
-- surface; `method_en`/`method_hi` remain as an optional free-text summary.
CREATE TABLE IF NOT EXISTS recipe_steps (
  id            CHAR(36)      NOT NULL,
  recipe_id     CHAR(36)      NOT NULL,
  step_no       INT           NOT NULL,
  text_en       TEXT          NOT NULL,
  text_hi       TEXT          NULL,
  duration_min  INT UNSIGNED  NULL,
  image_path    VARCHAR(500)  NULL,
  created_at    DATETIME(3)   NOT NULL,
  updated_at    DATETIME(3)   NOT NULL,
  deleted_at    DATETIME(3)   NULL,
  revision      INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_recipe_steps_sync_seq (sync_seq),
  KEY ix_recipe_steps_recipe (recipe_id, step_no),
  CONSTRAINT fk_recipe_steps_recipe FOREIGN KEY (recipe_id) REFERENCES recipes (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
