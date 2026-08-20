import type { RowDataPacket } from 'mysql2/promise';

export * from './equipmentRows';
export * from './cleaningRows';

import type {
  AlertSoundSlot,
  AlertType,
  AttachmentKind,
  AttachmentOwnerType,
  AvailabilityStatus,
  BatchIssuePolicy,
  BillingStatus,
  BoardRole,
  BoardStatus,
  ClientType,
  EntityType,
  GstSyncStatus,
  GstTaxability,
  HsnSacCodeType,
  InventoryLocationKind,
  ItcEligibility,
  MasterStatus,
  MediaEntityType,
  MediaRole,
  MediaType,
  MemberStatus,
  MessageType,
  ModifierSelectionType,
  NotificationType,
  OrderPriority,
  OrderStatus,
  PosDiscountType,
  PosKdsLineStatus,
  PosOrderItemStatus,
  PosOrderStatus,
  PosOrderType,
  PosPaymentMethod,
  PosPaymentStatus,
  ProductKind,
  RecipeDifficulty,
  RecipeIngredientScaling,
  RoutableEntityType,
  ScheduleShift,
  ShoppingListStatus,
  SupplyType,
  TaskKind,
  TaskPriority,
  TaskSource,
  TaskStatus,
  UomDimension,
  UserRole,
  UserStatus,
  ValuationMethod,
  YoutubeImportStatus,
} from '@menuboard/shared';

/**
 * Row types mapped 1:1 to the tables in 001_schema.sql.
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
  catalogue_id: string | null;
  name: string;
  name_hi: string | null;
  description: string | null;
  image_path: string | null;
  status: MasterStatus;
  sort_order: number;
  created_by: string | null;
  /** Joined from `menus` for display, not a column on menu_categories. */
  catalogue_name?: string | null;
}

export interface MenuItemRow extends RowDataPacket, SyncColumns {
  id: string;
  category_id: string;
  group_id: string | null;
  name: string;
  name_hi: string | null;
  description: string | null;
  description_hi: string | null;
  unit: string;
  unit_hi: string | null;
  image_path: string | null;
  /** Resolved by the SELECT, not a column on menu_items — see MenuItemRepository. */
  primary_media_id?: string | null;
  base_price: string | null;
  tax_profile_id: string | null;
  always_available: number;
  prep_seconds: number | null;
  status: MasterStatus;
  sort_order: number;
  created_by: string | null;
  /** Joined from `menu_categories` for display; not a column on menu_items. */
  category_name?: string | null;
  /** Joined from `item_groups` for display; not a column on menu_items. */
  group_name?: string | null;
}

/* ------------------------------------------------------------- menu master */

export interface MenuRow extends RowDataPacket, SyncColumns {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: MasterStatus;
  sort_order: number;
  priority: number;
  version: number;
  effective_from: string | null;
  effective_until: string | null;
  published_at: string | null;
  created_by: string | null;
}

export interface MenuCategoryAssignmentRow extends RowDataPacket, SyncColumns {
  id: string;
  menu_id: string;
  category_id: string;
  display_name: string | null;
  display_name_hi: string | null;
  description: string | null;
  description_hi: string | null;
  status: MasterStatus;
  sort_order: number;
  pos_visible: number;
  board_visible: number;
  created_by: string | null;
  category_name?: string;
  category_name_hi?: string | null;
  category_image_path?: string | null;
}

export interface MenuItemAssignmentRow extends RowDataPacket, SyncColumns {
  id: string;
  menu_id: string;
  food_item_id: string;
  category_assignment_id: string | null;
  display_name: string | null;
  display_name_hi: string | null;
  description: string | null;
  description_hi: string | null;
  preparation_method: string | null;
  preparation_method_hi: string | null;
  preparation_time_minutes: number | null;
  unit: string | null;
  status: MasterStatus;
  availability: AvailabilityStatus;
  sort_order: number;
  pos_visible: number;
  board_visible: number;
  qr_visible: number;
  web_visible: number;
  app_visible: number;
  dine_in_available: number;
  takeaway_available: number;
  delivery_available: number;
  allow_decimal_quantity: number;
  created_by: string | null;
  food_item_name?: string;
  food_item_name_hi?: string | null;
  food_item_description?: string | null;
  food_item_unit?: string;
  food_item_image_path?: string | null;
  food_item_base_price?: string | null;
  variant_count?: number;
}

