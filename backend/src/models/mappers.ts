export * from './equipmentMappers';
export * from './cleaningMappers';

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
  CounterDto,
  CounterRouteDto,
  EntityDto,
  IngredientCategoryDto,
  IngredientDto,
  ItemGroupDto,
  MediaAssetDto,
  MediaAssignmentDto,
  MenuCategoryAssignmentDto,
  MenuCategoryDto,
  MenuDto,
  MenuItemAssignmentDto,
  MenuItemDto,
  MenuItemScheduleDto,
  MenuItemVariantCatalogPriceDto,
  MenuItemVariantDto,
  MenuScheduleDto,
  ModifierAssignmentDto,
  ModifierDto,
  ModifierGroupDto,
  NotificationDto,
  OrderDto,
  OrderItemDto,
  PosOrderDto,
  PosOrderItemDto,
  PosPaymentDto,
  PrintingGroupDto,
  PrintingRouteDto,
  RecipeDto,
  RecipeIngredientDto,
  RecipeStepDto,
  GstSyncRunDto,
  HsnSacCodeDto,
  InventoryLocationDto,
  ProductDto,
  ProductLocationDto,
  SettingDto,
  ShoppingListDto,
  SupplierProductDto,
  TaskDto,
  TaxProfileDto,
  UomDto,
  VendorSummaryDto,
  TeamMemberActivityDto,
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
import { signMenuMediaUrl } from '../utils/mediaStorage';
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
  CounterRouteRow,
  CounterRow,
  EntityRow,
  IngredientCategoryRow,
  IngredientRow,
  InventoryLocationRow,
  ItemGroupRow,
  MediaAssetRow,
  MediaAssignmentRow,
  MenuCategoryAssignmentRow,
  MenuCategoryRow,
  MenuItemAssignmentRow,
  MenuItemRow,
  MenuItemScheduleRow,
  MenuItemVariantCatalogPriceRow,
  MenuItemVariantRow,
  MenuRow,
  MenuScheduleRow,
  ModifierAssignmentRow,
  ModifierGroupRow,
  ModifierRow,
  NotificationRow,
  OrderItemRow,
  OrderRow,
  PosOrderItemRow,
  PosOrderRow,
  PosPaymentRow,
  PrintingGroupRow,
  PrintingRouteRow,
  ProductLocationRow,
  ProductRow,
  RecipeIngredientRow,
  RecipeRow,
  RecipeStepRow,
  SettingRow,
  ShoppingListItemRow,
  ShoppingListRow,
  StationRow,
  SupplierProductRow,
  ThreadMessageRow,
  TaskRow,
  TaxProfileRow,
  TeamActivityRow,
  UomRow,
  UserRow,
  VendorRow,
  YoutubeImportRow,
  GstSyncRunRow,
  HsnSacCodeRow,
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
    catalogueId: row.catalogue_id,
    ...(row.catalogue_name !== undefined ? { catalogueName: row.catalogue_name } : {}),
    name: row.name,
    nameHi: row.name_hi,
    description: row.description,
    imagePath: row.image_path,
    status: row.status,
    sortOrder: Number(row.sort_order),
    ...syncMeta(row),
  };
}

/**
 * `userId` is only needed for `primaryMediaUrl`: media downloads are authorised by a signed,
 * expiring query string, so a link can only be minted for a known caller. Omit it wherever the
 * DTO is produced outside a request (the id still travels, and the device mints its own link).
 */
