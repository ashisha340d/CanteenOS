/**
 * Cleaning & Hygiene request schemas live in their own module and are re-exported here, so
 * every route keeps importing schemas from one place.
 */
export * from './cleaningSchemas';

import { z } from 'zod';
import {
  AlertSoundSlot,
  AlertType,
  AvailabilityStatus,
  BillingStatus,
  BoardRole,
  BoardStatus,
  CallOutcome,
  CallStatus,
  Capability,
  CaptureSource,
  ClientType,
  EntityType,
  EquipmentDocumentType,
  EquipmentStatus,
  EquipmentSupplierRole,
  FLOOR_PLAN_COORDINATE_MAX,
  GstTaxability,
  HsnSacCodeType,
  ItcEligibility,
  LIMITS,
  MaintenanceAttachmentKind,
  MaintenanceFrequency,
  MaintenancePriority,
  MaintenanceRequestKind,
  MaintenanceTicketStatus,
  MasterStatus,
  OrderPriority,
  OrderStatus,
  PosDiscountType,
  PosOrderStatus,
  PosOrderType,
  PosPaymentMethod,
  PosPaymentStatus,
  ProblemCategory,
  ReceiptTransport,
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
  WarrantyStatus,
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

/**
 * A Menu Category and a Menu Group each belong to one Menu Catalogue. The literal `NONE` asks
 * for the rows filed under no catalogue at all — a question the Admin Portal asks explicitly,
 * and one an absent parameter cannot express, since absent already means "any catalogue".
 */
export const CATALOGUE_NONE = 'NONE';

export const catalogueScopedListQuerySchema = masterListQuerySchema.extend({
  catalogueId: z.union([uuid, z.literal(CATALOGUE_NONE)]).optional(),
});

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
    // Nullable rather than required: a category may be drafted before anyone has decided which
    // catalogue it belongs on, and the two pre-existing unfiled categories must stay editable.
    catalogueId: uuid.nullable().optional(),
    name: text(LIMITS.MENU_CATEGORY_NAME_MAX, 'Category name'),
    nameHi: optionalText(LIMITS.MENU_CATEGORY_NAME_MAX),
    imagePath: optionalText(500),
  })
  .strict();

export const updateMenuCategorySchema = createMenuCategorySchema.partial().strict();

export const menuItemListQuerySchema = masterListQuerySchema.extend({
  categoryId: uuid.optional(),
  groupId: uuid.optional(),
});

export const createMenuItemSchema = z
  .object({
    ...masterBase,
    categoryId: uuid,
    groupId: uuid.nullable().optional(),
    name: text(LIMITS.MENU_ITEM_NAME_MAX, 'Item name'),
    nameHi: optionalText(LIMITS.MENU_ITEM_NAME_MAX),
    description: optionalText(LIMITS.MENU_DESCRIPTION_MAX),
    descriptionHi: optionalText(LIMITS.MENU_DESCRIPTION_MAX),
    unit: text(LIMITS.UNIT_MAX, 'Unit'),
    unitHi: optionalText(LIMITS.UNIT_MAX),
    imagePath: optionalText(500),
    basePrice: z.coerce.number().min(LIMITS.PRICE_MIN).max(LIMITS.PRICE_MAX).nullable().optional(),
    taxProfileId: uuid.nullable().optional(),
    alwaysAvailable: z.boolean().optional(),
    prepSeconds: z.coerce.number().int().min(1).max(86400).nullable().optional(),
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
    catalogueId: uuid.nullable().optional(),
    name: text(LIMITS.COUNTER_NAME_MAX, 'Item group name'),
    code: optionalText(60),
  })
  .strict();

export const updateItemGroupSchema = createItemGroupSchema.partial().strict();

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

/** Manual trigger for MenuShiftSchedulerService — see menuMaster.routes.ts `/menu-shift/apply`. */
export const menuShiftApplyQuerySchema = z
  .object({ shift: z.enum(['MORNING', 'EVENING']) })
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

export const moveCounterRouteSchema = routableEntityRefSchema
  .extend({
    sourceRouteId: uuid.optional(),
    targetCounterId: uuid.optional(),
  })
  .refine((value) => value.sourceRouteId !== undefined || value.targetCounterId !== undefined, {
    message: 'A source assignment or target counter is required',
  });

export const assignPrintingRouteSchema = routableEntityRefSchema.extend({
  printingGroupId: uuid,
  sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
  status: enumOf(MasterStatus).optional(),
});

export const movePrintingRouteSchema = routableEntityRefSchema
  .extend({
    sourceRouteId: uuid.optional(),
    targetPrintingGroupId: uuid.optional(),
  })
  .refine((value) => value.sourceRouteId !== undefined || value.targetPrintingGroupId !== undefined, {
    message: 'A source assignment or target kitchen is required',
  });

const modifierGroupFields = {
  ...masterBase,
  name: text(LIMITS.MODIFIER_GROUP_NAME_MAX, 'Modifier group name'),
  selectionType: z.enum(['SINGLE', 'MULTIPLE']).optional(),
  minSelect: z.coerce.number().int().min(0).max(50).optional(),
  maxSelect: z.coerce.number().int().min(0).max(50).nullable().optional(),
};

const validModifierSelectionRange = (value: { minSelect?: number; maxSelect?: number | null }) =>
  value.maxSelect === undefined || value.maxSelect === null ||
  value.minSelect === undefined || value.minSelect <= value.maxSelect;

export const createModifierGroupSchema = z
  .object(modifierGroupFields)
  .strict()
  .refine(validModifierSelectionRange, {
    path: ['maxSelect'],
    message: 'Maximum selections must be greater than or equal to minimum selections',
  });

