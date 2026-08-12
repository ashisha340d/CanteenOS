import { z } from 'zod';
import {
  AlertSoundSlot,
  AlertType,
  AvailabilityStatus,
  BillingStatus,
  BoardRole,
  BoardStatus,
  Capability,
  ClientType,
  EntityType,
  GstTaxability,
  HsnSacCodeType,
  ItcEligibility,
  LIMITS,
  MasterStatus,
  OrderPriority,
  OrderStatus,
  PosDiscountType,
  PosOrderStatus,
  PosOrderType,
  PosPaymentMethod,
  PosPaymentStatus,
  RecipeDifficulty,
  RecipeIngredientScaling,
  ReportKind,
  ShoppingListStatus,
  SupplyType,
  TaskKind,
  TaskPriority,
  TaskSource,
  TaskStatus,
  UserRole,
  UserStatus,
  YoutubeImportStatus,
} from '@menuboard/shared';
import {
  boardIdParam,
  clockTime,
  enumList,
  idParam,
  idList,
  isoDate,
  isoDateTime,
  optionalText,
  orderIdParam,
  pageQuery,
  sortQuery,
  text,
  uuid,
} from './common';

const enumOf = <T extends Record<string, string>>(source: T) =>
  z.enum(Object.values(source) as [string, ...string[]]);

/* ------------------------------------------------------------------------- auth */

export const loginSchema = z
  .object({
    identifier: text(190, 'Username, phone or email'),
    password: z.string().min(1, 'Password is required').max(LIMITS.PASSWORD_MAX),
    deviceId: text(120, 'Device id'),
    deviceName: optionalText(150),
    clientType: enumOf(ClientType),
    rememberMe: z.boolean().optional(),
  })
  .strict();

export const refreshSchema = z
  .object({ refreshToken: z.string().min(1), deviceId: text(120, 'Device id') })
  .strict();

export const logoutSchema = z
  .object({ refreshToken: z.string().min(1).optional(), allDevices: z.boolean().optional() })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(LIMITS.PASSWORD_MIN).max(LIMITS.PASSWORD_MAX),
  })
  .strict();

export const pushTokenSchema = z
  .object({ deviceId: text(120, 'Device id'), pushToken: text(255, 'Push token') })
  .strict();

/* ----------------------------------------------------------------- fast auth */

export const pinLoginSchema = z
  .object({
    identifier: text(190, 'Username, phone or email'),
    pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
    deviceId: text(120, 'Device id'),
    deviceName: optionalText(150),
    clientType: enumOf(ClientType),
    rememberMe: z.boolean().optional(),
  })
  .strict();

export const pinManageSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
  })
  .strict();

export const passkeyLoginOptionsSchema = z
  .object({
    identifier: text(190, 'Username, phone or email'),
  })
  .strict();

export const passkeyLoginSchema = z
  .object({
    response: z.record(z.unknown()),
    deviceId: text(120, 'Device id'),
    deviceName: optionalText(150),
    clientType: enumOf(ClientType),
    rememberMe: z.boolean().optional(),
  })
  .strict();

export const passkeyRegisterOptionsSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    deviceName: optionalText(150),
  })
  .strict();

export const passkeyRegisterSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    response: z.record(z.unknown()),
    deviceName: optionalText(150),
  })
  .strict();

export const passkeyRemoveSchema = z
  .object({
    credentialId: z.string().min(1, 'Credential id is required'),
    currentPassword: z.string().min(1, 'Current password is required'),
  })
  .strict();

/* ------------------------------------------------------------------------ users */

export const userListQuerySchema = pageQuery
  .merge(sortQuery)
  .extend({
    role: enumOf(UserRole).optional(),
    status: enumOf(UserStatus).optional(),
  })
  .strict();

export const createUserSchema = z
  .object({
    id: uuid.optional(),
    employeeCode: optionalText(50),
    name: text(LIMITS.USER_NAME_MAX, 'Name'),
    // Restricted character set keeps usernames unambiguous in mentions and logs.
    username: z
      .string()
      .trim()
      .min(3)
      .max(LIMITS.USERNAME_MAX)
      .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, digits, dot, underscore or hyphen only'),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9]{7,20}$/, 'Must be a valid phone number')
      .nullable()
      .optional(),
    email: z.string().trim().email().max(190).nullable().optional(),
    password: z.string().min(LIMITS.PASSWORD_MIN).max(LIMITS.PASSWORD_MAX),
    role: enumOf(UserRole),
    status: enumOf(UserStatus).optional(),
  })
  .strict();

export const updateUserSchema = z
  .object({
    employeeCode: optionalText(50),
    name: text(LIMITS.USER_NAME_MAX, 'Name').optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9]{7,20}$/)
      .nullable()
      .optional(),
    email: z.string().trim().email().max(190).nullable().optional(),
    role: enumOf(UserRole).optional(),
    status: enumOf(UserStatus).optional(),
    password: z.string().min(LIMITS.PASSWORD_MIN).max(LIMITS.PASSWORD_MAX).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

/* ----------------------------------------------------------------------- boards */

export const boardListQuerySchema = pageQuery
  .merge(sortQuery)
  .extend({
    status: enumOf(BoardStatus).optional(),
    stationId: uuid.optional(),
    withCounts: z.coerce.boolean().optional(),
  })
  .strict();

const boardColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value like #4F46E5')
  .nullable()
  .optional();

export const createBoardSchema = z
  .object({
    id: uuid.optional(),
    stationId: uuid,
    name: text(LIMITS.BOARD_NAME_MAX, 'Board name'),
    description: optionalText(LIMITS.BOARD_DESCRIPTION_MAX),
    color: boardColor,
    photoPath: optionalText(LIMITS.BOARD_PHOTO_PATH_MAX),
    members: z
      .array(z.object({ userId: uuid, boardRole: enumOf(BoardRole) }).strict())
      .max(200)
      .optional(),
  })
  .strict();

