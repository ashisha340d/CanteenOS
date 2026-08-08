import { z } from 'zod';
import {
  AlertSoundSlot,
  AlertType,
  BillingStatus,
  BoardRole,
  BoardStatus,
  Capability,
  ClientType,
  LIMITS,
  MasterStatus,
  OrderPriority,
  OrderStatus,
  RecipeDifficulty,
  RecipeIngredientScaling,
  ReportKind,
  ShoppingListStatus,
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
    unit: text(LIMITS.UNIT_MAX, 'Unit'),
    imagePath: optionalText(500),
  })
  .strict();

export const updateMenuItemSchema = createMenuItemSchema.partial().strict();

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

export { idParam, boardIdParam, orderIdParam };