export interface MenuItemVariantRow extends RowDataPacket, SyncColumns {
  id: string;
  food_item_id: string;
  variant_code: string | null;
  name: string;
  name_hi: string | null;
  description: string | null;
  description_hi: string | null;
  portion_name: string | null;
  portion_name_hi: string | null;
  quantity: string | null;
  unit: string | null;
  price: string;
  tax_profile_id: string | null;
  status: MasterStatus;
  availability: AvailabilityStatus;
  sort_order: number;
  preparation_method: string | null;
  preparation_method_hi: string | null;
  preparation_time_minutes: number | null;
  is_default: number;
  allow_decimal_quantity: number;
  created_by: string | null;
}

export interface MediaAssetRow extends RowDataPacket, SyncColumns {
  id: string;
  file_name: string;
  storage_path: string;
  mime_type: string;
  file_extension: string | null;
  size_bytes: string | number;
  width: number | null;
  height: number | null;
  media_type: MediaType;
  title: string | null;
  alt_text: string | null;
  checksum: string | null;
  status: MasterStatus;
  created_by: string | null;
}

export interface MediaAssignmentRow extends RowDataPacket, SyncColumns {
  id: string;
  media_id: string;
  entity_type: MediaEntityType;
  entity_id: string;
  role: MediaRole;
  is_primary: number;
  sort_order: number;
  status: MasterStatus;
  created_by: string | null;
}

export interface CounterRow extends RowDataPacket, SyncColumns {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: MasterStatus;
  sort_order: number;
  created_by: string | null;
}

export interface CounterRouteRow extends RowDataPacket, SyncColumns {
  id: string;
  entity_type: RoutableEntityType;
  entity_id: string;
  counter_id: string;
  status: MasterStatus;
  created_by: string | null;
  counter_name?: string;
}

export interface PrintingGroupRow extends RowDataPacket, SyncColumns {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: MasterStatus;
  sort_order: number;
  created_by: string | null;
}

export interface PrintingRouteRow extends RowDataPacket, SyncColumns {
  id: string;
  entity_type: RoutableEntityType;
  entity_id: string;
  printing_group_id: string;
  sort_order: number;
  status: MasterStatus;
  created_by: string | null;
  printing_group_name?: string;
}

export interface ModifierGroupRow extends RowDataPacket, SyncColumns {
  id: string;
  name: string;
  description: string | null;
  selection_type: ModifierSelectionType;
  min_select: number;
  max_select: number | null;
  status: MasterStatus;
  sort_order: number;
  created_by: string | null;
}

export interface ModifierRow extends RowDataPacket, SyncColumns {
  id: string;
  modifier_group_id: string;
  name: string;
  name_hi: string | null;
  price_delta: string;
  status: MasterStatus;
  sort_order: number;
  created_by: string | null;
}

export interface ModifierAssignmentRow extends RowDataPacket, SyncColumns {
  id: string;
  entity_type: RoutableEntityType;
  entity_id: string;
  modifier_group_id: string;
  is_required: number;
  sort_order: number;
  status: MasterStatus;
  created_by: string | null;
  modifier_group_name?: string;
}

export interface MenuScheduleRow extends RowDataPacket, SyncColumns {
  id: string;
  menu_id: string;
  day_of_week: number | null;
  start_time: string;
  end_time: string;
  status: MasterStatus;
  created_by: string | null;
}

export interface ItemGroupRow extends RowDataPacket, SyncColumns {
  id: string;
  catalogue_id: string | null;
  name: string;
  code: string | null;
  description: string | null;
  status: MasterStatus;
  sort_order: number;
  created_by: string | null;
  /** Joined from `menus` for display, not a column on item_groups. */
  catalogue_name?: string | null;
}