export const updateModifierGroupSchema = z
  .object(modifierGroupFields)
  .partial()
  .strict()
  .refine(validModifierSelectionRange, {
    path: ['maxSelect'],
    message: 'Maximum selections must be greater than or equal to minimum selections',
  });

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

export const moveModifierAssignmentSchema = routableEntityRefSchema
  .extend({
    sourceAssignmentId: uuid.optional(),
    targetModifierGroupId: uuid.optional(),
  })
  .refine(
    (value) => value.sourceAssignmentId !== undefined || value.targetModifierGroupId !== undefined,
    { message: 'A source assignment or target modifier group is required' },
  );

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

export const posAnalyticsQuerySchema = z
  .object({ dateFrom: isoDate, dateTo: isoDate })
  .strict();

export const posTopItemsQuerySchema = z
  .object({
    dateFrom: isoDate,
    dateTo: isoDate,
    limit: z.coerce.number().int().min(1).max(25).optional(),
  })
  .strict();

export const posOrderIdParam = z.object({ posOrderId: uuid }).strict();

/**
 * The print request names no printer. The destination is a server-side setting, so a tablet
 * standing in a public hall cannot point the backend at an arbitrary host and port.
 */
export const printPosBillSchema = z
  .object({ copies: z.coerce.number().int().min(1).max(5).optional() })
  .strict();
export const sendPosBillWhatsAppSchema = z
  .object({
    // Free-form on purpose: a guest types ten digits, a counter may paste a number with a
    // country code and spaces, and `normalisePhone` reconciles both.
    phone: z.string().trim().min(6).max(20).optional(),
  })
  .strict();
/** The stand a tablet says it is. Optional: an unprovisioned kiosk still reads the profile. */
export const kioskProfileQuerySchema = z
  .object({ device: z.string().trim().min(1).max(40).optional() })
  .strict();

/* ------------------------------------------------------------------ kds / cds */

export const kdsCounterIdParam = z.object({ counterId: uuid }).strict();
export const kdsPrintingGroupIdParam = z.object({ printingGroupId: uuid }).strict();
export const kdsLineIdParam = z.object({ lineId: uuid }).strict();
export const kdsOrderIdParam = z.object({ orderId: uuid }).strict();

/**
 * An admin↔counter message. `orderId` is optional and nullable: tagging an order is a choice,
 * and the server re-checks that the order actually belongs to this counter before it snapshots
 * the number — a client-supplied id is never trusted to name the right board.
 */
export const counterMessageSchema = z
  .object({
    body: z.string().trim().min(1).max(LIMITS.COUNTER_MESSAGE_MAX),
    orderId: uuid.nullish(),
  })
  .strict();

/** One message inside a counter's thread — the on-demand translate route. */
export const counterMessageParam = z.object({ counterId: uuid, messageId: uuid }).strict();

/** Which counter's lines a "serve all" bumps — the kitchen flow is counter-scoped. */
export const kdsServeAllSchema = z.object({ counterId: uuid }).strict();

/**
 * Shape only, like the POS line schema: the service re-checks every line against the order,
 * resolves each addition's price itself, and re-verifies expectedValue to the paisa.
 */
export const kdsExchangeSchema = z
  .object({
    lineIds: z.array(uuid).min(1).max(LIMITS.POS_ITEMS_PER_ORDER_MAX),
    additions: z
      .array(
        z
          .object({
            menuItemId: uuid,
            variantId: uuid.nullable().optional(),
            quantity: z.coerce
              .number()
              .gt(0, 'Quantity must be greater than zero')
              .max(LIMITS.QUANTITY_MAX)
              .refine((value) => Number.isInteger(value * 1000), 'At most 3 decimal places'),
          })
          .strict(),
      )
      .min(1)
      .max(LIMITS.POS_ITEMS_PER_ORDER_MAX),
    expectedValue: posMoney,
  })
  .strict();

/** Which screen's menu file is being read or written. */
export const kdsStationMenuParam = z
  .object({ kind: z.enum(['counter', 'kitchen']), stationId: uuid })
  .strict();
export const kdsStationMenuItemParam = kdsStationMenuParam.extend({ menuItemId: uuid }).strict();

/**
 * Send only what changed; a null displayName hands the dish its master name back, and a null
 * openingQty forgets the count entirely (rather than counting zero, which means "none left").
 */
export const kdsStationMenuUpsertSchema = z
  .object({
    displayName: z.string().trim().min(1).max(160).nullish(),
    isFinished: z.boolean().optional(),
    openingQty: z.coerce
      .number()
      .min(0)
      .max(LIMITS.QUANTITY_MAX)
      .refine((value) => Number.isInteger(value * 1000), 'At most 3 decimal places')
      .nullish(),
  })
  .strict();
/* ------------------------------------------------------------------ kiosk devices */
/**
 * A stand in the hall. `code` is what a member of staff types into the tablet once, so it is
 * kept to characters that survive being read off a printed label and typed on a touch keyboard.
 */
