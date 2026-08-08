/**
 * Canonical enumerations. These string values are persisted in MariaDB and SQLite and
 * travel over the wire unchanged — never renumber or rename an existing member.
 */

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

/** The three uploadable buzzer slots. */
export const AlertSoundSlot = {
  NORMAL: 'NORMAL',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
} as const;
export type AlertSoundSlot = (typeof AlertSoundSlot)[keyof typeof AlertSoundSlot];

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
