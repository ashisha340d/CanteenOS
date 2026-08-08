import type {
  AlertSoundSlot,
  AlertType,
  AttachmentKind,
  AttachmentOwnerType,
  BillingStatus,
  BoardRole,
  BoardStatus,
  MasterStatus,
  MemberStatus,
  MessageType,
  NotificationType,
  OrderPriority,
  OrderStatus,
  RecipeDifficulty,
  RecipeIngredientScaling,
  ShoppingListStatus,
  SystemEvent,
  UserRole,
  UserStatus,
  YoutubeImportStatus,
} from '../enums';
import type { ClockTime, IsoDate, IsoDateTime, SyncMeta, Uuid } from './common';

/* ------------------------------------------------------------------ users */

export interface UserDto extends SyncMeta {
  id: Uuid;
  employeeCode: string | null;
  name: string;
  username: string;
  phone: string | null;
  email: string | null;
  role: UserRole;
  status: UserStatus;
  avatarPath: string | null;
  lastLoginAt: IsoDateTime | null;
}

export interface CreateUserRequest {
  id?: Uuid;
  employeeCode?: string | null;
  name: string;
  username: string;
  phone?: string | null;
  email?: string | null;
  password: string;
  role: UserRole;
  status?: UserStatus;
}

export interface UpdateUserRequest {
  employeeCode?: string | null;
  name?: string;
  phone?: string | null;
  email?: string | null;
  role?: UserRole;
  status?: UserStatus;
  /** Admin-initiated reset; forces mustChangePassword. */
  password?: string;
}

/* --------------------------------------------------------------- stations */

/**
 * The organisation's real-world site (e.g. "Barsana", "Mangarh"). A board belongs to
 * exactly one station; a station has any number of boards (Canteen, Dining Hall, Prasad
 * Ghar, ...). Membership stays board-scoped — there is deliberately no station-level
 * membership table — so a user can hold independent roles on same-named boards at two
 * different stations (Barsana > Canteen Board, Mangarh > Canteen Board).
 */
export interface StationDto extends SyncMeta {
  id: Uuid;
  name: string;
  /** Optional short code/slug, admin-assigned. */
  code: string | null;
  description: string | null;
  status: MasterStatus;
  createdBy: Uuid | null;
}

export interface CreateStationRequest {
  id?: Uuid;
  name: string;
  code?: string | null;
  description?: string | null;
  status?: MasterStatus;
}

export interface UpdateStationRequest {
  name?: string;
  code?: string | null;
  description?: string | null;
  status?: MasterStatus;
}

/* ----------------------------------------------------------------- boards */

export interface BoardDto extends SyncMeta {
  id: Uuid;
  /** The station this board belongs to. Every board has exactly one. */
  stationId: Uuid;
  name: string;
  description: string | null;
  /** Hex swatch (`#RRGGBB`), admin-configurable. Null falls back to a deterministic icon. */
  color: string | null;
  /** Storage path of an uploaded board photo, same convention as UserDto.avatarPath. */
  photoPath: string | null;
  status: BoardStatus;
  createdBy: Uuid;
  /** Denormalised for display; not stored on the board row. */
  stationName?: string;
}

export interface BoardWithMembersDto extends BoardDto {
  members: BoardMemberDto[];
  /** Counts for the Home screen; computed, never stored. */
  openOrderCount?: number;
  todayOrderCount?: number;
}

export interface CreateBoardRequest {
  id?: Uuid;
  stationId: Uuid;
  name: string;
  description?: string | null;
  color?: string | null;
  photoPath?: string | null;
  /** Members to seed on creation. The creator is always added as OWNER. */
  members?: { userId: Uuid; boardRole: BoardRole }[];
}

export interface UpdateBoardRequest {
  /** Re-parents the board to a different station. */
  stationId?: Uuid;
  name?: string;
  description?: string | null;
  color?: string | null;
  photoPath?: string | null;
  status?: BoardStatus;
}

export interface BoardMemberDto extends SyncMeta {
  id: Uuid;
  boardId: Uuid;
  userId: Uuid;
  boardRole: BoardRole;
  status: MemberStatus;
  joinedAt: IsoDateTime | null;
  invitedBy: Uuid | null;
  /** Denormalised for display; not persisted on the membership row. */
  userName?: string;
  userAvatarPath?: string | null;
}