export interface MenuItemScheduleRow extends RowDataPacket, SyncColumns {
  id: string;
  food_item_id: string;
  day_of_week: number;
  shift: ScheduleShift;
  is_available: number;
  created_by: string | null;
}

export interface MenuItemVariantCatalogPriceRow extends RowDataPacket, SyncColumns {
  id: string;
  variant_id: string;
  menu_id: string;
  price: string;
  status: MasterStatus;
  created_by: string | null;
  menu_name?: string;
  menu_code?: string;
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
  /** Menu Master sellable-configuration snapshot — see 012_menu_master.sql. */
  menu_id: string | null;
  variant_id: string | null;
  variant_name: string | null;
  unit_price: string | null;
  tax_amount: string;
  discount_amount: string;
  line_total: string | null;
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

/* ------------------------------------------------------------------- fast auth */

export interface UserPinRow extends RowDataPacket {
  user_id: string;
  pin_hash: string;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------ tasks */

export interface TaskRow extends RowDataPacket {
  id: string;
  title: string;
  description: string | null;
  kind: TaskKind;
  source: TaskSource;
  status: TaskStatus;
  priority: TaskPriority;
  assigned_to: string;
  assigned_by: string | null;
  order_id: string | null;
  board_id: string | null;
  due_at: string | null;
  estimated_minutes: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** Resolved by the SELECT's joins, not columns on tasks. */
  assigned_to_name?: string;
  assigned_by_name?: string | null;
  order_number?: string | null;
  board_name?: string | null;
}

/** Aggregate row behind the team activity view; every field is computed by the query. */
export interface TeamActivityRow extends RowDataPacket {
  user_id: string;
  name: string;
  task_id: string | null;
  task_title: string | null;
  task_kind: TaskKind | null;
  task_priority: TaskPriority | null;
  started_at: string | null;
  estimated_minutes: number | null;
  due_at: string | null;
  last_task_title: string | null;
  last_active_at: string | null;
}

/* ------------------------------------------------------------- GST / tax */

export interface HsnSacCodeRow extends RowDataPacket {
  id: string;
  code: string;
  code_type: HsnSacCodeType;
  description: string;
  chapter: string | null;
  heading: string | null;
  sub_heading: string | null;
  is_active: number;
  source: string;
  source_version: string | null;
  source_checksum: string | null;
  first_synced_at: string;
  last_synced_at: string;
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GstSyncRunRow extends RowDataPacket {
  id: string;
  started_at: string;
  completed_at: string | null;
  started_by: string | null;
  source: string;
  source_url: string | null;
  source_version: string | null;
  source_checksum: string | null;
  records_downloaded: number;
  records_added: number;
  records_updated: number;
  records_deactivated: number;
  records_unchanged: number;
  records_failed: number;
  status: GstSyncStatus;
  error_details: string | null;
  created_at: string;
  updated_at: string;
  /** Resolved by the SELECT's join to users, not a column. */
  started_by_name?: string | null;
}

export interface TaxProfileRow extends RowDataPacket {
  id: string;
  code: string;
  name: string;
  description: string | null;
  hsn_sac_id: string | null;
  supply_type: SupplyType;
  gst_taxability: GstTaxability;
  gst_rate: string;
  cgst_rate: string;
  sgst_rate: string;
  igst_rate: string;
  cess_rate: string;
  price_is_inclusive: number;
  itc_eligibility: ItcEligibility;
  effective_from: string | null;
  effective_to: string | null;
  exemption_reason: string | null;
  regulatory_notes: string | null;
  status: MasterStatus;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** Resolved by the SELECT's join to hsn_sac_master, not columns. */
  hsn_sac_code?: string | null;
  hsn_sac_code_type?: HsnSacCodeType | null;
  hsn_sac_description?: string | null;
  food_item_count?: number;
}

/* -------------------------------------------------- entities and point of sale */

export interface EntityRow extends RowDataPacket {
  id: string;
  code: string;
  type: EntityType;
  name: string;
  name_hi: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state_code: string | null;
  gstin: string | null;
  pan: string | null;
  department: string | null;
  designation: string | null;
  linked_user_id: string | null;
  discount_percent: string;
  credit_limit: string;
  account_balance: string;
  notes: string | null;
  status: MasterStatus;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** Resolved by the SELECT's joins, not columns. */
  linked_user_name?: string | null;
  pos_order_count?: number;
}

export interface PosOrderRow extends RowDataPacket {
  id: string;
  order_number: string;
  daily_sequence: number;
  business_date: string;
  order_type: PosOrderType;
  status: PosOrderStatus;
  payment_status: PosPaymentStatus;
  station_id: string | null;
  counter_id: string | null;
  menu_id: string | null;
  entity_id: string | null;
  entity_type: EntityType | null;
  entity_name: string | null;
  entity_phone: string | null;
  entity_address: string | null;
  table_label: string | null;
  pax: number;
  scheduled_for: string | null;
  notes: string | null;
  discount_type: PosDiscountType;
  discount_value: string;
  subtotal_amount: string;
  discount_amount: string;
  tax_amount: string;
  round_off_amount: string;
  total_amount: string;
  paid_amount: string;
  balance_amount: string;
  placed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  /** Resolved by the SELECT's joins, not columns. */
  station_name?: string | null;
  counter_name?: string | null;
  created_by_name?: string | null;
  item_count?: number;
}

export interface PosOrderItemRow extends RowDataPacket {
  id: string;
  pos_order_id: string;
  menu_item_id: string | null;
  variant_id: string | null;
  custom_item_name: string | null;
  item_name: string;
  variant_name: string | null;
  quantity: string;
  unit: string;
  unit_price: string;
  gross_amount: string;
  discount_type: PosDiscountType;
  discount_value: string;
  discount_amount: string;
  taxable_amount: string;
  tax_profile_id: string | null;
  tax_rate: string;
  cgst_amount: string;
  sgst_amount: string;
  igst_amount: string;
  cess_amount: string;
  tax_amount: string;
  line_total: string;
  allow_decimal_quantity: number;
  notes: string | null;
  sort_order: number;
  status: PosOrderItemStatus;
  cancelled_at: string | null;
  cancelled_by: string | null;
  kds_status: PosKdsLineStatus;
  cancel_reason: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  served_at: string | null;
  served_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PosPaymentRow extends RowDataPacket {
  id: string;
  pos_order_id: string;
  method: PosPaymentMethod;
  amount: string;
  tendered_amount: string | null;
  change_amount: string;
  reference: string | null;
  notes: string | null;
  entity_id: string | null;
  is_reversal: number;
  received_by: string | null;
  received_at: string;
  created_at: string;
  updated_at: string;
}

export interface WebAuthnCredentialRow extends RowDataPacket {
  id: string;
  credential_id: string;
  user_id: string;
  public_key: string;
  sign_counter: number;
  transports: string;
  backup_eligible: number;
  backup_state: number;
  device_name: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebAuthnChallengeRow extends RowDataPacket {
  id: string;
  user_id: string;
  type: 'registration' | 'authentication';
  challenge: string;
  expires_at: string;
  created_at: string;
}

export interface PasswordResetRow extends RowDataPacket {
  id: string;
  user_id: string;
  email: string;
  code_hash: string;
  used_at: string | null;
  expires_at: string;
  created_at: string;
}

/* ------------------------------------------- purchase & inventory masters (004) */

export interface UomRow extends RowDataPacket {
  id: string;
  code: string;
  name: string;
  dimension: UomDimension;
  is_base: number;
  /** DECIMAL(18,6) — arrives as a string. */
  factor_to_base: string;
  decimal_places: number;
  status: MasterStatus;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface InventoryLocationRow extends RowDataPacket {
  id: string;
  code: string;
  name: string;
  name_hi: string | null;
  kind: InventoryLocationKind;
  parent_id: string | null;
  counter_id: string | null;
  station_id: string | null;
  department: string | null;
  is_default_receiving: number;
  allows_negative_stock: number;
  status: MasterStatus;
  sort_order: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  /** Resolved by the SELECT's join to the parent location, not a column. */
  parent_name?: string | null;
}

export interface ProductRow extends RowDataPacket, SyncColumns {
  id: string;
  category_id: string | null;
  name: string;
  name_hi: string | null;
  unit: string;
  status: MasterStatus;
  sort_order: number;
  created_by: string | null;

