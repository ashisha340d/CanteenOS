import type {
  AlertSoundSlot,
  AlertType,
  AttachmentKind,
  AttachmentOwnerType,
  AvailabilityStatus,
  BillingStatus,
  BoardRole,
  BoardStatus,
  EntityType,
  GstSyncStatus,
  GstTaxability,
  HsnSacCodeType,
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
  PosOrderItemStatus,
  PosOrderStatus,
  PosOrderType,
  PosPaymentMethod,
  PosPaymentStatus,
  RecipeDifficulty,
  RecipeIngredientScaling,
  RoutableEntityType,
  ScheduleShift,
  ShoppingListStatus,
  SupplyType,
  SystemEvent,
  TaskKind,
  TaskPriority,
  TaskSource,
  TaskStatus,
  UserRole,
  UserStatus,
  YoutubeImportStatus,
} from '../enums';
import type { PosKdsLineStatus } from './kds';
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
  /**
   * The Menu Catalogue (`MenuDto.id`) this category belongs to. A category belongs to exactly
   * one catalogue and is never shared between them. Null means it has not been filed under a
   * catalogue yet, so it appears in the master list but on no menu.
   */
  catalogueId: Uuid | null;
  /** Resolved by the SELECT for display; never written. */
  catalogueName?: string | null;
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
  /** Resolved by the SELECT for display; never written. */
  categoryName?: string | null;
  /** The single Item Group this dish belongs to. Null means ungrouped. */
  groupId: Uuid | null;
  /** Resolved by the SELECT for display; never written. */
  groupName?: string | null;
  name: string;
  /** Devanagari name. Null falls back to `name`. */
  nameHi: string | null;
  unit: string;
  /** Devanagari unit ("प्लेट", "किलो"). Null falls back to `unit`. */
  unitHi: string | null;
  imagePath: string | null;
  /**
   * Primary image from the media library (MediaEntityType.MENU_ITEM), if one is attached. The
   * id is stable and syncs to the device; `primaryMediaUrl` is a signed, expiring link and is
   * only present on responses served to an authenticated caller.
   */
  primaryMediaId: Uuid | null;
  primaryMediaUrl?: string | null;
  /** Used only while this item has zero ACTIVE variants (see MenuItemVariantDto). */
  basePrice: number | null;
  /** The Tax Profile this food item assigns. Variants inherit it unless they override. */
  taxProfileId: Uuid | null;
  /** When true, ignores MenuItemScheduleDto and is always available. */
  alwaysAvailable: boolean;
  /**
   * KDS prep target in seconds — the line's deadline on the kitchen board. Null uses the
   * station's default (KdsConfigDto.defaultPrepSeconds).
   */
  prepSeconds: number | null;
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
  catalogueId?: Uuid | null;
  nameHi?: string | null;
  imagePath?: string | null;
}

export interface MenuItemWriteRequest extends MasterWriteRequest {
  categoryId: Uuid;
  groupId?: Uuid | null;
  nameHi?: string | null;
  unit: string;
  unitHi?: string | null;
  imagePath?: string | null;
  basePrice?: number | null;
  taxProfileId?: Uuid | null;
  alwaysAvailable?: boolean;
  prepSeconds?: number | null;
}

/* ------------------------------------------------------------- menu master */

/**
 * A configurable menu definition — VSK, PUBLIC, SATSANGEE, PUBLIC_MORNING, ... . Ordinary data
 * rows: nothing about a menu's identity is a schema enum, so a new menu never requires a
 * deployment.
 */
export interface MenuDto extends SyncMeta {
  id: Uuid;
  code: string;
  name: string;
  description: string | null;
  status: MasterStatus;
  sortOrder: number;
  priority: number;
  version: number;
  effectiveFrom: IsoDate | null;
  effectiveUntil: IsoDate | null;
  /** Null while unpublished. POS/MenuBoard consumers should treat an unpublished menu as absent. */
  publishedAt: IsoDateTime | null;
  createdBy: Uuid | null;
}

export interface MenuWriteRequest {
  id?: Uuid;
  code: string;
  name: string;
  description?: string | null;
  status?: MasterStatus;
  sortOrder?: number;
  priority?: number;
  effectiveFrom?: IsoDate | null;
  effectiveUntil?: IsoDate | null;
}

/** Reuses the global `menu_categories` master on a given menu, with per-menu overrides. */
export interface MenuCategoryAssignmentDto extends SyncMeta {
  id: Uuid;
  menuId: Uuid;
  categoryId: Uuid;
  displayName: string | null;
  displayNameHi: string | null;
  description: string | null;
  descriptionHi: string | null;
  status: MasterStatus;
  sortOrder: number;
  posVisible: boolean;
  boardVisible: boolean;
  createdBy: Uuid | null;
  /** Denormalised from menu_categories for display. */
  categoryName?: string;
  categoryNameHi?: string | null;
  categoryImagePath?: string | null;
}

