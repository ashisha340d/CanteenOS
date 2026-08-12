-- MenuBoard — Android local schema (SQLite)
--
-- This is the ONLY database the Android application reads from. Every screen queries
-- SQLite; no screen renders from an API response.
--
-- Differences from the MariaDB master schema, and why:
--   * Local-only columns `sync_state` and `sync_error` describe a row's relationship to the
--     server so the UI can show "Pending sync" without a second query.
--   * `server_sync_seq` records the cursor the row arrived at, so a pull can be resumed.
--   * No billing, reporting, audit, permission or configuration tables exist here. The
--     Android app has no such concern (docs/MENUBOARD_SPEC.md).
--   * Master tables (stations, activity_types, menu_categories, menu_items) are a
--     read-only cache. The device never originates writes to them.
--   * TEXT is used for timestamps in ISO-8601 UTC ('YYYY-MM-DDTHH:MM:SS.sssZ') so string
--     comparison equals chronological comparison.
--
-- Applied by the Phase 4 migration runner. Version is tracked in `settings`
-- under key 'db_schema_version'.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

-- ------------------------------------------------------------------------ users

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY NOT NULL,
  employee_code     TEXT,
  name              TEXT NOT NULL,
  username          TEXT NOT NULL,
  phone             TEXT,
  email             TEXT,
  role              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'ACTIVE',
  avatar_path       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  revision          INTEGER NOT NULL DEFAULT 1,
  server_sync_seq   INTEGER NOT NULL DEFAULT 0,
  sync_state        TEXT NOT NULL DEFAULT 'SYNCED'
);
CREATE INDEX IF NOT EXISTS ix_users_name ON users (name);

-- -------------------------------------------------------------------- stations