export interface UpsertBoardMemberRequest {
  userId: Uuid;
  boardRole: BoardRole;
}

/** An active user not yet a member of a given board — candidates for the add-member picker. */
export interface BoardEligibleUserDto {
  id: Uuid;
  name: string;
  username: string;
  avatarPath: string | null;
}

/* ---------------------------------------------------------------- masters */

export interface ActivityTypeDto extends SyncMeta {
  id: Uuid;
  name: string;
  description: string | null;
  icon: string | null;
  status: MasterStatus;
  sortOrder: number;
  /** Seeded types cannot be deleted, only deactivated. */
  isSystem: boolean;
}

export interface MenuCategoryDto extends SyncMeta {
  id: Uuid;
  name: string;
  /**
   * Devanagari name, authored rather than machine-translated — a dish has one spelling the
   * kitchen already uses. Null falls back to `name`, so the catalogue stays usable while it
   * is being translated.
   */
  nameHi: string | null;
  description: string | null;
  imagePath: string | null;
  status: MasterStatus;
  sortOrder: number;
}

export interface MenuItemDto extends SyncMeta {
  id: Uuid;
  categoryId: Uuid;
  name: string;
  /** Devanagari name. Null falls back to `name`. */
  nameHi: string | null;
  unit: string;
  /** Devanagari unit ("प्लेट", "किलो"). Null falls back to `unit`. */
  unitHi: string | null;
  imagePath: string | null;
  status: MasterStatus;
  sortOrder: number;
}

export interface MasterWriteRequest {
  id?: Uuid;
  name: string;
  description?: string | null;
  status?: MasterStatus;
  sortOrder?: number;
}

export interface ActivityTypeWriteRequest extends MasterWriteRequest {
  icon?: string | null;
}

export interface MenuCategoryWriteRequest extends MasterWriteRequest {
  nameHi?: string | null;
  imagePath?: string | null;
}

export interface MenuItemWriteRequest extends MasterWriteRequest {
  categoryId: Uuid;
  nameHi?: string | null;
  unit: string;
  unitHi?: string | null;
  imagePath?: string | null;
}

/* ----------------------------------------------------------------- orders */

export interface OrderDto extends SyncMeta {
  id: Uuid;
  orderNumber: string;
  boardId: Uuid;
  activityTypeId: Uuid | null;
  customActivity: string | null;
  venue: string;
  pax: number;
  requiredDate: IsoDate;
  requiredTime: ClockTime;
  priority: OrderPriority;
  status: OrderStatus;
  createdBy: Uuid;
  completedAt: IsoDateTime | null;
  completedBy: Uuid | null;
  /**
   * Cross-cutting states. Both are independent of `status` — a shopping list can be raised
   * at any point and billing does not require the order to be Done. Feed them plus `status`
   * to `deriveOrderDisplayStatus` rather than reading them individually for the pill.
   */
  shoppingGeneratedAt: IsoDateTime | null;
  billedAt: IsoDateTime | null;
  billingExportId: Uuid | null;
  doneAt: IsoDateTime | null;
  doneBy: Uuid | null;
  /**
   * The board member who owns getting this order done, or null while it is unclaimed.
   *
   * Deliberately *not* part of the status lifecycle: an order can be assigned before anyone
   * acknowledges it and reassigned at any point without moving the status, which is how a
   * kitchen actually hands work over mid-service.
   */
  assignedTo: Uuid | null;
  assignedAt: IsoDateTime | null;
  /** Denormalised for the feed card; not stored on the order row. */
  createdByName?: string;
  assignedToName?: string;
}

export interface AssignOrderRequest {
  /** Null clears the assignment. */
  assignedTo: Uuid | null;
}