export interface MenuCategoryAssignmentWriteRequest {
  id?: Uuid;
  categoryId: Uuid;
  displayName?: string | null;
  displayNameHi?: string | null;
  description?: string | null;
  descriptionHi?: string | null;
  status?: MasterStatus;
  sortOrder?: number;
  posVisible?: boolean;
  boardVisible?: boolean;
}

/**
 * Offers an existing Food Item (a `menu_items` row) on a specific menu. The same food item can
 * have any number of these — one per menu — each carrying its own description, preparation
 * method, visibility and channel availability. The global food item is never modified by this.
 */
export interface MenuItemAssignmentDto extends SyncMeta {
  id: Uuid;
  menuId: Uuid;
  foodItemId: Uuid;
  categoryAssignmentId: Uuid | null;
  displayName: string | null;
  displayNameHi: string | null;
  description: string | null;
  descriptionHi: string | null;
  preparationMethod: string | null;
  preparationMethodHi: string | null;
  preparationTimeMinutes: number | null;
  unit: string | null;
  status: MasterStatus;
  availability: AvailabilityStatus;
  sortOrder: number;
  posVisible: boolean;
  boardVisible: boolean;
  qrVisible: boolean;
  webVisible: boolean;
  appVisible: boolean;
  dineInAvailable: boolean;
  takeawayAvailable: boolean;
  deliveryAvailable: boolean;
  allowDecimalQuantity: boolean;
  createdBy: Uuid | null;
  /** Denormalised from menu_items (the Food Item Master) for display. */
  foodItemName?: string;
  foodItemNameHi?: string | null;
  foodItemUnit?: string;
  foodItemImagePath?: string | null;
  /** The food item's own base price/variants — pricing lives on the Master File, not here. */
  foodItemBasePrice?: number | null;
  variantCount?: number;
}

export interface MenuItemAssignmentWriteRequest {
  id?: Uuid;
  foodItemId: Uuid;
  categoryAssignmentId?: Uuid | null;
  displayName?: string | null;
  displayNameHi?: string | null;
  description?: string | null;
  descriptionHi?: string | null;
  preparationMethod?: string | null;
  preparationMethodHi?: string | null;
  preparationTimeMinutes?: number | null;
  unit?: string | null;
  status?: MasterStatus;
  availability?: AvailabilityStatus;
  sortOrder?: number;
  posVisible?: boolean;
  boardVisible?: boolean;
  qrVisible?: boolean;
  webVisible?: boolean;
  appVisible?: boolean;
  dineInAvailable?: boolean;
  takeawayAvailable?: boolean;
  deliveryAvailable?: boolean;
  allowDecimalQuantity?: boolean;
}

/**
 * The actual sellable configuration and price. A food item (Menu Master File) may have zero,
 * one or many of these — "Tiny / ₹30", "Large / ₹100" are ordinary rows, never schema enum
 * values. Global to the dish: the same variants apply on every menu it is assigned to.
 */
export interface MenuItemVariantDto extends SyncMeta {
  id: Uuid;
  foodItemId: Uuid;
  variantCode: string | null;
  name: string;
  nameHi: string | null;
  description: string | null;
  descriptionHi: string | null;
  portionName: string | null;
  portionNameHi: string | null;
  quantity: number | null;
  unit: string | null;
  price: number;
  /** Null means inherit the food item's Tax Profile — the normal case. */
  taxProfileId: Uuid | null;
  status: MasterStatus;
  availability: AvailabilityStatus;
  sortOrder: number;
  preparationMethod: string | null;
  preparationMethodHi: string | null;
  preparationTimeMinutes: number | null;
  isDefault: boolean;
  allowDecimalQuantity: boolean;
  createdBy: Uuid | null;
}

export interface MenuItemVariantWriteRequest {
  id?: Uuid;
  variantCode?: string | null;
  name: string;
  nameHi?: string | null;
  description?: string | null;
  descriptionHi?: string | null;
  portionName?: string | null;
  portionNameHi?: string | null;
  quantity?: number | null;
  unit?: string | null;
  price: number;
  taxProfileId?: Uuid | null;
  status?: MasterStatus;
  availability?: AvailabilityStatus;
  sortOrder?: number;
  preparationMethod?: string | null;
  preparationMethodHi?: string | null;
  preparationTimeMinutes?: number | null;
  isDefault?: boolean;
  allowDecimalQuantity?: boolean;
}

