import type {
  AcknowledgementDto,
  ActivityTypeDto,
  AlertSettingDto,
  AlertSoundDto,
  AttachmentDto,
  AuditLogDto,
  BillingExportDto,
  BoardDto,
  BoardMemberDto,
  IngredientCategoryDto,
  IngredientDto,
  MenuCategoryDto,
  MenuItemDto,
  NotificationDto,
  OrderDto,
  OrderItemDto,
  RecipeDto,
  RecipeIngredientDto,
  RecipeStepDto,
  SettingDto,
  ShoppingListDto,
  ShoppingListItemDto,
  StationDto,
  SyncMeta,
  SystemEvent,
  ThreadMessageDto,
  UserDto,
  UserRole,
  YoutubeExtractedRecipe,
  YoutubeImportDto,
} from '@menuboard/shared';
import { parseIdArray, parseJsonColumn } from '../utils/json';
import { fromDbDate, fromDbDateTime, fromDbDateTimeRequired, fromDbTime } from '../utils/time';
import type {
  AcknowledgementRow,
  ActivityTypeRow,
  AlertSettingRow,
  AlertSoundRow,
  AttachmentRow,
  AuditLogRow,
  BillingExportRow,
  BoardMemberRow,
  BoardRow,
  IngredientCategoryRow,
  IngredientRow,
  MenuCategoryRow,
  MenuItemRow,
  NotificationRow,
  OrderItemRow,
  OrderRow,
  RecipeIngredientRow,
  RecipeRow,
  RecipeStepRow,
  SettingRow,
  ShoppingListItemRow,
  ShoppingListRow,
  StationRow,
  ThreadMessageRow,
  UserRow,
  YoutubeImportRow,
} from './rows';

/**
 * Row → DTO mapping. The single boundary where database representation becomes wire
 * representation: string dates become ISO instants, JSON columns become arrays/objects,
 * `TINYINT(1)` becomes boolean, and `password_hash` is structurally impossible to leak
 * because no mapper reads it.
 */

function syncMeta(row: {
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  sync_seq: string | number;
}): SyncMeta {
  return {
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    deletedAt: fromDbDateTime(row.deleted_at),
    revision: Number(row.revision),
    syncSeq: Number(row.sync_seq),
  };
}

export function mapUser(row: UserRow): UserDto {
  return {
    id: row.id,
    employeeCode: row.employee_code,
    name: row.name,
    username: row.username,
    phone: row.phone,
    email: row.email,
    role: row.role,
    status: row.status,
    avatarPath: row.avatar_path,
    lastLoginAt: fromDbDateTime(row.last_login_at),
    ...syncMeta(row),
  };
}

export function mapStation(row: StationRow): StationDto {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    status: row.status,
    createdBy: row.created_by,
    ...syncMeta(row),
  };
}

export function mapBoard(row: BoardRow): BoardDto {
  return {
    id: row.id,
    stationId: row.station_id,
    name: row.name,
    description: row.description,
    color: row.color,
    photoPath: row.photo_path,
    status: row.status,
    createdBy: row.created_by,
    ...(row.station_name !== undefined ? { stationName: row.station_name } : {}),
    ...syncMeta(row),
  };
}

export function mapBoardMember(row: BoardMemberRow): BoardMemberDto {
  return {
    id: row.id,
    boardId: row.board_id,
    userId: row.user_id,
    boardRole: row.board_role,
    status: row.status,
    joinedAt: fromDbDateTime(row.joined_at),
    invitedBy: row.invited_by,
    ...(row.user_name !== undefined ? { userName: row.user_name } : {}),
    ...(row.user_avatar_path !== undefined ? { userAvatarPath: row.user_avatar_path } : {}),
    ...syncMeta(row),
  };
}

export function mapActivityType(row: ActivityTypeRow): ActivityTypeDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    status: row.status,
    sortOrder: Number(row.sort_order),
    isSystem: row.is_system === 1,
    ...syncMeta(row),
  };
}

export function mapMenuCategory(row: MenuCategoryRow): MenuCategoryDto {
  return {
    id: row.id,
    name: row.name,
    nameHi: row.name_hi,
    description: row.description,
    imagePath: row.image_path,
    status: row.status,
    sortOrder: Number(row.sort_order),
    ...syncMeta(row),
  };
}

export function mapMenuItem(row: MenuItemRow): MenuItemDto {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    nameHi: row.name_hi,
    unit: row.unit,
    unitHi: row.unit_hi,
    imagePath: row.image_path,
    status: row.status,
    sortOrder: Number(row.sort_order),
    ...syncMeta(row),
  };
}

export function mapOrder(row: OrderRow): OrderDto {
  return {
    id: row.id,
    orderNumber: row.order_number,
    boardId: row.board_id,
    activityTypeId: row.activity_type_id,
    customActivity: row.custom_activity,
    venue: row.venue,
    pax: Number(row.pax),
    requiredDate: fromDbDate(row.required_date) as string,
    requiredTime: fromDbTime(row.required_time) as string,
    priority: row.priority,
    status: row.status,
    completedAt: fromDbDateTime(row.completed_at),
    completedBy: row.completed_by,
    shoppingGeneratedAt: fromDbDateTime(row.shopping_generated_at),
    billedAt: fromDbDateTime(row.billed_at),
    billingExportId: row.billing_export_id,
    doneAt: fromDbDateTime(row.done_at),
    doneBy: row.done_by,
    createdBy: row.created_by,
    assignedTo: row.assigned_to,
    assignedAt: fromDbDateTime(row.assigned_at),
    ...syncMeta(row),
  };
}