/**
 * A line on an order.
 *
 * Lines are never removed once the order is live: cancelling stamps `cancelledAt` so the
 * feed can keep showing it struck through, and replacing points the cancelled line at its
 * successor, which is inserted directly beneath it.
 *
 * A line names its dish in exactly one of two ways, and never both:
 * - `menuItemId` set, `customItemName` null — a catalogued dish.
 * - `menuItemId` null, `customItemName` set — an ad-hoc dish typed on the spot, because a
 *   kitchen cannot wait for an Admin to register a master record mid-service. This is
 *   order-scoped free text; it does *not* create a `menu_items` row, so the Android master
 *   cache stays read-only (docs/MENUBOARD_SPEC.md §3).
 *
 * Ad-hoc lines are invisible to anything that needs a catalogued dish: recipe scaling and
 * shopping-list generation skip them, and billing shows them under a synthetic category.
 */
export interface OrderItemDto extends SyncMeta {
  id: Uuid;
  orderId: Uuid;
  menuItemId: Uuid | null;
  /** Set only when `menuItemId` is null. */
  customItemName: string | null;
  quantity: number;
  unit: string;
  notes: string | null;
  mentionedUserIds: Uuid[];
  sortOrder: number;
  cancelledAt: IsoDateTime | null;
  cancelledBy: Uuid | null;
  /** Set on the cancelled line, pointing at the line that superseded it. */
  replacedByItemId: Uuid | null;
  /** Denormalised for display; not stored on the item row. */
  menuItemName?: string;
}

/**
 * The label to show for a line, whichever way it names its dish. Clients should use this
 * rather than reaching for `menuItemName` directly, so an ad-hoc line never renders blank.
 */
export function orderItemLabel(
  item: Pick<OrderItemDto, 'customItemName' | 'menuItemName'>,
  fallback = 'Item',
): string {
  return item.customItemName ?? item.menuItemName ?? fallback;
}

export interface OrderDetailDto extends OrderDto {
  items: OrderItemDto[];
  attachments: AttachmentDto[];
  acknowledgements: AcknowledgementDto[];
  /** Board members who have not yet acknowledged. */
  pendingAcknowledgementUserIds: Uuid[];
  messageCount: number;
}

export interface CreateOrderRequest {
  id?: Uuid;
  orderNumber?: string;
  boardId: Uuid;
  activityTypeId?: Uuid | null;
  customActivity?: string | null;
  venue: string;
  pax: number;
  requiredDate: IsoDate;
  requiredTime: ClockTime;
  priority?: OrderPriority;
  items: CreateOrderItemRequest[];
  attachmentIds?: Uuid[];
}

/** Exactly one of `menuItemId` / `customItemName` must be supplied — see `OrderItemDto`. */
export interface CreateOrderItemRequest {
  id?: Uuid;
  menuItemId?: Uuid | null;
  customItemName?: string | null;
  quantity: number;
  unit?: string;
  notes?: string | null;
  mentionedUserIds?: Uuid[];
  sortOrder?: number;
}

export interface UpdateOrderRequest {
  activityTypeId?: Uuid | null;
  customActivity?: string | null;
  venue?: string;
  pax?: number;
  requiredDate?: IsoDate;
  requiredTime?: ClockTime;
  priority?: OrderPriority;
  /** Full replacement of the item set when present. */
  items?: CreateOrderItemRequest[];
  /** Optimistic concurrency guard; rejected with STALE_WRITE on mismatch. */
  expectedRevision?: number;
}

export interface UpdateOrderStatusRequest {
  status: OrderStatus;
  note?: string;
}

/**
 * Quantity and pax edits are their own endpoint rather than part of `UpdateOrderRequest`,
 * because they carry a different capability (ORDER_QUANTITY_EDIT) and each one writes a
 * before/after row into the board feed.
 */
export interface UpdateOrderQuantitiesRequest {
  /** New serving count for the whole order. */
  pax?: number;
  /** Per-line quantity changes; lines not listed are untouched. */
  items?: { itemId: Uuid; quantity: number }[];
  /** Lines to strike through. They stay on the order, greyed out. */
  cancelItemIds?: Uuid[];
  /**
   * Lines to supersede. The old line is cancelled and the replacement is inserted directly
   * beneath it, so the feed reads as a correction rather than an edit.
   */
  replaceItems?: {
    itemId: Uuid;
    menuItemId?: Uuid | null;
    customItemName?: string | null;
    quantity: number;
    unit?: string;
    notes?: string | null;
  }[];
  /** Lines to append. */
  addItems?: CreateOrderItemRequest[];
  note?: string;
  expectedRevision?: number;
}