/** A snapshot of one resolved, orderable line for POS/MenuBoard consumption — see `MenuTreeDto`. */
export interface ResolvedMenuVariantDto {
  id: Uuid;
  variantCode: string | null;
  name: string;
  nameHi: string | null;
  portionName: string | null;
  quantity: number | null;
  unit: string | null;
  price: number;
  availability: AvailabilityStatus;
  sortOrder: number;
  /** Resolved by variant -> menu item -> food item, first non-null wins. Never duplicated. */
  primaryMediaUrl: string | null;
  /** What the kitchen needs for this portion. Drives the kiosk's "ready by" estimate. */
  preparationTimeMinutes: number | null;
  allowDecimalQuantity: boolean;
  counters: string[];
  printingGroups: string[];
  modifierGroupIds: Uuid[];
}

export interface ResolvedMenuItemDto {
  id: Uuid;
  foodItemId: Uuid;
  name: string;
  nameHi: string | null;
  description: string | null;
  unit: string;
  availability: AvailabilityStatus;
  sortOrder: number;
  primaryMediaUrl: string | null;
  /** Per-menu preparation time; a variant may state its own. */
  preparationTimeMinutes: number | null;
  allowDecimalQuantity: boolean;
  basePrice: number | null;
  variants: ResolvedMenuVariantDto[];
  posVisible: boolean;
  boardVisible: boolean;
  qrVisible: boolean;
  webVisible: boolean;
  appVisible: boolean;
}

export interface ResolvedMenuCategoryDto {
  id: Uuid;
  categoryId: Uuid;
  name: string;
  nameHi: string | null;
  sortOrder: number;
  primaryMediaUrl: string | null;
  items: ResolvedMenuItemDto[];
}

/** The full tree a POS or MenuBoard client requests for one published menu. */
export interface MenuTreeDto {
  id: Uuid;
  code: string;
  name: string;
  description: string | null;
  primaryMediaUrl: string | null;
  categories: ResolvedMenuCategoryDto[];
}

/* --------------------------------------------------------------- media library */

/**
 * A reusable media asset. One row per physical file; any number of `MediaAssignmentDto` rows
 * may point at it from different Menu Master entities without duplicating the file.
 */
export interface MediaAssetDto extends SyncMeta {
  id: Uuid;
  fileName: string;
  mimeType: string;
  fileExtension: string | null;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  mediaType: MediaType;
  title: string | null;
  altText: string | null;
  status: MasterStatus;
  createdBy: Uuid | null;
  /** Signed, time-limited download URL — same convention as `AttachmentDto`. */
  url: string;
}

export interface MediaAssetUpdateRequest {
  title?: string | null;
  altText?: string | null;
  status?: MasterStatus;
}

/** Links a media asset to a Menu, Menu Category Assignment, Menu Item Assignment or Variant. */
export interface MediaAssignmentDto extends SyncMeta {
  id: Uuid;
  mediaId: Uuid;
  entityType: MediaEntityType;
  entityId: Uuid;
  role: MediaRole;
  isPrimary: boolean;
  sortOrder: number;
  status: MasterStatus;
  createdBy: Uuid | null;
  media?: MediaAssetDto;
}

export interface MediaAssignmentWriteRequest {
  mediaId: Uuid;
  entityType: MediaEntityType;
  entityId: Uuid;
  role?: MediaRole;
  isPrimary?: boolean;
  sortOrder?: number;
}

/* ------------------------------------------------------------------- counters */

/** Operational service counters (VSK Counter, Main Counter, ...) — never attached to a food item
 * directly, only to a menu item assignment or variant via `CounterRouteDto`. */
export interface CounterDto extends SyncMeta {
  id: Uuid;
  name: string;
  code: string | null;
  description: string | null;
  status: MasterStatus;
  sortOrder: number;
  createdBy: Uuid | null;
}

export interface CounterWriteRequest {
  id?: Uuid;
  name: string;
  code?: string | null;
  description?: string | null;
  status?: MasterStatus;
  sortOrder?: number;
}

export interface CounterRouteDto extends SyncMeta {
  id: Uuid;
  entityType: RoutableEntityType;
  entityId: Uuid;
  counterId: Uuid;
  status: MasterStatus;
  createdBy: Uuid | null;
  counterName?: string;
}

export interface CounterRouteWriteRequest {
  entityType: RoutableEntityType;
  entityId: Uuid;
  counterId: Uuid;
  status?: MasterStatus;
}

/* ---------------------------------------------------------------- item groups */

/** Reusable tag master for the Food Item Master (À La Carte, Combo Eligible, Set Menu, ...). */
export interface ItemGroupDto extends SyncMeta {
  id: Uuid;
  /** The Menu Catalogue this group belongs to, on the same terms as `MenuCategoryDto`. */
  catalogueId: Uuid | null;
  /** Resolved by the SELECT for display; never written. */
  catalogueName?: string | null;
  name: string;
  code: string | null;
  description: string | null;
  status: MasterStatus;
  sortOrder: number;
  createdBy: Uuid | null;
}

