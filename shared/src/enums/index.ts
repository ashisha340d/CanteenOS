/**
 * Canonical enumerations. These string values are persisted in MariaDB and SQLite and
 * travel over the wire unchanged — never renumber or rename an existing member.
 */

export * from './equipment';
export * from './cleaning';

export const UserRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  USER: 'USER',
  /** View-only. Sees the Hindi board and nothing else; edits nothing anywhere. */
  EMPLOYEE: 'EMPLOYEE',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/** Ordered most-privileged first; index doubles as a precedence rank. */
export const USER_ROLE_ORDER: readonly UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.USER,
  UserRole.EMPLOYEE,
];

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const BoardStatus = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
  ON_HOLD: 'ON_HOLD',
} as const;
export type BoardStatus = (typeof BoardStatus)[keyof typeof BoardStatus];

export const BoardRole = {
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  MEMBER: 'MEMBER',
  VIEWER: 'VIEWER',
} as const;
export type BoardRole = (typeof BoardRole)[keyof typeof BoardRole];

export const BOARD_ROLE_ORDER: readonly BoardRole[] = [
  BoardRole.OWNER,
  BoardRole.MANAGER,
  BoardRole.MEMBER,
  BoardRole.VIEWER,
];

export const MemberStatus = {
  ACTIVE: 'ACTIVE',
  INVITED: 'INVITED',
  REMOVED: 'REMOVED',
} as const;
export type MemberStatus = (typeof MemberStatus)[keyof typeof MemberStatus];

/** Shared lifecycle flag for master data (stations, activities, categories, items). */
export const MasterStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type MasterStatus = (typeof MasterStatus)[keyof typeof MasterStatus];

/* --------------------------------------------------------------- menu master */

/** Sellable/orderable state for a menu item assignment or a variant. */
export const AvailabilityStatus = {
  AVAILABLE: 'AVAILABLE',
  UNAVAILABLE: 'UNAVAILABLE',
  SOLD_OUT: 'SOLD_OUT',
} as const;
export type AvailabilityStatus = (typeof AvailabilityStatus)[keyof typeof AvailabilityStatus];

/** What a media asset physically is. */
export const MediaType = {
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
  /** Voice notes, which the Equipment module stores in the shared library (029). */
  AUDIO: 'AUDIO',
  DOCUMENT: 'DOCUMENT',
} as const;
export type MediaType = (typeof MediaType)[keyof typeof MediaType];

/** The purpose a media assignment plays for its entity — drives which slot it fills in the UI. */
export const MediaRole = {
  PRIMARY: 'PRIMARY',
  GALLERY: 'GALLERY',
  BANNER: 'BANNER',
  THUMBNAIL: 'THUMBNAIL',
  COVER: 'COVER',
} as const;
export type MediaRole = (typeof MediaRole)[keyof typeof MediaRole];

/** Every kind of Menu Master row a media asset, counter, printing group or modifier group can be
 * attached to. Mirrors the polymorphic owner_type/owner_id pattern already used by attachments. */
export const MediaEntityType = {
  MENU: 'MENU',
  MENU_CATEGORY_ASSIGNMENT: 'MENU_CATEGORY_ASSIGNMENT',
  MENU_ITEM_ASSIGNMENT: 'MENU_ITEM_ASSIGNMENT',
  MENU_ITEM_VARIANT: 'MENU_ITEM_VARIANT',
  /** The food item itself — photography that follows the dish onto every menu it appears on. */
  MENU_ITEM: 'MENU_ITEM',
  COUNTER: 'COUNTER',
  PRINTING_GROUP: 'PRINTING_GROUP',
  RECIPE: 'RECIPE',
} as const;
export type MediaEntityType = (typeof MediaEntityType)[keyof typeof MediaEntityType];

/** Routing tables (counters, printing groups, modifiers) target these levels — MENU_ITEM
 * being the food item itself, global across every menu it is offered on. */
export const RoutableEntityType = {
  MENU_ITEM_ASSIGNMENT: 'MENU_ITEM_ASSIGNMENT',
  MENU_ITEM_VARIANT: 'MENU_ITEM_VARIANT',
  MENU_ITEM: 'MENU_ITEM',
} as const;
export type RoutableEntityType = (typeof RoutableEntityType)[keyof typeof RoutableEntityType];

