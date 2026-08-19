# Ingredient + Recipe Port (from VSKorder / ashram_kitchen)

This document records the work done to port VSKorder's (the sibling "ashram_kitchen" JKP
Canteen Order system, `E:\VSKorder`) working Ingredient + Recipe(+ steps) implementation into
MenuBoard, replacing MenuBoard's previous placeholder (one recipe per menu item, free-text
ingredient names, no steps, no scaling modes). Source analysis this work is based on:
`E:\VSKorder\HANDOVER_INGREDIENT_RECIPE.md`.

Everything below is **implemented, migrated, seeded, built and smoke-tested** against a real
MariaDB dev database, unless explicitly flagged as follow-up.

## Scope decisions taken

Asked and answered at the start of this session (see chat history for the exact question/answer
pairs); recorded here so they aren't re-litigated:

1. **Ingredient master is recipe-only.** New `ingredients` / `ingredient_categories` tables
   carry name/name (Hindi)/unit/category only — no purchase unit, pack size, price, GST, HSN or
   brand fields. This stays inside MenuBoard's "not an inventory/accounting system" boundary
   (`docs/MENUBOARD_SPEC.md` §3) — it exists purely to normalise the strings a recipe's
   ingredient list uses, not to manage procurement.
2. **Recipes are multi-variant.** A menu item can now have several authored recipe variants
   (VSKorder's data has up to ~10 per dish, e.g. different kinds of Roti). Exactly one variant
   per menu item is `isDefault`; that is the variant `ShoppingListService` scales against.
   MenuBoard's previous `UNIQUE(menu_item_id)` constraint on `recipes` was dropped.
3. **Catalogue merge is additive.** VSKorder's 43 dishes / 11 (deduplicated from 13) categories
   and 98 ingredients / 15 categories were imported alongside MenuBoard's existing curated seed
   catalogue, not as a replacement. Some dish names appear in both catalogues under different
   categories — cosmetic, not a schema conflict.
4. **AI-assisted recipe import was ported too**, including the Gemini-backed steps (ingredient
   auto-resolution, audio transcription), gated behind an optional `GEMINI_API_KEY` env var so
   the feature degrades to a clear error message rather than crashing when unset.

## Database (`backend/src/db/migrations/001_schema.sql`)

- New `ingredient_categories` table (mirrors `menu_categories`).
- New `ingredients` table (mirrors `menu_items`, narrower — see decision 1). Unique on `name`.
- `recipes` table: dropped `UNIQUE(menu_item_id)`; added `is_default`, `prep_time_min`,
  `cook_time_min`, `team_size`, `difficulty` (`EASY`/`MEDIUM`/`HARD`), `description_en/hi`,
  `yield_note`, `chef_notes`; renamed `instructions` → `method_en`, added `method_hi`.
  - **"At most one default per menu item" is enforced in `RecipeService`** (in the same
    transaction as promoting a new default), not a DB constraint — MariaDB/InnoDB refuses a
    stored generated column that depends on a column (`menu_item_id`) carrying an
    `ON UPDATE CASCADE` foreign key (`ER_GENERATED_COLUMN_FUNCTION_IS_NOT_ALLOWED`, verified
    against the live MariaDB 10.6 instance). This is documented inline in the migration file.
- `recipe_ingredients`: replaced free-text `name` with `ingredient_id` (FK → `ingredients`,
  `ON DELETE RESTRICT`), added `scaling` (`LINEAR`/`FIXED`/`SQRT`). Existing rows' distinct
  names were promoted into the new `ingredients` table by the migration itself so no authored
  quantity was lost.
- New `recipe_steps` table: ordered (`step_no`), `text_en`/`text_hi`, `duration_min`,
  `image_path`, cascade-deletes with its recipe.

Applied and verified against the local dev database (`npm run migrate`). Live-verified via
`SHOW COLUMNS`/`SHOW INDEX`/`information_schema.KEY_COLUMN_USAGE` during this session.

## Shared package (`shared/src`)

- `enums/index.ts`: `RecipeIngredientScaling`, `RecipeDifficulty`.
- `constants/index.ts`: new `LIMITS` entries (`INGREDIENT_NAME_MAX`,
  `RECIPE_INGREDIENTS_PER_RECIPE_MAX`, `RECIPE_STEPS_PER_RECIPE_MAX`, etc).
- `dto/domain.ts`: new `IngredientDto`/`IngredientWriteRequest`/`IngredientCategoryDto`/
  `IngredientCategoryWriteRequest`; `RecipeDto`/`RecipeIngredientDto`/`RecipeWriteRequest`/
  `ScaledRecipeDto` rewritten for the new shape (see any of those interfaces' doc-comments).
  New `RecipeStepDto`.
- `sync/index.ts`: `SYNC_ENTITIES` gained `ingredients` and `recipe_steps` (both read-only,
  never in `PUSHABLE_ENTITIES`); `SyncChangeSet`/`emptyChangeSet()` updated to match.
- `recipes/index.ts`: exports `scaleQuantity(quantity, basePax, targetPax, scaling)` — the
  LINEAR/FIXED/SQRT formula ported verbatim from VSKorder's `scaleQuantity` — and an updated
  `scaleRecipe()` that uses it per-ingredient and passes `steps` through unscaled.

## Backend (`backend/src`)

- **New**: `repositories/IngredientRepository.ts` (`IngredientCategoryRepository` +
  `IngredientRepository`), `services/IngredientService.ts`, `controllers/IngredientController.ts`,
  `routes/ingredient.routes.ts` — mounted at `/api/v1/ingredients` and
  `/api/v1/ingredient-categories`. Reads gated on `Capability.RECIPE_READ`, writes on
  `RECIPE_WRITE` (ingredients are recipe-adjacent master data, not a separate capability).
- **Rewritten**: `repositories/RecipeRepository.ts`, `services/RecipeService.ts`,
  `controllers/RecipeController.ts`, `routes/recipe.routes.ts` for multi-variant recipes with
  ingredients + steps. New endpoints: `GET /recipes/menu-item/:id/variants` (all variants),
  `GET /recipes/menu-item/:id` (default variant only, same URL as before), `PATCH /recipes/:id/default`
  (promote a variant).
- **`services/ShoppingListService.ts`**: now scales against each menu item's *default* recipe
  (`recipeRepository.findDefaultByMenuItemIds`) and uses `scaleQuantity` (respecting each
  ingredient's own `scaling` mode) instead of a flat linear multiply.
- **`services/SyncService.ts`**: pulls `ingredients` and `recipe_steps` alongside
  `recipes`/`recipe_ingredients`.
- **AI-assisted import** (ported from VSKorder, new files): `services/GeminiService.ts`
  (`generateGeminiText`, `transcribeAudio`, `extractJson`), `services/TranslateService.ts`
  (keyless MyMemory API, no key required), `services/RecipeParserService.ts` (rule-based
  free-text → structured-recipe parser, no AI dependency; plus `resolveRecipeWithAI` which does
  call Gemini). New endpoints on `recipe.routes.ts`: `POST /recipes/import/parse` (no key
  needed), `POST /recipes/import/ai`, `POST /recipes/transcribe` (multipart audio upload, kept
  in memory only, never persisted to disk), `POST /recipes/translate`. Same
  `POST /ingredients/translate` for the ingredient name field. `config/index.ts` gained an
  optional `gemini.{apiKey,apiUrl,model}` block (`GEMINI_API_KEY` env var) — every AI-dependent
  endpoint throws a clear `ValidationError` ("AI-assisted recipe authoring is not configured on
  this server") rather than crashing when unset.
- `models/rows.ts` / `models/mappers.ts`: new row types and mappers for the above.
- `validation/schemas.ts`: new/updated Zod schemas for every new endpoint and field.

## Seed data (`backend/src/db/seeds/`)

- `data/imported-recipes.json` — VSKorder's real catalogue (43 dishes / 11 deduplicated
  categories, 98 ingredients / 15 categories, 235 recipes, 1,411 recipe ingredients, 700 recipe
  steps), transformed from the live `ashram_kitchen` export
  (`E:\VSKorder\handover-data\*.json`) into MenuBoard's DTO shape (UUIDs generated at seed time,
  VSKorder's own duplicate categories such as `Fast Food`/`fast_food` deduplicated). Loaded at
  **runtime** by `seedRecipes.ts`, not hardcoded as TS literals.
- `seedRecipes.ts` — `seedImportedRecipes()`, wired additively into the existing `seed.ts`
  transaction. Fully idempotent: every insert is guarded by an existence check (by name / by
  `(menu_item_id, description_en)`), verified by running `npm run seed` twice in this session —
  the second run added zero duplicate rows.

## Admin Portal (`admin/src`) — built by a background subagent, verified

New pages/nav under a new "Recipes" section:

- **Ingredient categories** (`/ingredient-categories`) — CRUD grid.
- **Ingredients** (`/ingredients`) — CRUD grid with category/status filters, "referenced by
  recipes → set INACTIVE instead" delete-conflict flow, Auto-Translate button for the Hindi
  name, creatable unit field.
- **Recipes** (`/recipes`) — flat list of every recipe variant (menu item, variant description,
  base pax, difficulty, default badge, status), filterable by menu item (drill-down link added
  to the Menu Items grid) and by search/status; row actions to edit, promote to default, delete.
- **Recipe builder** (`/recipes/new`, `/recipes/:id/edit`) — full-page form (not a modal — the
  content is too large for the shared compact `Modal`): base fields, a draggable repeatable
  ingredients table (ingredient picker, quantity, unit, scaling mode with inline explanation,
  notes), a draggable repeatable ordered steps list, and an **Import from text** dialog
  (paste free text → rule-based parse → optional "Resolve unmatched with AI" → review → apply
  to the form; also supports recording a voice note via the browser's `MediaRecorder` API and
  transcribing it).

Verified: `npm run build --workspace @menuboard/admin` and
`npm run lint --workspace @menuboard/admin` both pass with zero errors/warnings.

## Mobile app (`app/`) — built by a background subagent, verified

Read-only cache update only — per `app/AGENTS.md`, the Android app never writes master data.

- `src/db/schema.ts`: `SCHEMA_VERSION` 4→5. New `ingredients`/`recipe_steps` tables; `recipes`
  and `recipe_ingredients` updated to the new columns (see migration list above, mirrored 1:1).
- `src/db/client.ts`: new v5 migration step drops the old-shaped `recipes`/`recipe_ingredients`
  tables (and the two new ones, harmlessly) before they're recreated fresh — the same
  drop-and-refetch pattern already used for the v4 menu-items migration, valid here because
  these are pure read-only synced caches with no local writes to lose.
- `src/db/repositories/recipeRepository.ts` (rewritten) + new `ingredientRepository.ts`:
  resolve "the" recipe for a menu item via `is_default = 1`, join ingredient names from the new
  `ingredients` table, load and attach `steps`.
- `src/sync/applyChangeSet.ts`: applies `ingredients` and `recipe_steps` in the same dependency
  order as `shared/src/sync/index.ts`'s `SYNC_ENTITIES`.
- `src/components/RecipeSheet.tsx`: renders `methodEn`/`methodHi` instead of the removed
  `instructions` field, plus a new numbered Steps list.

Verified: `npm run typecheck` and `npm run lint` inside `app/` both pass with zero errors.
**Not verified**: a live emulator/device sync run (no emulator available in this environment) —
flagged as a required follow-up before shipping.

## Documentation

- `docs/sqlite-schema.sql` — brought back in line with the actual (now v5) SQLite schema: added
  the `ingredients`, `recipes` (updated), `recipe_ingredients` (updated), `recipe_steps`,
  `shopping_lists` and `shopping_list_items` table definitions, which were missing from this
  file even before this session (pre-existing drift, not introduced by this work, but fixed
  here since it was directly relevant).

## End-to-end verification performed this session

1. `npm run build` (shared → backend → admin) from repo root — clean.
2. `npm run migrate` — migration applied once, idempotent on re-run.
3. `npm run seed` — ran twice; second run added zero duplicate recipes/ingredients/categories.
4. Live smoke test against the running backend (login as `superadmin`, then):
   - `GET /ingredients`, `/ingredients/units`, `/ingredient-categories` — correct data/paging.
   - `GET /recipes?q=Roti` — 3 variants returned, correct `isDefault`/ingredients/steps shape.
   - `GET /recipes/menu-item/:id/variants` and `.../menu-item/:id` (default) — correct.
   - `GET /recipes/menu-item/:id/scaled?pax=250` — quantities scaled correctly per ingredient
     (confirmed a `SQRT`-scaling ingredient, salt, scaled sub-linearly: 0.1 kg base → 0.158 kg
     at 2.5x pax, not the linear 0.25 kg a naive multiply would give).
   - `POST /recipes/import/parse` — correctly extracted item name, base pax, ingredients
     (matched against the real seeded ingredient master), and steps from free text.
   - `POST /ingredients/translate` — returned a real Hindi translation.
5. `admin/` and `app/` builds/typecheck/lint verified independently by the subagents that did
   that work (see their sections above); re-verified together in the final root `npm run build`.

## Known follow-ups (not done in this session)

- **Live Android emulator/device test** of the v4→v5 SQLite migration and a real sync pull —
  the environment this work was done in has no emulator available.
- **`GEMINI_API_KEY` is not configured** anywhere in this environment — the AI-resolution and
  audio-transcription steps are wired and will work once an operator supplies a key in
  `backend/.env`, but were not (and could not be) tested end-to-end against the real Gemini API.
- MenuBoard's recipe/shopping-list/billing features are implemented in the codebase but are
  **not listed in `docs/MENUBOARD_SPEC.md`'s "Core objects" section (§4)**, and that document's
  hard-exclusion list (§3) names "inventory" — the new ingredient master sits close to that
  boundary even though it was deliberately kept narrow (name/unit/category only, no
  procurement fields) to stay on the right side of it. Whoever owns `MENUBOARD_SPEC.md` should
  consider updating §4 to name Recipes/Ingredients/Shopping Lists as core objects explicitly,
  since the spec and the shipped product have drifted apart on this point independent of this
  session's work.