const kioskDeviceFields = {
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 _-]*$/, 'Use letters, digits, spaces, hyphens or underscores'),
  label: z.string().trim().min(1).max(120),
  menuCode: z.string().trim().min(1).max(60),
  stationId: uuid.nullable().optional(),
  outletName: z.string().trim().min(1).max(120),
  outletNameHi: z.string().trim().max(160).nullable().optional(),
  upiVpa: z.string().trim().max(120).optional(),
  upiPayeeName: z.string().trim().max(120).optional(),
  receiptTransport: enumOf(ReceiptTransport).optional(),
  // The stand's own category order. Ids the menu no longer has are harmless — the kiosk reads
  // this as a preference and falls back to the menu's own order for anything unlisted.
  categoryOrder: z.array(uuid).max(200).optional(),
  status: enumOf(MasterStatus).optional(),
};
export const createKioskDeviceSchema = z.object(kioskDeviceFields).strict();
export const updateKioskDeviceSchema = z
  .object(kioskDeviceFields)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'No changes supplied' });

/* ------------------------------------------------------- digital menu board screens */

/** A font size, padding or gap in CSS pixels. Bounded so a typo cannot blank a wall screen. */
const boardPixels = z.coerce.number().min(0).max(400);

/**
 * The twelve celebration animations the canvas layer knows how to draw — `fireworks`, `pushpa`
 * (flower fall), `rose`, `deep` (diyas), `aarti`, `morpankh` (peacock feather), `tulsi`, `om`,
 * `shankh`, `rangoli`, `gulal` and `kanak` (golden shower). Both `board.fx.anim` and each
 * festival day's `a` name one of these; anything else is a typo the picker in the portal
 * cannot itself produce, so this is the one place that has to catch it.
 */
const CELEBRATION_ANIMATIONS = [
  'fireworks',
  'pushpa',
  'rose',
  'deep',
  'aarti',
  'morpankh',
  'tulsi',
  'om',
  'shankh',
  'rangoli',
  'gulal',
  'kanak',
] as const;

/** Percent of the viewport — the unit every position/size on the board is stored in. */
const boardPercent = z.coerce.number().min(0).max(100);
/** A type scale relative to the board's own sizes. Bounded so nothing can be scaled off-screen. */
const boardScale = z.coerce.number().min(0.6).max(2);
/** Minutes between repeats of something periodic. Floor of 1 keeps a typo from spinning a loop. */
const everyMinutes = z.coerce.number().min(1).max(720);