export interface OrderListQuery {
  boardId?: Uuid;
  status?: OrderStatus[];
  priority?: OrderPriority[];
  activityTypeId?: Uuid;
  createdBy?: Uuid;
  dateFrom?: IsoDate;
  dateTo?: IsoDate;
  search?: string;
  page?: number;
  pageSize?: number;
}

/* -------------------------------------------------------------- ingredients */

/**
 * Recipe-only ingredient master (name/unit/category). Deliberately narrow: no purchase
 * unit, pack size, price, GST, HSN or brand fields — that is a procurement concern outside
 * MenuBoard's scope (docs/MENUBOARD_SPEC.md's inventory exclusion). `recipe_ingredients`
 * rows reference this table instead of storing a free-text name, so "Wheat Flour" typed
 * once is reused by every recipe that needs it.
 */
export interface IngredientDto extends SyncMeta {
  id: Uuid;
  categoryId: Uuid | null;
  name: string;
  nameHi: string | null;
  unit: string;
  status: MasterStatus;
  sortOrder: number;
  /** Denormalised for display. */
  categoryName?: string | null;
}

export interface IngredientWriteRequest {
  id?: Uuid;
  categoryId?: Uuid | null;
  name: string;
  nameHi?: string | null;
  unit: string;
  status?: MasterStatus;
  sortOrder?: number;
}

export interface IngredientCategoryDto extends SyncMeta {
  id: Uuid;
  name: string;
  nameHi: string | null;
  status: MasterStatus;
  sortOrder: number;
}

export interface IngredientCategoryWriteRequest {
  id?: Uuid;
  name: string;
  nameHi?: string | null;
  status?: MasterStatus;
  sortOrder?: number;
}

/* ---------------------------------------------------------------- recipes */

/**
 * A recipe belongs to one menu item and states its ingredients for `basePax` servings.
 * Quantities are stored at that base and scaled on read, so changing an order's pax never
 * rewrites recipe data.
 *
 * A menu item may have several authored variants (e.g. three kinds of Roti); exactly one
 * is `isDefault`, and that is the variant `ShoppingListService` scales against.
 */
export interface RecipeDto extends SyncMeta {
  id: Uuid;
  menuItemId: Uuid;
  basePax: number;
  isDefault: boolean;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  teamSize: number | null;
  difficulty: RecipeDifficulty | null;
  /** A short label for this variant, e.g. "Missi Roti" — shown alongside the menu item name. */
  descriptionEn: string | null;
  descriptionHi: string | null;
  /** Free-text method summary; the ordered `steps` below are the primary authoring surface. */
  methodEn: string | null;
  methodHi: string | null;
  yieldNote: string | null;
  chefNotes: string | null;
  status: MasterStatus;
  ingredients: RecipeIngredientDto[];
  steps: RecipeStepDto[];
  /** Denormalised for display. */
  menuItemName?: string;
}

export interface RecipeIngredientDto extends SyncMeta {
  id: Uuid;
  recipeId: Uuid;
  ingredientId: Uuid;
  /** Quantity for `RecipeDto.basePax` servings. */
  quantity: number;
  unit: string;
  scaling: RecipeIngredientScaling;
  notes: string | null;
  sortOrder: number;
  /** Denormalised for display. */
  ingredientName?: string;
  ingredientNameHi?: string | null;
}

export interface RecipeStepDto extends SyncMeta {
  id: Uuid;
  recipeId: Uuid;
  stepNo: number;
  textEn: string;
  textHi: string | null;
  durationMin: number | null;
  imagePath: string | null;
}

/** A recipe with its quantities already multiplied out for a requested serving count. */
export interface ScaledRecipeDto {
  recipeId: Uuid;
  menuItemId: Uuid;
  menuItemName: string;
  basePax: number;
  /** The count the quantities below were scaled to. */
  scaledToPax: number;
  methodEn: string | null;
  methodHi: string | null;
  ingredients: {
    ingredientId: Uuid;
    name: string;
    nameHi: string | null;
    /** Recomputed from `scaling`, rounded to three decimals. */
    quantity: number;
    baseQuantity: number;
    unit: string;
    scaling: RecipeIngredientScaling;
    notes: string | null;
  }[];
  steps: RecipeStepDto[];
}