export const updateBoardSchema = z
  .object({
    stationId: uuid.optional(),
    name: text(LIMITS.BOARD_NAME_MAX, 'Board name').optional(),
    description: optionalText(LIMITS.BOARD_DESCRIPTION_MAX),
    color: boardColor,
    photoPath: optionalText(LIMITS.BOARD_PHOTO_PATH_MAX),
    status: enumOf(BoardStatus).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const upsertBoardMemberSchema = z
  .object({ userId: uuid, boardRole: enumOf(BoardRole) })
  .strict();

export const boardMemberParamSchema = boardIdParam.extend({ userId: uuid }).strict();

/* ---------------------------------------------------------------------- masters */

const masterBase = {
  id: uuid.optional(),
  description: optionalText(1000),
  status: enumOf(MasterStatus).optional(),
  sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
};

export const masterListQuerySchema = pageQuery
  .extend({ status: enumOf(MasterStatus).optional() })
  .strict();

export const stationListQuerySchema = masterListQuerySchema;

export const createStationSchema = z
  .object({
    id: uuid.optional(),
    name: text(LIMITS.STATION_NAME_MAX, 'Station name'),
    code: optionalText(LIMITS.STATION_CODE_MAX),
    description: optionalText(LIMITS.STATION_DESCRIPTION_MAX),
    status: enumOf(MasterStatus).optional(),
  })
  .strict();

export const updateStationSchema = createStationSchema
  .omit({ id: true })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const createActivityTypeSchema = z
  .object({
    ...masterBase,
    name: text(LIMITS.ACTIVITY_NAME_MAX, 'Activity name'),
    icon: optionalText(60),
  })
  .strict();

export const updateActivityTypeSchema = createActivityTypeSchema.partial().strict();

export const createMenuCategorySchema = z
  .object({
    ...masterBase,
    name: text(LIMITS.MENU_CATEGORY_NAME_MAX, 'Category name'),
    nameHi: optionalText(LIMITS.MENU_CATEGORY_NAME_MAX),
    imagePath: optionalText(500),
  })
  .strict();

export const updateMenuCategorySchema = createMenuCategorySchema.partial().strict();

export const menuItemListQuerySchema = masterListQuerySchema.extend({
  categoryId: uuid.optional(),
});

export const createMenuItemSchema = z
  .object({
    ...masterBase,
    categoryId: uuid,
    name: text(LIMITS.MENU_ITEM_NAME_MAX, 'Item name'),
    nameHi: optionalText(LIMITS.MENU_ITEM_NAME_MAX),
    unit: text(LIMITS.UNIT_MAX, 'Unit'),
    unitHi: optionalText(LIMITS.UNIT_MAX),
    imagePath: optionalText(500),
    basePrice: z.coerce.number().min(LIMITS.PRICE_MIN).max(LIMITS.PRICE_MAX).nullable().optional(),
    taxProfileId: uuid.nullable().optional(),
    alwaysAvailable: z.boolean().optional(),
  })
  .strict();

export const updateMenuItemSchema = createMenuItemSchema.partial().strict();

/* ------------------------------------------------------------------- menu master */

export const menuListQuerySchema = masterListQuerySchema;

export const createMenuSchema = z
  .object({
    id: uuid.optional(),
    code: text(LIMITS.MENU_CODE_MAX, 'Menu code').regex(
      /^[A-Za-z0-9_-]+$/,
      'Use letters, digits, underscore or hyphen only',
    ),
    name: text(LIMITS.MENU_NAME_MAX, 'Menu name'),
    description: optionalText(LIMITS.MENU_DESCRIPTION_MAX),
    status: enumOf(MasterStatus).optional(),
    sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
    priority: z.coerce.number().int().min(0).max(100_000).optional(),
    effectiveFrom: isoDate.nullable().optional(),
    effectiveUntil: isoDate.nullable().optional(),
  })
  .strict();

export const updateMenuSchema = createMenuSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const menuCategoryAssignmentListQuerySchema = z
  .object({ includeInactive: z.coerce.boolean().optional() })
  .strict();

export const assignMenuCategorySchema = z
  .object({
    id: uuid.optional(),
    categoryId: uuid,
    displayName: optionalText(LIMITS.MENU_DISPLAY_NAME_MAX),
    displayNameHi: optionalText(LIMITS.MENU_DISPLAY_NAME_MAX),
    description: optionalText(LIMITS.MENU_DESCRIPTION_OVERRIDE_MAX),
    descriptionHi: optionalText(LIMITS.MENU_DESCRIPTION_OVERRIDE_MAX),
    status: enumOf(MasterStatus).optional(),
    sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
    posVisible: z.boolean().optional(),
    boardVisible: z.boolean().optional(),
  })
  .strict();

export const updateMenuCategoryAssignmentSchema = assignMenuCategorySchema
  .omit({ categoryId: true, id: true })
  .partial()
  .strict();

export const menuItemAssignmentListQuerySchema = masterListQuerySchema.extend({
  menuId: uuid.optional(),
  categoryAssignmentId: uuid.optional(),
  availability: enumOf(AvailabilityStatus).optional(),
});

export const assignMenuItemSchema = z
  .object({
    id: uuid.optional(),
    foodItemId: uuid,
    categoryAssignmentId: uuid.nullable().optional(),
    displayName: optionalText(LIMITS.MENU_DISPLAY_NAME_MAX),
    displayNameHi: optionalText(LIMITS.MENU_DISPLAY_NAME_MAX),
    description: optionalText(LIMITS.MENU_DESCRIPTION_OVERRIDE_MAX),
    descriptionHi: optionalText(LIMITS.MENU_DESCRIPTION_OVERRIDE_MAX),
    preparationMethod: optionalText(LIMITS.PREPARATION_METHOD_MAX),
    preparationMethodHi: optionalText(LIMITS.PREPARATION_METHOD_MAX),
    preparationTimeMinutes: z.coerce.number().int().min(0).max(1440).nullable().optional(),
    unit: optionalText(LIMITS.UNIT_MAX),
    status: enumOf(MasterStatus).optional(),
    availability: enumOf(AvailabilityStatus).optional(),
    sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
    posVisible: z.boolean().optional(),
    boardVisible: z.boolean().optional(),
    qrVisible: z.boolean().optional(),
    webVisible: z.boolean().optional(),
    appVisible: z.boolean().optional(),
    dineInAvailable: z.boolean().optional(),
    takeawayAvailable: z.boolean().optional(),
    deliveryAvailable: z.boolean().optional(),
    allowDecimalQuantity: z.boolean().optional(),
  })
  .strict();

export const updateMenuItemAssignmentSchema = assignMenuItemSchema
  .omit({ foodItemId: true, id: true })
  .partial()
  .strict();

export const createVariantSchema = z
  .object({
    id: uuid.optional(),
    variantCode: optionalText(LIMITS.VARIANT_CODE_MAX),
    name: text(LIMITS.VARIANT_NAME_MAX, 'Variant name'),
    nameHi: optionalText(LIMITS.VARIANT_NAME_MAX),
    description: optionalText(LIMITS.MENU_DESCRIPTION_OVERRIDE_MAX),
    descriptionHi: optionalText(LIMITS.MENU_DESCRIPTION_OVERRIDE_MAX),
    portionName: optionalText(LIMITS.PORTION_NAME_MAX),
    portionNameHi: optionalText(LIMITS.PORTION_NAME_MAX),
    quantity: z.coerce.number().min(0).nullable().optional(),
    unit: optionalText(LIMITS.UNIT_MAX),
    price: z.coerce.number().min(LIMITS.PRICE_MIN).max(LIMITS.PRICE_MAX),
    /** Null/absent means inherit the food item's profile; a value is an explicit override. */
    taxProfileId: uuid.nullable().optional(),
    status: enumOf(MasterStatus).optional(),
    availability: enumOf(AvailabilityStatus).optional(),
    sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
    preparationMethod: optionalText(LIMITS.PREPARATION_METHOD_MAX),
    preparationMethodHi: optionalText(LIMITS.PREPARATION_METHOD_MAX),
    preparationTimeMinutes: z.coerce.number().int().min(0).max(1440).nullable().optional(),
    isDefault: z.boolean().optional(),
    allowDecimalQuantity: z.boolean().optional(),
  })
  .strict();

export const updateVariantSchema = createVariantSchema
  .omit({ id: true })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const createCounterSchema = z
  .object({
    ...masterBase,
    name: text(LIMITS.COUNTER_NAME_MAX, 'Counter name'),
    code: optionalText(60),
  })
  .strict();

export const updateCounterSchema = createCounterSchema.partial().strict();

export const createItemGroupSchema = z
  .object({
    ...masterBase,
    name: text(LIMITS.COUNTER_NAME_MAX, 'Item group name'),
    code: optionalText(60),
  })
  .strict();

export const updateItemGroupSchema = createItemGroupSchema.partial().strict();

export const assignItemGroupSchema = z
  .object({
    foodItemId: uuid,
    groupId: uuid,
    status: enumOf(MasterStatus).optional(),
  })
  .strict();

export const menuItemScheduleBulkSchema = z
  .object({
    alwaysAvailable: z.boolean(),
    slots: z.array(
      z
        .object({
          dayOfWeek: z.coerce.number().int().min(0).max(6),
          shift: z.enum(['MORNING', 'EVENING']),
          isAvailable: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

export const variantCatalogPriceSchema = z
  .object({
    menuId: uuid,
    price: z.coerce.number().min(LIMITS.PRICE_MIN).max(LIMITS.PRICE_MAX).nullable(),
  })
  .strict();

export const createPrintingGroupSchema = z
  .object({
    ...masterBase,
    name: text(LIMITS.PRINTING_GROUP_NAME_MAX, 'Printing group name'),
    code: optionalText(60),
  })
  .strict();

export const updatePrintingGroupSchema = createPrintingGroupSchema.partial().strict();

export const routableEntityRefSchema = z
  .object({
    entityType: z.enum(['MENU_ITEM_ASSIGNMENT', 'MENU_ITEM_VARIANT', 'MENU_ITEM']),
    entityId: uuid,
  })
  .strict();

export const assignCounterRouteSchema = routableEntityRefSchema.extend({
  counterId: uuid,
  status: enumOf(MasterStatus).optional(),
});

export const assignPrintingRouteSchema = routableEntityRefSchema.extend({
  printingGroupId: uuid,
  sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
  status: enumOf(MasterStatus).optional(),
});

export const createModifierGroupSchema = z
  .object({
    ...masterBase,
    name: text(LIMITS.MODIFIER_GROUP_NAME_MAX, 'Modifier group name'),
    selectionType: z.enum(['SINGLE', 'MULTIPLE']).optional(),
    minSelect: z.coerce.number().int().min(0).max(50).optional(),
    maxSelect: z.coerce.number().int().min(0).max(50).nullable().optional(),
  })
  .strict();

export const updateModifierGroupSchema = createModifierGroupSchema.partial().strict();

export const createModifierSchema = z
  .object({
    id: uuid.optional(),
    name: text(LIMITS.MODIFIER_NAME_MAX, 'Modifier name'),
    nameHi: optionalText(LIMITS.MODIFIER_NAME_MAX),
    priceDelta: z.coerce.number().min(-LIMITS.PRICE_MAX).max(LIMITS.PRICE_MAX).optional(),
    status: enumOf(MasterStatus).optional(),
    sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
  })
  .strict();

export const updateModifierSchema = createModifierSchema.omit({ id: true }).partial().strict();

export const assignModifierGroupSchema = routableEntityRefSchema.extend({
  modifierGroupId: uuid,
  isRequired: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
  status: enumOf(MasterStatus).optional(),
});

export const createScheduleSchema = z
  .object({
    id: uuid.optional(),
    dayOfWeek: z.coerce.number().int().min(0).max(6).nullable().optional(),
    startTime: clockTime,
    endTime: clockTime,
    status: enumOf(MasterStatus).optional(),
  })
  .strict();

export const updateScheduleSchema = createScheduleSchema.omit({ id: true }).partial().strict();

export const menuCodeParam = z.object({ code: text(LIMITS.MENU_CODE_MAX, 'Menu code') }).strict();

/* --------------------------------------------------------------------- media library */

export const mediaListQuerySchema = pageQuery.extend({
  unassignedOnly: z.coerce.boolean().optional(),
});

export const updateMediaAssetSchema = z
  .object({
    title: optionalText(LIMITS.MEDIA_TITLE_MAX),
    altText: optionalText(LIMITS.MEDIA_ALT_TEXT_MAX),
    status: enumOf(MasterStatus).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const assignMediaSchema = z
  .object({
    mediaId: uuid,
    entityType: z.enum([
      'MENU',
      'MENU_CATEGORY_ASSIGNMENT',
      'MENU_ITEM_ASSIGNMENT',
      'MENU_ITEM_VARIANT',
      'MENU_ITEM',
      'COUNTER',
      'PRINTING_GROUP',
      'RECIPE',
    ]),
    entityId: uuid,
    role: z.enum(['PRIMARY', 'GALLERY', 'BANNER', 'THUMBNAIL', 'COVER']).optional(),
    isPrimary: z.boolean().optional(),
    sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
  })
  .strict();

export const mediaEntityQuerySchema = z
  .object({
    entityType: z.enum([
      'MENU',
      'MENU_CATEGORY_ASSIGNMENT',
      'MENU_ITEM_ASSIGNMENT',
      'MENU_ITEM_VARIANT',
      'MENU_ITEM',
      'COUNTER',
      'PRINTING_GROUP',
      'RECIPE',
    ]),
    entityId: uuid,
  })
  .strict();

export const reorderMediaSchema = z.object({ sortOrder: z.coerce.number().int().min(0) }).strict();

/** Same shape as `attachmentFileQuerySchema` below — signed download URL query string. */
export const mediaFileQuerySchema = z
  .object({ expires: z.string(), uid: uuid, sig: z.string() })
  .strict();

/* ----------------------------------------------------------------------- orders */

/**
 * Mirrors the `ck_order_items_dish` database constraint: a line names its dish either by
 * pointing at a catalogued `menu_items` row or by carrying free text typed on the spot,
 * never both and never neither.
 */
function refineDishNaming<T extends { menuItemId?: unknown; customItemName?: unknown }>(
  value: T,
  ctx: z.RefinementCtx,
): void {
  const hasMenuItem = typeof value.menuItemId === 'string' && value.menuItemId !== '';
  const hasCustomName =
    typeof value.customItemName === 'string' && value.customItemName.trim() !== '';
  if (hasMenuItem === hasCustomName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['menuItemId'],
      message: hasMenuItem
        ? 'Provide either a menu item or a custom item name, not both'
        : 'Choose a menu item or type a custom item name',
    });
  }
}

const orderItemSchema = z
  .object({
    id: uuid.optional(),
    menuItemId: uuid.nullable().optional(),
    customItemName: optionalText(LIMITS.CUSTOM_ITEM_NAME_MAX),
    quantity: z.coerce
      .number()
      .min(LIMITS.QUANTITY_MIN)
      .max(LIMITS.QUANTITY_MAX)
      // DECIMAL(12,3) — anything finer would be silently rounded by the database.
      .refine((value) => Number.isInteger(value * 1000), 'At most 3 decimal places'),
    unit: text(LIMITS.UNIT_MAX, 'Unit').optional(),
    notes: optionalText(LIMITS.ORDER_ITEM_NOTES_MAX),
    mentionedUserIds: idList.optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
    // Menu Master reference, optional — see CreateOrderItemRequest in shared.
    menuId: uuid.nullable().optional(),
    variantId: uuid.nullable().optional(),
    discountAmount: z.coerce.number().min(0).max(LIMITS.PRICE_MAX).optional(),
  })
  .strict()
  .superRefine(refineDishNaming);

export const orderListQuerySchema = pageQuery
  .extend({
    boardId: uuid.optional(),
    status: enumList(Object.values(OrderStatus) as [string, ...string[]]),
    priority: enumList(Object.values(OrderPriority) as [string, ...string[]]),
    activityTypeId: uuid.optional(),
    createdBy: uuid.optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
  })
  .strict();

export const createOrderSchema = z
  .object({
    id: uuid.optional(),
    orderNumber: z
      .string()
      .trim()
      .regex(/^ORD-\d{8}-[0-9A-HJKMNP-TV-Z]{6}$/, 'Expected the format ORD-YYYYMMDD-XXXXXX')
      .optional(),
    boardId: uuid,
    activityTypeId: uuid.nullable().optional(),
    customActivity: optionalText(LIMITS.CUSTOM_ACTIVITY_MAX),
    venue: text(LIMITS.VENUE_MAX, 'Venue'),
    pax: z.coerce.number().int().min(LIMITS.PAX_MIN).max(LIMITS.PAX_MAX),
    requiredDate: isoDate,
    requiredTime: clockTime,
    priority: enumOf(OrderPriority).optional(),
    items: z.array(orderItemSchema).min(1).max(LIMITS.ORDER_ITEMS_PER_ORDER_MAX),
    attachmentIds: z.array(uuid).max(LIMITS.ATTACHMENTS_PER_OWNER_MAX).optional(),
  })
  .strict()
  // Mirrors the ck_orders_activity_present database constraint with a usable message.
  .refine(
    (value) =>
      (value.activityTypeId !== null && value.activityTypeId !== undefined) ||
      (typeof value.customActivity === 'string' && value.customActivity.trim() !== ''),
    { message: 'Select an activity type or enter a custom activity', path: ['activityTypeId'] },
  );

export const updateOrderSchema = z
  .object({
    activityTypeId: uuid.nullable().optional(),
    customActivity: optionalText(LIMITS.CUSTOM_ACTIVITY_MAX),
    venue: text(LIMITS.VENUE_MAX, 'Venue').optional(),
    pax: z.coerce.number().int().min(LIMITS.PAX_MIN).max(LIMITS.PAX_MAX).optional(),
    requiredDate: isoDate.optional(),
    requiredTime: clockTime.optional(),
    priority: enumOf(OrderPriority).optional(),
    items: z.array(orderItemSchema).min(1).max(LIMITS.ORDER_ITEMS_PER_ORDER_MAX).optional(),
    expectedRevision: z.coerce.number().int().min(1).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== 'expectedRevision'),
    'Provide at least one field to update',
  );

/** Null clears the assignment, returning the order to the pool. */
export const assignOrderSchema = z
  .object({ assignedTo: uuid.nullable() })
  .strict();

export const updateOrderStatusSchema = z
  .object({ status: enumOf(OrderStatus), note: optionalText(1000) })
  .strict();

const quantity = z.coerce.number().min(LIMITS.QUANTITY_MIN).max(LIMITS.QUANTITY_MAX);

export const updateOrderQuantitiesSchema = z
  .object({
    pax: z.coerce.number().int().min(LIMITS.PAX_MIN).max(LIMITS.PAX_MAX).optional(),
    items: z
      .array(z.object({ itemId: uuid, quantity }).strict())
      .max(LIMITS.ORDER_ITEMS_PER_ORDER_MAX)
      .optional(),
    cancelItemIds: z.array(uuid).max(LIMITS.ORDER_ITEMS_PER_ORDER_MAX).optional(),
    replaceItems: z
      .array(
        z
          .object({
            itemId: uuid,
            menuItemId: uuid.nullable().optional(),
            customItemName: optionalText(LIMITS.CUSTOM_ITEM_NAME_MAX),
            quantity,
            unit: z.string().trim().max(LIMITS.UNIT_MAX).optional(),
            notes: optionalText(LIMITS.ORDER_ITEM_NOTES_MAX),
          })
          .strict()
          .superRefine(refineDishNaming),
      )
      .max(LIMITS.ORDER_ITEMS_PER_ORDER_MAX)
      .optional(),
    addItems: z.array(orderItemSchema).max(LIMITS.ORDER_ITEMS_PER_ORDER_MAX).optional(),
    note: optionalText(1000),
    expectedRevision: z.coerce.number().int().min(1).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.pax !== undefined ||
      (value.items?.length ?? 0) > 0 ||
      (value.cancelItemIds?.length ?? 0) > 0 ||
      (value.replaceItems?.length ?? 0) > 0 ||
      (value.addItems?.length ?? 0) > 0,
    'Provide at least one quantity, pax, cancellation, replacement or addition',
  );

/* ------------------------------------------------------------------- ingredients */

export const ingredientCategoryListQuerySchema = pageQuery
  .extend({ search: optionalText(120), status: enumOf(MasterStatus).optional() })
  .strict();

export const createIngredientCategorySchema = z
  .object({
    id: uuid.optional(),
    name: text(LIMITS.INGREDIENT_CATEGORY_NAME_MAX, 'Name'),
    nameHi: optionalText(150),
    status: enumOf(MasterStatus).optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export const updateIngredientCategorySchema = createIngredientCategorySchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const ingredientListQuerySchema = pageQuery
  .extend({
    search: optionalText(150),
    status: enumOf(MasterStatus).optional(),
    categoryId: uuid.optional(),
  })
  .strict();

export const createIngredientSchema = z
  .object({
    id: uuid.optional(),
    categoryId: uuid.nullable().optional(),
    name: text(LIMITS.INGREDIENT_NAME_MAX, 'Name'),
    nameHi: optionalText(180),
    unit: text(LIMITS.UNIT_MAX, 'Unit'),
    status: enumOf(MasterStatus).optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export const updateIngredientSchema = createIngredientSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const translateTextSchema = z
  .object({ text: text(4000, 'Text'), target: optionalText(10) })
  .strict();

export const translateBatchSchema = z
  .object({
    texts: z.array(z.string().max(4000)).min(1).max(LIMITS.RECIPE_STEPS_PER_RECIPE_MAX + 5),
    target: optionalText(10),
  })
  .strict();

/* ---------------------------------------------------------------------- recipes */

const recipeIngredientWriteSchema = z
  .object({
    id: uuid.optional(),
    ingredientId: uuid,
    quantity,
    unit: text(LIMITS.UNIT_MAX, 'Unit'),
    scaling: enumOf(RecipeIngredientScaling).optional(),
    notes: optionalText(500),
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const recipeStepWriteSchema = z
  .object({
    id: uuid.optional(),
    textEn: text(LIMITS.RECIPE_STEP_TEXT_MAX, 'Step text'),
    textHi: optionalText(LIMITS.RECIPE_STEP_TEXT_MAX),
    durationMin: z.coerce.number().int().min(0).max(1440).nullable().optional(),
    imagePath: optionalText(500),
  })
  .strict();

export const recipeWriteSchema = z
  .object({
    id: uuid.optional(),
    menuItemId: uuid,
    basePax: z.coerce.number().int().min(1).max(LIMITS.PAX_MAX),
    isDefault: z.boolean().optional(),
    prepTimeMin: z.coerce.number().int().min(0).max(1440).nullable().optional(),
    cookTimeMin: z.coerce.number().int().min(0).max(1440).nullable().optional(),
    teamSize: z.coerce.number().int().min(0).max(1000).nullable().optional(),
    difficulty: enumOf(RecipeDifficulty).nullable().optional(),
    descriptionEn: optionalText(LIMITS.RECIPE_DESCRIPTION_MAX),
    descriptionHi: optionalText(LIMITS.RECIPE_DESCRIPTION_MAX),
    methodEn: optionalText(4000),
    methodHi: optionalText(4000),
    yieldNote: optionalText(LIMITS.RECIPE_YIELD_NOTE_MAX),
    chefNotes: optionalText(LIMITS.RECIPE_CHEF_NOTES_MAX),
    status: enumOf(MasterStatus).optional(),
    ingredients: z.array(recipeIngredientWriteSchema).min(1).max(LIMITS.RECIPE_INGREDIENTS_PER_RECIPE_MAX),
    steps: z.array(recipeStepWriteSchema).max(LIMITS.RECIPE_STEPS_PER_RECIPE_MAX).optional(),
  })
  .strict();

export const recipeListQuerySchema = z
  .object({
    menuItemId: uuid.optional(),
    status: enumOf(MasterStatus).optional(),
    q: optionalText(150),
  })
  .strict();

export const menuItemIdParam = z.object({ menuItemId: uuid }).strict();

export const scaledRecipeQuerySchema = z
  .object({ pax: z.coerce.number().int().min(1).max(LIMITS.PAX_MAX) })
  .strict();

export const recipeImportParseSchema = z
  .object({ rawText: text(20_000, 'Recipe text') })
  .strict();

export const recipeImportAiSchema = z
  .object({
    rawText: text(20_000, 'Recipe text'),
    draft: z.record(z.unknown()),
    unresolved: z.array(z.record(z.unknown())).optional(),
  })
  .strict();

/* --------------------------------------------------------------- shopping lists */

export const generateShoppingListSchema = z
  .object({
    orderIds: z.array(uuid).min(1).max(100),
    title: optionalText(200).transform((value) => value ?? undefined),
    notes: optionalText(1000),
  })
  .strict();

export const updateShoppingListSchema = z
  .object({
    status: enumOf(ShoppingListStatus).optional(),
    notes: optionalText(1000),
    items: z
      .array(
        z
          .object({
            itemId: uuid,
            purchased: z.boolean().optional(),
            quantity: quantity.optional(),
          })
          .strict(),
      )
      .max(500)
      .optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'Provide a status, notes or item changes',
  );

export const shoppingListIdParam = z.object({ shoppingListId: uuid }).strict();

/* ---------------------------------------------------------------------- alerts */

export const alertTypeParam = z.object({ alertType: enumOf(AlertType) }).strict();
export const alertSoundSlotParam = z.object({ slot: enumOf(AlertSoundSlot) }).strict();

export const updateAlertSettingSchema = z
  .object({
    enabled: z.boolean().optional(),
    // 24 hours of lead is already generous for a prep call; beyond that it is a data error.
    leadMinutes: z.coerce.number().int().min(0).max(1440).optional(),
    sound: enumOf(AlertSoundSlot).optional(),
    repeatUntilAck: z.boolean().optional(),
    repeatEverySeconds: z.coerce.number().int().min(10).max(3600).optional(),
    targetRoles: z.array(enumOf(UserRole)).max(5).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const pendingAlertsQuerySchema = z
  .object({ horizonHours: z.coerce.number().int().min(1).max(168).optional() })
  .strict();

/* ---------------------------------------------------------------------- threads */

export const threadListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(LIMITS.PAGE_SIZE_MAX).optional(),
    /** Keyset cursor: return messages created strictly before this instant. */
    before: isoDateTime.optional(),
  })
  .strict();

export const createThreadMessageSchema = z
  .object({
    id: uuid.optional(),
    /** Attaches the message to an order; omitted posts it as a general board message. */
    orderId: uuid.nullable().optional(),
    parentMessageId: uuid.nullable().optional(),
    body: optionalText(LIMITS.THREAD_BODY_MAX),
    mentionedUserIds: idList.optional(),
    attachmentIds: z.array(uuid).max(LIMITS.ATTACHMENTS_PER_OWNER_MAX).optional(),
  })
  .strict();

export const boardEligibleMembersQuerySchema = z
  .object({ search: optionalText(190) })
  .strict();

export const messageIdParamSchema = z.object({ messageId: uuid }).strict();

/* -------------------------------------------------------------- acknowledgements */

export const createAcknowledgementSchema = z
  .object({ id: uuid.optional(), note: optionalText(1000) })
  .strict();

/* ------------------------------------------------------------------ attachments */

export const uploadQuerySchema = z
  .object({
    attachmentId: uuid.optional(),
    ownerType: z.enum(['ORDER', 'THREAD_MESSAGE']),
    ownerId: uuid.optional(),
    durationMs: z.coerce.number().int().min(0).max(3_600_000).optional(),
    width: z.coerce.number().int().min(1).max(20_000).optional(),
    height: z.coerce.number().int().min(1).max(20_000).optional(),
  })
  .strict();

export const attachmentFileQuerySchema = z
  .object({ expires: z.string(), uid: uuid, sig: z.string() })
  .strict();

export const bindAttachmentsSchema = z
  .object({
    attachmentIds: z.array(uuid).min(1).max(LIMITS.ATTACHMENTS_PER_OWNER_MAX),
    ownerType: z.enum(['ORDER', 'THREAD_MESSAGE']),
    ownerId: uuid,
  })
  .strict();

/* ---------------------------------------------------------------- notifications */

export const notificationListQuerySchema = pageQuery
  .extend({ unreadOnly: z.coerce.boolean().optional() })
  .strict();

export const markReadSchema = z
  .object({ ids: z.array(uuid).min(1).max(500) })
  .strict();

/* ------------------------------------------------------------------------- sync */

const syncPushItemSchema = z
  .object({
    clientOpId: uuid,
    entity: z.enum([
      'boards',
      'orders',
      'order_items',
      'attachments',
      'thread_messages',
      'acknowledgements',
    ]),
    entityId: uuid,
    op: z.enum(['UPSERT', 'DELETE']),
    // Free-form: each entity's payload is validated by its own service on the way in.
    payload: z.record(z.unknown()).nullable(),
    clientTimestamp: isoDateTime,
    baseRevision: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export const syncPushSchema = z
  .object({
    deviceId: text(120, 'Device id'),
    items: z.array(syncPushItemSchema).min(1).max(LIMITS.SYNC_PUSH_BATCH_MAX),
  })
  .strict();

export const syncPullSchema = z
  .object({
    deviceId: text(120, 'Device id'),
    cursor: z.coerce.number().int().min(0),
    limit: z.coerce.number().int().min(1).max(LIMITS.SYNC_PULL_LIMIT_MAX).optional(),
    entities: z
      .array(
        z.enum([
          'users',
          'boards',
          'board_members',
          'stations',
          'activity_types',
          'menu_categories',
          'menu_items',
          'orders',
          'order_items',
          'attachments',
          'thread_messages',
          'acknowledgements',
          'notifications',
        ]),
      )
      .min(1)
      .optional(),
  })
  .strict();

/* ---------------------------------------------------------------------- billing */

export const billingListQuerySchema = pageQuery
  .extend({
    boardId: uuid.optional(),
    status: enumOf(BillingStatus).optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
  })
  .strict();

export const generateBillingSchema = z
  .object({
    boardId: uuid.nullable().optional(),
    periodFrom: isoDate,
    periodTo: isoDate,
    notes: optionalText(1000),
  })
  .strict()
  .refine((value) => value.periodFrom <= value.periodTo, {
    message: 'The end date must not be before the start date',
    path: ['periodTo'],
  });

export const billingStatusSchema = z
  .object({ status: z.enum([BillingStatus.FINALIZED, BillingStatus.CANCELLED]) })
  .strict();

/* ---------------------------------------------------------------------- reports */

export const reportQuerySchema = pageQuery
  .extend({
    dateFrom: isoDate,
    dateTo: isoDate,
    boardId: uuid.optional(),
    userId: uuid.optional(),
    activityTypeId: uuid.optional(),
  })
  .strict();

export const reportKindParamSchema = z.object({ kind: enumOf(ReportKind) }).strict();

/* ------------------------------------------------------------------------ audit */

export const auditListQuerySchema = pageQuery
  .extend({
    actorId: uuid.optional(),
    action: z.string().trim().max(80).optional(),
    entityType: z.string().trim().max(60).optional(),
    entityId: z.string().trim().max(64).optional(),
    boardId: uuid.optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
  })
  .strict();

/* --------------------------------------------------------------------- settings */

export const settingKeyParamSchema = z.object({ key: z.string().trim().min(1).max(120) }).strict();
export const settingValueSchema = z.object({ value: z.unknown() }).strict();

/* ----------------------------------------------------------------- permissions */

export const roleCapabilityParam = z
  .object({ role: enumOf(UserRole), capability: enumOf(Capability) })
  .strict();
export const boardRoleCapabilityParam = z
  .object({ boardRole: enumOf(BoardRole), capability: enumOf(Capability) })
  .strict();
export const updatePermissionSchema = z.object({ granted: z.boolean() }).strict();

/* -------------------------------------------------------------- YouTube imports */

export const createYoutubeImportSchema = z
  .object({ url: z.string().trim().min(1, 'A YouTube URL is required').max(500) })
  .strict();

export const youtubeImportListQuerySchema = z
  .object({ status: enumOf(YoutubeImportStatus).optional() })
  .strict();

export const youtubeImportMarkSavedSchema = z.object({ recipeId: uuid }).strict();

/* --------------------------------------------------------------- GST / tax */

export const hsnSacSearchQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    codeType: enumOf(HsnSacCodeType).optional(),
    activeOnly: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((value) => value === true || value === 'true')
      .optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(LIMITS.PAGE_SIZE_MAX).optional(),
  })
  .strict();

export const gstSyncRunListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(LIMITS.PAGE_SIZE_MAX).optional(),
  })
  .strict();

export const taxProfileListQuerySchema = pageQuery
  .extend({ status: enumOf(MasterStatus).optional() })
  .strict();

/** Percentages, stored as DECIMAL(6,3) — three decimal places is the column's own precision. */
const taxRate = z
  .number()
  .min(0, 'A rate cannot be negative')
  .max(LIMITS.TAX_RATE_MAX, `A rate cannot exceed ${LIMITS.TAX_RATE_MAX}%`)
  .multipleOf(0.001, 'A rate may have at most three decimal places');

const taxProfileShape = {
  id: uuid.optional(),
  code: text(LIMITS.TAX_PROFILE_CODE_MAX, 'Code'),
  name: text(LIMITS.TAX_PROFILE_NAME_MAX, 'Name'),
  description: optionalText(LIMITS.TAX_PROFILE_DESCRIPTION_MAX),
  hsnSacId: uuid.nullable().optional(),
  supplyType: enumOf(SupplyType),
  gstTaxability: enumOf(GstTaxability).optional(),
  gstRate: taxRate.optional(),
  cgstRate: taxRate.optional(),
  sgstRate: taxRate.optional(),
  igstRate: taxRate.optional(),
  cessRate: taxRate.optional(),
  priceIsInclusive: z.boolean().optional(),
  itcEligibility: enumOf(ItcEligibility).optional(),
  effectiveFrom: isoDate.nullable().optional(),
  effectiveTo: isoDate.nullable().optional(),
  exemptionReason: optionalText(LIMITS.TAX_EXEMPTION_REASON_MAX),
  regulatoryNotes: optionalText(LIMITS.TAX_REGULATORY_NOTES_MAX),
  status: enumOf(MasterStatus).optional(),
  sortOrder: z.number().int().optional(),
};

/** An open-ended period is normal; a closed one must not end before it begins. */
function effectiveRangeIsSane(value: {
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}): boolean {
  if (!value.effectiveFrom || !value.effectiveTo) return true;
  return value.effectiveFrom <= value.effectiveTo;
}

export const createTaxProfileSchema = z
  .object(taxProfileShape)
  .strict()
  .refine(effectiveRangeIsSane, {
    message: 'Effective To cannot be earlier than Effective From',
    path: ['effectiveTo'],
  });

export const updateTaxProfileSchema = z
  .object(taxProfileShape)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No changes supplied')
  .refine(effectiveRangeIsSane, {
    message: 'Effective To cannot be earlier than Effective From',
    path: ['effectiveTo'],
  });

/* ------------------------------------------------------------------ entities */

const entityShape = {
  id: uuid.optional(),
  // Optional on create: the service allocates CUS-0001 / EMP-0001 / VEN-0001 per type.
  code: z.string().trim().max(LIMITS.ENTITY_CODE_MAX).optional(),
  type: enumOf(EntityType),
  name: text(LIMITS.ENTITY_NAME_MAX, 'Name'),
  nameHi: optionalText(LIMITS.ENTITY_NAME_MAX),
  phone: optionalText(LIMITS.ENTITY_PHONE_MAX),
  email: z
    .string()
    .trim()
    .max(LIMITS.ENTITY_EMAIL_MAX)
    .email('Must be a valid email address')
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  address: optionalText(LIMITS.ENTITY_ADDRESS_MAX),
  city: optionalText(LIMITS.ENTITY_CITY_MAX),
  stateCode: z
    .string()
    .trim()
    .regex(/^\d{2}$/, 'Must be a two-digit GST state code')
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]{1}$/, 'Must be a valid 15-character GSTIN')
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Must be a valid 10-character PAN')
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  department: optionalText(LIMITS.ENTITY_DEPARTMENT_MAX),
  designation: optionalText(LIMITS.ENTITY_DESIGNATION_MAX),
  linkedUserId: uuid.nullable().optional(),
  discountPercent: z.coerce
    .number()
    .min(0)
    .max(LIMITS.POS_DISCOUNT_PERCENT_MAX)
    .multipleOf(0.001, 'A discount may have at most three decimal places')
    .optional(),
  creditLimit: z.coerce.number().min(0).max(LIMITS.PRICE_MAX).optional(),
  notes: optionalText(LIMITS.ENTITY_NOTES_MAX),
  status: enumOf(MasterStatus).optional(),
  sortOrder: z.coerce.number().int().optional(),
};

export const entityListQuerySchema = pageQuery
  .extend({
    type: enumOf(EntityType).optional(),
    status: enumOf(MasterStatus).optional(),
    phone: z.string().trim().max(LIMITS.ENTITY_PHONE_MAX).optional(),
  })
  .strict();

export const createEntitySchema = z.object(entityShape).strict();

export const updateEntitySchema = z
  .object(entityShape)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No changes supplied');

/* ----------------------------------------------------------------------- POS */

const posMoney = z.coerce.number().min(0).max(LIMITS.PRICE_MAX);

/**
 * Only the *shape* of a line is validated here. Price, tax and every derived amount are
 * resolved server-side from the Menu Master and the line's tax profile — a client that could
 * post its own `lineTotal` could post its own discount too.
 */
const posOrderItemSchema = z
  .object({
    id: uuid.optional(),
    menuItemId: uuid.nullable().optional(),
    variantId: uuid.nullable().optional(),
    customItemName: optionalText(LIMITS.CUSTOM_ITEM_NAME_MAX),
    unitPrice: posMoney.optional(),
    quantity: z.coerce
      .number()
      .gt(0, 'Quantity must be greater than zero')
      .max(LIMITS.QUANTITY_MAX)
      .refine((value) => Number.isInteger(value * 1000), 'At most 3 decimal places'),
    unit: z.string().trim().max(LIMITS.UNIT_MAX).optional(),
    discountType: enumOf(PosDiscountType).optional(),
    discountValue: posMoney.optional(),
    notes: optionalText(LIMITS.POS_ORDER_ITEM_NOTES_MAX),
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasCatalogue = value.menuItemId !== null && value.menuItemId !== undefined;
    const hasCustom =
      typeof value.customItemName === 'string' && value.customItemName.trim() !== '';
    if (hasCatalogue === hasCustom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['menuItemId'],
        message: 'Provide either a menu item or a custom item name, not both',
      });
    }
    if (hasCustom && value.unitPrice === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unitPrice'],
        message: 'A custom line needs a unit price — there is no catalogue price to resolve',
      });
    }
    if (value.discountType === PosDiscountType.PERCENT && (value.discountValue ?? 0) > LIMITS.POS_DISCOUNT_PERCENT_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discountValue'],
        message: `A percentage discount cannot exceed ${LIMITS.POS_DISCOUNT_PERCENT_MAX}%`,
      });
    }
  });

const posOrderShape = {
  orderType: enumOf(PosOrderType),
  stationId: uuid.nullable().optional(),
  counterId: uuid.nullable().optional(),
  menuId: uuid.nullable().optional(),
  entityId: uuid.nullable().optional(),
  entityName: optionalText(LIMITS.ENTITY_NAME_MAX),
  entityPhone: optionalText(LIMITS.ENTITY_PHONE_MAX),
  entityAddress: optionalText(LIMITS.ENTITY_ADDRESS_MAX),
  tableLabel: optionalText(LIMITS.POS_TABLE_LABEL_MAX),
  pax: z.coerce.number().int().min(LIMITS.PAX_MIN).max(LIMITS.PAX_MAX).optional(),
  scheduledFor: isoDateTime.nullable().optional(),
  notes: optionalText(LIMITS.POS_ORDER_NOTES_MAX),
  discountType: enumOf(PosDiscountType).optional(),
  discountValue: posMoney.optional(),
};

/** A ticket may only be created in one of the three non-terminal states. */
const creatablePosStatus = z.enum([
  PosOrderStatus.DRAFT,
  PosOrderStatus.SCHEDULED,
  PosOrderStatus.OPEN,
]);

export const createPosOrderSchema = z
  .object({
    id: uuid.optional(),
    ...posOrderShape,
    status: creatablePosStatus.optional(),
    items: z
      .array(posOrderItemSchema)
      .max(LIMITS.POS_ITEMS_PER_ORDER_MAX)
      .default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === PosOrderStatus.SCHEDULED && !value.scheduledFor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scheduledFor'],
        message: 'A scheduled order needs the time the food is wanted',
      });
    }
    // A DRAFT is allowed to be empty — that is what makes it a draft. Anything else is a
    // ticket, and a ticket with no lines is not a sale.
    if (value.status !== PosOrderStatus.DRAFT && value.items.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: 'Add at least one item, or save the order as a draft',
      });
    }
    if (
      value.orderType === PosOrderType.QUICK_SALE &&
      (value.entityId || (value.entityName ?? null) !== null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['orderType'],
        message: 'A quick sale is anonymous — choose Takeaway, Dine-in or Delivery to name it',
      });
    }
  });