export interface ItemGroupWriteRequest {
  id?: Uuid;
  catalogueId?: Uuid | null;
  name: string;
  code?: string | null;
  description?: string | null;
  status?: MasterStatus;
  sortOrder?: number;
}

/* -------------------------------------------------------------- printing groups */

/** Kitchen / Bakery / Coffee / Pizza / Packing / Bar — independent of physical printer hardware. */
export interface PrintingGroupDto extends SyncMeta {
  id: Uuid;
  name: string;
  code: string | null;
  description: string | null;
  status: MasterStatus;
  sortOrder: number;
  createdBy: Uuid | null;
}

export interface PrintingGroupWriteRequest {
  id?: Uuid;
  name: string;
  code?: string | null;
  description?: string | null;
  status?: MasterStatus;
  sortOrder?: number;
}

export interface PrintingRouteDto extends SyncMeta {
  id: Uuid;
  entityType: RoutableEntityType;
  entityId: Uuid;
  printingGroupId: Uuid;
  sortOrder: number;
  status: MasterStatus;
  createdBy: Uuid | null;
  printingGroupName?: string;
}

export interface PrintingRouteWriteRequest {
  entityType: RoutableEntityType;
  entityId: Uuid;
  printingGroupId: Uuid;
  sortOrder?: number;
  status?: MasterStatus;
}

/* ------------------------------------------------------------------- modifiers */

export interface ModifierGroupDto extends SyncMeta {
  id: Uuid;
  name: string;
  description: string | null;
  selectionType: ModifierSelectionType;
  minSelect: number;
  maxSelect: number | null;
  status: MasterStatus;
  sortOrder: number;
  createdBy: Uuid | null;
  modifiers?: ModifierDto[];
}

export interface ModifierGroupWriteRequest {
  id?: Uuid;
  name: string;
  description?: string | null;
  selectionType?: ModifierSelectionType;
  minSelect?: number;
  maxSelect?: number | null;
  status?: MasterStatus;
  sortOrder?: number;
}

export interface ModifierDto extends SyncMeta {
  id: Uuid;
  modifierGroupId: Uuid;
  name: string;
  nameHi: string | null;
  priceDelta: number;
  status: MasterStatus;
  sortOrder: number;
  createdBy: Uuid | null;
}

export interface ModifierWriteRequest {
  id?: Uuid;
  name: string;
  nameHi?: string | null;
  priceDelta?: number;
  status?: MasterStatus;
  sortOrder?: number;
}

export interface ModifierAssignmentDto extends SyncMeta {
  id: Uuid;
  entityType: RoutableEntityType;
  entityId: Uuid;
  modifierGroupId: Uuid;
  isRequired: boolean;
  sortOrder: number;
  status: MasterStatus;
  createdBy: Uuid | null;
  modifierGroupName?: string;
}

export interface ModifierAssignmentWriteRequest {
  entityType: RoutableEntityType;
  entityId: Uuid;
  modifierGroupId: Uuid;
  isRequired?: boolean;
  sortOrder?: number;
  status?: MasterStatus;
}

/* --------------------------------------------------------------- menu schedules */

/** Configurable time-based availability. `dayOfWeek` null means "every day". Nothing named
 * Morning/Evening exists in this schema — PUBLIC_MORNING/PUBLIC_EVENING are just two `menus`
 * rows, each optionally carrying its own schedule. */
export interface MenuScheduleDto extends SyncMeta {
  id: Uuid;
  menuId: Uuid;
  /** 0 = Sunday .. 6 = Saturday; null = every day. */
  dayOfWeek: number | null;
  startTime: ClockTime;
  endTime: ClockTime;
  status: MasterStatus;
  createdBy: Uuid | null;
}

export interface MenuScheduleWriteRequest {
  id?: Uuid;
  dayOfWeek?: number | null;
  startTime: ClockTime;
  endTime: ClockTime;
  status?: MasterStatus;
}

/* ---------------------------------------------------------- food item schedules */

/** Per food item, per weekday, per shift availability. Ignored entirely while the food
 * item's `alwaysAvailable` flag is true. */
export interface MenuItemScheduleDto extends SyncMeta {
  id: Uuid;
  foodItemId: Uuid;
  /** 0 = Sunday .. 6 = Saturday. */
  dayOfWeek: number;
  shift: ScheduleShift;
  isAvailable: boolean;
  createdBy: Uuid | null;
}

export interface MenuItemScheduleWriteRequest {
  dayOfWeek: number;
  shift: ScheduleShift;
  isAvailable: boolean;
}

export interface MenuItemScheduleBulkWriteRequest {
  alwaysAvailable: boolean;
  slots: MenuItemScheduleWriteRequest[];
}

export interface MenuItemScheduleBulkResponse {
  alwaysAvailable: boolean;
  slots: MenuItemScheduleDto[];
}