export function mapMenuItem(row: MenuItemRow, userId?: string): MenuItemDto {
  const primaryMediaId = row.primary_media_id ?? null;
  return {
    id: row.id,
    categoryId: row.category_id,
    ...(row.category_name !== undefined ? { categoryName: row.category_name } : {}),
    groupId: row.group_id,
    ...(row.group_name !== undefined ? { groupName: row.group_name } : {}),
    name: row.name,
    nameHi: row.name_hi,
    description: row.description,
    descriptionHi: row.description_hi,
    unit: row.unit,
    unitHi: row.unit_hi,
    imagePath: row.image_path,
    primaryMediaId,
    primaryMediaUrl:
      primaryMediaId !== null && userId !== undefined
        ? signMenuMediaUrl(primaryMediaId, userId)
        : null,
    basePrice: row.base_price === null ? null : Number(row.base_price),
    taxProfileId: row.tax_profile_id,
    alwaysAvailable: row.always_available === 1,
    prepSeconds: row.prep_seconds === null ? null : Number(row.prep_seconds),
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

/* ------------------------------------------------------------- menu master */

export function mapMenu(row: MenuRow): MenuDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status,
    sortOrder: Number(row.sort_order),
    priority: Number(row.priority),
    version: Number(row.version),
    effectiveFrom: fromDbDate(row.effective_from),
    effectiveUntil: fromDbDate(row.effective_until),
    publishedAt: fromDbDateTime(row.published_at),
    createdBy: row.created_by,
    ...syncMeta(row),
  };
}

export function mapMenuCategoryAssignment(
  row: MenuCategoryAssignmentRow,
): MenuCategoryAssignmentDto {
  return {
    id: row.id,
    menuId: row.menu_id,
    categoryId: row.category_id,
    displayName: row.display_name,
    displayNameHi: row.display_name_hi,
    description: row.description,
    descriptionHi: row.description_hi,
    status: row.status,
    sortOrder: Number(row.sort_order),
    posVisible: row.pos_visible === 1,
    boardVisible: row.board_visible === 1,
    createdBy: row.created_by,
    ...(row.category_name !== undefined ? { categoryName: row.category_name } : {}),
    ...(row.category_name_hi !== undefined ? { categoryNameHi: row.category_name_hi } : {}),
    ...(row.category_image_path !== undefined
      ? { categoryImagePath: row.category_image_path }
      : {}),
    ...syncMeta(row),
  };
}

export function mapMenuItemAssignment(row: MenuItemAssignmentRow): MenuItemAssignmentDto {
  return {
    id: row.id,
    menuId: row.menu_id,
    foodItemId: row.food_item_id,
    categoryAssignmentId: row.category_assignment_id,
    displayName: row.display_name,
    displayNameHi: row.display_name_hi,
    description: row.description,
    descriptionHi: row.description_hi,
    preparationMethod: row.preparation_method,
    preparationMethodHi: row.preparation_method_hi,
    preparationTimeMinutes:
      row.preparation_time_minutes === null ? null : Number(row.preparation_time_minutes),
    unit: row.unit,
    status: row.status,
    availability: row.availability,
    sortOrder: Number(row.sort_order),
    posVisible: row.pos_visible === 1,
    boardVisible: row.board_visible === 1,
    qrVisible: row.qr_visible === 1,
    webVisible: row.web_visible === 1,
    appVisible: row.app_visible === 1,
    dineInAvailable: row.dine_in_available === 1,
    takeawayAvailable: row.takeaway_available === 1,
    deliveryAvailable: row.delivery_available === 1,
    allowDecimalQuantity: row.allow_decimal_quantity === 1,
    createdBy: row.created_by,
    ...(row.food_item_name !== undefined ? { foodItemName: row.food_item_name } : {}),
    ...(row.food_item_name_hi !== undefined ? { foodItemNameHi: row.food_item_name_hi } : {}),
    ...(row.food_item_unit !== undefined ? { foodItemUnit: row.food_item_unit } : {}),
    ...(row.food_item_image_path !== undefined
      ? { foodItemImagePath: row.food_item_image_path }
      : {}),
    ...(row.food_item_base_price !== undefined
      ? { foodItemBasePrice: row.food_item_base_price === null ? null : Number(row.food_item_base_price) }
      : {}),
    ...(row.variant_count !== undefined ? { variantCount: Number(row.variant_count) } : {}),
    ...syncMeta(row),
  };
}