  code: string | null;
  barcode: string | null;
  brand: string | null;
  description: string | null;
  kind: ProductKind;

  hsn_sac_id: string | null;
  tax_profile_id: string | null;

  stock_uom_id: string | null;
  purchase_uom_id: string | null;
  /** DECIMAL(18,6) — arrives as a string. */
  purchase_conversion_factor: string;
  pack_size: string | null;

  is_batch_tracked: number;
  is_expiry_tracked: number;
  shelf_life_days: number | null;
  batch_issue_policy: BatchIssuePolicy;

  valuation_method: ValuationMethod;
  /** DECIMAL(14,4) — arrives as a string. */
  standard_cost: string | null;
  moving_average_cost: string;
  last_purchase_rate: string | null;
  last_purchased_at: string | null;

  default_location_id: string | null;
  preferred_supplier_id: string | null;
  /** DECIMAL(14,3) — arrives as a string. */
  min_stock: string | null;
  reorder_level: string | null;
  max_stock: string | null;
  lead_time_days: number | null;
  is_purchasable: number;
  is_stocked: number;

  /** Resolved by the SELECT's joins, not columns. */
  category_name?: string | null;
  stock_uom_code?: string | null;
  purchase_uom_code?: string | null;
  tax_profile_name?: string | null;
  tax_rate?: string | null;
  hsn_sac_code?: string | null;
  hsn_sac_code_type?: HsnSacCodeType | null;
  default_location_name?: string | null;
  preferred_supplier_name?: string | null;
  stock_on_hand?: string | number;
}

export interface ProductLocationRow extends RowDataPacket {
  id: string;
  product_id: string;
  location_id: string;
  /** DECIMAL(14,3) — arrives as a string. */
  min_stock: string | null;
  reorder_level: string | null;
  max_stock: string | null;
  is_default_destination: number;
  bin: string | null;
  status: MasterStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** Resolved by the SELECT's joins, not columns. */
  product_name?: string;
  location_name?: string;
  location_kind?: InventoryLocationKind;
}

export interface SupplierProductRow extends RowDataPacket {
  id: string;
  supplier_id: string;
  product_id: string;
  supplier_sku: string | null;
  supplier_product_name: string | null;
  barcode: string | null;
  purchase_uom_id: string | null;
  /** DECIMAL(18,6) — arrives as a string. */
  conversion_factor: string;
  pack_size: string | null;
  /** DECIMAL(14,4) — arrives as a string. */
  last_rate: string | null;
  last_purchased_at: string | null;
  lead_time_days: number | null;
  is_preferred: number;
  status: MasterStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** Resolved by the SELECT's joins, not columns. */
  supplier_name?: string;
  product_name?: string;
  product_unit?: string;
  purchase_uom_code?: string | null;
}

/**
 * A VENDOR row of the entity master, read through the purchase lens: the shared entity
 * columns the purchase screens need plus the `vendor_*` profile added by migration 004.
 */
export interface VendorRow extends RowDataPacket {
  id: string;
  code: string;
  type: EntityType;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state_code: string | null;
  gstin: string | null;
  pan: string | null;
  /** DECIMAL(14,2) — arrives as a string. */
  credit_limit: string;
  account_balance: string;
  status: MasterStatus;
  vendor_payment_terms: string | null;
  vendor_credit_days: number;
  vendor_bank_name: string | null;
  vendor_bank_account: string | null;
  vendor_bank_ifsc: string | null;
  vendor_opening_balance: string;
  vendor_is_approved: number;
  vendor_default_location_id: string | null;
}