/* ------------------------------------------------------- variant catalogue pricing */

/** Lets a specific catalogue (a `menus` row) override a variant's price without touching the
 * variant's own base price. */
export interface MenuItemVariantCatalogPriceDto extends SyncMeta {
  id: Uuid;
  variantId: Uuid;
  menuId: Uuid;
  price: number;
  status: MasterStatus;
  createdBy: Uuid | null;
  /** Denormalised from menus for display. */
  menuName?: string;
  menuCode?: string;
}

/** `price: null` removes the override, reverting the variant to its base price. */
export interface MenuItemVariantCatalogPriceWriteRequest {
  menuId: Uuid;
  price: number | null;
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
  /**
   * Menu Master sellable-configuration snapshot, frozen at the moment the line was created.
   * Null on lines created before Menu Master existed, or on an ad-hoc line. None of these are
   * ever recomputed from the current Menu Master — a later price or name change on `menuId` /
   * `variantId` must never alter an existing order line.
   */
  menuId: Uuid | null;
  variantId: Uuid | null;
  /** The variant's name at sale time — survives the variant being renamed or deleted later. */
  variantName: string | null;
  /** Price of one unit at sale time. */
  unitPrice: number | null;
  taxAmount: number;
  discountAmount: number;
  /** (unitPrice * quantity) + taxAmount - discountAmount, frozen at sale time. */
  lineTotal: number | null;
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
  /**
   * Which menu/variant this line was ordered from. Optional: an order raised outside Menu
   * Master context (or for a food item with no menu assignment) simply omits these, and the
   * line carries no price snapshot. When `variantId` is supplied the server resolves and
   * freezes its current name/price into the line at creation time.
   */
  menuId?: Uuid | null;
  variantId?: Uuid | null;
  discountAmount?: number;
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

/* --------------------------------------------------------- GST / HSN / SAC */

/**
 * One classification row from the official GST/GSTN dataset. Reference data: never authored
 * in the Admin Portal, never carrying a tax rate (the official workbook has none), and never
 * deleted — a code that leaves the authoritative dataset is deactivated so that food items
 * referencing it keep resolving.
 */
export interface HsnSacCodeDto {
  id: Uuid;
  code: string;
  codeType: HsnSacCodeType;
  description: string;
  /** Derived from `code` on import; HSN only, null for SAC. */
  chapter: string | null;
  heading: string | null;
  subHeading: string | null;
  isActive: boolean;
  source: string;
  /** The source workbook's own modified date — the official file carries no version field. */
  sourceVersion: string | null;
  lastSyncedAt: IsoDateTime;
  deactivatedAt: IsoDateTime | null;
}

export interface HsnSacSearchQuery {
  q?: string;
  codeType?: HsnSacCodeType;
  /** Defaults to true; only an override flow has any reason to see deactivated codes. */
  activeOnly?: boolean;
  page?: number;
  pageSize?: number;
}

/** Headline state for the HSN/SAC Master admin screen. Counts always come from the data. */
export interface HsnSacMasterSummaryDto {
  totalCodes: number;
  activeCodes: number;
  hsnCodes: number;
  sacCodes: number;
  inactiveCodes: number;
  lastSyncedAt: IsoDateTime | null;
  source: string;
  sourceVersion: string | null;
  lastSyncStatus: GstSyncStatus | null;
}

/** The result of one "Sync GST Master" run, and the row persisted for the audit log. */
export interface GstSyncRunDto {
  id: Uuid;
  startedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  startedBy: Uuid | null;
  startedByName?: string | null;
  source: string;
  sourceUrl: string | null;
  sourceVersion: string | null;
  sourceChecksum: string | null;
  recordsDownloaded: number;
  recordsAdded: number;
  recordsUpdated: number;
  recordsDeactivated: number;
  recordsUnchanged: number;
  recordsFailed: number;
  status: GstSyncStatus;
  errorDetails: string | null;
  /** Wall-clock duration of the run; null while still RUNNING. */
  durationMs: number | null;
}

/**
 * A reusable tax treatment. This — not the HSN/SAC master — is where rates live, because the
 * official dataset supplies classification only. Syncing the master never alters a profile.
 */
export interface TaxProfileDto {
  id: Uuid;
  code: string;
  name: string;
  description: string | null;
  hsnSacId: Uuid | null;
  supplyType: SupplyType;
  gstTaxability: GstTaxability;
  gstRate: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cessRate: number;
  priceIsInclusive: boolean;
  itcEligibility: ItcEligibility;
  effectiveFrom: IsoDate | null;
  effectiveTo: IsoDate | null;
  exemptionReason: string | null;
  regulatoryNotes: string | null;
  status: MasterStatus;
  sortOrder: number;
  createdBy: Uuid | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** Denormalised from hsn_sac_master for display. */
  hsnSacCode?: string | null;
  hsnSacCodeType?: HsnSacCodeType | null;
  hsnSacDescription?: string | null;
  /** How many food items currently assign this profile — drives delete/deactivate guards. */
  foodItemCount?: number;
}

export interface TaxProfileWriteRequest {
  id?: Uuid;
  code: string;
  name: string;
  description?: string | null;
  hsnSacId?: Uuid | null;
  supplyType: SupplyType;
  gstTaxability?: GstTaxability;
  gstRate?: number;
  cgstRate?: number;
  sgstRate?: number;
  igstRate?: number;
  cessRate?: number;
  priceIsInclusive?: boolean;
  itcEligibility?: ItcEligibility;
  effectiveFrom?: IsoDate | null;
  effectiveTo?: IsoDate | null;
  exemptionReason?: string | null;
  regulatoryNotes?: string | null;
  status?: MasterStatus;
  sortOrder?: number;
}

/* ------------------------------------------------------------------ tasks */

/**
 * A unit of work a volunteer owns. Order-derived tasks carry `orderId` and a real
 * `dueAt` taken from the order; an ordinary task has neither, by design.
 */
export interface TaskDto {
  id: Uuid;
  title: string;
  description: string | null;
  kind: TaskKind;
  source: TaskSource;
  status: TaskStatus;
  priority: TaskPriority;
  assignedTo: Uuid;
  assignedBy: Uuid | null;
  orderId: Uuid | null;
  boardId: Uuid | null;
  /** Operational deadline. Only ever set from a linked order — never invented. */
  dueAt: IsoDateTime | null;
  estimatedMinutes: number | null;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** Denormalised for display. */
  assignedToName?: string;
  assignedByName?: string | null;
  orderNumber?: string | null;
  boardName?: string | null;
}

/** The one question the Tasks screen exists to answer, in one response. */
export interface MyTasksDto {
  /** The single task currently being worked on, or null for "Nothing in Progress". */
  active: TaskDto | null;
  /** Everything assigned and not yet started, deadline-bearing work first. */
  available: TaskDto[];
  completedToday: TaskDto[];
}

export interface TaskCreateRequest {
  title: string;
  description?: string | null;
  kind?: TaskKind;
  priority?: TaskPriority;
  /** Omitted or equal to the caller means a self-assigned task. Otherwise needs TASK_ASSIGN. */
  assignedTo?: Uuid;
  boardId?: Uuid | null;
  estimatedMinutes?: number | null;
}

export interface TaskUpdateRequest {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  assignedTo?: Uuid;
  estimatedMinutes?: number | null;
  status?: TaskStatus;
}

export interface TaskListQuery {
  assignedTo?: Uuid;
  status?: TaskStatus;
  source?: TaskSource;
  kind?: TaskKind;
  search?: string;
  page?: number;
  pageSize?: number;
}

/** One row of the team activity view: who is working, and when they come free. */
export interface TeamMemberActivityDto {
  userId: Uuid;
  name: string;
  /** Two-letter monogram for the avatar, derived server-side so both clients agree. */
  initials: string;
  status: 'WORKING' | 'FREE' | 'OFF';
  currentTaskId: Uuid | null;
  currentTaskTitle: string | null;
  currentTaskPriority: TaskPriority | null;
  startedAt: IsoDateTime | null;
  /** Minutes until the current task's estimate runs out. Null when there is no estimate. */
  freeInMinutes: number | null;
  /** Deadline of the active task, when it came from an order. */
  dueAt: IsoDateTime | null;
  lastTaskTitle: string | null;
  lastActiveAt: IsoDateTime | null;
}

/** The tax treatment in force for a variant, after inheritance is resolved. */
export interface ResolvedTaxDto {
  taxProfileId: Uuid | null;
  /** True when the variant carries its own profile rather than the food item's. */
  isOverride: boolean;
  profile: TaxProfileDto | null;
}

/* --------------------------------------------------------------- entities */

/**
 * A party the operation deals with: a customer at the counter, an employee taking a subsidised
 * meal, a vendor being paid out. One row per person or organisation, `type` saying which role
 * they play — see the `EntityType` note on why these are not three separate tables.
 *
 * `linkedUserId` connects an EMPLOYEE entity to the login account of the same person, so a
 * staff meal charged at the counter and the account that raised it resolve to one human.
 */
export interface EntityDto {
  id: Uuid;
  code: string;
  type: EntityType;
  name: string;
  nameHi: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  /** Two-digit GST state code; drives CGST+SGST versus IGST at checkout. */
  stateCode: string | null;
  gstin: string | null;
  pan: string | null;
  /** EMPLOYEE only — which department the meal is charged against. */
  department: string | null;
  designation: string | null;
  linkedUserId: Uuid | null;
  /** Standing discount applied to every line of this entity's POS orders. */
  discountPercent: number;
  /** Ceiling on the unsettled ACCOUNT balance. Zero means no credit is extended. */
  creditLimit: number;
  /** Positive = the entity owes the operation. Maintained by ACCOUNT settlements. */
  accountBalance: number;
  notes: string | null;
  status: MasterStatus;
  sortOrder: number;
  createdBy: Uuid | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** Denormalised for display. */
  linkedUserName?: string | null;
  /** Completed POS orders raised in this entity's name — drives the delete guard. */
  posOrderCount?: number;
}

export interface EntityWriteRequest {
  id?: Uuid;
  /** Omitted on create: the server allocates `CUS-0001` / `EMP-0001` / `VEN-0001`. */
  code?: string;
  type: EntityType;
  name: string;
  nameHi?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  stateCode?: string | null;
  gstin?: string | null;
  pan?: string | null;
  department?: string | null;
  designation?: string | null;
  linkedUserId?: Uuid | null;
  discountPercent?: number;
  creditLimit?: number;
  notes?: string | null;
  status?: MasterStatus;
  sortOrder?: number;
}

export interface EntityListQuery {
  search?: string;
  type?: EntityType;
  status?: MasterStatus;
  /** Exact-match phone lookup, for the counter's "who is this?" search. */
  phone?: string;
  page?: number;
  pageSize?: number;
}

/* -------------------------------------------------------------------- POS */

/**
 * One sale line, frozen at the moment it was rung up.
 *
 * `itemName`, `variantName`, `unitPrice` and every tax field are snapshots, not lookups: the
 * menu may be re-priced or the variant retired tomorrow, and the bill that was handed to the
 * customer must still add up. Same reasoning as `order_items` in the Menu Master extension.
 */
export interface PosOrderItemDto {
  id: Uuid;
  posOrderId: Uuid;
  menuItemId: Uuid | null;
  variantId: Uuid | null;
  /** Set instead of `menuItemId` for a line typed on the spot. */
  customItemName: string | null;
  itemName: string;
  variantName: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  /** quantity × unitPrice, before any discount. */
  grossAmount: number;
  discountType: PosDiscountType;
  discountValue: number;
  discountAmount: number;
  taxableAmount: number;
  taxProfileId: Uuid | null;
  taxRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  taxAmount: number;
  /** taxableAmount + taxAmount — what this line contributes to the bill. */
  lineTotal: number;
  allowDecimalQuantity: boolean;
  notes: string | null;
  sortOrder: number;
  status: PosOrderItemStatus;
  cancelledAt: IsoDateTime | null;
  cancelledBy: Uuid | null;
  /** Kitchen/counter flow, independent of billing status. See dto/kds.ts. */
  kdsStatus?: PosKdsLineStatus;
  acknowledgedAt?: IsoDateTime | null;
  acknowledgedBy?: Uuid | null;
  servedAt?: IsoDateTime | null;
  servedBy?: Uuid | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface PosPaymentDto {
  id: Uuid;
  posOrderId: Uuid;
  method: PosPaymentMethod;
  /** Negative on a reversal row, so the payment ledger never rewrites history. */
  amount: number;
  tenderedAmount: number | null;
  changeAmount: number;
  reference: string | null;
  notes: string | null;
  /** Set for ACCOUNT settlement — whose account was charged. */
  entityId: Uuid | null;
  isReversal: boolean;
  receivedBy: Uuid | null;
  receivedAt: IsoDateTime;
}

/** The POS ticket header. Items and payments come with `PosOrderDetailDto`. */
export interface PosOrderDto {
  id: Uuid;
  orderNumber: string;
  /** Resets each business date; the human-facing token number at the counter. */
  dailySequence: number;
  businessDate: IsoDate;
  orderType: PosOrderType;
  status: PosOrderStatus;
  paymentStatus: PosPaymentStatus;
  stationId: Uuid | null;
  counterId: Uuid | null;
  menuId: Uuid | null;
  entityId: Uuid | null;
  /** Snapshot of who the order was raised for, kept even if the entity is later renamed. */
  entityType: EntityType | null;
  entityName: string | null;
  entityPhone: string | null;
  entityAddress: string | null;
  /** Free text — "T4", "Hall 2". A named table master is deliberately not modelled. */
  tableLabel: string | null;
  pax: number;
  /** Set on a SCHEDULED order: when the food is wanted. */
  scheduledFor: IsoDateTime | null;
  notes: string | null;
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  roundOffAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  placedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  cancelledAt: IsoDateTime | null;
  cancelReason: string | null;
  createdBy: Uuid;
  updatedBy: Uuid | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  revision: number;
  /** Denormalised for the dashboard card. */
  stationName?: string | null;
  counterName?: string | null;
  createdByName?: string | null;
  itemCount?: number;
}

export interface PosOrderDetailDto extends PosOrderDto {
  items: PosOrderItemDto[];
  payments: PosPaymentDto[];
}

export interface PosOrderItemInput {
  id?: Uuid;
  menuItemId?: Uuid | null;
  variantId?: Uuid | null;
  customItemName?: string | null;
  unitPrice?: number;
  quantity: number;
  unit?: string;
  discountType?: PosDiscountType;
  discountValue?: number;
  notes?: string | null;
  sortOrder?: number;
  allowDecimalQuantity?: boolean;
}

export interface CreatePosOrderRequest {
  id?: Uuid;
  orderType: PosOrderType;
  /** DRAFT, SCHEDULED or OPEN. Defaults to OPEN — the counter's normal case. */
  status?: PosOrderStatus;
  stationId?: Uuid | null;
  counterId?: Uuid | null;
  menuId?: Uuid | null;
  entityId?: Uuid | null;
  /** Names the order without registering an entity, for a one-off walk-in. */
  entityName?: string | null;
  entityPhone?: string | null;
  entityAddress?: string | null;
  tableLabel?: string | null;
  pax?: number;
  scheduledFor?: IsoDateTime | null;
  notes?: string | null;
  /** Whole-bill discount, applied after line discounts. */
  discountType?: PosDiscountType;
  discountValue?: number;
  items: PosOrderItemInput[];
}

export interface UpdatePosOrderRequest {
  orderType?: PosOrderType;
  stationId?: Uuid | null;
  counterId?: Uuid | null;
  menuId?: Uuid | null;
  entityId?: Uuid | null;
  entityName?: string | null;
  entityPhone?: string | null;
  entityAddress?: string | null;
  tableLabel?: string | null;
  pax?: number;
  scheduledFor?: IsoDateTime | null;
  notes?: string | null;
  discountType?: PosDiscountType;
  discountValue?: number;
  items?: PosOrderItemInput[];
  /** Optimistic concurrency: rejected with STALE_WRITE when the ticket moved underneath. */
  expectedRevision?: number;
}

export interface UpdatePosOrderStatusRequest {
  status: PosOrderStatus;
  /** Required when moving to SCHEDULED. */
  scheduledFor?: IsoDateTime | null;
  reason?: string | null;
}

export interface PosPaymentInput {
  method: PosPaymentMethod;
  amount: number;
  tenderedAmount?: number | null;
  reference?: string | null;
  notes?: string | null;
  entityId?: Uuid | null;
}

/** Settles the ticket. Split tender is the general case; one payment is the common one. */
export interface PosCheckoutRequest {
  payments: PosPaymentInput[];
  /** Whole-bill discount applied at the till, overriding whatever was on the ticket. */
  discountType?: PosDiscountType;
  discountValue?: number;
  expectedRevision?: number;
}

export interface PosVoidRequest {
  reason: string;
}

export interface PosOrderListQuery {
  status?: PosOrderStatus[];
  orderType?: PosOrderType[];
  paymentStatus?: PosPaymentStatus[];
  entityId?: Uuid;
  stationId?: Uuid;
  counterId?: Uuid;
  /** True: only orders raised in the name of an entity. False: only anonymous ones. */
  named?: boolean;
  dateFrom?: IsoDate;
  dateTo?: IsoDate;
  search?: string;
  page?: number;
  pageSize?: number;
}

/** The counts behind the POS dashboard tiles, computed server-side in one pass. */
export interface PosDashboardSummaryDto {
  businessDate: IsoDate;
  draftCount: number;
  scheduledCount: number;
  openCount: number;
  takeawayCount: number;
  dineInCount: number;
  deliveryCount: number;
  quickSaleCount: number;
  namedCount: number;
  completedToday: number;
  cancelledToday: number;
  /** Money taken today across completed sales, net of reversals. */
  salesToday: number;
  /** Money taken today grouped by payment method. */
  salesTodayByMethod: Record<PosPaymentMethod, number>;
  /** Money still owed on active tickets. */
  outstandingAmount: number;
}

/** Live work sitting on one service counter. Idle counters are reported with a zero count. */
export interface PosCounterLoadDto {
  counterId: Uuid;
  code: string | null;
  name: string;
  /** Drafts, scheduled and open tickets currently routed to this counter. */
  activeCount: number;
  /** Money still owed across those tickets. */
  openAmount: number;
}

/** Everything the POS dashboard renders in one round trip. */
export interface PosDashboardDto {
  summary: PosDashboardSummaryDto;
  counterLoad: PosCounterLoadDto[];
  drafts: PosOrderDto[];
  scheduled: PosOrderDto[];
  takeaway: PosOrderDto[];
  named: PosOrderDto[];
  open: PosOrderDto[];
}