export function mapMenuItemVariant(row: MenuItemVariantRow): MenuItemVariantDto {
  return {
    id: row.id,
    foodItemId: row.food_item_id,
    variantCode: row.variant_code,
    name: row.name,
    nameHi: row.name_hi,
    description: row.description,
    descriptionHi: row.description_hi,
    portionName: row.portion_name,
    portionNameHi: row.portion_name_hi,
    quantity: row.quantity === null ? null : Number(row.quantity),
    unit: row.unit,
    price: Number(row.price),
    taxProfileId: row.tax_profile_id,
    status: row.status,
    availability: row.availability,
    sortOrder: Number(row.sort_order),
    preparationMethod: row.preparation_method,
    preparationMethodHi: row.preparation_method_hi,
    preparationTimeMinutes:
      row.preparation_time_minutes === null ? null : Number(row.preparation_time_minutes),
    isDefault: row.is_default === 1,
    allowDecimalQuantity: row.allow_decimal_quantity === 1,
    createdBy: row.created_by,
    ...syncMeta(row),
  };
}

export function mapMediaAsset(row: MediaAssetRow, userId: string): MediaAssetDto {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileExtension: row.file_extension,
    sizeBytes: Number(row.size_bytes),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    mediaType: row.media_type,
    title: row.title,
    altText: row.alt_text,
    status: row.status,
    createdBy: row.created_by,
    url: signMenuMediaUrl(row.id, userId),
    ...syncMeta(row),
  };
}

export function mapMediaAssignment(row: MediaAssignmentRow): MediaAssignmentDto {
  return {
    id: row.id,
    mediaId: row.media_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    role: row.role,
    isPrimary: row.is_primary === 1,
    sortOrder: Number(row.sort_order),
    status: row.status,
    createdBy: row.created_by,
    ...syncMeta(row),
  };
}

export function mapCounter(row: CounterRow): CounterDto {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    status: row.status,
    sortOrder: Number(row.sort_order),
    createdBy: row.created_by,
    ...syncMeta(row),
  };
}

export function mapCounterRoute(row: CounterRouteRow): CounterRouteDto {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    counterId: row.counter_id,
    status: row.status,
    createdBy: row.created_by,
    ...(row.counter_name !== undefined ? { counterName: row.counter_name } : {}),
    ...syncMeta(row),
  };
}

export function mapPrintingGroup(row: PrintingGroupRow): PrintingGroupDto {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    status: row.status,
    sortOrder: Number(row.sort_order),
    createdBy: row.created_by,
    ...syncMeta(row),
  };
}

export function mapPrintingRoute(row: PrintingRouteRow): PrintingRouteDto {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    printingGroupId: row.printing_group_id,
    sortOrder: Number(row.sort_order),
    status: row.status,
    createdBy: row.created_by,
    ...(row.printing_group_name !== undefined
      ? { printingGroupName: row.printing_group_name }
      : {}),
    ...syncMeta(row),
  };
}

export function mapModifierGroup(row: ModifierGroupRow): ModifierGroupDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    selectionType: row.selection_type,
    minSelect: Number(row.min_select),
    maxSelect: row.max_select === null ? null : Number(row.max_select),
    status: row.status,
    sortOrder: Number(row.sort_order),
    createdBy: row.created_by,
    ...syncMeta(row),
  };
}

export function mapModifier(row: ModifierRow): ModifierDto {
  return {
    id: row.id,
    modifierGroupId: row.modifier_group_id,
    name: row.name,
    nameHi: row.name_hi,
    priceDelta: Number(row.price_delta),
    status: row.status,
    sortOrder: Number(row.sort_order),
    createdBy: row.created_by,
    ...syncMeta(row),
  };
}