-- The real-world site a board operates at (Barsana, Mangarh, ...). Read-only synced cache,
-- same as activity_types — the device never originates a station.
CREATE TABLE IF NOT EXISTS stations (
  id                TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL,
  code              TEXT,
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  revision          INTEGER NOT NULL DEFAULT 1,
  server_sync_seq   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_stations_status ON stations (status, deleted_at);

-- ----------------------------------------------------------------------- boards

-- Station -> Board. A board belongs to exactly one station; board names repeat across
-- stations on purpose (e.g. "Canteen Board" at both Barsana and Mangarh) — membership is
-- board-scoped, so the same person can hold independent roles on same-named boards at two
-- different stations.
CREATE TABLE IF NOT EXISTS boards (
  id                TEXT PRIMARY KEY NOT NULL,
  station_id        TEXT NOT NULL REFERENCES stations (id),
  name              TEXT NOT NULL,
  description       TEXT,
  color             TEXT,             -- hex swatch '#RRGGBB', admin-configurable
  photo_path        TEXT,             -- storage path of an uploaded board photo
  status            TEXT NOT NULL DEFAULT 'ACTIVE',
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  revision          INTEGER NOT NULL DEFAULT 1,
  server_sync_seq   INTEGER NOT NULL DEFAULT 0,
  sync_state        TEXT NOT NULL DEFAULT 'SYNCED',
  sync_error        TEXT
);
CREATE INDEX IF NOT EXISTS ix_boards_status ON boards (status, deleted_at);
CREATE INDEX IF NOT EXISTS ix_boards_station ON boards (station_id, status);

CREATE TABLE IF NOT EXISTS board_members (
  id                TEXT PRIMARY KEY NOT NULL,
  board_id          TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL,
  board_role        TEXT NOT NULL DEFAULT 'MEMBER',
  status            TEXT NOT NULL DEFAULT 'ACTIVE',
  joined_at         TEXT,
  invited_by        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  revision          INTEGER NOT NULL DEFAULT 1,
  server_sync_seq   INTEGER NOT NULL DEFAULT 0,
  sync_state        TEXT NOT NULL DEFAULT 'SYNCED'
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_board_members_board_user
  ON board_members (board_id, user_id);
CREATE INDEX IF NOT EXISTS ix_board_members_user ON board_members (user_id, status);

-- ------------------------------------------------- masters (read-only cache)

CREATE TABLE IF NOT EXISTS activity_types (
  id                TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  icon              TEXT,
  status            TEXT NOT NULL DEFAULT 'ACTIVE',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  is_system         INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  revision          INTEGER NOT NULL DEFAULT 1,
  server_sync_seq   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_activity_types_status ON activity_types (status, sort_order);

CREATE TABLE IF NOT EXISTS menu_categories (
  id                TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  image_path        TEXT,
  status            TEXT NOT NULL DEFAULT 'ACTIVE',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  revision          INTEGER NOT NULL DEFAULT 1,
  server_sync_seq   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_menu_categories_status ON menu_categories (status, sort_order);

CREATE TABLE IF NOT EXISTS menu_items (
  id                TEXT PRIMARY KEY NOT NULL,
  category_id       TEXT NOT NULL,
  name              TEXT NOT NULL,
  unit              TEXT NOT NULL DEFAULT 'NOS',
  image_path        TEXT,
  primary_media_id  TEXT,
  status            TEXT NOT NULL DEFAULT 'ACTIVE',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  revision          INTEGER NOT NULL DEFAULT 1,
  server_sync_seq   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_menu_items_category ON menu_items (category_id, status, sort_order);
CREATE INDEX IF NOT EXISTS ix_menu_items_name ON menu_items (name);

-- ------------------------------------------------- recipes & ingredients (v5)
--
-- Recipe-only ingredient master. Narrow on purpose (see shared/src/dto/domain.ts's
-- IngredientDto doc-comment) — no purchase unit, pack size, price, GST, HSN or brand
-- fields, since procurement is out of MenuBoard's scope.
CREATE TABLE IF NOT EXISTS ingredients (
  id                TEXT PRIMARY KEY NOT NULL,
  category_id       TEXT,
  name              TEXT NOT NULL,
  name_hi           TEXT,
  unit              TEXT NOT NULL DEFAULT 'GM',
  status            TEXT NOT NULL DEFAULT 'ACTIVE',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  revision          INTEGER NOT NULL DEFAULT 1,
  server_sync_seq   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_ingredients_status ON ingredients (status, sort_order);

-- Recipes are cached locally so the long-press "view recipe" works in a kitchen with no
-- signal. A menu item may have several authored variants; exactly one has is_default = 1,
-- matching shared/src/dto/domain.ts's RecipeDto doc-comment.
CREATE TABLE IF NOT EXISTS recipes (
  id                TEXT PRIMARY KEY NOT NULL,
  menu_item_id      TEXT NOT NULL,
  base_pax          INTEGER NOT NULL DEFAULT 1,
  is_default        INTEGER NOT NULL DEFAULT 1,
  prep_time_min     INTEGER,
  cook_time_min     INTEGER,
  team_size         INTEGER,
  difficulty        TEXT,
  description_en    TEXT,
  description_hi    TEXT,
  method_en         TEXT,
  method_hi         TEXT,
  yield_note        TEXT,
  chef_notes        TEXT,
  status            TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  revision          INTEGER NOT NULL DEFAULT 1,
  server_sync_seq   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_recipes_menu_item_default ON recipes (menu_item_id, is_default);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id                TEXT PRIMARY KEY NOT NULL,
  recipe_id         TEXT NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  ingredient_id     TEXT NOT NULL REFERENCES ingredients (id),
  quantity          REAL NOT NULL DEFAULT 0,
  unit              TEXT NOT NULL DEFAULT 'GM',
  scaling           TEXT NOT NULL DEFAULT 'LINEAR',  -- LINEAR | FIXED | SQRT
  notes             TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  revision          INTEGER NOT NULL DEFAULT 1,
  server_sync_seq   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_recipe_ingredients_recipe ON recipe_ingredients (recipe_id, sort_order);

CREATE TABLE IF NOT EXISTS recipe_steps (
  id                TEXT PRIMARY KEY NOT NULL,
  recipe_id         TEXT NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  step_no           INTEGER NOT NULL DEFAULT 1,
  text_en           TEXT,
  text_hi           TEXT,
  duration_min      INTEGER,
  image_path        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  revision          INTEGER NOT NULL DEFAULT 1,
  server_sync_seq   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_recipe_steps_recipe ON recipe_steps (recipe_id, step_no);

-- Generated once per selection of orders as a server-side roll-up over recipes; the device
-- never computes one itself (see shared/src/sync/index.ts's PUSHABLE_ENTITIES doc-comment).
CREATE TABLE IF NOT EXISTS shopping_lists (
  id                TEXT PRIMARY KEY NOT NULL,
  board_id          TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'OPEN',
  order_ids         TEXT,
  notes             TEXT,
  generated_by      TEXT NOT NULL,
  generated_at      TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  revision          INTEGER NOT NULL DEFAULT 1,
  server_sync_seq   INTEGER NOT NULL DEFAULT 0,
  sync_state        TEXT NOT NULL DEFAULT 'SYNCED'
);
CREATE INDEX IF NOT EXISTS ix_shopping_lists_board ON shopping_lists (board_id, generated_at);

CREATE TABLE IF NOT EXISTS shopping_list_items (
  id                TEXT PRIMARY KEY NOT NULL,
  shopping_list_id  TEXT NOT NULL REFERENCES shopping_lists (id) ON DELETE CASCADE,
  ingredient_name   TEXT NOT NULL,
  quantity          REAL NOT NULL DEFAULT 0,
  unit              TEXT NOT NULL DEFAULT 'GM',
  purchased         INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  source_order_ids  TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  revision          INTEGER NOT NULL DEFAULT 1,
  server_sync_seq   INTEGER NOT NULL DEFAULT 0,
  sync_state        TEXT NOT NULL DEFAULT 'SYNCED'
);
CREATE INDEX IF NOT EXISTS ix_shopping_list_items_list ON shopping_list_items (shopping_list_id, sort_order);

-- ---------------------------------------------------------------------- orders

CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY NOT NULL,
  order_number      TEXT NOT NULL,
  board_id          TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  activity_type_id  TEXT,
  custom_activity   TEXT,
  venue             TEXT NOT NULL,
  pax               INTEGER NOT NULL DEFAULT 0,
  required_date     TEXT NOT NULL,   -- YYYY-MM-DD
  required_time     TEXT NOT NULL,   -- HH:MM
  priority          TEXT NOT NULL DEFAULT 'NORMAL',
  status            TEXT NOT NULL DEFAULT 'PENDING',
  completed_at      TEXT,
  completed_by      TEXT,
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  revision          INTEGER NOT NULL DEFAULT 1,
  server_sync_seq   INTEGER NOT NULL DEFAULT 0,
  sync_state        TEXT NOT NULL DEFAULT 'SYNCED',
  sync_error        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_order_number ON orders (order_number);
-- Board screen: today / upcoming / completed sections and the Home screen counts.
CREATE INDEX IF NOT EXISTS ix_orders_board_date
  ON orders (board_id, required_date, required_time);
CREATE INDEX IF NOT EXISTS ix_orders_board_status ON orders (board_id, status);
CREATE INDEX IF NOT EXISTS ix_orders_sync_state ON orders (sync_state);

-- A line names its dish exactly one way: menu_item_id (catalogued) or custom_item_name
-- (typed on the spot, when the dish has no master record yet). Mirrors ck_order_items_dish
-- in backend migration 008; not declared as a CHECK here because the local database is a
-- cache of rows the server has already validated.
CREATE TABLE IF NOT EXISTS order_items (
  id                  TEXT PRIMARY KEY NOT NULL,
  order_id            TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  menu_item_id        TEXT,
  custom_item_name    TEXT,
  quantity            REAL NOT NULL DEFAULT 0,
  unit                TEXT NOT NULL DEFAULT 'NOS',
  notes               TEXT,
  mentioned_user_ids  TEXT,            -- JSON array of user ids
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT,
  revision            INTEGER NOT NULL DEFAULT 1,
  server_sync_seq     INTEGER NOT NULL DEFAULT 0,
  sync_state          TEXT NOT NULL DEFAULT 'SYNCED'
);
CREATE INDEX IF NOT EXISTS ix_order_items_order ON order_items (order_id, sort_order);

-- ----------------------------------------------------------------- attachments

-- local_path holds the on-device file (captured or lazily downloaded); storage_path is
-- the server-side relative path. A row may have either or both.
CREATE TABLE IF NOT EXISTS attachments (
  id                TEXT PRIMARY KEY NOT NULL,
  owner_type        TEXT NOT NULL,
  owner_id          TEXT,
  kind              TEXT NOT NULL,
  file_name         TEXT NOT NULL,
  storage_path      TEXT,
  local_path        TEXT,
  mime_type         TEXT NOT NULL,
  size_bytes        INTEGER NOT NULL DEFAULT 0,
  duration_ms       INTEGER,
  width             INTEGER,
  height            INTEGER,
  checksum          TEXT,
  uploaded_by       TEXT NOT NULL,
  upload_state      TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | UPLOADING | UPLOADED | FAILED
  upload_attempts   INTEGER NOT NULL DEFAULT 0,
  cached_at         TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  revision          INTEGER NOT NULL DEFAULT 1,
  server_sync_seq   INTEGER NOT NULL DEFAULT 0,
  sync_state        TEXT NOT NULL DEFAULT 'SYNCED'
);
CREATE INDEX IF NOT EXISTS ix_attachments_owner ON attachments (owner_type, owner_id);
CREATE INDEX IF NOT EXISTS ix_attachments_upload_state ON attachments (upload_state);

-- ------------------------------------------------------------- thread & acks

-- The board feed. Every message belongs to a board; `order_id` is optional and says what the
-- message is *about*:
--   * order_id IS NULL  — a general board post (text, voice note, attachment).
--   * order_id IS NOT NULL — a comment/voice note on that order; renders nested under the
--     order's card in the same feed rather than in a separate screen.
-- SYSTEM rows (message_type = 'SYSTEM', author_id NULL) materialise order history —
-- ORDER_CREATED is what renders the structured order card (docs/SCOPE.md decision 2).
CREATE TABLE IF NOT EXISTS thread_messages (
  id                  TEXT PRIMARY KEY NOT NULL,
  board_id            TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  order_id            TEXT REFERENCES orders (id) ON DELETE CASCADE,
  parent_message_id   TEXT,
  author_id           TEXT,
  message_type        TEXT NOT NULL DEFAULT 'USER',
  body                TEXT,
  mentioned_user_ids  TEXT,            -- JSON array of user ids
  system_event        TEXT,            -- populated when message_type = 'SYSTEM'
  system_meta         TEXT,            -- JSON
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT,
  revision            INTEGER NOT NULL DEFAULT 1,
  server_sync_seq     INTEGER NOT NULL DEFAULT 0,
  sync_state          TEXT NOT NULL DEFAULT 'SYNCED',
  sync_error          TEXT
);
-- The board feed query (every message on a board, newest last) and the per-order thread query.
CREATE INDEX IF NOT EXISTS ix_thread_messages_board ON thread_messages (board_id, created_at);
CREATE INDEX IF NOT EXISTS ix_thread_messages_order ON thread_messages (order_id, created_at);
CREATE INDEX IF NOT EXISTS ix_thread_messages_parent ON thread_messages (parent_message_id);

CREATE TABLE IF NOT EXISTS acknowledgements (
  id                TEXT PRIMARY KEY NOT NULL,
  order_id          TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL,
  acknowledged_at   TEXT NOT NULL,
  note              TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  revision          INTEGER NOT NULL DEFAULT 1,
  server_sync_seq   INTEGER NOT NULL DEFAULT 0,
  sync_state        TEXT NOT NULL DEFAULT 'SYNCED'
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_acknowledgements_order_user
  ON acknowledgements (order_id, user_id);

-- -------------------------------------------------------------- notifications

CREATE TABLE IF NOT EXISTS notifications (
  id                TEXT PRIMARY KEY NOT NULL,
  user_id           TEXT NOT NULL,
  type              TEXT NOT NULL,
  title             TEXT NOT NULL,
  body              TEXT,
  board_id          TEXT,
  order_id          TEXT,
  actor_id          TEXT,
  data              TEXT,             -- JSON
  read_at           TEXT,
  created_at        TEXT NOT NULL,
  deleted_at        TEXT,             -- tombstone: user removed it from their inbox
  server_sync_seq   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_notifications_unread
  ON notifications (user_id, read_at, created_at);

-- ---------------------------------------------------------------- sync queue

-- Durable, ordered outbox. `id` is the clientOpId sent to the server, making the push
-- idempotent across retries. Rows are removed only on APPLIED, DUPLICATE or REJECTED.
CREATE TABLE IF NOT EXISTS sync_queue (
  id             TEXT PRIMARY KEY NOT NULL,
  entity         TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  op             TEXT NOT NULL,           -- UPSERT | DELETE
  payload        TEXT,                    -- JSON entity snapshot; NULL for DELETE
  base_revision  INTEGER,
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  next_attempt_at TEXT,                   -- exponential backoff gate
  last_error     TEXT,
  status         TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | IN_FLIGHT | FAILED
  created_at     TEXT NOT NULL,
  sequence       INTEGER NOT NULL         -- device-local ordering, monotonic
);
CREATE INDEX IF NOT EXISTS ix_sync_queue_dispatch
  ON sync_queue (status, next_attempt_at, sequence);
CREATE INDEX IF NOT EXISTS ix_sync_queue_entity ON sync_queue (entity, entity_id);

-- ------------------------------------------------------------------ settings

-- Device-local key/value store. Holds the sync cursor, session metadata and device
-- preferences only. Never system configuration — that is Admin Portal territory.
CREATE TABLE IF NOT EXISTS settings (
  setting_key  TEXT PRIMARY KEY NOT NULL,
  value        TEXT NOT NULL,             -- JSON-encoded
  updated_at   TEXT NOT NULL
);

-- Seeded keys:
--   db_schema_version  integer   local migration version
--   sync_cursor        integer   highest server sync_seq applied
--   last_sync_at       string    ISO timestamp of last successful pull
--   current_user_id    string    signed-in user
--   remember_login     boolean   persist refresh token across restarts