export interface RecipeWriteRequest {
  id?: Uuid;
  menuItemId: Uuid;
  basePax: number;
  isDefault?: boolean;
  prepTimeMin?: number | null;
  cookTimeMin?: number | null;
  teamSize?: number | null;
  difficulty?: RecipeDifficulty | null;
  descriptionEn?: string | null;
  descriptionHi?: string | null;
  methodEn?: string | null;
  methodHi?: string | null;
  yieldNote?: string | null;
  chefNotes?: string | null;
  status?: MasterStatus;
  ingredients: {
    id?: Uuid;
    ingredientId: Uuid;
    quantity: number;
    unit: string;
    scaling?: RecipeIngredientScaling;
    notes?: string | null;
    sortOrder?: number;
  }[];
  /** Always a full replace, same as `ingredients` — the admin form submits complete state. */
  steps?: {
    id?: Uuid;
    textEn: string;
    textHi?: string | null;
    durationMin?: number | null;
    imagePath?: string | null;
  }[];
}

/* --------------------------------------------------------- shopping lists */

/**
 * The purchasing sheet a Manager raises from one or more orders. Generating one stamps
 * `orders.shopping_generated_at`, which is what puts the On Shopping pill on those orders.
 */
export interface ShoppingListDto extends SyncMeta {
  id: Uuid;
  boardId: Uuid;
  /** The orders this sheet was rolled up from. */
  orderIds: Uuid[];
  title: string;
  status: ShoppingListStatus;
  generatedBy: Uuid;
  generatedAt: IsoDateTime;
  notes: string | null;
  items: ShoppingListItemDto[];
  generatedByName?: string;
}

/**
 * One purchasable ingredient. Identical ingredient/unit pairs from different orders are
 * summed into a single line, with `sourceOrderIds` recording where the total came from.
 */
export interface ShoppingListItemDto extends SyncMeta {
  id: Uuid;
  shoppingListId: Uuid;
  ingredientName: string;
  quantity: number;
  unit: string;
  /** Ticked off by whoever does the buying. */
  purchased: boolean;
  notes: string | null;
  sortOrder: number;
  sourceOrderIds: Uuid[];
}

export interface GenerateShoppingListRequest {
  /** All orders must belong to the board in the path. */
  orderIds: Uuid[];
  title?: string;
  notes?: string | null;
}

export interface UpdateShoppingListRequest {
  status?: ShoppingListStatus;
  notes?: string | null;
  /** Tick/untick lines. */
  items?: { itemId: Uuid; purchased?: boolean; quantity?: number }[];
}

/* ------------------------------------------------------------------ alerts */

/**
 * One configured alarm, organisation-wide. Admin owns these; every client reads them to
 * decide when to buzz and which sound to play.
 */
export interface AlertSettingDto extends SyncMeta {
  id: Uuid;
  alertType: AlertType;
  enabled: boolean;
  /**
   * How far ahead of the trigger point the alarm fires. Meaningless for NEW_INCOMING,
   * which fires on arrival.
   */
  leadMinutes: number;
  sound: AlertSoundSlot;
  /**
   * Keep notifying until the recipient acknowledges. Continued alerts always vibrate, even
   * when no sound has been uploaded for the slot.
   */
  repeatUntilAck: boolean;
  repeatEverySeconds: number;
  /** Which roles receive this alarm. */
  targetRoles: UserRole[];
  updatedBy: Uuid | null;
}

export interface UpdateAlertSettingRequest {
  enabled?: boolean;
  leadMinutes?: number;
  sound?: AlertSoundSlot;
  repeatUntilAck?: boolean;
  repeatEverySeconds?: number;
  targetRoles?: UserRole[];
}

/** An uploaded buzzer. One row per slot; uploading again replaces the slot's file. */
export interface AlertSoundDto extends SyncMeta {
  slot: AlertSoundSlot;
  /** Null means no file uploaded — clients fall back to vibration only. */
  attachmentId: Uuid | null;
  fileName: string | null;
  storagePath: string | null;
  updatedBy: Uuid | null;
}

/**
 * A due alarm, computed by the server from orders + settings. The client turns each into a
 * local notification; `fireAt` is absolute so a device that was offline still buzzes at the
 * right moment.
 */