export function mapModifierAssignment(row: ModifierAssignmentRow): ModifierAssignmentDto {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    modifierGroupId: row.modifier_group_id,
    isRequired: row.is_required === 1,
    sortOrder: Number(row.sort_order),
    status: row.status,
    createdBy: row.created_by,
    ...(row.modifier_group_name !== undefined
      ? { modifierGroupName: row.modifier_group_name }
      : {}),
    ...syncMeta(row),
  };
}

export function mapMenuSchedule(row: MenuScheduleRow): MenuScheduleDto {
  return {
    id: row.id,
    menuId: row.menu_id,
    dayOfWeek: row.day_of_week === null ? null : Number(row.day_of_week),
    startTime: fromDbTime(row.start_time) as string,
    endTime: fromDbTime(row.end_time) as string,
    status: row.status,
    createdBy: row.created_by,
    ...syncMeta(row),
  };
}

export function mapItemGroup(row: ItemGroupRow): ItemGroupDto {
  return {
    id: row.id,
    catalogueId: row.catalogue_id,
    ...(row.catalogue_name !== undefined ? { catalogueName: row.catalogue_name } : {}),
    name: row.name,
    code: row.code,
    description: row.description,
    status: row.status,
    sortOrder: Number(row.sort_order),
    createdBy: row.created_by,
    ...syncMeta(row),
  };
}

export function mapMenuItemSchedule(row: MenuItemScheduleRow): MenuItemScheduleDto {
  return {
    id: row.id,
    foodItemId: row.food_item_id,
    dayOfWeek: Number(row.day_of_week),
    shift: row.shift,
    isAvailable: row.is_available === 1,
    createdBy: row.created_by,
    ...syncMeta(row),
  };
}

export function mapVariantCatalogPrice(
  row: MenuItemVariantCatalogPriceRow,
): MenuItemVariantCatalogPriceDto {
  return {
    id: row.id,
    variantId: row.variant_id,
    menuId: row.menu_id,
    price: Number(row.price),
    status: row.status,
    createdBy: row.created_by,
    ...(row.menu_name !== undefined ? { menuName: row.menu_name } : {}),
    ...(row.menu_code !== undefined ? { menuCode: row.menu_code } : {}),
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
    menuId: row.menu_id,
    variantId: row.variant_id,
    variantName: row.variant_name,
    unitPrice: row.unit_price === null ? null : Number(row.unit_price),
    taxAmount: Number(row.tax_amount),
    discountAmount: Number(row.discount_amount),
    lineTotal: row.line_total === null ? null : Number(row.line_total),
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

/* ------------------------------------------------------------------ tasks */

export function mapTask(row: TaskRow): TaskDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    kind: row.kind,
    source: row.source,
    status: row.status,
    priority: row.priority,
    assignedTo: row.assigned_to,
    assignedBy: row.assigned_by,
    orderId: row.order_id,
    boardId: row.board_id,
    dueAt: fromDbDateTime(row.due_at),
    estimatedMinutes: row.estimated_minutes === null ? null : Number(row.estimated_minutes),
    startedAt: fromDbDateTime(row.started_at),
    completedAt: fromDbDateTime(row.completed_at),
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    ...(row.assigned_to_name !== undefined ? { assignedToName: row.assigned_to_name } : {}),
    ...(row.assigned_by_name !== undefined ? { assignedByName: row.assigned_by_name } : {}),
    ...(row.order_number !== undefined ? { orderNumber: row.order_number } : {}),
    ...(row.board_name !== undefined ? { boardName: row.board_name } : {}),
  };
}