export const ModifierSelectionType = {
  SINGLE: 'SINGLE',
  MULTIPLE: 'MULTIPLE',
} as const;
export type ModifierSelectionType =
  (typeof ModifierSelectionType)[keyof typeof ModifierSelectionType];

/** The two shifts a food item's per-weekday availability is configured for. */
export const ScheduleShift = {
  MORNING: 'MORNING',
  EVENING: 'EVENING',
} as const;
export type ScheduleShift = (typeof ScheduleShift)[keyof typeof ScheduleShift];

/* ------------------------------------------------------------- order status */

/**
 * The operational lifecycle of an order, stored on `orders.status`.
 *
 * `ON_SHOPPING` and `BILLED` are deliberately *not* members: a shopping list can be raised
 * and a bill can be processed at any point without disturbing where the kitchen actually is.
 * Both are timestamps on the order, folded into what the user sees by
 * {@link deriveOrderDisplayStatus}.
 */
export const OrderStatus = {
  PENDING: 'PENDING',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  PREPARATION: 'PREPARATION',
  WORK_IN_PROGRESS: 'WORK_IN_PROGRESS',
  DELIVERED: 'DELIVERED',
  /** No longer active; no further operational processing is possible. */
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/**
 * The linear progression, in order. Forward moves advance exactly one step; an undo may
 * rewind to any earlier step. Anything outside this array (DONE, CANCELLED) is a jump-out.
 */
export const ORDER_STATUS_FLOW: readonly OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.ACKNOWLEDGED,
  OrderStatus.PREPARATION,
  OrderStatus.WORK_IN_PROGRESS,
  OrderStatus.DELIVERED,
];

export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.ACKNOWLEDGED,
  OrderStatus.PREPARATION,
  OrderStatus.WORK_IN_PROGRESS,
];

/** DONE and CANCELLED end operational processing; only an explicit undo leaves them. */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.DONE,
  OrderStatus.CANCELLED,
];

export function orderStatusRank(status: OrderStatus): number {
  return ORDER_STATUS_FLOW.indexOf(status);
}

/**
 * Whether `to` may follow `from`.
 *
 * - one step forward along the flow;
 * - any number of steps backward along the flow (the undo the spec requires);
 * - DONE from any flow status;
 * - CANCELLED from any non-terminal status;
 * - DELIVERED back out of DONE, so "mark done" is itself undoable.
 */
export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true;
  if (to === OrderStatus.CANCELLED) return from !== OrderStatus.CANCELLED;
  if (from === OrderStatus.CANCELLED) return false;

  if (from === OrderStatus.DONE) return to === OrderStatus.DELIVERED;
  if (to === OrderStatus.DONE) return orderStatusRank(from) >= 0;

  const fromRank = orderStatusRank(from);
  const toRank = orderStatusRank(to);
  if (fromRank < 0 || toRank < 0) return false;
  return toRank < fromRank || toRank === fromRank + 1;
}

/** The next step forward, or null when the order is at the end of the flow. */
export function nextOrderStatus(from: OrderStatus): OrderStatus | null {
  const rank = orderStatusRank(from);
  if (rank < 0 || rank >= ORDER_STATUS_FLOW.length - 1) return null;
  return ORDER_STATUS_FLOW[rank + 1] as OrderStatus;
}

/** The step immediately behind, or null when the order is at the start of the flow. */
export function previousOrderStatus(from: OrderStatus): OrderStatus | null {
  const rank = orderStatusRank(from);
  if (rank <= 0) return null;
  return ORDER_STATUS_FLOW[rank - 1] as OrderStatus;
}

/**
 * What the status pill reads. Superset of {@link OrderStatus} with the two cross-cutting
 * states the specification asks to surface.
 */
export const OrderDisplayStatus = {
  ...OrderStatus,
  ON_SHOPPING: 'ON_SHOPPING',
  BILLED: 'BILLED',
} as const;
export type OrderDisplayStatus =
  (typeof OrderDisplayStatus)[keyof typeof OrderDisplayStatus];