const menuBoardAdSchema = z
  .object({
    id: z.string().trim().min(1).max(60),
    on: z.boolean().optional(),
    title: z.string().trim().max(80).optional(),
    hi: z.string().trim().max(80).optional(),
    text: z.string().trim().max(200).optional(),
    // Free text, not a number: the board only prefixes a ₹ when it looks numeric, so a seasonal
    // line like "Ask at the counter" is a legitimate value here.
    price: z.string().trim().max(20).optional(),
    // Split evenly across `forSec` and crossfaded — capped at 6 so a single ad cannot stretch
    // its own slot into a slideshow nobody scheduled.
    images: z.array(z.string().trim().max(500)).max(6).optional(),
    // Menu Master item ids this ad advertises. Capped for the same reason as `images`: an ad
    // slot holds a few lines, and a list longer than that is a menu, not an advertisement.
    items: z.array(z.string().trim().max(60)).max(8).optional(),
    everyMin: everyMinutes.optional(),
    forSec: z.coerce.number().min(3).max(60).optional(),
    x: boardPercent.optional(),
    y: boardPercent.optional(),
    // An ad narrower than 14% or shorter than 8% of the screen stops being legible from across
    // a hall — the same floor the board's own placement UI enforced.
    w: z.coerce.number().min(14).max(100).optional(),
    h: z.coerce.number().min(8).max(100).optional(),
    fs: boardScale.optional(),
    fsTitle: boardScale.optional(),
    fsHi: boardScale.optional(),
    fsText: boardScale.optional(),
    fsPrice: boardScale.optional(),
    anim: z.string().trim().max(40).optional(),
    img: z
      .object({
        x: boardPercent.optional(),
        y: boardPercent.optional(),
        w: boardPercent.optional(),
        h: boardPercent.optional(),
        fit: z.enum(['cover', 'contain']).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const menuBoardBoardConfigSchema = z
  .object({
    panel: z
      .object({
        on: z.boolean().optional(),
        x: boardPercent.optional(),
        y: boardPercent.optional(),
        // The Today panel carries a clock face and, optionally, a weather card and a festival
        // line — collapsing it much past these floors clips its own contents.
        w: z.coerce.number().min(8).max(96).optional(),
        h: z.coerce.number().min(3.5).max(70).optional(),
        wx: z.boolean().optional(),
        fest: z.boolean().optional(),
        fs: boardScale.optional(),
      })
      .strict()
      .optional(),
    wx: z
      .object({
        lat: z.coerce.number().min(-90).max(90).optional(),
        lon: z.coerce.number().min(-180).max(180).optional(),
        place: z.string().trim().max(60).optional(),
        unit: z.enum(['C', 'F']).optional(),
        // Only meaningful while `float` is on, but stored either way so turning the card loose
        // and putting it back does not lose where it was last placed.
        float: z.boolean().optional(),
        x: boardPercent.optional(),
        y: boardPercent.optional(),
        w: z.coerce.number().min(10).max(60).optional(),
        h: z.coerce.number().min(5).max(40).optional(),
        fs: boardScale.optional(),
      })
      .strict()
      .optional(),
    fx: z
      .object({
        on: z.boolean().optional(),
        anim: z.enum(CELEBRATION_ANIMATIONS).optional(),
        everyMin: everyMinutes.optional(),
        forSec: z.coerce.number().min(2).max(60).optional(),
      })
      .strict()
      .optional(),
    hol: z
      .object({
        // A Calendarific API key is a secret typed once by an operator, so this stores it
        // rather than proxying the import through the backend — the same trust boundary the
        // vanilla board already had, just moved from a browser field to this row.
        key: z.string().trim().max(200).optional(),
        country: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{2,3}$/, 'Use a two-letter country code, e.g. IN')
          .optional(),
        lastSync: z.string().trim().max(40).optional(),
      })
      .strict()
      .optional(),
    divAnim: z
      .object({
        on: z.boolean().optional(),
        style: z.enum(['slide', 'drawer', 'flip', 'zoom', 'fade', 'swing', 'random']).optional(),
        everyMin: everyMinutes.optional(),
      })
      .strict()
      .optional(),
    // MM-DD repeats yearly; a lunar festival whose date moves needs the full YYYY-MM-DD and is
    // re-entered each year rather than computed — the same convention the board has always used.
    days: z
      .array(
        z
          .object({
            d: z.string().trim().regex(/^(\d{4}-)?\d{2}-\d{2}$/, 'Use MM-DD or YYYY-MM-DD'),
            n: z.string().trim().min(1).max(60),
            h: z.string().trim().max(60).optional(),
            a: z.enum(CELEBRATION_ANIMATIONS).optional(),
          })
          .strict(),
      )
      .max(60)
      .optional(),
    ads: z.array(menuBoardAdSchema).max(20).optional(),
    sort: z.enum(['menu', 'name', 'price']).optional(),
    // Item id -> category name, applied on this screen only. Bounded so a malformed config
    // cannot carry an unbounded map onto a display nobody is standing in front of.
    moves: z.record(z.string().trim().max(60), z.string().trim().max(80)).optional(),
    cats: z
      .record(
        z.string().trim().max(80),
        z
          .object({
            label: z.string().trim().max(80).optional(),
            labelHi: z.string().trim().max(80).optional(),
            fs: z.coerce.number().min(0.7).max(1.8).optional(),
            x: boardPercent.optional(),
            y: boardPercent.optional(),
            w: boardPercent.optional(),
            h: boardPercent.optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

/**
 * The board's presentation blob.
 *
 * Validated field by field rather than accepted as free-form JSON: this reaches a screen that
 * nobody is standing in front of, so a value that makes the board unreadable is only noticed
 * by a guest.
 */
const menuBoardConfigSchema = z
  .object({
    identity: z
      .object({
        restaurantName: z.string().trim().max(80).optional(),
        restaurantNameHi: z.string().trim().max(80).optional(),
        langSwitchSeconds: z.coerce.number().int().min(4).max(30).optional(),
        morningFrom: clockTime.optional(),
        morningTo: clockTime.optional(),
        eveningFrom: clockTime.optional(),
        eveningTo: clockTime.optional(),
      })
      .strict()
      .optional(),
    typography: z
      .object({
        Font_RestaurantName: z.string().trim().max(60).optional(),
        FontSize_RestaurantName: boardPixels.optional(),
        Font_CategoryName: z.string().trim().max(60).optional(),
        FontSize_CategoryName: boardPixels.optional(),
        Font_ItemName_EN: z.string().trim().max(60).optional(),
        FontSize_ItemName_EN: boardPixels.optional(),
        Font_ItemName_HI: z.string().trim().max(60).optional(),
        FontSize_ItemName_HI: boardPixels.optional(),
        Font_Price: z.string().trim().max(60).optional(),
        FontSize_Price: boardPixels.optional(),
        FontSize_Min: boardPixels.optional(),
        Padding_Header: boardPixels.optional(),
        Padding_CategoryHeader: boardPixels.optional(),
        Padding_Item: boardPixels.optional(),
        Padding_Item_Horizontal: boardPixels.optional(),
        Gap_Columns: boardPixels.optional(),
        Gap_Outer: boardPixels.optional(),
        Gap_Categories: boardPixels.optional(),
      })
      .strict()
      .optional(),
    layout: z
      .object({
        // Always three columns; the board folds them for display on a narrow screen rather
        // than rewriting the arrangement the wall screen depends on.
        columns: z.array(z.array(z.string().trim().max(120)).max(60)).max(3).optional(),
        fonts: z.record(z.coerce.number().min(0.7).max(1.8)).optional(),
      })
      .strict()
      .optional(),
    board: z.record(z.unknown()).optional(),
  })
  .strict();

/**
 * One physical screen. `code` appears in the screen's URL and is typed by hand into a browser
 * on a machine with no keyboard shortcuts to help, so it is kept short and unambiguous.
 */
const menuBoardScreenFields = {
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Use letters, digits, hyphens or underscores'),
  name: z.string().trim().min(1).max(120),
  // Blank is meaningful: it defers to the `pos.default_menu_code` setting, so a single-menu
  // operation configures its menu once rather than once per screen.
  menuCode: z.string().trim().max(60),
  // Floor of 15s so a misconfigured screen cannot turn into a load generator; the tree
  // resolution behind a snapshot is several queries deep.
  pollSeconds: z.coerce.number().int().min(15).max(3600).optional(),
  config: menuBoardConfigSchema.optional(),
  status: enumOf(MasterStatus).optional(),
};

export const createMenuBoardScreenSchema = z.object(menuBoardScreenFields).strict();
export const updateMenuBoardScreenSchema = z
  .object(menuBoardScreenFields)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'No changes supplied' });

/** The screen asking. Optional: a bare URL resolves to the default screen. */
export const menuBoardQuerySchema = z
  .object({
    screen: z.string().trim().min(1).max(40).optional(),
    /**
     * Set by the Admin Portal's layout editor, which frames this same page to drag the panel
     * and ads over the real menu. It suppresses the heartbeat only: a screen's `lastSeenAt` is
     * the one signal that tells an operator a wall display is switched on, and an editor tab
     * open on a desk would otherwise report every screen as Live.
     */
    preview: z.enum(['1']).optional(),
  })
  .strict();

/* ------------------------------------------------------------------ tasks */

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

/* ------------------------------------- equipment monitoring & maintenance */
/**
 * Everything below follows the module's one architectural rule: the client sends what it
 * genuinely knows and nothing more. That is why almost every field here is optional and why
 * `equipmentId` is the only thing a report-problem request must carry — the asset id,
 * location, supplier, priority, reporter and timestamps are all resolved server-side.
 */
const booleanFlag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true')
  .optional();
/** Three letters that become a segment of an asset id: KIT, OVN. */
const assetSegment = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,4}$/, 'Must be 2-4 letters or digits');
const phoneField = optionalText(LIMITS.SUPPLIER_PHONE_MAX);
const emailField = z
  .string()
  .trim()
  .max(LIMITS.SUPPLIER_EMAIL_MAX)
  .email('Must be a valid email address')
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null));
/* -------------------------------------------------------- location & category */
export const equipmentFloorSchema = z
  .object({
    code: text(40, 'Code'),
    name: text(LIMITS.EQUIPMENT_FLOOR_NAME_MAX, 'Floor name'),
    levelIndex: z.coerce.number().int().min(-20).max(200).optional(),
  })
  .strict();
export const updateEquipmentFloorSchema = equipmentFloorSchema
  .extend({ status: enumOf(MasterStatus) })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No changes supplied');
export const equipmentAreaSchema = z
  .object({
    floorId: uuid,
    code: text(40, 'Code'),
    name: text(LIMITS.EQUIPMENT_AREA_NAME_MAX, 'Area name'),
    assetSegment,
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .strict();
export const updateEquipmentAreaSchema = equipmentAreaSchema
  .extend({ status: enumOf(MasterStatus) })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No changes supplied');
export const equipmentLocationSchema = z
  .object({
    areaId: uuid,
    name: text(LIMITS.EQUIPMENT_LOCATION_NAME_MAX, 'Location name'),
    room: optionalText(LIMITS.EQUIPMENT_ROOM_MAX),
    section: optionalText(LIMITS.EQUIPMENT_SECTION_MAX),
    position: optionalText(LIMITS.EQUIPMENT_POSITION_MAX),
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .strict();
export const updateEquipmentLocationSchema = equipmentLocationSchema
  .extend({ status: enumOf(MasterStatus) })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No changes supplied');
export const equipmentMasterQuerySchema = z
  .object({
    floorId: uuid.optional(),
    areaId: uuid.optional(),
    includeInactive: booleanFlag,
  })
  .strict();
const equipmentCategoryShape = {
  code: text(LIMITS.EQUIPMENT_CATEGORY_CODE_MAX, 'Code'),
  name: text(LIMITS.EQUIPMENT_CATEGORY_NAME_MAX, 'Category name'),
  assetSegment,
  description: optionalText(1000),
  defaultFrequency: enumOf(MaintenanceFrequency).nullable().optional(),
  defaultIntervalDays: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITS.MAINTENANCE_INTERVAL_DAYS_MAX)
    .nullable()
    .optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
  status: enumOf(MasterStatus).optional(),
};
export const equipmentCategorySchema = z.object(equipmentCategoryShape).strict();
export const updateEquipmentCategorySchema = z
  .object(equipmentCategoryShape)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No changes supplied');
/* ------------------------------------------------------------------ equipment */
const equipmentSpecificationsSchema = z
  .object({
    capacity: optionalText(LIMITS.EQUIPMENT_SPEC_VALUE_MAX),
    voltage: optionalText(LIMITS.EQUIPMENT_SPEC_VALUE_MAX),
    powerRating: optionalText(LIMITS.EQUIPMENT_SPEC_VALUE_MAX),
    dimensions: optionalText(LIMITS.EQUIPMENT_SPEC_VALUE_MAX),
    weight: optionalText(LIMITS.EQUIPMENT_SPEC_VALUE_MAX),
    fuelType: optionalText(LIMITS.EQUIPMENT_SPEC_VALUE_MAX),
    temperatureRange: optionalText(LIMITS.EQUIPMENT_SPEC_VALUE_MAX),
    other: z
      .record(z.string().trim().max(LIMITS.EQUIPMENT_SPEC_VALUE_MAX))
      .refine((value) => Object.keys(value).length <= LIMITS.EQUIPMENT_SPEC_KEYS_MAX, `At most ${LIMITS.EQUIPMENT_SPEC_KEYS_MAX} extra specifications`)
      .optional(),
  })
  .strict()
  .nullable()
  .optional();
const equipmentCoreShape = {
  name: text(LIMITS.EQUIPMENT_NAME_MAX, 'Equipment name'),
  equipmentType: optionalText(LIMITS.EQUIPMENT_TYPE_MAX),
  brand: optionalText(LIMITS.EQUIPMENT_BRAND_MAX),
  model: optionalText(LIMITS.EQUIPMENT_MODEL_MAX),
  serialNumber: optionalText(LIMITS.EQUIPMENT_SERIAL_MAX),
  manufacturer: optionalText(LIMITS.EQUIPMENT_MANUFACTURER_MAX),
  categoryId: uuid.nullable().optional(),
  locationId: uuid.nullable().optional(),
  status: enumOf(EquipmentStatus).optional(),
  imageMediaId: uuid.nullable().optional(),
  specifications: equipmentSpecificationsSchema,
  purchaseDate: isoDate.nullable().optional(),
  installationDate: isoDate.nullable().optional(),
  purchasePrice: z.coerce.number().min(0).max(LIMITS.PRICE_MAX).nullable().optional(),
  invoiceNumber: optionalText(LIMITS.EQUIPMENT_INVOICE_NUMBER_MAX),
  supplierName: optionalText(LIMITS.SUPPLIER_NAME_MAX),
  warrantyExpiry: isoDate.nullable().optional(),
  nfcTagId: optionalText(LIMITS.EQUIPMENT_NFC_TAG_MAX),
  notes: optionalText(LIMITS.EQUIPMENT_NOTES_MAX),
};
export const createEquipmentSchema = z
  .object({
    ...equipmentCoreShape,
    capturedVia: enumOf(CaptureSource).optional(),
    documentIds: z.array(uuid).max(LIMITS.EQUIPMENT_DOCUMENTS_PER_ASSET_MAX).optional(),
    suppliers: z
      .array(z
        .object({
          supplierId: uuid,
          role: enumOf(EquipmentSupplierRole),
          isDefault: z.boolean().optional(),
        })
        .strict())
      .max(3)
      .optional(),
    schedule: z
      .object({
        frequency: enumOf(MaintenanceFrequency),
        intervalDays: z.coerce
          .number()
          .int()
          .min(1)
          .max(LIMITS.MAINTENANCE_INTERVAL_DAYS_MAX)
          .nullable()
          .optional(),
        anchorDate: isoDate.optional(),
      })
      .strict()
      .nullable()
      .optional(),
    position: z
      .object({
        floorPlanId: uuid,
        x: z.coerce.number().min(0).max(FLOOR_PLAN_COORDINATE_MAX),
        y: z.coerce.number().min(0).max(FLOOR_PLAN_COORDINATE_MAX),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
/**
 * `status` is absent on purpose: it moves through `POST /equipment/:id/status`, which writes
 * the history row and the timeline entry. Accepting it here and ignoring it would make an
 * ordinary edit look as though it had changed the status when it had not.
 */
export const updateEquipmentSchema = z
  .object(equipmentCoreShape)
  .omit({ status: true })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No changes supplied');
export const equipmentListQuerySchema = pageQuery
  .extend({
    status: enumOf(EquipmentStatus).optional(),
    categoryId: uuid.optional(),
    floorId: uuid.optional(),
    areaId: uuid.optional(),
    locationId: uuid.optional(),
    supplierId: uuid.optional(),
    warrantyStatus: enumOf(WarrantyStatus).optional(),
    hasOpenProblems: booleanFlag,
    maintenanceDue: booleanFlag,
    maintenanceOverdue: booleanFlag,
  })
  .strict();
/** A scanned QR payload, an NFC tag or a typed asset id — all three resolve the same way. */
export const equipmentResolveQuerySchema = z
  .object({ code: text(LIMITS.EQUIPMENT_QR_CODE_MAX, 'Code') })
  .strict();
export const equipmentStatusChangeSchema = z
  .object({
    status: enumOf(EquipmentStatus),
    note: optionalText(LIMITS.EQUIPMENT_STATUS_NOTE_MAX),
  })
  .strict();
export const equipmentMoveSchema = z
  .object({
    locationId: uuid,
    note: optionalText(LIMITS.EQUIPMENT_STATUS_NOTE_MAX),
  })
  .strict();
const documentExtractionSchema = z
  .object({
    purchaseDate: isoDate.nullable().optional(),
    supplierName: optionalText(LIMITS.SUPPLIER_NAME_MAX),
    invoiceNumber: optionalText(LIMITS.EQUIPMENT_INVOICE_NUMBER_MAX),
    warrantyMonths: z.coerce.number().int().min(0).max(600).nullable().optional(),
    warrantyExpiry: isoDate.nullable().optional(),
    purchasePrice: z.coerce.number().min(0).max(LIMITS.PRICE_MAX).nullable().optional(),
    serialNumber: optionalText(LIMITS.EQUIPMENT_SERIAL_MAX),
    notes: optionalText(1000),
  })
  .strict();
export const equipmentDocumentSchema = z
  .object({
    mediaId: uuid,
    docType: enumOf(EquipmentDocumentType).optional(),
    title: optionalText(LIMITS.EQUIPMENT_DOCUMENT_TITLE_MAX),
    extracted: documentExtractionSchema.nullable().optional(),
    applyWarranty: z.boolean().optional(),
  })
  .strict();
export const equipmentWarrantySchema = z
  .object({
    provider: optionalText(LIMITS.SUPPLIER_NAME_MAX),
    policyNumber: optionalText(LIMITS.EQUIPMENT_INVOICE_NUMBER_MAX),
    startDate: isoDate.nullable().optional(),
    expiryDate: isoDate.nullable().optional(),
    months: z.coerce.number().int().min(0).max(600).nullable().optional(),
    terms: optionalText(1000),
    documentId: uuid.nullable().optional(),
  })
  .strict()
  .refine((value) => (value.expiryDate ?? null) !== null ||
    ((value.startDate ?? null) !== null && (value.months ?? null) !== null), 'Give an expiry date, or a start date and a number of months');
export const equipmentSupplierLinkSchema = z
  .object({
    supplierId: uuid,
    role: enumOf(EquipmentSupplierRole),
    isDefault: z.boolean().optional(),
  })
  .strict();
export const equipmentSupplierRoleParam = z
  .object({ id: uuid, role: enumOf(EquipmentSupplierRole) })
  .strict();
export const equipmentMediaQuerySchema = z
  .object({ title: z.string().trim().max(200).optional() })
  .strict();
/* ------------------------------------------------------------------ AI drafts */
export const equipmentIdentifySchema = z.object({ mediaId: uuid }).strict();
export const equipmentDocumentScanSchema = z
  .object({ mediaId: uuid, docType: enumOf(EquipmentDocumentType) })
  .strict();
export const problemClassifySchema = z
  .object({
    equipmentId: uuid.nullable().optional(),
    text: optionalText(LIMITS.MAINTENANCE_DESCRIPTION_MAX),
    mediaId: uuid.nullable().optional(),
  })
  .strict()
  .refine((value) => (value.text ?? null) !== null || (value.mediaId ?? null) !== null, 'Describe the problem, record it, or attach a photo');
/* ---------------------------------------------------------------- floor plans */
export const floorPlanQuerySchema = z.object({ floorId: uuid.optional() }).strict();
export const floorIdParam = z.object({ floorId: uuid }).strict();
export const createFloorPlanSchema = z
  .object({
    floorId: uuid,
    name: text(120, 'Plan name'),
    mediaId: uuid,
    width: z.coerce.number().int().min(1).max(20000).nullable().optional(),
    height: z.coerce.number().int().min(1).max(20000).nullable().optional(),
  })
  .strict();
export const updateFloorPlanSchema = z
  .object({ name: text(120, 'Plan name').optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No changes supplied');
export const floorPlanPositionSchema = z
  .object({
    equipmentId: uuid,
    x: z.coerce.number().min(0).max(FLOOR_PLAN_COORDINATE_MAX),
    y: z.coerce.number().min(0).max(FLOOR_PLAN_COORDINATE_MAX),
  })
  .strict();
export const floorPlanPositionParam = z.object({ id: uuid, equipmentId: uuid }).strict();
/* --------------------------------------------------------- maintenance tickets */
const maintenanceAttachmentSchema = z
  .object({
    mediaId: uuid,
    kind: enumOf(MaintenanceAttachmentKind),
    transcript: optionalText(LIMITS.MAINTENANCE_TRANSCRIPT_MAX),
  })
  .strict();
export const createMaintenanceTicketSchema = z
  .object({
    equipmentId: uuid,
    kind: enumOf(MaintenanceRequestKind).optional(),
    problemCategory: enumOf(ProblemCategory).nullable().optional(),
    description: optionalText(LIMITS.MAINTENANCE_DESCRIPTION_MAX),
    title: optionalText(LIMITS.MAINTENANCE_TITLE_MAX),
    priority: enumOf(MaintenancePriority).optional(),
    attachments: z
      .array(maintenanceAttachmentSchema)
      .max(LIMITS.MAINTENANCE_ATTACHMENTS_PER_TICKET_MAX)
      .optional(),
    aiSuggestedCategory: enumOf(ProblemCategory).nullable().optional(),
    aiConfidence: z.coerce.number().min(0).max(1).nullable().optional(),
    capturedVia: enumOf(CaptureSource).optional(),
  })
  .strict();
export const updateMaintenanceTicketSchema = z
  .object({
    title: text(LIMITS.MAINTENANCE_TITLE_MAX, 'Title').optional(),
    description: optionalText(LIMITS.MAINTENANCE_DESCRIPTION_MAX),
    priority: enumOf(MaintenancePriority).optional(),
    problemCategory: enumOf(ProblemCategory).nullable().optional(),
    partsRequired: optionalText(LIMITS.MAINTENANCE_PARTS_MAX),
    costAmount: z.coerce.number().min(0).max(LIMITS.MAINTENANCE_COST_MAX).nullable().optional(),
    resolutionNotes: optionalText(LIMITS.MAINTENANCE_RESOLUTION_MAX),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No changes supplied');
export const maintenanceStatusChangeSchema = z
  .object({
    status: enumOf(MaintenanceTicketStatus),
    note: optionalText(LIMITS.MAINTENANCE_NOTE_MAX),
    resolutionNotes: optionalText(LIMITS.MAINTENANCE_RESOLUTION_MAX),
    partsRequired: optionalText(LIMITS.MAINTENANCE_PARTS_MAX),
    costAmount: z.coerce.number().min(0).max(LIMITS.MAINTENANCE_COST_MAX).nullable().optional(),
  })
  .strict();
export const maintenanceAssignSchema = z
  .object({
    assignedTo: uuid.nullable().optional(),
    supplierId: uuid.nullable().optional(),
    technicianName: optionalText(LIMITS.MAINTENANCE_TECHNICIAN_NAME_MAX),
    technicianPhone: phoneField,
    scheduledAt: isoDateTime.nullable().optional(),
    notes: optionalText(LIMITS.MAINTENANCE_NOTE_MAX),
  })
  .strict()
  .refine((value) => (value.assignedTo ?? null) !== null ||
    (value.supplierId ?? null) !== null ||
    (value.technicianName ?? null) !== null, 'Choose a person, a supplier or name the technician');
export const maintenanceCompleteSchema = z
  .object({
    resolutionNotes: optionalText(LIMITS.MAINTENANCE_RESOLUTION_MAX),
    partsReplaced: optionalText(LIMITS.MAINTENANCE_PARTS_MAX),
    costAmount: z.coerce.number().min(0).max(LIMITS.MAINTENANCE_COST_MAX).nullable().optional(),
    attachments: z
      .array(maintenanceAttachmentSchema)
      .max(LIMITS.MAINTENANCE_ATTACHMENTS_PER_TICKET_MAX)
      .optional(),
    restoreEquipment: z.boolean().optional(),
  })
  .strict();
export const maintenanceAttachmentsSchema = z
  .object({
    attachments: z
      .array(maintenanceAttachmentSchema)
      .min(1)
      .max(LIMITS.MAINTENANCE_ATTACHMENTS_PER_TICKET_MAX),
  })
  .strict();
export const maintenanceNoteSchema = z
  .object({ note: text(LIMITS.MAINTENANCE_NOTE_MAX, 'Note') })
  .strict();
export const maintenanceTicketListQuerySchema = pageQuery
  .extend({
    equipmentId: uuid.optional(),
    status: enumOf(MaintenanceTicketStatus).optional(),
    priority: enumOf(MaintenancePriority).optional(),
    kind: enumOf(MaintenanceRequestKind).optional(),
    problemCategory: enumOf(ProblemCategory).optional(),
    supplierId: uuid.optional(),
    assignedTo: uuid.optional(),
    reportedBy: uuid.optional(),
    floorId: uuid.optional(),
    areaId: uuid.optional(),
    openOnly: booleanFlag,
    mine: booleanFlag,
  })
  .strict();
/* ------------------------------------------------------- maintenance schedules */
const maintenanceScheduleShape = {
  equipmentId: uuid,
  title: text(LIMITS.MAINTENANCE_TITLE_MAX, 'Title').optional(),
  frequency: enumOf(MaintenanceFrequency),
  intervalDays: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITS.MAINTENANCE_INTERVAL_DAYS_MAX)
    .nullable()
    .optional(),
  anchorDate: isoDate.optional(),
  reminderDays: z.coerce.number().int().min(0).max(LIMITS.MAINTENANCE_REMINDER_DAYS_MAX).optional(),
  assignedTo: uuid.nullable().optional(),
  supplierId: uuid.nullable().optional(),
  instructions: optionalText(LIMITS.MAINTENANCE_INSTRUCTIONS_MAX),
  isActive: z.boolean().optional(),
};
export const createMaintenanceScheduleSchema = z.object(maintenanceScheduleShape).strict();
export const updateMaintenanceScheduleSchema = z
  .object(maintenanceScheduleShape)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No changes supplied');
export const maintenanceScheduleListQuerySchema = pageQuery
  .extend({
    equipmentId: uuid.optional(),
    assignedTo: uuid.optional(),
    dueBefore: isoDate.optional(),
    includeInactive: booleanFlag,
  })
  .strict();
/* ------------------------------------------------------------------ suppliers */
const supplierShape = {
  name: text(LIMITS.SUPPLIER_NAME_MAX, 'Supplier name'),
  code: optionalText(LIMITS.SUPPLIER_CODE_MAX),
  contactPerson: optionalText(LIMITS.SUPPLIER_CONTACT_NAME_MAX),
  phone: phoneField,
  whatsapp: phoneField,
  email: emailField,
  serviceCategory: optionalText(LIMITS.SUPPLIER_SERVICE_CATEGORY_MAX),
  categoryIds: z.array(uuid).max(50).optional(),
  serviceArea: optionalText(LIMITS.SUPPLIER_SERVICE_AREA_MAX),
  notes: optionalText(LIMITS.SUPPLIER_NOTES_MAX),
  entityId: uuid.nullable().optional(),
  status: enumOf(MasterStatus).optional(),
};
export const createSupplierSchema = z.object(supplierShape).strict();
export const updateSupplierSchema = z
  .object(supplierShape)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No changes supplied');
export const supplierListQuerySchema = pageQuery
  .extend({
    status: enumOf(MasterStatus).optional(),
    categoryId: uuid.optional(),
  })
  .strict();
const supplierContactShape = {
  name: text(LIMITS.SUPPLIER_CONTACT_NAME_MAX, 'Contact name'),
  role: optionalText(120),
  phone: phoneField,
  whatsapp: phoneField,
  email: emailField,
  isPrimary: z.boolean().optional(),
};
export const createSupplierContactSchema = z.object(supplierContactShape).strict();
export const updateSupplierContactSchema = z
  .object(supplierContactShape)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No changes supplied');
/* ------------------------------------------------------- supplier communication */
export const callLogSchema = z
  .object({
    equipmentId: uuid,
    ticketId: uuid.nullable().optional(),
    supplierId: uuid.nullable().optional(),
    contactId: uuid.nullable().optional(),
    phoneNumber: text(LIMITS.SUPPLIER_PHONE_MAX, 'Phone number'),
  })
  .strict();
export const callOutcomeSchema = z
  .object({
    outcome: enumOf(CallOutcome),
    status: enumOf(CallStatus).optional(),
    durationSeconds: z.coerce.number().int().min(0).max(86_400).nullable().optional(),
    notes: optionalText(1000),
  })
  .strict();
export const communicationLogQuerySchema = z
  .object({
    equipmentId: uuid.optional(),
    ticketId: uuid.optional(),
    supplierId: uuid.optional(),
    outcome: enumOf(CallOutcome).optional(),
  })
  .strict();
export const whatsappDraftSchema = z
  .object({
    equipmentId: uuid,
    ticketId: uuid.nullable().optional(),
    supplierId: uuid.nullable().optional(),
  })
  .strict();
export const whatsappSendSchema = z
  .object({
    equipmentId: uuid,
    ticketId: uuid.nullable().optional(),
    supplierId: uuid.nullable().optional(),
    message: optionalText(LIMITS.WHATSAPP_MESSAGE_MAX),
  })
  .strict();

export { idParam, boardIdParam, orderIdParam };