export interface PendingAlertDto {
  id: string;
  alertType: AlertType;
  orderId: Uuid | null;
  boardId: Uuid;
  title: string;
  body: string;
  fireAt: IsoDateTime;
  sound: AlertSoundSlot;
  repeatUntilAck: boolean;
  repeatEverySeconds: number;
}

/* ----------------------------------------------------------- voice model */

/**
 * Everything a device needs to decide whether to fetch the offline speech model, and to
 * prove that what it fetched is intact.
 *
 * The model is not bundled with the app: the multilingual Whisper Base weights are far too
 * large to ship in the APK, and a user who never dictates an order should never pay for
 * them. `version` is what an installed client compares to learn an update exists — the
 * checksum cannot serve that purpose, since knowing it differs would require downloading
 * the file first.
 */
export interface VoiceModelManifestDto {
  version: string;
  /** Identifies the weights, e.g. `whisper-base-multilingual`. */
  model: string;
  /** Always true — a `.en` model could not handle Hindi or Hinglish. */
  multilingual: boolean;
  sizeBytes: number;
  /** Lowercase hex. The device must verify this before activating the file. */
  sha256: string;
  /** Time-limited and bound to the requesting user. */
  downloadUrl: string;
  expiresInSeconds: number;
}

/* ------------------------------------------------------------ attachments */

export interface AttachmentDto extends SyncMeta {
  id: Uuid;
  ownerType: AttachmentOwnerType;
  ownerId: Uuid | null;
  kind: AttachmentKind;
  fileName: string;
  /** Relative path served by the media endpoint; never a filesystem path. */
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  checksum: string | null;
  uploadedBy: Uuid;
}

export interface AttachmentUploadResult {
  attachment: AttachmentDto;
  /** Signed, time-limited URL for download. */
  url: string;
}

/* ------------------------------------------------------------ board feed */

/**
 * One message on a board's feed. `orderId` says what the message is *about*:
 *
 *   - `null` — a general board post (text, voice note, attachment).
 *   - set — a comment/voice note on that order, rendered nested under the order's card in
 *     the same feed rather than in a separate screen.
 *
 * `SYSTEM` rows (`authorId === null`) materialise order history; `ORDER_CREATED` is what the
 * app renders as the structured order card.
 */
export interface ThreadMessageDto extends SyncMeta {
  id: Uuid;
  boardId: Uuid;
  orderId: Uuid | null;
  parentMessageId: Uuid | null;
  authorId: Uuid | null;
  messageType: MessageType;
  body: string | null;
  mentionedUserIds: Uuid[];
  systemEvent: SystemEvent | null;
  systemMeta: Record<string, unknown> | null;
  attachments?: AttachmentDto[];
  authorName?: string;
}

export interface CreateThreadMessageRequest {
  id?: Uuid;
  /** Attaches the message to an order. Omitted/null posts it as a general board message. */
  orderId?: Uuid | null;
  parentMessageId?: Uuid | null;
  body?: string | null;
  mentionedUserIds?: Uuid[];
  attachmentIds?: Uuid[];
}

/* -------------------------------------------------------- acknowledgements */

export interface AcknowledgementDto extends SyncMeta {
  id: Uuid;
  orderId: Uuid;
  userId: Uuid;
  acknowledgedAt: IsoDateTime;
  note: string | null;
  userName?: string;
}

export interface CreateAcknowledgementRequest {
  id?: Uuid;
  note?: string | null;
}

/* ---------------------------------------------------------- notifications */

export interface NotificationDto {
  id: Uuid;
  userId: Uuid;
  type: NotificationType;
  title: string;
  body: string | null;
  boardId: Uuid | null;
  orderId: Uuid | null;
  actorId: Uuid | null;
  data: Record<string, unknown> | null;
  readAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
  syncSeq: number;
}

/* --------------------------------------------------------------- billing */

export interface BillingExportDto {
  id: Uuid;
  boardId: Uuid | null;
  periodFrom: IsoDate;
  periodTo: IsoDate;
  billingVersion: number;
  status: BillingStatus;
  totalOrders: number;
  totalPax: number;
  notes: string | null;
  checksum: string;
  generatedBy: Uuid;
  generatedAt: IsoDateTime;
  generatedByName?: string;
}