/** "Alex Rivera" -> "AR". Computed here so the phone and the portal never disagree. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

export function mapTeamActivity(row: TeamActivityRow): TeamMemberActivityDto {
  const startedAt = fromDbDateTime(row.started_at);
  const estimate = row.estimated_minutes === null ? null : Number(row.estimated_minutes);

  // Remaining time is derived, never stored: an estimate that silently went stale would be
  // worse than no estimate at all. A task past its estimate reports 0, not a negative.
  const freeInMinutes =
    startedAt !== null && estimate !== null
      ? Math.max(0, Math.round((Date.parse(startedAt) + estimate * 60_000 - Date.now()) / 60_000))
      : null;

  const status: TeamMemberActivityDto['status'] =
    row.task_id === null ? 'FREE' : row.task_kind === 'OFF_TIME' ? 'OFF' : 'WORKING';

  return {
    userId: row.user_id,
    name: row.name,
    initials: initialsOf(row.name),
    status,
    currentTaskId: row.task_id,
    currentTaskTitle: row.task_title,
    currentTaskPriority: row.task_priority,
    startedAt,
    freeInMinutes,
    dueAt: fromDbDateTime(row.due_at),
    lastTaskTitle: row.last_task_title,
    lastActiveAt: fromDbDateTime(row.last_active_at),
  };
}

/* ------------------------------------------------------------- GST / tax */

export function mapHsnSacCode(row: HsnSacCodeRow): HsnSacCodeDto {
  return {
    id: row.id,
    code: row.code,
    codeType: row.code_type,
    description: row.description,
    chapter: row.chapter,
    heading: row.heading,
    subHeading: row.sub_heading,
    isActive: row.is_active === 1,
    source: row.source,
    sourceVersion: row.source_version,
    lastSyncedAt: fromDbDateTimeRequired(row.last_synced_at),
    deactivatedAt: fromDbDateTime(row.deactivated_at),
  };
}

export function mapGstSyncRun(row: GstSyncRunRow): GstSyncRunDto {
  const startedAt = fromDbDateTimeRequired(row.started_at);
  const completedAt = fromDbDateTime(row.completed_at);
  return {
    id: row.id,
    startedAt,
    completedAt,
    startedBy: row.started_by,
    ...(row.started_by_name !== undefined ? { startedByName: row.started_by_name } : {}),
    source: row.source,
    sourceUrl: row.source_url,
    sourceVersion: row.source_version,
    sourceChecksum: row.source_checksum,
    recordsDownloaded: Number(row.records_downloaded),
    recordsAdded: Number(row.records_added),
    recordsUpdated: Number(row.records_updated),
    recordsDeactivated: Number(row.records_deactivated),
    recordsUnchanged: Number(row.records_unchanged),
    recordsFailed: Number(row.records_failed),
    status: row.status,
    errorDetails: row.error_details,
    durationMs:
      completedAt === null ? null : Date.parse(completedAt) - Date.parse(startedAt),
  };
}

export function mapTaxProfile(row: TaxProfileRow): TaxProfileDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    hsnSacId: row.hsn_sac_id,
    supplyType: row.supply_type,
    gstTaxability: row.gst_taxability,
    gstRate: Number(row.gst_rate),
    cgstRate: Number(row.cgst_rate),
    sgstRate: Number(row.sgst_rate),
    igstRate: Number(row.igst_rate),
    cessRate: Number(row.cess_rate),
    priceIsInclusive: row.price_is_inclusive === 1,
    itcEligibility: row.itc_eligibility,
    effectiveFrom: fromDbDate(row.effective_from),
    effectiveTo: fromDbDate(row.effective_to),
    exemptionReason: row.exemption_reason,
    regulatoryNotes: row.regulatory_notes,
    status: row.status,
    sortOrder: Number(row.sort_order),
    createdBy: row.created_by,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    ...(row.hsn_sac_code !== undefined ? { hsnSacCode: row.hsn_sac_code } : {}),
    ...(row.hsn_sac_code_type !== undefined ? { hsnSacCodeType: row.hsn_sac_code_type } : {}),
    ...(row.hsn_sac_description !== undefined
      ? { hsnSacDescription: row.hsn_sac_description }
      : {}),
    ...(row.food_item_count !== undefined ? { foodItemCount: Number(row.food_item_count) } : {}),
  };
}

/* -------------------------------------------------- entities and point of sale */