export const updatePosOrderSchema = z
  .object({
    ...posOrderShape,
    items: z.array(posOrderItemSchema).max(LIMITS.POS_ITEMS_PER_ORDER_MAX),
    expectedRevision: z.coerce.number().int().min(1),
  })
  .partial()
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== 'expectedRevision'),
    'Provide at least one field to update',
  );

export const updatePosOrderStatusSchema = z
  .object({
    status: enumOf(PosOrderStatus),
    scheduledFor: isoDateTime.nullable().optional(),
    reason: optionalText(LIMITS.POS_CANCEL_REASON_MAX),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === PosOrderStatus.SCHEDULED && !value.scheduledFor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scheduledFor'],
        message: 'A scheduled order needs the time the food is wanted',
      });
    }
  });

const posPaymentSchema = z
  .object({
    method: enumOf(PosPaymentMethod),
    amount: z.coerce.number().min(0).max(LIMITS.PRICE_MAX),
    tenderedAmount: posMoney.nullable().optional(),
    reference: optionalText(LIMITS.POS_PAYMENT_REFERENCE_MAX),
    notes: optionalText(LIMITS.POS_PAYMENT_NOTES_MAX),
    entityId: uuid.nullable().optional(),
  })
  .strict();

export const posCheckoutSchema = z
  .object({
    payments: z.array(posPaymentSchema).min(1).max(LIMITS.POS_PAYMENTS_PER_ORDER_MAX),
    discountType: enumOf(PosDiscountType).optional(),
    discountValue: posMoney.optional(),
    expectedRevision: z.coerce.number().int().min(1).optional(),
  })
  .strict();

