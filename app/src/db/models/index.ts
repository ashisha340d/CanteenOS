/**
 * SQLite row types — one field per column, in the exact snake_case shape they are stored
 * in (docs/sqlite-schema.sql). Repositories map these to/from the camelCase `@menuboard/shared`
 * DTOs; nothing else in the app should read a raw row.
 */

export interface UserRow {
  id: string;
  employee_code: string | null;
  name: string;
  username: string;
  phone: string | null;
  email: string | null;
  role: string;
  status: string;
  avatar_path: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
  sync_state: string;
}

export interface StationRow {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
}

export interface BoardRow {
  id: string;
  station_id: string;
  name: string;
  description: string | null;
  color: string | null;
  photo_path: string | null;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
  sync_state: string;
  sync_error: string | null;
}

export interface BoardMemberRow {
  id: string;
  board_id: string;
  user_id: string;
  board_role: string;
  status: string;
  joined_at: string | null;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
  sync_state: string;
}

export interface ActivityTypeRow {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  status: string;
  sort_order: number;
  is_system: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
}

export interface MenuCategoryRow {
  id: string;
  name: string;
  /** Devanagari name; null falls back to `name`. */
  name_hi: string | null;
  description: string | null;
  image_path: string | null;
  status: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
}

export interface MenuItemRow {
  id: string;
  category_id: string;
  name: string;
  /** Devanagari name; null falls back to `name`. */
  name_hi: string | null;
  unit: string;
  /** Devanagari unit; null falls back to `unit`. */
  unit_hi: string | null;
  image_path: string | null;
  status: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
}

export interface OrderRow {
  id: string;
  order_number: string;
  board_id: string;
  activity_type_id: string | null;
  custom_activity: string | null;
  venue: string;
  pax: number;
  required_date: string;
  required_time: string;
  priority: string;
  status: string;
  completed_at: string | null;
  completed_by: string | null;
  /** Set when a shopping list was raised from this order; drives the On Shopping pill. */
  shopping_generated_at: string | null;
  /** Set when the order was billed. Freezes it for everyone (`isOrderLocked`). */
  billed_at: string | null;
  billing_export_id: string | null;
  done_at: string | null;
  done_by: string | null;
  created_by: string;
  /** Who owns getting this order done; null while it is unclaimed. */
  assigned_to: string | null;
  assigned_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
  sync_state: string;
  sync_error: string | null;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  /** Null on an ad-hoc line, where `custom_item_name` carries the dish instead. */
  menu_item_id: string | null;
  custom_item_name: string | null;
  quantity: number;
  unit: string;
  notes: string | null;
  mentioned_user_ids: string | null;
  sort_order: number;
  /** A cancelled line stays on the order, struck through, rather than being removed. */
  cancelled_at: string | null;
  cancelled_by: string | null;
  /** On a cancelled line, points at the line that superseded it. */
  replaced_by_item_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
  sync_state: string;
}

export interface AttachmentRow {
  id: string;
  owner_type: string;
  owner_id: string | null;
  kind: string;
  file_name: string;
  storage_path: string | null;
  local_path: string | null;
  mime_type: string;
  size_bytes: number;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  checksum: string | null;
  uploaded_by: string;
  upload_state: string;
  upload_attempts: number;
  cached_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
  sync_state: string;
}

export interface ThreadMessageRow {
  id: string;
  board_id: string;
  /** Null for a general board post; set when the message is about that order. */
  order_id: string | null;
  parent_message_id: string | null;
  author_id: string | null;
  message_type: string;
  body: string | null;
  mentioned_user_ids: string | null;
  system_event: string | null;
  system_meta: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
  sync_state: string;
  sync_error: string | null;
}

export interface AcknowledgementRow {
  id: string;
  order_id: string;
  user_id: string;
  acknowledged_at: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
  sync_state: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  board_id: string | null;
  order_id: string | null;
  actor_id: string | null;
  data: string | null;
  read_at: string | null;
  created_at: string;
  deleted_at: string | null;
  server_sync_seq: number;
}

export interface SyncQueueRow {
  id: string;
  entity: string;
  entity_id: string;
  op: string;
  payload: string | null;
  base_revision: number | null;
  attempts: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  last_error: string | null;
  status: string;
  created_at: string;
  sequence: number;
}

export interface SettingRow {
  setting_key: string;
  value: string;
  updated_at: string;
}

/* ------------------------------------------------------------ ingredients */

export interface IngredientRow {
  id: string;
  category_id: string | null;
  name: string;
  name_hi: string | null;
  unit: string;
  status: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
}

/* --------------------------------------------------------------- recipes */

export interface RecipeRow {
  id: string;
  menu_item_id: string;
  base_pax: number;
  is_default: number;
  prep_time_min: number | null;
  cook_time_min: number | null;
  team_size: number | null;
  difficulty: string | null;
  description_en: string | null;
  description_hi: string | null;
  method_en: string | null;
  method_hi: string | null;
  yield_note: string | null;
  chef_notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
}

export interface RecipeIngredientRow {
  id: string;
  recipe_id: string;
  ingredient_id: string;
  quantity: number;
  unit: string;
  scaling: string;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
}

export interface RecipeStepRow {
  id: string;
  recipe_id: string;
  step_no: number;
  text_en: string | null;
  text_hi: string | null;
  duration_min: number | null;
  image_path: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
}

/* -------------------------------------------------------- shopping lists */

export interface ShoppingListRow {
  id: string;
  board_id: string;
  title: string;
  status: string;
  /** JSON array of order ids. */
  order_ids: string | null;
  notes: string | null;
  generated_by: string;
  generated_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
  sync_state: string;
}

export interface ShoppingListItemRow {
  id: string;
  shopping_list_id: string;
  ingredient_name: string;
  quantity: number;
  unit: string;
  purchased: number;
  notes: string | null;
  sort_order: number;
  source_order_ids: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
  sync_state: string;
}

/* ---------------------------------------------------------------- alerts */

export interface AlertSettingRow {
  id: string;
  alert_type: string;
  enabled: number;
  lead_minutes: number;
  sound: string;
  repeat_until_ack: number;
  repeat_every_seconds: number;
  /** JSON array of UserRole. */
  target_roles: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
}