/** Just enough of an order to decide what its pill says. */
export interface OrderStatusFacts {
  status: OrderStatus;
  shoppingGeneratedAt?: string | null;
  billedAt?: string | null;
}

/**
 * The one place any client turns an order into a pill. Cancellation outranks everything
 * (nothing is owed on a cancelled order), then billing, then the lifecycle itself; a raised
 * shopping list only shows while the kitchen has not yet started the work it was raised for.
 */
export function deriveOrderDisplayStatus(order: OrderStatusFacts): OrderDisplayStatus {
  if (order.status === OrderStatus.CANCELLED) return OrderDisplayStatus.CANCELLED;
  if (order.billedAt) return OrderDisplayStatus.BILLED;
  if (order.status === OrderStatus.DONE) return OrderDisplayStatus.DONE;
  if (
    order.shoppingGeneratedAt &&
    orderStatusRank(order.status) < orderStatusRank(OrderStatus.WORK_IN_PROGRESS)
  ) {
    return OrderDisplayStatus.ON_SHOPPING;
  }
  return order.status;
}

/**
 * A billed order is frozen for everyone, including Super Admin — the export downstream
 * systems consumed must keep matching the order it was taken from.
 */
export function isOrderLocked(order: OrderStatusFacts): boolean {
  return Boolean(order.billedAt);
}

/**
 * The only statuses from which the person who raised an order may still withdraw it.
 *
 * The line is drawn at "Got it": up to and including acknowledgement nobody has acted on the
 * order yet, so retracting it costs nothing. The moment it reaches PREPARATION someone has
 * started buying or cooking against it, and deleting it would erase the reason work is
 * happening. From there it is a manager's call (`ORDER_CANCEL`), not the author's.
 */
export const OWN_ORDER_DELETABLE_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.ACKNOWLEDGED,
];

/**
 * Whether `userId` may delete this order themselves. Shared so the app's menu and the
 * server's push handler cannot drift on what "too late to delete" means.
 */
export function canDeleteOwnOrder(
  order: OrderStatusFacts & { createdBy: string },
  userId: string,
): boolean {
  if (order.createdBy !== userId) return false;
  if (isOrderLocked(order)) return false;
  return OWN_ORDER_DELETABLE_STATUSES.includes(order.status);
}

export const OrderPriority = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;
export type OrderPriority = (typeof OrderPriority)[keyof typeof OrderPriority];

/* ------------------------------------------------------------------ recipes */

/**
 * How a recipe ingredient's quantity grows with serving count — see
 * `shared/src/recipes` (`scaleRecipe`) for the formula each mode drives.
 */
export const RecipeIngredientScaling = {
  /** Most ingredients: quantity * (targetPax / basePax). */
  LINEAR: 'LINEAR',
  /** Tempering spices, bay leaf, garnish — does not grow with serving count. */
  FIXED: 'FIXED',
  /** Salt, water — grows sub-linearly in bulk cooking: quantity * sqrt(targetPax / basePax). */
  SQRT: 'SQRT',
} as const;
export type RecipeIngredientScaling =
  (typeof RecipeIngredientScaling)[keyof typeof RecipeIngredientScaling];

export const RecipeDifficulty = {
  EASY: 'EASY',
  MEDIUM: 'MEDIUM',
  HARD: 'HARD',
} as const;
export type RecipeDifficulty = (typeof RecipeDifficulty)[keyof typeof RecipeDifficulty];

/* ---------------------------------------------------------------- shopping */

export const ShoppingListStatus = {
  OPEN: 'OPEN',
  PURCHASED: 'PURCHASED',
  CANCELLED: 'CANCELLED',
} as const;
export type ShoppingListStatus =
  (typeof ShoppingListStatus)[keyof typeof ShoppingListStatus];

/* ------------------------------------------------------------- attachments */

export const AttachmentOwnerType = {
  ORDER: 'ORDER',
  THREAD_MESSAGE: 'THREAD_MESSAGE',
} as const;
export type AttachmentOwnerType =
  (typeof AttachmentOwnerType)[keyof typeof AttachmentOwnerType];

/** DOCUMENT is structurally supported for future PDF/document use; no UI exposes it yet. */
export const AttachmentKind = {
  IMAGE: 'IMAGE',
  VOICE_NOTE: 'VOICE_NOTE',
  DOCUMENT: 'DOCUMENT',
} as const;
export type AttachmentKind = (typeof AttachmentKind)[keyof typeof AttachmentKind];

