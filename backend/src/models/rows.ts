import type { RowDataPacket } from 'mysql2/promise';
import type {
  AlertSoundSlot,
  AlertType,
  AttachmentKind,
  AttachmentOwnerType,
  BillingStatus,
  BoardRole,
  BoardStatus,
  ClientType,
  MasterStatus,
  MemberStatus,
  MessageType,
  NotificationType,
  OrderPriority,
  OrderStatus,
  RecipeDifficulty,
  RecipeIngredientScaling,
  ShoppingListStatus,
  UserRole,
  UserStatus,
  YoutubeImportStatus,
} from '@menuboard/shared';

/**
 * Row types mapped 1:1 to the tables in 001_core_schema.sql.
 *
 * `dateStrings: true` on the pool means DATE / DATETIME / TIME arrive as strings, and
 * DECIMAL / BIGINT arrive as strings too — reflected here so mapping code cannot forget to
 * convert. Repositories are the only layer that sees these types.
 */

interface SyncColumns {
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  sync_seq: string | number;
}

export interface UserRow extends RowDataPacket, SyncColumns {
  id: string;
  employee_code: string | null;
  name: string;
  username: string;
  phone: string | null;
  email: string | null;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  avatar_path: string | null;
  must_change_password: number;
  last_login_at: string | null;
  created_by: string | null;
}

export interface StationRow extends RowDataPacket, SyncColumns {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: MasterStatus;
  created_by: string | null;
}

export interface BoardRow extends RowDataPacket, SyncColumns {
  id: string;
  station_id: string;
  name: string;
  description: string | null;
  color: string | null;
  photo_path: string | null;
  status: BoardStatus;
  created_by: string;
  /** Present only on queries that join stations for display. */
  station_name?: string;
}

export interface BoardMemberRow extends RowDataPacket, SyncColumns {
  id: string;
  board_id: string;
  user_id: string;
  board_role: BoardRole;
  status: MemberStatus;
  joined_at: string | null;
  invited_by: string | null;
  /** Present only on queries that join users for display. */
  user_name?: string;
  user_avatar_path?: string | null;
}

export interface ActivityTypeRow extends RowDataPacket, SyncColumns {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  status: MasterStatus;
  sort_order: number;
  is_system: number;
  created_by: string | null;
}

export interface MenuCategoryRow extends RowDataPacket, SyncColumns {
  id: string;
  name: string;
  name_hi: string | null;
  description: string | null;
  image_path: string | null;
  status: MasterStatus;
  sort_order: number;
  created_by: string | null;
}

export interface MenuItemRow extends RowDataPacket, SyncColumns {
  id: string;
  category_id: string;
  name: string;
  name_hi: string | null;
  unit: string;
  unit_hi: string | null;
  image_path: string | null;
  status: MasterStatus;
  sort_order: number;
  created_by: string | null;
}

export interface OrderRow extends RowDataPacket, SyncColumns {
  id: string;
  order_number: string;
  board_id: string;
  activity_type_id: string | null;
  custom_activity: string | null;
  venue: string;
  pax: number;
  /** DATE column — 'YYYY-MM-DD'. */
  required_date: string;
  /** TIME column — 'HH:MM:SS'. */
  required_time: string;
  priority: OrderPriority;
  status: OrderStatus;
  completed_at: string | null;
  completed_by: string | null;
  shopping_generated_at: string | null;
  billed_at: string | null;
  billing_export_id: string | null;
  done_at: string | null;
  done_by: string | null;
  created_by: string;
  assigned_to: string | null;
  assigned_at: string | null;
}

export interface OrderItemRow extends RowDataPacket, SyncColumns {
  id: string;
  order_id: string;
  /** Null on an ad-hoc line, where `custom_item_name` carries the dish instead. */
  menu_item_id: string | null;
  custom_item_name: string | null;
  /** DECIMAL(12,3) — arrives as a string. */
  quantity: string;
  unit: string;
  notes: string | null;
  mentioned_user_ids: string | null;
  sort_order: number;
  cancelled_at: string | null;
  cancelled_by: string | null;
  replaced_by_item_id: string | null;
}

export interface AttachmentRow extends RowDataPacket, SyncColumns {
  id: string;
  owner_type: AttachmentOwnerType;
  owner_id: string | null;
  kind: AttachmentKind;
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: string | number;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  checksum: string | null;
  uploaded_by: string;
}

export interface ThreadMessageRow extends RowDataPacket, SyncColumns {
  id: string;
  board_id: string;
  /** Null for a general board post; set when the message is about that order. */
  order_id: string | null;
  parent_message_id: string | null;
  author_id: string | null;
  message_type: MessageType;
  body: string | null;
  mentioned_user_ids: string | null;
  system_event: string | null;
  system_meta: string | null;
  author_name?: string;
}

export interface AcknowledgementRow extends RowDataPacket, SyncColumns {
  id: string;
  order_id: string;
  user_id: string;
  acknowledged_at: string;
  note: string | null;
  user_name?: string;
}

export interface NotificationRow extends RowDataPacket, SyncColumns {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  board_id: string | null;
  order_id: string | null;
  actor_id: string | null;
  data: string | null;
  read_at: string | null;
}

