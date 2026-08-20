import { z } from 'zod';
import {
  BatchIssuePolicy,
  InventoryLocationKind,
  LIMITS,
  MasterStatus,
  ProductKind,
  UomDimension,
  ValuationMethod,
} from '@menuboard/shared';
import { optionalText, pageQuery, text, uuid } from './common';

/**
 * Request schemas for the purchase masters — units, inventory locations, products and their
 * per-location stock policy, the supplier ↔ product mapping, and the vendor purchase profile.
 *
 * Kept out of `schemas.ts` for the same reason the DTOs are kept out of `domain.ts`: purchase
 * is a module of its own and its contract should be readable in one sitting.
 */

const enumOf = <T extends Record<string, string>>(source: T) =>
  z.enum(Object.values(source) as [string, ...string[]]);

/**
 * A boolean that survives a query string.
 *
 * `z.coerce.boolean()` is wrong here: it follows JavaScript truthiness, so the string `'false'`
 * would arrive as `true` and `?purchasableOnly=false` would mean its opposite.
 */
const boolQuery = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true')
  .optional();

/** Conversion factors are excluded at zero: see the LIMITS comment in shared/constants. */
const conversionFactor = z.coerce
  .number()
  .gt(0, 'A conversion factor must be greater than zero')
  .min(LIMITS.CONVERSION_FACTOR_MIN)
  .max(LIMITS.CONVERSION_FACTOR_MAX);

/** DECIMAL(14,3) in the schema; three decimals is the resolution of a stock quantity. */
const stockQuantity = z.coerce
  .number()
  .min(0)
  .max(LIMITS.QUANTITY_MAX)
  .nullable()
  .optional();

/** DECIMAL(14,4): a spice priced per gram is genuinely ₹0.0125. */
const cost = z.coerce.number().min(0).max(LIMITS.PRICE_MAX).nullable().optional();

const days = z.coerce.number().int().min(0).max(3650).nullable().optional();
const sortOrder = z.coerce.number().int().min(0).max(100_000).optional();

/* ------------------------------------------------------------------------- params --- */

export const uomIdParam = z.object({ uomId: uuid }).strict();
export const inventoryLocationIdParam = z.object({ locationId: uuid }).strict();
export const productIdParam = z.object({ productId: uuid }).strict();
export const productLocationParams = z.object({ productId: uuid, locationId: uuid }).strict();
export const supplierProductIdParam = z.object({ supplierProductId: uuid }).strict();
export const vendorIdParam = z.object({ entityId: uuid }).strict();

/* ------------------------------------------------------------------ units of measure --- */

export const uomListQuerySchema = pageQuery
  .extend({
    dimension: enumOf(UomDimension).optional(),
    status: enumOf(MasterStatus).optional(),
  })
  .strict();

export const createUomSchema = z
  .object({
    id: uuid.optional(),
    code: text(LIMITS.UOM_CODE_MAX, 'Unit code'),
    name: text(LIMITS.UOM_NAME_MAX, 'Unit name'),
    dimension: enumOf(UomDimension),
    isBase: z.boolean().optional(),
    factorToBase: conversionFactor.optional(),
    decimalPlaces: z.coerce.number().int().min(0).max(6).optional(),
    status: enumOf(MasterStatus).optional(),
    sortOrder,
  })
  .strict();

export const updateUomSchema = createUomSchema
  .omit({ id: true })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No changes supplied');

/* --------------------------------------------------------------- inventory locations --- */

export const inventoryLocationListQuerySchema = pageQuery
  .extend({
    kind: enumOf(InventoryLocationKind).optional(),
    parentId: uuid.optional(),
    status: enumOf(MasterStatus).optional(),
  })
  .strict();

export const createInventoryLocationSchema = z
  .object({
    id: uuid.optional(),
    code: text(LIMITS.INVENTORY_LOCATION_CODE_MAX, 'Location code'),
    name: text(LIMITS.INVENTORY_LOCATION_NAME_MAX, 'Location name'),
    nameHi: optionalText(150),
    kind: enumOf(InventoryLocationKind),
    parentId: uuid.nullable().optional(),
    counterId: uuid.nullable().optional(),
    stationId: uuid.nullable().optional(),
    department: optionalText(120),
    isDefaultReceiving: z.boolean().optional(),
    allowsNegativeStock: z.boolean().optional(),
    status: enumOf(MasterStatus).optional(),
    sortOrder,
    notes: optionalText(1000),
  })
  .strict();