export function mapEntity(row: EntityRow): EntityDto {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    name: row.name,
    nameHi: row.name_hi,
    phone: row.phone,
    email: row.email,
    address: row.address,
    city: row.city,
    stateCode: row.state_code,
    gstin: row.gstin,
    pan: row.pan,
    department: row.department,
    designation: row.designation,
    linkedUserId: row.linked_user_id,
    discountPercent: Number(row.discount_percent),
    creditLimit: Number(row.credit_limit),
    accountBalance: Number(row.account_balance),
    notes: row.notes,
    status: row.status,
    sortOrder: Number(row.sort_order),
    createdBy: row.created_by,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    ...(row.linked_user_name !== undefined ? { linkedUserName: row.linked_user_name } : {}),
    ...(row.pos_order_count !== undefined ? { posOrderCount: Number(row.pos_order_count) } : {}),
  };
}

export function mapPosOrder(row: PosOrderRow): PosOrderDto {
  return {
    id: row.id,
    orderNumber: row.order_number,
    dailySequence: Number(row.daily_sequence),
    businessDate: fromDbDate(row.business_date) as string,
    orderType: row.order_type,
    status: row.status,
    paymentStatus: row.payment_status,
    stationId: row.station_id,
    counterId: row.counter_id,
    menuId: row.menu_id,
    entityId: row.entity_id,
    entityType: row.entity_type,
    entityName: row.entity_name,
    entityPhone: row.entity_phone,
    entityAddress: row.entity_address,
    tableLabel: row.table_label,
    pax: Number(row.pax),
    scheduledFor: fromDbDateTime(row.scheduled_for),
    notes: row.notes,
    subtotalAmount: Number(row.subtotal_amount),
    discountAmount: Number(row.discount_amount),
    taxAmount: Number(row.tax_amount),
    roundOffAmount: Number(row.round_off_amount),
    totalAmount: Number(row.total_amount),
    paidAmount: Number(row.paid_amount),
    balanceAmount: Number(row.balance_amount),
    placedAt: fromDbDateTime(row.placed_at),
    completedAt: fromDbDateTime(row.completed_at),
    cancelledAt: fromDbDateTime(row.cancelled_at),
    cancelReason: row.cancel_reason,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    revision: Number(row.revision),
    ...(row.station_name !== undefined ? { stationName: row.station_name } : {}),
    ...(row.counter_name !== undefined ? { counterName: row.counter_name } : {}),
    ...(row.created_by_name !== undefined ? { createdByName: row.created_by_name } : {}),
    ...(row.item_count !== undefined ? { itemCount: Number(row.item_count) } : {}),
  };
}