export const posVoidSchema = z
  .object({ reason: text(LIMITS.POS_CANCEL_REASON_MAX, 'Reason') })
  .strict();

export const posOrderListQuerySchema = pageQuery
  .extend({
    status: enumList(Object.values(PosOrderStatus) as [string, ...string[]]),
    orderType: enumList(Object.values(PosOrderType) as [string, ...string[]]),
    paymentStatus: enumList(Object.values(PosPaymentStatus) as [string, ...string[]]),
    entityId: uuid.optional(),
    stationId: uuid.optional(),
    counterId: uuid.optional(),
    named: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((value) => value === true || value === 'true')
      .optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
  })
  .strict();

export const posDashboardQuerySchema = z
  .object({
    businessDate: isoDate.optional(),
    stationId: uuid.optional(),
    counterId: uuid.optional(),
  })
  .strict();

export const posOrderIdParam = z.object({ posOrderId: uuid }).strict();

/* ------------------------------------------------------------------ tasks */

export const taskListQuerySchema = pageQuery
  .extend({
    assignedTo: uuid.optional(),
    status: enumOf(TaskStatus).optional(),
    source: enumOf(TaskSource).optional(),
    kind: enumOf(TaskKind).optional(),
  })
  .strict();

export const createTaskSchema = z
  .object({
    title: text(LIMITS.TASK_TITLE_MAX, 'Task name'),
    description: optionalText(LIMITS.TASK_DESCRIPTION_MAX),
    kind: enumOf(TaskKind).optional(),
    priority: enumOf(TaskPriority).optional(),
    assignedTo: uuid.optional(),
    boardId: uuid.nullable().optional(),
    estimatedMinutes: z.coerce
      .number()
      .int()
      .min(1)
      .max(LIMITS.TASK_ESTIMATE_MINUTES_MAX)
      .nullable()
      .optional(),
  })
  .strict();

export const updateTaskSchema = z
  .object({
    title: text(LIMITS.TASK_TITLE_MAX, 'Task name').optional(),
    description: optionalText(LIMITS.TASK_DESCRIPTION_MAX),
    priority: enumOf(TaskPriority).optional(),
    assignedTo: uuid.optional(),
    estimatedMinutes: z.coerce
      .number()
      .int()
      .min(1)
      .max(LIMITS.TASK_ESTIMATE_MINUTES_MAX)
      .nullable()
      .optional(),
    status: enumOf(TaskStatus).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No changes supplied');

export { idParam, boardIdParam, orderIdParam };