export const updateInventoryLocationSchema = createInventoryLocationSchema
  .omit({ id: true })
  .partial()
  .extend({ expectedRevision: z.coerce.number().int().min(1).optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No changes supplied');

/* -------------------------------------------------------------------- product master --- */

export const productListQuerySchema = pageQuery
  .extend({
    categoryId: uuid.optional(),
    kind: enumOf(ProductKind).optional(),
    status: enumOf(MasterStatus).optional(),
    purchasableOnly: boolQuery,
    stockedOnly: boolQuery,
    batchTrackedOnly: boolQuery,
    supplierId: uuid.optional(),
    locationId: uuid.optional(),
    belowReorderLevel: boolQuery,
    includeStock: boolQuery,
  })
  .strict();

export const createProductSchema = z
  .object({
    id: uuid.optional(),
    categoryId: uuid.nullable().optional(),
    name: text(LIMITS.PRODUCT_NAME_MAX, 'Product name'),
    nameHi: optionalText(LIMITS.PRODUCT_NAME_MAX),
    unit: z.string().trim().min(1).max(LIMITS.UNIT_MAX).optional(),
    status: enumOf(MasterStatus).optional(),
    sortOrder,

    code: optionalText(LIMITS.PRODUCT_CODE_MAX),
    barcode: optionalText(LIMITS.PRODUCT_BARCODE_MAX),
    brand: optionalText(LIMITS.PRODUCT_BRAND_MAX),
    description: optionalText(LIMITS.PRODUCT_DESCRIPTION_MAX),
    kind: enumOf(ProductKind).optional(),

    hsnSacId: uuid.nullable().optional(),
    taxProfileId: uuid.nullable().optional(),

    stockUomId: uuid.nullable().optional(),
    purchaseUomId: uuid.nullable().optional(),
    purchaseConversionFactor: conversionFactor.optional(),
    packSize: optionalText(LIMITS.PRODUCT_PACK_SIZE_MAX),

    isBatchTracked: z.boolean().optional(),
    isExpiryTracked: z.boolean().optional(),
    shelfLifeDays: days,
    batchIssuePolicy: enumOf(BatchIssuePolicy).optional(),

    valuationMethod: enumOf(ValuationMethod).optional(),
    standardCost: cost,

    defaultLocationId: uuid.nullable().optional(),
    preferredSupplierId: uuid.nullable().optional(),
    minStock: stockQuantity,
    reorderLevel: stockQuantity,
    maxStock: stockQuantity,
    leadTimeDays: days,
    isPurchasable: z.boolean().optional(),
    isStocked: z.boolean().optional(),
  })
  .strict();

export const updateProductSchema = createProductSchema
  .omit({ id: true })
  .partial()
  .extend({ expectedRevision: z.coerce.number().int().min(1).optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No changes supplied');

/* --------------------------------------------------------- per-location stock policy --- */

/**
 * `productId` is optional in the body because the path already carries it; when both are sent
 * the service refuses a mismatch rather than silently preferring one.
 */
export const upsertProductLocationSchema = z
  .object({
    id: uuid.optional(),
    productId: uuid.optional(),
    locationId: uuid,
    minStock: stockQuantity,
    reorderLevel: stockQuantity,
    maxStock: stockQuantity,
    isDefaultDestination: z.boolean().optional(),
    bin: optionalText(60),
    status: enumOf(MasterStatus).optional(),
  })
  .strict();

/* ------------------------------------------------------------ supplier ↔ product map --- */

export const supplierProductListQuerySchema = pageQuery
  .extend({
    supplierId: uuid.optional(),
    productId: uuid.optional(),
    status: enumOf(MasterStatus).optional(),
    preferredOnly: boolQuery,
  })
  .strict();

export const upsertSupplierProductSchema = z
  .object({
    id: uuid.optional(),
    supplierId: uuid,
    productId: uuid,
    supplierSku: optionalText(LIMITS.SUPPLIER_SKU_MAX),
    supplierProductName: optionalText(LIMITS.SUPPLIER_PRODUCT_NAME_MAX),
    barcode: optionalText(LIMITS.PRODUCT_BARCODE_MAX),
    purchaseUomId: uuid.nullable().optional(),
    conversionFactor: conversionFactor.optional(),
    packSize: optionalText(LIMITS.PRODUCT_PACK_SIZE_MAX),
    leadTimeDays: days,
    isPreferred: z.boolean().optional(),
    status: enumOf(MasterStatus).optional(),
    notes: optionalText(500),
  })
  .strict();

/**
 * The supplier and the product identify the row, so a patch may restate them but may not
 * change them — the service refuses a different value rather than silently re-pointing the
 * mapping. They are accepted here because an edit form legitimately round-trips the whole
 * record it loaded.
 */
export const updateSupplierProductSchema = upsertSupplierProductSchema
  .omit({ id: true })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No changes supplied');

/* ------------------------------------------------------------ vendor purchase profile --- */

export const vendorListQuerySchema = pageQuery
  .extend({ status: enumOf(MasterStatus).optional() })
  .strict();

export const updateVendorProfileSchema = z
  .object({
    paymentTerms: optionalText(LIMITS.PURCHASE_TERMS_MAX),
    creditDays: z.coerce.number().int().min(0).max(3650).optional(),
    bankName: optionalText(120),
    bankAccount: optionalText(50),
    bankIfsc: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Must be a valid 11-character IFSC')
      .nullable()
      .optional()
      .or(z.literal('').transform(() => null)),
    openingBalance: z.coerce.number().min(-LIMITS.PRICE_MAX).max(LIMITS.PRICE_MAX).optional(),
    isApproved: z.boolean().optional(),
    defaultLocationId: uuid.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No changes supplied');