export const MessageType = {
  USER: 'USER',
  SYSTEM: 'SYSTEM',
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

/**
 * System thread events. These materialise the Order Detail "History" section without a
 * dedicated history table — see docs/SCOPE.md decision 2.
 *
 * The `ORDER_*_CHANGED` events carry both the previous and the updated value in
 * `system_meta`, because the board feed renders the change inline rather than linking out
 * to an audit screen.
 */
export const SystemEvent = {
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_UPDATED: 'ORDER_UPDATED',
  ORDER_STATUS_CHANGED: 'ORDER_STATUS_CHANGED',
  ORDER_ACKNOWLEDGED: 'ORDER_ACKNOWLEDGED',
  ORDER_ITEMS_CHANGED: 'ORDER_ITEMS_CHANGED',
  ORDER_PAX_CHANGED: 'ORDER_PAX_CHANGED',
  ORDER_ITEM_QUANTITY_CHANGED: 'ORDER_ITEM_QUANTITY_CHANGED',
  ORDER_ITEM_CANCELLED: 'ORDER_ITEM_CANCELLED',
  ORDER_ITEM_REPLACED: 'ORDER_ITEM_REPLACED',
  ORDER_ITEM_ADDED: 'ORDER_ITEM_ADDED',
  ORDER_ASSIGNED: 'ORDER_ASSIGNED',
  ORDER_DONE: 'ORDER_DONE',
  ORDER_BILLED: 'ORDER_BILLED',
  SHOPPING_LIST_GENERATED: 'SHOPPING_LIST_GENERATED',
  ATTACHMENT_ADDED: 'ATTACHMENT_ADDED',
  MEMBER_JOINED: 'MEMBER_JOINED',
} as const;
export type SystemEvent = (typeof SystemEvent)[keyof typeof SystemEvent];

export const NotificationType = {
  NEW_ORDER: 'NEW_ORDER',
  MENTION: 'MENTION',
  THREAD_REPLY: 'THREAD_REPLY',
  ACKNOWLEDGEMENT: 'ACKNOWLEDGEMENT',
  STATUS_CHANGED: 'STATUS_CHANGED',
  BOARD_INVITATION: 'BOARD_INVITATION',
  /** Raised by the alarm scheduler; carries an `alertType` in `data`. */
  ALERT: 'ALERT',

  /**
   * Equipment & maintenance. One inbox and one delivery path for everything, rather than a
   * parallel notification system; `data` carries `equipmentId` / `ticketId` so tapping the
   * notification lands on the right screen.
   */
  MAINTENANCE_DUE: 'MAINTENANCE_DUE',
  MAINTENANCE_OVERDUE: 'MAINTENANCE_OVERDUE',
  MAINTENANCE_CRITICAL: 'MAINTENANCE_CRITICAL',
  MAINTENANCE_REPORTED: 'MAINTENANCE_REPORTED',
  MAINTENANCE_ASSIGNED: 'MAINTENANCE_ASSIGNED',
  MAINTENANCE_COMPLETED: 'MAINTENANCE_COMPLETED',
  EQUIPMENT_OUT_OF_SERVICE: 'EQUIPMENT_OUT_OF_SERVICE',
  WARRANTY_EXPIRING: 'WARRANTY_EXPIRING',
  SUPPLIER_FOLLOW_UP: 'SUPPLIER_FOLLOW_UP',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

/* ------------------------------------------------------------------ alerts */

/**
 * The four admin-configurable alarms. An *alarm* is the scheduled notification; the
 * *buzzer* is the sound/vibration it fires with.
 */
export const AlertType = {
  /** A new order, task or message arrived. */
  NEW_INCOMING: 'NEW_INCOMING',
  /** Delivery is due within `leadMinutes`. */
  DELIVERY_WARNING: 'DELIVERY_WARNING',
  /** Delivery has reached the critical threshold. */
  CRITICAL_ALERT: 'CRITICAL_ALERT',
  /** Start preparing — fires `leadMinutes` before the required time. */
  PREP_CALL: 'PREP_CALL',
} as const;
export type AlertType = (typeof AlertType)[keyof typeof AlertType];

/**
 * The Android notification channel order alerts are delivered on.
 *
 * Shared because both ends must name the same string: the app creates the channel (MAX
 * importance, sound, vibration) and the server stamps `channelId` onto every push. Android 8+
 * reads importance and sound from the channel and ignores the message, so a mismatch here is
 * silent delivery — the alert arrives with no heads-up banner and no sound.
 */
export const ORDER_CHANNEL_ID = 'orders';

/**
 * Chat messages get their own channel so they are distinguishable from an order without
 * looking at the screen, and so a user can mute chatter in Android settings while leaving
 * order alarms at full volume.
 */
export const MESSAGE_CHANNEL_ID = 'messages';

/**
 * The uploadable buzzer slots.
 *
 * The first three belong to the phone/tablet alert system. The KDS_* three are the wall
 * screens' own voices, kept separate on purpose: a front desk changing the phone's new-order
 * buzzer must not change what the kitchen counter hears, and vice versa.
 */
export const AlertSoundSlot = {
  NORMAL: 'NORMAL',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
  /** KDS: a new order landed on the board. */
  KDS_NEW: 'KDS_NEW',
  /** KDS: a line is approaching its due time — the attention call. */
  KDS_ATTENTION: 'KDS_ATTENTION',
  /** KDS: a line is past its due time, and the repeat while it stays late. */
  KDS_CRITICAL: 'KDS_CRITICAL',
} as const;
export type AlertSoundSlot = (typeof AlertSoundSlot)[keyof typeof AlertSoundSlot];

/** Slots the phone/tablet alert system uses — what the Alerts page configures. */
export const MOBILE_ALERT_SOUND_SLOTS: readonly AlertSoundSlot[] = [
  AlertSoundSlot.NORMAL,
  AlertSoundSlot.WARNING,
  AlertSoundSlot.CRITICAL,
];

/** Slots the KDS wall screens use — configured on the KDS & CDS tab, never on a board. */
export const KDS_ALERT_SOUND_SLOTS: readonly AlertSoundSlot[] = [
  AlertSoundSlot.KDS_NEW,
  AlertSoundSlot.KDS_ATTENTION,
  AlertSoundSlot.KDS_CRITICAL,
];

/** Defaults applied when an admin has never configured a given alert. */
export const ALERT_DEFAULTS: Readonly<
  Record<AlertType, { leadMinutes: number; sound: AlertSoundSlot; repeatUntilAck: boolean }>
> = {
  [AlertType.NEW_INCOMING]: {
    leadMinutes: 0,
    sound: AlertSoundSlot.NORMAL,
    repeatUntilAck: true,
  },
  [AlertType.DELIVERY_WARNING]: {
    leadMinutes: 30,
    sound: AlertSoundSlot.WARNING,
    repeatUntilAck: true,
  },
  [AlertType.CRITICAL_ALERT]: {
    leadMinutes: 10,
    sound: AlertSoundSlot.CRITICAL,
    repeatUntilAck: true,
  },
  [AlertType.PREP_CALL]: {
    leadMinutes: 120,
    sound: AlertSoundSlot.NORMAL,
    repeatUntilAck: true,
  },
};

export const BillingStatus = {
  GENERATED: 'GENERATED',
  FINALIZED: 'FINALIZED',
  CANCELLED: 'CANCELLED',
} as const;
export type BillingStatus = (typeof BillingStatus)[keyof typeof BillingStatus];

export const SyncDirection = {
  PUSH: 'PUSH',
  PULL: 'PULL',
} as const;
export type SyncDirection = (typeof SyncDirection)[keyof typeof SyncDirection];

/** Local-only on Android; describes a row's relationship to the server. */
export const SyncState = {
  SYNCED: 'SYNCED',
  PENDING: 'PENDING',
  FAILED: 'FAILED',
} as const;
export type SyncState = (typeof SyncState)[keyof typeof SyncState];

/* -------------------------------------------------- YouTube recipe imports */

/**
 * Lifecycle of a YouTube recipe import (staging record — never the Recipe Master itself).
 * QUEUED..ANALYZING are the background-processing stages; READY means the extracted recipe
 * JSON is stored and waiting for review; SAVED means the user pushed it into Recipe Master.
 */
export const YoutubeImportStatus = {
  QUEUED: 'QUEUED',
  DOWNLOADING: 'DOWNLOADING',
  TRANSCRIBING: 'TRANSCRIBING',
  OCR: 'OCR',
  ANALYZING: 'ANALYZING',
  READY: 'READY',
  FAILED: 'FAILED',
  SAVED: 'SAVED',
} as const;
export type YoutubeImportStatus = (typeof YoutubeImportStatus)[keyof typeof YoutubeImportStatus];

/** Statuses the background worker still owns; the record must not be retried or deleted mid-flight. */
export const YOUTUBE_IMPORT_ACTIVE_STATUSES: readonly YoutubeImportStatus[] = [
  YoutubeImportStatus.QUEUED,
  YoutubeImportStatus.DOWNLOADING,
  YoutubeImportStatus.TRANSCRIBING,
  YoutubeImportStatus.OCR,
  YoutubeImportStatus.ANALYZING,
];

/* ------------------------------------------------------------- GST / tax */

/** HSN classifies goods, SAC classifies services. The official workbook ships one sheet each. */
export const HsnSacCodeType = {
  HSN: 'HSN',
  SAC: 'SAC',
} as const;
export type HsnSacCodeType = (typeof HsnSacCodeType)[keyof typeof HsnSacCodeType];

export const SupplyType = {
  GOODS: 'GOODS',
  SERVICE: 'SERVICE',
} as const;
export type SupplyType = (typeof SupplyType)[keyof typeof SupplyType];

/**
 * Why a supply is or is not taxed. EXEMPT/NIL_RATED/ZERO_RATED are legally distinct despite
 * all three producing no tax, so they are not collapsed into one value.
 */
export const GstTaxability = {
  TAXABLE: 'TAXABLE',
  EXEMPT: 'EXEMPT',
  NIL_RATED: 'NIL_RATED',
  ZERO_RATED: 'ZERO_RATED',
  NON_GST: 'NON_GST',
} as const;
export type GstTaxability = (typeof GstTaxability)[keyof typeof GstTaxability];

/** Taxabilities for which a non-zero GST rate is a contradiction. */
export const ZERO_TAX_TAXABILITIES: readonly GstTaxability[] = [
  GstTaxability.EXEMPT,
  GstTaxability.NIL_RATED,
  GstTaxability.ZERO_RATED,
  GstTaxability.NON_GST,
];

export const ItcEligibility = {
  AVAILABLE: 'AVAILABLE',
  NOT_AVAILABLE: 'NOT_AVAILABLE',
  PARTIAL: 'PARTIAL',
} as const;
export type ItcEligibility = (typeof ItcEligibility)[keyof typeof ItcEligibility];

/* ------------------------------------------------------------------ tasks */

/** Ordinary work, or a volunteer marking themselves unavailable. */
export const TaskKind = {
  WORK: 'WORK',
  OFF_TIME: 'OFF_TIME',
} as const;
export type TaskKind = (typeof TaskKind)[keyof typeof TaskKind];

/**
 * Where the work came from, as the volunteer sees it. Stamped at creation from the
 * assigner's role — SELF is deliberately not an administrator role, so self-assigned work is
 * never presented as an instruction from above.
 */
export const TaskSource = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  SELF: 'SELF',
} as const;
export type TaskSource = (typeof TaskSource)[keyof typeof TaskSource];

export const TASK_SOURCE_LABELS: Readonly<Record<TaskSource, string>> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  SELF: 'Self Assigned',
};