export interface GenerateBillingRequest {
  boardId?: Uuid | null;
  periodFrom: IsoDate;
  periodTo: IsoDate;
  notes?: string | null;
}

/** Immutable payload frozen at generation time. Never recomputed. */
export interface BillingSnapshot {
  generatedAt: IsoDateTime;
  generatedBy: Uuid;
  billingVersion: number;
  periodFrom: IsoDate;
  periodTo: IsoDate;
  boardId: Uuid | null;
  orders: BillingSnapshotOrder[];
}

export interface BillingSnapshotOrder {
  orderId: Uuid;
  orderNumber: string;
  boardName: string;
  activityName: string | null;
  venue: string;
  pax: number;
  requiredDate: IsoDate;
  requiredTime: ClockTime;
  status: OrderStatus;
  completedAt: IsoDateTime | null;
  createdByName: string;
  items: BillingSnapshotItem[];
}

export interface BillingSnapshotItem {
  /** Null for an ad-hoc line; `itemName` then carries the name typed on the order. */
  menuItemId: Uuid | null;
  categoryName: string;
  itemName: string;
  quantity: number;
  unit: string;
  notes: string | null;
}

/* --------------------------------------------------------------- audit */

export interface AuditLogDto {
  id: Uuid;
  actorId: Uuid | null;
  actorRole: UserRole | null;
  action: string;
  entityType: string;
  entityId: string | null;
  boardId: Uuid | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: IsoDateTime;
  actorName?: string;
}

/* ------------------------------------------------------------- settings */

export interface SettingDto {
  key: string;
  value: unknown;
  description: string | null;
  updatedBy: Uuid | null;
  updatedAt: IsoDateTime;
}

/* -------------------------------------------------- YouTube recipe imports */

/**
 * One ingredient as extracted from a YouTube video. `quantity` stays null when the video
 * only says "a little salt" / "as required" — that phrasing is preserved in `quantityText`
 * rather than invented as a number. `ingredientId` is set only when the extraction matched
 * an existing Ingredient Master record with confidence; unmatched rows are resolved by the
 * user during review.
 */
export interface YoutubeExtractedIngredient {
  name: string;
  quantity: number | null;
  quantityText: string | null;
  unit: string | null;
  preparation: string | null;
  notes: string | null;
  ingredientId: Uuid | null;
}

export interface YoutubeExtractedStep {
  stepNo: number;
  instruction: string;
  durationMin: number | null;
  temperature: string | null;
  cookingMethod: string | null;
}

/**
 * The staging payload produced by the analysis step and stored on the import record.
 * Field-for-field it covers everything the existing Recipe module can hold, plus the extra
 * context (equipment, tips, storage…) that is folded into chef notes at review time.
 * Anything the video did not state is null/empty — never invented.
 */
export interface YoutubeExtractedRecipe {
  recipeName: string;
  description: string | null;
  category: string | null;
  cuisine: string | null;
  yieldNote: string | null;
  servings: number | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  totalTimeMin: number | null;
  difficulty: RecipeDifficulty | null;
  ingredients: YoutubeExtractedIngredient[];
  steps: YoutubeExtractedStep[];
  equipment: string[];
  tips: string[];
  notes: string | null;
  variations: string[];
  garnish: string | null;
  storageInstructions: string | null;
  shelfLife: string | null;
  dietaryInfo: string[];
  allergens: string[];
}

/** A YouTube import/staging record. Never the Recipe Master itself. */
export interface YoutubeImportDto {
  id: Uuid;
  youtubeUrl: string;
  youtubeVideoId: string;
  videoTitle: string | null;
  channelName: string | null;
  durationSec: number | null;
  thumbnailUrl: string | null;
  status: YoutubeImportStatus;
  progressPercent: number;
  statusMessage: string | null;
  transcript: string | null;
  ocrText: string | null;
  extractedRecipe: YoutubeExtractedRecipe | null;
  errorMessage: string | null;
  /** Set once the reviewed recipe is saved into Recipe Master. */
  recipeId: Uuid | null;
  createdBy: Uuid | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
}

export interface YoutubeImportCreateRequest {
  url: string;
}