export interface RefreshTokenRow extends RowDataPacket {
  id: string;
  user_id: string;
  token_hash: string;
  device_id: string;
  device_name: string | null;
  client_type: ClientType;
  push_token: string | null;
  ip: string | null;
  user_agent: string | null;
  expires_at: string;
  revoked_at: string | null;
  replaced_by: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface AuditLogRow extends RowDataPacket {
  id: string;
  actor_id: string | null;
  actor_role: UserRole | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  board_id: string | null;
  before_data: string | null;
  after_data: string | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: string;
  actor_name?: string;
}

export interface BillingExportRow extends RowDataPacket {
  id: string;
  board_id: string | null;
  period_from: string;
  period_to: string;
  billing_version: number;
  status: BillingStatus;
  total_orders: number;
  total_pax: string | number;
  snapshot: string;
  checksum: string;
  notes: string | null;
  generated_by: string;
  generated_at: string;
  generated_by_name?: string;
}

export interface SettingRow extends RowDataPacket {
  setting_key: string;
  value: string;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface CountRow extends RowDataPacket {
  total: number;
}

/* ----------------------------------------------------------- ingredients */

export interface IngredientCategoryRow extends RowDataPacket, SyncColumns {
  id: string;
  name: string;
  name_hi: string | null;
  status: MasterStatus;
  sort_order: number;
  created_by: string | null;
}

export interface IngredientRow extends RowDataPacket, SyncColumns {
  id: string;
  category_id: string | null;
  name: string;
  name_hi: string | null;
  unit: string;
  status: MasterStatus;
  sort_order: number;
  created_by: string | null;
  /** Present only on queries that join ingredient_categories. */
  category_name?: string | null;
}

/* --------------------------------------------------------------- recipes */

export interface RecipeRow extends RowDataPacket, SyncColumns {
  id: string;
  menu_item_id: string;
  base_pax: number;
  is_default: number;
  prep_time_min: number | null;
  cook_time_min: number | null;
  team_size: number | null;
  difficulty: RecipeDifficulty | null;
  description_en: string | null;
  description_hi: string | null;
  method_en: string | null;
  method_hi: string | null;
  yield_note: string | null;
  chef_notes: string | null;
  status: MasterStatus;
  created_by: string | null;
  /** Present only on queries that join menu_items. */
  menu_item_name?: string;
}

export interface RecipeIngredientRow extends RowDataPacket, SyncColumns {
  id: string;
  recipe_id: string;
  ingredient_id: string;
  /** DECIMAL(12,3) — arrives as a string. */
  quantity: string;
  unit: string;
  scaling: RecipeIngredientScaling;
  notes: string | null;
  sort_order: number;
  /** Present only on queries that join ingredients. */
  ingredient_name?: string;
  ingredient_name_hi?: string | null;
}

export interface RecipeStepRow extends RowDataPacket, SyncColumns {
  id: string;
  recipe_id: string;
  step_no: number;
  text_en: string;
  text_hi: string | null;
  duration_min: number | null;
  image_path: string | null;
}

/* -------------------------------------------------------- shopping lists */

export interface ShoppingListRow extends RowDataPacket, SyncColumns {
  id: string;
  board_id: string;
  title: string;
  status: ShoppingListStatus;
  /** JSON array of order UUIDs. */
  order_ids: string | null;
  notes: string | null;
  generated_by: string;
  generated_at: string;
  generated_by_name?: string;
}

export interface ShoppingListItemRow extends RowDataPacket, SyncColumns {
  id: string;
  shopping_list_id: string;
  ingredient_name: string;
  quantity: string;
  unit: string;
  purchased: number;
  notes: string | null;
  sort_order: number;
  source_order_ids: string | null;
}

/* ---------------------------------------------------------------- alerts */

export interface AlertSettingRow extends RowDataPacket, SyncColumns {
  id: string;
  alert_type: AlertType;
  enabled: number;
  lead_minutes: number;
  sound: AlertSoundSlot;
  repeat_until_ack: number;
  repeat_every_seconds: number;
  /** JSON array of UserRole. */
  target_roles: string | null;
  updated_by: string | null;
}

export interface AlertSoundRow extends RowDataPacket {
  slot: AlertSoundSlot;
  attachment_id: string | null;
  file_name: string | null;
  storage_path: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
  sync_seq: string | number;
}

/* ------------------------------------------------------------ permissions */

export interface RoleCapabilityRow extends RowDataPacket {
  role: string;
  capability: string;
  updated_by: string | null;
  updated_at: string;
}

export interface BoardRoleCapabilityRow extends RowDataPacket {
  board_role: string;
  capability: string;
  updated_by: string | null;
  updated_at: string;
}

/* -------------------------------------------------- YouTube recipe imports */

export interface YoutubeImportRow extends RowDataPacket {
  id: string;
  youtube_url: string;
  youtube_video_id: string;
  video_title: string | null;
  channel_name: string | null;
  duration_sec: number | null;
  thumbnail_url: string | null;
  status: YoutubeImportStatus;
  progress_percent: number;
  status_message: string | null;
  transcript: string | null;
  ocr_text: string | null;
  extracted_recipe_json: string | null;
  error_message: string | null;
  recipe_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  completed_at: string | null;
}