export const TaskStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskPriority = {
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
} as const;
export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];

/** Lifecycle of one "Sync GST Master" run. */
export const GstSyncStatus = {
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;
export type GstSyncStatus = (typeof GstSyncStatus)[keyof typeof GstSyncStatus];

/* ---------------------------------------------------------------- entities */

/**
 * What kind of party an `entities` row describes.
 *
 * One master, not three: a canteen sells to a customer, charges an employee against payroll
 * and buys from a vendor, and the same person is regularly two of those at once. Splitting
 * them into separate tables would duplicate the person and lose the link between the roles.
 */
export const EntityType = {
  CUSTOMER: 'CUSTOMER',
  EMPLOYEE: 'EMPLOYEE',
  VENDOR: 'VENDOR',
  /** Departments, trusts, visiting groups — anything a bill may be raised in the name of. */
  OTHER: 'OTHER',
} as const;
export type EntityType = (typeof EntityType)[keyof typeof EntityType];

/* --------------------------------------------------------------------- POS */

/** How the sale is fulfilled. Orthogonal to whether the order carries an entity. */
export const PosOrderType = {
  DINE_IN: 'DINE_IN',
  TAKEAWAY: 'TAKEAWAY',
  DELIVERY: 'DELIVERY',
  /** Walk-up cash sale, deliberately anonymous — the only type that never names an entity. */
  QUICK_SALE: 'QUICK_SALE',
} as const;
export type PosOrderType = (typeof PosOrderType)[keyof typeof PosOrderType];

/**
 * The POS order lifecycle.
 *
 * DRAFT and SCHEDULED are both "not yet on the counter", but for different reasons, and the
 * dashboard has to be able to tell them apart: a DRAFT is an unfinished ticket someone parked
 * mid-entry, a SCHEDULED order is a finished ticket deliberately dated forward.
 */
export const PosOrderStatus = {
  DRAFT: 'DRAFT',
  SCHEDULED: 'SCHEDULED',
  OPEN: 'OPEN',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type PosOrderStatus = (typeof PosOrderStatus)[keyof typeof PosOrderStatus];

/** Statuses still on the floor — everything the POS dashboard shows by default. */
export const ACTIVE_POS_ORDER_STATUSES: readonly PosOrderStatus[] = [
  PosOrderStatus.DRAFT,
  PosOrderStatus.SCHEDULED,
  PosOrderStatus.OPEN,
];

/** COMPLETED and CANCELLED end the ticket; only a void reopens neither. */
export const TERMINAL_POS_ORDER_STATUSES: readonly PosOrderStatus[] = [
  PosOrderStatus.COMPLETED,
  PosOrderStatus.CANCELLED,
];

/**
 * Whether `to` may follow `from`.
 *
 * - A DRAFT may be scheduled, opened or cancelled.
 * - A SCHEDULED order may be pulled back to DRAFT, opened when its time comes, or cancelled.
 * - An OPEN order may be completed or cancelled; it may not go back to DRAFT, because items
 *   have already been committed against it.
 * - COMPLETED and CANCELLED are terminal. Reversing a completed sale is `void`, which is an
 *   explicit, audited action, not a status edit.
 */
export function canTransitionPosOrderStatus(from: PosOrderStatus, to: PosOrderStatus): boolean {
  if (from === to) return true;
  if (TERMINAL_POS_ORDER_STATUSES.includes(from)) return false;
  if (to === PosOrderStatus.CANCELLED) return true;

  switch (from) {
    case PosOrderStatus.DRAFT:
      return to === PosOrderStatus.SCHEDULED || to === PosOrderStatus.OPEN;
    case PosOrderStatus.SCHEDULED:
      return to === PosOrderStatus.DRAFT || to === PosOrderStatus.OPEN;
    case PosOrderStatus.OPEN:
      return to === PosOrderStatus.COMPLETED;
    default:
      return false;
  }
}

/** A cancelled line stays on the ticket so the audit trail keeps its shape. */
export const PosOrderItemStatus = {
  ACTIVE: 'ACTIVE',
  CANCELLED: 'CANCELLED',
} as const;
export type PosOrderItemStatus = (typeof PosOrderItemStatus)[keyof typeof PosOrderItemStatus];

export const PosPaymentMethod = {
  CASH: 'CASH',
  CARD: 'CARD',
  UPI: 'UPI',
  WALLET: 'WALLET',
  /** Charged to the entity's account — payroll deduction, vendor set-off, running tab. */
  ACCOUNT: 'ACCOUNT',
  /** Staff meal, prasad, complimentary — settles the ticket without money moving. */
  COMPLIMENTARY: 'COMPLIMENTARY',
} as const;
export type PosPaymentMethod = (typeof PosPaymentMethod)[keyof typeof PosPaymentMethod];

/** ACCOUNT settlement is only meaningful against a named entity. */
export const ENTITY_REQUIRED_PAYMENT_METHODS: readonly PosPaymentMethod[] = [
  PosPaymentMethod.ACCOUNT,
];

export const PosPaymentStatus = {
  UNPAID: 'UNPAID',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
  /** A completed sale that was later voided; the offsetting payment rows carry the reversal. */
  VOIDED: 'VOIDED',
} as const;
export type PosPaymentStatus = (typeof PosPaymentStatus)[keyof typeof PosPaymentStatus];

/** Percentage of the line, or a flat amount off it. Nothing else discounts a POS line. */
export const PosDiscountType = {
  NONE: 'NONE',
  PERCENT: 'PERCENT',
  AMOUNT: 'AMOUNT',
} as const;
export type PosDiscountType = (typeof PosDiscountType)[keyof typeof PosDiscountType];

/* ------------------------------------------------------------------ kiosk presentation */

/**
 * The visual skin the self-service kiosk wears.
 *
 * Chosen in the Admin Portal, not on the tablet: a hall runs several kiosks and they must
 * look like one another, and the person who decides how the organisation presents itself is
 * not the person walking past the stand. All four are quiet by intent — a spiritual
 * organisation's canteen is not a promotion, so none of them carries a second accent.
 */
export const KioskSkin = {
  /** Warm ivory and sandalwood with a single saffron accent. The default. */
  SANDALWOOD: 'SANDALWOOD',
  /** Cool ivory and tulsi green. Reads calmer under daylight-white hall lighting. */
  TULSI: 'TULSI',
  /** Low-light indigo and moonlight, for an evening hall or an outdoor stand after dark. */
  KASHI: 'KASHI',
  /** Near-monochrome paper and graphite; the most austere of the four. */
  SATTVA: 'SATTVA',
} as const;
export type KioskSkin = (typeof KioskSkin)[keyof typeof KioskSkin];

/**
 * Which language the guest-facing surfaces are written in.
 *
 * `BOTH` is not a fallback — it is a deliberate third setting for a hall whose queue is mixed,
 * and it renders each label twice rather than picking one. The GST bill is unaffected: it is a
 * tax document and stays in English whatever this says.
 */
export const KioskLanguageMode = {
  EN: 'EN',
  HI: 'HI',
  BOTH: 'BOTH',
} as const;
export type KioskLanguageMode = (typeof KioskLanguageMode)[keyof typeof KioskLanguageMode];

/**
 * How a settled bill reaches paper. Both routes are ESC/POS; there is no third.
 *
 * The browser's own print dialog used to sit behind these as a last resort and has been
 * removed. It printed an HTML approximation of the bill on whatever paper the tablet's default
 * printer held, raised a modal a guest could not dismiss, and took seconds — on a device with
 * nobody standing behind it, all three are failures. A stand either has a printer it can drive
 * as a printer, or it prints at the counter.
 */
export const ReceiptTransport = {
  /** ESC/POS straight to a printer attached to the tablet over WebUSB. */
  USB: 'USB',
  /** ESC/POS from the backend to a networked counter printer over RAW/9100. */
  NETWORK: 'NETWORK',
} as const;
export type ReceiptTransport = (typeof ReceiptTransport)[keyof typeof ReceiptTransport];

/**
 * Whether the kiosk may suggest anything before payment, and what.
 *
 * A suggestion is one extra tap between a guest and their food, so who is allowed to place it
 * there is an operator's decision rather than a developer's. A hall that serves free prasad
 * turns it off; one running a paid canteen with a drinks counter leaves it on. The two kinds
 * are separable because a hall may want to offer a drink and consider pushing sweets unseemly.
 */
export const KioskRecommendationMode = {
  /** Never interrupt. A guest goes from cart to payment with nothing in between. */
  OFF: 'OFF',
  DRINKS: 'DRINKS',
  SWEETS: 'SWEETS',
  /** Both, but still only ever one prompt per order — whichever is relevant first. */
  BOTH: 'BOTH',
} as const;
export type KioskRecommendationMode =
  (typeof KioskRecommendationMode)[keyof typeof KioskRecommendationMode];