export function mapOrderItem(row: OrderItemRow): OrderItemDto {
  return {
    id: row.id,
    orderId: row.order_id,
    menuItemId: row.menu_item_id,
    customItemName: row.custom_item_name,
    // DECIMAL arrives as a string; Number is exact for the 12,3 range in play here.
    quantity: Number(row.quantity),
    unit: row.unit,
    notes: row.notes,
    mentionedUserIds: parseIdArray(row.mentioned_user_ids),
    sortOrder: Number(row.sort_order),
    cancelledAt: fromDbDateTime(row.cancelled_at),
    cancelledBy: row.cancelled_by,
    replacedByItemId: row.replaced_by_item_id,
    ...syncMeta(row),
  };
}

export function mapAttachment(row: AttachmentRow): AttachmentDto {
  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    kind: row.kind,
    fileName: row.file_name,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    checksum: row.checksum,
    uploadedBy: row.uploaded_by,
    ...syncMeta(row),
  };
}

export function mapThreadMessage(row: ThreadMessageRow): ThreadMessageDto {
  return {
    id: row.id,
    boardId: row.board_id,
    orderId: row.order_id,
    parentMessageId: row.parent_message_id,
    authorId: row.author_id,
    messageType: row.message_type,
    body: row.body,
    mentionedUserIds: parseIdArray(row.mentioned_user_ids),
    systemEvent: row.system_event as SystemEvent | null,
    systemMeta: parseJsonColumn<Record<string, unknown> | null>(row.system_meta, null),
    ...(row.author_name !== undefined ? { authorName: row.author_name } : {}),
    ...syncMeta(row),
  };
}

export function mapAcknowledgement(row: AcknowledgementRow): AcknowledgementDto {
  return {
    id: row.id,
    orderId: row.order_id,
    userId: row.user_id,
    acknowledgedAt: fromDbDateTimeRequired(row.acknowledged_at),
    note: row.note,
    ...(row.user_name !== undefined ? { userName: row.user_name } : {}),
    ...syncMeta(row),
  };
}

export function mapNotification(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    boardId: row.board_id,
    orderId: row.order_id,
    actorId: row.actor_id,
    data: parseJsonColumn<Record<string, unknown> | null>(row.data, null),
    readAt: fromDbDateTime(row.read_at),
    createdAt: fromDbDateTimeRequired(row.created_at),
    deletedAt: fromDbDateTime(row.deleted_at),
    syncSeq: Number(row.sync_seq),
  };
}

export function mapAuditLog(row: AuditLogRow): AuditLogDto {
  return {
    id: row.id,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    boardId: row.board_id,
    before: parseJsonColumn<Record<string, unknown> | null>(row.before_data, null),
    after: parseJsonColumn<Record<string, unknown> | null>(row.after_data, null),
    ip: row.ip,
    userAgent: row.user_agent,
    createdAt: fromDbDateTimeRequired(row.created_at),
    ...(row.actor_name !== undefined ? { actorName: row.actor_name } : {}),
  };
}

/** The frozen `snapshot` payload is deliberately excluded; it is fetched on demand. */
export function mapBillingExport(row: BillingExportRow): BillingExportDto {
  return {
    id: row.id,
    boardId: row.board_id,
    periodFrom: fromDbDate(row.period_from) as string,
    periodTo: fromDbDate(row.period_to) as string,
    billingVersion: Number(row.billing_version),
    status: row.status,
    totalOrders: Number(row.total_orders),
    totalPax: Number(row.total_pax),
    notes: row.notes,
    checksum: row.checksum,
    generatedBy: row.generated_by,
    generatedAt: fromDbDateTimeRequired(row.generated_at),
    ...(row.generated_by_name !== undefined ? { generatedByName: row.generated_by_name } : {}),
  };
}