export function mapPosOrderItem(row: PosOrderItemRow): PosOrderItemDto {
  return {
    id: row.id,
    posOrderId: row.pos_order_id,
    menuItemId: row.menu_item_id,
    variantId: row.variant_id,
    customItemName: row.custom_item_name,
    itemName: row.item_name,
    variantName: row.variant_name,
    quantity: Number(row.quantity),
    unit: row.unit,
    unitPrice: Number(row.unit_price),
    grossAmount: Number(row.gross_amount),
    discountType: row.discount_type,
    discountValue: Number(row.discount_value),
    discountAmount: Number(row.discount_amount),
    taxableAmount: Number(row.taxable_amount),
    taxProfileId: row.tax_profile_id,
    taxRate: Number(row.tax_rate),
    cgstAmount: Number(row.cgst_amount),
    sgstAmount: Number(row.sgst_amount),
    igstAmount: Number(row.igst_amount),
    cessAmount: Number(row.cess_amount),
    taxAmount: Number(row.tax_amount),
    lineTotal: Number(row.line_total),
    allowDecimalQuantity: row.allow_decimal_quantity === 1,
    notes: row.notes,
    sortOrder: Number(row.sort_order),
    status: row.status,
    cancelledAt: fromDbDateTime(row.cancelled_at),
    cancelledBy: row.cancelled_by,
    kdsStatus: row.kds_status,
    acknowledgedAt: fromDbDateTime(row.acknowledged_at),
    acknowledgedBy: row.acknowledged_by,
    servedAt: fromDbDateTime(row.served_at),
    servedBy: row.served_by,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

export function mapPosPayment(row: PosPaymentRow): PosPaymentDto {
  return {
    id: row.id,
    posOrderId: row.pos_order_id,
    method: row.method,
    amount: Number(row.amount),
    tenderedAmount: row.tendered_amount === null ? null : Number(row.tendered_amount),
    changeAmount: Number(row.change_amount),
    reference: row.reference,
    notes: row.notes,
    entityId: row.entity_id,
    isReversal: row.is_reversal === 1,
    receivedBy: row.received_by,
    receivedAt: fromDbDateTimeRequired(row.received_at),
  };
}

/* ------------------------------------------- purchase & inventory masters (004) */

export function mapUom(row: UomRow): UomDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    dimension: row.dimension,
    isBase: row.is_base === 1,
    factorToBase: Number(row.factor_to_base),
    decimalPlaces: Number(row.decimal_places),
    status: row.status,
    sortOrder: Number(row.sort_order),
    createdBy: row.created_by,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

export function mapInventoryLocation(row: InventoryLocationRow): InventoryLocationDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameHi: row.name_hi,
    kind: row.kind,
    parentId: row.parent_id,
    counterId: row.counter_id,
    stationId: row.station_id,
    department: row.department,
    isDefaultReceiving: row.is_default_receiving === 1,
    allowsNegativeStock: row.allows_negative_stock === 1,
    status: row.status,
    sortOrder: Number(row.sort_order),
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    deletedAt: fromDbDateTime(row.deleted_at),
    revision: Number(row.revision),
    ...(row.parent_name !== undefined ? { parentName: row.parent_name } : {}),
  };
}

export function mapProduct(row: ProductRow): ProductDto {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    nameHi: row.name_hi,
    unit: row.unit,
    status: row.status,
    sortOrder: Number(row.sort_order),
    createdBy: row.created_by,

    code: row.code,
    barcode: row.barcode,
    brand: row.brand,
    description: row.description,
    kind: row.kind,

    hsnSacId: row.hsn_sac_id,
    taxProfileId: row.tax_profile_id,

    stockUomId: row.stock_uom_id,
    purchaseUomId: row.purchase_uom_id,
    purchaseConversionFactor: Number(row.purchase_conversion_factor),
    packSize: row.pack_size,

    isBatchTracked: row.is_batch_tracked === 1,
    isExpiryTracked: row.is_expiry_tracked === 1,
    shelfLifeDays: row.shelf_life_days === null ? null : Number(row.shelf_life_days),
    batchIssuePolicy: row.batch_issue_policy,

    valuationMethod: row.valuation_method,
    standardCost: row.standard_cost === null ? null : Number(row.standard_cost),
    movingAverageCost: Number(row.moving_average_cost),
    lastPurchaseRate: row.last_purchase_rate === null ? null : Number(row.last_purchase_rate),
    lastPurchasedAt: fromDbDateTime(row.last_purchased_at),

    defaultLocationId: row.default_location_id,
    preferredSupplierId: row.preferred_supplier_id,
    minStock: row.min_stock === null ? null : Number(row.min_stock),
    reorderLevel: row.reorder_level === null ? null : Number(row.reorder_level),
    maxStock: row.max_stock === null ? null : Number(row.max_stock),
    leadTimeDays: row.lead_time_days === null ? null : Number(row.lead_time_days),
    isPurchasable: row.is_purchasable === 1,
    isStocked: row.is_stocked === 1,

    ...(row.category_name !== undefined ? { categoryName: row.category_name } : {}),
    ...(row.stock_uom_code !== undefined ? { stockUomCode: row.stock_uom_code } : {}),
    ...(row.purchase_uom_code !== undefined ? { purchaseUomCode: row.purchase_uom_code } : {}),
    ...(row.tax_profile_name !== undefined ? { taxProfileName: row.tax_profile_name } : {}),
    ...(row.tax_rate !== undefined
      ? { taxRate: row.tax_rate === null ? null : Number(row.tax_rate) }
      : {}),
    ...(row.hsn_sac_code !== undefined ? { hsnSacCode: row.hsn_sac_code } : {}),
    ...(row.hsn_sac_code_type !== undefined ? { hsnSacCodeType: row.hsn_sac_code_type } : {}),
    ...(row.default_location_name !== undefined
      ? { defaultLocationName: row.default_location_name }
      : {}),
    ...(row.preferred_supplier_name !== undefined
      ? { preferredSupplierName: row.preferred_supplier_name }
      : {}),
    ...(row.stock_on_hand !== undefined ? { stockOnHand: Number(row.stock_on_hand) } : {}),
    ...syncMeta(row),
  };
}

