import type { IsoDateTime, Uuid } from '../dto/common';
import type {
  AcknowledgementDto,
  ActivityTypeDto,
  AlertSettingDto,
  AttachmentDto,
  BoardDto,
  BoardMemberDto,
  IngredientDto,
  MenuCategoryDto,
  MenuItemDto,
  NotificationDto,
  OrderDto,
  OrderItemDto,
  RecipeIngredientDto,
  RecipeDto,
  RecipeStepDto,
  ShoppingListDto,
  ShoppingListItemDto,
  StationDto,
  ThreadMessageDto,
  UserDto,
} from '../dto/domain';

/**
 * Entities that participate in delta sync, in dependency order for safe application.
 *
 * Recipes (and the ingredient master they reference) sit with the other master data: they
 * are read-only on the device but must be cached, because the long-press "view recipe" has
 * to work in a kitchen with no signal.
 */
export const SYNC_ENTITIES = [
  'users',
  // stations must precede boards because boards.station_id is a foreign key.
  'stations',
  'boards',
  'board_members',
  'activity_types',
  'menu_categories',
  'menu_items',
  'ingredients',
  'recipes',
  'recipe_ingredients',
  'recipe_steps',
  'orders',
  'order_items',
  'attachments',
  'thread_messages',
  'acknowledgements',
  'shopping_lists',
  'shopping_list_items',
  'alert_settings',
  'notifications',
] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

/**
 * Entities an Android device may push. Everything else is server- or Admin-authored.
 *
 * Shopping lists are absent on purpose: generation is a server-side roll-up over recipes,
 * so a device offline cannot compute one that would agree with the server's.
 */
export const PUSHABLE_ENTITIES = [
  'boards',
  'orders',
  'order_items',
  'attachments',
  'thread_messages',
  'acknowledgements',
] as const;
export type PushableEntity = (typeof PUSHABLE_ENTITIES)[number];

export const SyncOp = {
  UPSERT: 'UPSERT',
  DELETE: 'DELETE',
} as const;
export type SyncOp = (typeof SyncOp)[keyof typeof SyncOp];

/** One durable row from the device's sync_queue. */
export interface SyncPushItem {
  /** Client-generated queue id; makes the push idempotent across retries. */
  clientOpId: Uuid;
  entity: PushableEntity;
  entityId: Uuid;
  op: SyncOp;
  /** Full entity payload for UPSERT; null for DELETE. */
  payload: Record<string, unknown> | null;
  /** Device-local creation time of the operation, for last-write-wins tie-breaks. */
  clientTimestamp: IsoDateTime;
  /** Revision the device believed it was editing, when known. */
  baseRevision?: number;
}

export interface SyncPushRequest {
  deviceId: string;
  items: SyncPushItem[];
}

export const SyncResultStatus = {
  APPLIED: 'APPLIED',
  /** Already applied by an earlier attempt — safe to drop from the queue. */
  DUPLICATE: 'DUPLICATE',
  /** Server copy won last-write-wins; device must adopt the returned entity. */
  SUPERSEDED: 'SUPERSEDED',
  /** Permanently invalid (validation, permission, missing parent) — do not retry. */
  REJECTED: 'REJECTED',
  /** Transient failure — retry with backoff. */
  FAILED: 'FAILED',
} as const;
export type SyncResultStatus = (typeof SyncResultStatus)[keyof typeof SyncResultStatus];

export interface SyncPushItemResult {
  clientOpId: Uuid;
  entity: PushableEntity;
  entityId: Uuid;
  status: SyncResultStatus;
  /**
   * Authoritative server state after the attempt, when available. Deliberately `unknown`: the
   * shape varies by entity, and the device applies it through its own per-entity writer.
   */
  serverEntity?: unknown;
  errorCode?: string;
  errorMessage?: string;
}

export interface SyncPushResponse {
  results: SyncPushItemResult[];
  /** Cursor after applying this batch; the device should pull from here. */
  cursor: number;
  serverTime: IsoDateTime;
}

export interface SyncPullRequest {
  deviceId: string;
  /** Last cursor the device successfully applied. 0 for a full initial sync. */
  cursor: number;
  limit?: number;
  /** Restrict to specific entities; omitted means all. */
  entities?: SyncEntity[];
}

export interface SyncChangeSet {
  users: UserDto[];
  boards: BoardDto[];
  board_members: BoardMemberDto[];
  stations: StationDto[];
  activity_types: ActivityTypeDto[];
  menu_categories: MenuCategoryDto[];
  menu_items: MenuItemDto[];
  ingredients: IngredientDto[];
  recipes: RecipeDto[];
  recipe_ingredients: RecipeIngredientDto[];
  recipe_steps: RecipeStepDto[];
  orders: OrderDto[];
  order_items: OrderItemDto[];
  attachments: AttachmentDto[];
  thread_messages: ThreadMessageDto[];
  acknowledgements: AcknowledgementDto[];
  shopping_lists: ShoppingListDto[];
  shopping_list_items: ShoppingListItemDto[];
  alert_settings: AlertSettingDto[];
  notifications: NotificationDto[];
}

export interface SyncPullResponse {
  changes: SyncChangeSet;
  /** Highest cursor included in this page. */
  cursor: number;
  /** True when more rows remain above `cursor`; pull again immediately. */
  hasMore: boolean;
  serverTime: IsoDateTime;
}

export function emptyChangeSet(): SyncChangeSet {
  return {
    users: [],
    boards: [],
    board_members: [],
    stations: [],
    activity_types: [],
    menu_categories: [],
    menu_items: [],
    ingredients: [],
    recipes: [],
    recipe_ingredients: [],
    recipe_steps: [],
    orders: [],
    order_items: [],
    attachments: [],
    thread_messages: [],
    acknowledgements: [],
    shopping_lists: [],
    shopping_list_items: [],
    alert_settings: [],
    notifications: [],
  };
}