export function mapSetting(row: SettingRow): SettingDto {
  return {
    key: row.setting_key,
    value: parseJsonColumn<unknown>(row.value, null),
    description: row.description,
    updatedBy: row.updated_by,
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

/* ----------------------------------------------------------- ingredients */

export function mapIngredientCategory(row: IngredientCategoryRow): IngredientCategoryDto {
  return {
    id: row.id,
    name: row.name,
    nameHi: row.name_hi,
    status: row.status,
    sortOrder: Number(row.sort_order),
    ...syncMeta(row),
  };
}

export function mapIngredient(row: IngredientRow): IngredientDto {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    nameHi: row.name_hi,
    unit: row.unit,
    status: row.status,
    sortOrder: Number(row.sort_order),
    ...(row.category_name !== undefined ? { categoryName: row.category_name } : {}),
    ...syncMeta(row),
  };
}

/* --------------------------------------------------------------- recipes */

export function mapRecipeIngredient(row: RecipeIngredientRow): RecipeIngredientDto {
  return {
    id: row.id,
    recipeId: row.recipe_id,
    ingredientId: row.ingredient_id,
    quantity: Number(row.quantity),
    unit: row.unit,
    scaling: row.scaling,
    notes: row.notes,
    sortOrder: Number(row.sort_order),
    ...(row.ingredient_name !== undefined ? { ingredientName: row.ingredient_name } : {}),
    ...(row.ingredient_name_hi !== undefined ? { ingredientNameHi: row.ingredient_name_hi } : {}),
    ...syncMeta(row),
  };
}

export function mapRecipeStep(row: RecipeStepRow): RecipeStepDto {
  return {
    id: row.id,
    recipeId: row.recipe_id,
    stepNo: Number(row.step_no),
    textEn: row.text_en,
    textHi: row.text_hi,
    durationMin: row.duration_min === null ? null : Number(row.duration_min),
    imagePath: row.image_path,
    ...syncMeta(row),
  };
}

export function mapRecipe(
  row: RecipeRow,
  ingredients: RecipeIngredientRow[],
  steps: RecipeStepRow[] = [],
): RecipeDto {
  return {
    id: row.id,
    menuItemId: row.menu_item_id,
    basePax: Number(row.base_pax),
    isDefault: row.is_default === 1,
    prepTimeMin: row.prep_time_min === null ? null : Number(row.prep_time_min),
    cookTimeMin: row.cook_time_min === null ? null : Number(row.cook_time_min),
    teamSize: row.team_size === null ? null : Number(row.team_size),
    difficulty: row.difficulty,
    descriptionEn: row.description_en,
    descriptionHi: row.description_hi,
    methodEn: row.method_en,
    methodHi: row.method_hi,
    yieldNote: row.yield_note,
    chefNotes: row.chef_notes,
    status: row.status,
    ingredients: ingredients.map(mapRecipeIngredient),
    steps: steps.map(mapRecipeStep),
    ...(row.menu_item_name !== undefined ? { menuItemName: row.menu_item_name } : {}),
    ...syncMeta(row),
  };
}

/* -------------------------------------------------------- shopping lists */

export function mapShoppingListItem(row: ShoppingListItemRow): ShoppingListItemDto {
  return {
    id: row.id,
    shoppingListId: row.shopping_list_id,
    ingredientName: row.ingredient_name,
    quantity: Number(row.quantity),
    unit: row.unit,
    purchased: row.purchased === 1,
    notes: row.notes,
    sortOrder: Number(row.sort_order),
    sourceOrderIds: parseIdArray(row.source_order_ids),
    ...syncMeta(row),
  };
}

export function mapShoppingList(
  row: ShoppingListRow,
  items: ShoppingListItemRow[],
): ShoppingListDto {
  return {
    id: row.id,
    boardId: row.board_id,
    orderIds: parseIdArray(row.order_ids),
    title: row.title,
    status: row.status,
    generatedBy: row.generated_by,
    generatedAt: fromDbDateTimeRequired(row.generated_at),
    notes: row.notes,
    items: items.map(mapShoppingListItem),
    ...(row.generated_by_name !== undefined ? { generatedByName: row.generated_by_name } : {}),
    ...syncMeta(row),
  };
}

/* ---------------------------------------------------------------- alerts */

export function mapAlertSetting(row: AlertSettingRow): AlertSettingDto {
  return {
    id: row.id,
    alertType: row.alert_type,
    enabled: row.enabled === 1,
    leadMinutes: Number(row.lead_minutes),
    sound: row.sound,
    repeatUntilAck: row.repeat_until_ack === 1,
    repeatEverySeconds: Number(row.repeat_every_seconds),
    targetRoles: parseJsonColumn<UserRole[]>(row.target_roles, []),
    updatedBy: row.updated_by,
    ...syncMeta(row),
  };
}

export function mapAlertSound(row: AlertSoundRow): AlertSoundDto {
  return {
    slot: row.slot,
    attachmentId: row.attachment_id,
    fileName: row.file_name,
    storagePath: row.storage_path,
    updatedBy: row.updated_by,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    deletedAt: null,
    revision: Number(row.revision),
    syncSeq: Number(row.sync_seq),
  };
}

export function mapYoutubeImport(row: YoutubeImportRow): YoutubeImportDto {
  return {
    id: row.id,
    youtubeUrl: row.youtube_url,
    youtubeVideoId: row.youtube_video_id,
    videoTitle: row.video_title,
    channelName: row.channel_name,
    durationSec: row.duration_sec === null ? null : Number(row.duration_sec),
    thumbnailUrl: row.thumbnail_url,
    status: row.status,
    progressPercent: Number(row.progress_percent),
    statusMessage: row.status_message,
    transcript: row.transcript,
    ocrText: row.ocr_text,
    extractedRecipe: parseJsonColumn<YoutubeExtractedRecipe | null>(row.extracted_recipe_json, null),
    errorMessage: row.error_message,
    recipeId: row.recipe_id,
    createdBy: row.created_by,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    completedAt: fromDbDateTime(row.completed_at),
  };
}