export function mapProductLocation(row: ProductLocationRow): ProductLocationDto {
  return {
    id: row.id,
    productId: row.product_id,
    locationId: row.location_id,
    minStock: row.min_stock === null ? null : Number(row.min_stock),
    reorderLevel: row.reorder_level === null ? null : Number(row.reorder_level),
    maxStock: row.max_stock === null ? null : Number(row.max_stock),
    isDefaultDestination: row.is_default_destination === 1,
    bin: row.bin,
    status: row.status,
    createdBy: row.created_by,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    ...(row.product_name !== undefined ? { productName: row.product_name } : {}),
    ...(row.location_name !== undefined ? { locationName: row.location_name } : {}),
    ...(row.location_kind !== undefined ? { locationKind: row.location_kind } : {}),
  };
}

export function mapSupplierProduct(row: SupplierProductRow): SupplierProductDto {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    productId: row.product_id,
    supplierSku: row.supplier_sku,
    supplierProductName: row.supplier_product_name,
    barcode: row.barcode,
    purchaseUomId: row.purchase_uom_id,
    conversionFactor: Number(row.conversion_factor),
    packSize: row.pack_size,
    lastRate: row.last_rate === null ? null : Number(row.last_rate),
    lastPurchasedAt: fromDbDateTime(row.last_purchased_at),
    leadTimeDays: row.lead_time_days === null ? null : Number(row.lead_time_days),
    isPreferred: row.is_preferred === 1,
    status: row.status,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    ...(row.supplier_name !== undefined ? { supplierName: row.supplier_name } : {}),
    ...(row.product_name !== undefined ? { productName: row.product_name } : {}),
    ...(row.product_unit !== undefined ? { productUnit: row.product_unit } : {}),
    ...(row.purchase_uom_code !== undefined ? { purchaseUomCode: row.purchase_uom_code } : {}),
  };
}

/**
 * A VENDOR entity as the purchase screens read it.
 *
 * `outstanding` is deliberately absent rather than zero: unpaid invoice value does not exist
 * until the payables slice lands, and a zero would read as "this supplier is settled up".
 */
export function mapVendorSummary(row: VendorRow): VendorSummaryDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    city: row.city,
    stateCode: row.state_code,
    gstin: row.gstin,
    pan: row.pan,
    creditLimit: Number(row.credit_limit),
    accountBalance: Number(row.account_balance),
    status: row.status,
    profile: {
      entityId: row.id,
      paymentTerms: row.vendor_payment_terms,
      creditDays: Number(row.vendor_credit_days),
      bankName: row.vendor_bank_name,
      bankAccount: row.vendor_bank_account,
      bankIfsc: row.vendor_bank_ifsc,
      openingBalance: Number(row.vendor_opening_balance),
      isApproved: row.vendor_is_approved === 1,
      defaultLocationId: row.vendor_default_location_id,
    },
  };
}
