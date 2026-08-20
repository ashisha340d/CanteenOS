import type {
  BatchIssuePolicy,
  HsnSacCodeType,
  InventoryLocationKind,
  MasterStatus,
  ProductKind,
  UomDimension,
  ValuationMethod,
} from '../enums';
import type { IsoDateTime, PageQuery, SyncMeta, Uuid } from './common';

/**
 * Purchase and inventory master data contracts.
 *
 * Document contracts (requirement, order, entry, receipt, invoice, return, memo, payment)
 * live alongside these as each is built; this file is the masters they all reference.
 */

/* ------------------------------------------------------------------ units of measure --- */

export interface UomDto {
  id: Uuid;
  code: string;
  name: string;
  dimension: UomDimension;
  /** The unit others in this dimension convert through. Exactly one per dimension. */
  isBase: boolean;
  /** How many base units one of this unit is worth. KG -> GM is 1000. */
  factorToBase: number;
  /** How many decimals a quantity in this unit should show. NOS is 0, KG is 3. */
  decimalPlaces: number;
  status: MasterStatus;
  sortOrder: number;
  createdBy: Uuid | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CreateUomRequest {
  id?: Uuid;
  code: string;
  name: string;
  dimension: UomDimension;
  isBase?: boolean;
  factorToBase?: number;
  decimalPlaces?: number;
  status?: MasterStatus;
  sortOrder?: number;
}

export type UpdateUomRequest = Partial<Omit<CreateUomRequest, 'id'>>;

export interface UomListQuery extends PageQuery {
  dimension?: UomDimension;
  status?: MasterStatus;
}

/* --------------------------------------------------------------- inventory locations --- */

export interface InventoryLocationDto {
  id: Uuid;
  code: string;
  name: string;
  nameHi: string | null;
  kind: InventoryLocationKind;
  parentId: Uuid | null;
  counterId: Uuid | null;
  stationId: Uuid | null;
  department: string | null;
  /** Where a goods receipt defaults to when nothing more specific applies. At most one. */
  isDefaultReceiving: boolean;
  /**
   * Whether an issue may drive this location's balance below zero. Off for a warehouse,
   * where negative stock means somebody miscounted; frequently on for a kitchen, where the
   * paperwork legitimately trails the cooking.
   */
  allowsNegativeStock: boolean;
  status: MasterStatus;
  sortOrder: number;
  notes: string | null;
  createdBy: Uuid | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
  revision: number;
  /** Joined for display. */
  parentName?: string | null;
}

export interface CreateInventoryLocationRequest {
  id?: Uuid;
  code: string;
  name: string;
  nameHi?: string | null;
  kind: InventoryLocationKind;
  parentId?: Uuid | null;
  counterId?: Uuid | null;
  stationId?: Uuid | null;
  department?: string | null;
  isDefaultReceiving?: boolean;
  allowsNegativeStock?: boolean;
  status?: MasterStatus;
  sortOrder?: number;
  notes?: string | null;
}

export interface UpdateInventoryLocationRequest
  extends Partial<Omit<CreateInventoryLocationRequest, 'id'>> {
  expectedRevision?: number;
}

export interface InventoryLocationListQuery extends PageQuery {
  kind?: InventoryLocationKind;
  parentId?: Uuid;
  status?: MasterStatus;
}

/* -------------------------------------------------------------------- product master --- */

export interface ProductDto extends SyncMeta {
  id: Uuid;
  categoryId: Uuid | null;
  name: string;
  nameHi: string | null;
  /** Human-readable stock unit. Kept alongside `stockUomId` because recipes display it. */
  unit: string;
  status: MasterStatus;
  sortOrder: number;
  createdBy: Uuid | null;

  code: string | null;
  barcode: string | null;
  brand: string | null;
  description: string | null;
  kind: ProductKind;

  hsnSacId: Uuid | null;
  taxProfileId: Uuid | null;

  stockUomId: Uuid | null;
  purchaseUomId: Uuid | null;
  /** How many stock units one purchase unit yields. A CASE of 12 bottles is 12. */
  purchaseConversionFactor: number;
  packSize: string | null;

  isBatchTracked: boolean;
  isExpiryTracked: boolean;
  shelfLifeDays: number | null;
  batchIssuePolicy: BatchIssuePolicy;

  valuationMethod: ValuationMethod;
  standardCost: number | null;
  movingAverageCost: number;
  lastPurchaseRate: number | null;
  lastPurchasedAt: IsoDateTime | null;

  defaultLocationId: Uuid | null;
  preferredSupplierId: Uuid | null;
  minStock: number | null;
  reorderLevel: number | null;
  maxStock: number | null;
  leadTimeDays: number | null;
  isPurchasable: boolean;
  isStocked: boolean;

  /** Joined for display; absent rather than null when the query did not ask for them. */
  categoryName?: string | null;
  stockUomCode?: string | null;
  purchaseUomCode?: string | null;
  taxProfileName?: string | null;
  taxRate?: number | null;
  hsnSacCode?: string | null;
  hsnSacCodeType?: HsnSacCodeType | null;
  defaultLocationName?: string | null;
  preferredSupplierName?: string | null;
  /** Total on hand across every location. Only present on queries that ask for stock. */
  stockOnHand?: number;
}

export interface CreateProductRequest {
  id?: Uuid;
  categoryId?: Uuid | null;
  name: string;
  nameHi?: string | null;
  unit?: string;
  status?: MasterStatus;
  sortOrder?: number;

  code?: string | null;
  barcode?: string | null;
  brand?: string | null;
  description?: string | null;
  kind?: ProductKind;

  hsnSacId?: Uuid | null;
  taxProfileId?: Uuid | null;

  stockUomId?: Uuid | null;
  purchaseUomId?: Uuid | null;
  purchaseConversionFactor?: number;
  packSize?: string | null;

  isBatchTracked?: boolean;
  isExpiryTracked?: boolean;
  shelfLifeDays?: number | null;
  batchIssuePolicy?: BatchIssuePolicy;

  valuationMethod?: ValuationMethod;
  standardCost?: number | null;

  defaultLocationId?: Uuid | null;
  preferredSupplierId?: Uuid | null;
  minStock?: number | null;
  reorderLevel?: number | null;
  maxStock?: number | null;
  leadTimeDays?: number | null;
  isPurchasable?: boolean;
  isStocked?: boolean;
}

export interface UpdateProductRequest extends Partial<Omit<CreateProductRequest, 'id'>> {
  expectedRevision?: number;
}

export interface ProductListQuery extends PageQuery {
  categoryId?: Uuid;
  kind?: ProductKind;
  status?: MasterStatus;
  /** Restrict to products that may be bought. The purchase entry picker sets this. */
  purchasableOnly?: boolean;
  /** Restrict to products that hold stock. */
  stockedOnly?: boolean;
  batchTrackedOnly?: boolean;
  supplierId?: Uuid;
  locationId?: Uuid;
  /** Only products at or below their reorder level. Drives requirement generation. */
  belowReorderLevel?: boolean;
  includeStock?: boolean;
}

/* --------------------------------------------------------- per-location stock policy --- */

export interface ProductLocationDto {
  id: Uuid;
  productId: Uuid;
  locationId: Uuid;
  minStock: number | null;
  reorderLevel: number | null;
  maxStock: number | null;
  isDefaultDestination: boolean;
  bin: string | null;
  status: MasterStatus;
  createdBy: Uuid | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  productName?: string;
  locationName?: string;
  locationKind?: InventoryLocationKind;
}

export interface UpsertProductLocationRequest {
  id?: Uuid;
  productId: Uuid;
  locationId: Uuid;
  minStock?: number | null;
  reorderLevel?: number | null;
  maxStock?: number | null;
  isDefaultDestination?: boolean;
  bin?: string | null;
  status?: MasterStatus;
}

/* ------------------------------------------------------------ supplier ↔ product map --- */

export interface SupplierProductDto {
  id: Uuid;
  supplierId: Uuid;
  productId: Uuid;
  supplierSku: string | null;
  supplierProductName: string | null;
  barcode: string | null;
  purchaseUomId: Uuid | null;
  conversionFactor: number;
  packSize: string | null;
  lastRate: number | null;
  lastPurchasedAt: IsoDateTime | null;
  leadTimeDays: number | null;
  isPreferred: boolean;
  status: MasterStatus;
  notes: string | null;
  createdBy: Uuid | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  supplierName?: string;
  productName?: string;
  productUnit?: string;
  purchaseUomCode?: string | null;
}

export interface UpsertSupplierProductRequest {
  id?: Uuid;
  supplierId: Uuid;
  productId: Uuid;
  supplierSku?: string | null;
  supplierProductName?: string | null;
  barcode?: string | null;
  purchaseUomId?: Uuid | null;
  conversionFactor?: number;
  packSize?: string | null;
  leadTimeDays?: number | null;
  isPreferred?: boolean;
  status?: MasterStatus;
  notes?: string | null;
}

export interface SupplierProductListQuery extends PageQuery {
  supplierId?: Uuid;
  productId?: Uuid;
  status?: MasterStatus;
  preferredOnly?: boolean;
}

/* ------------------------------------------------------------ vendor purchase profile --- */

/**
 * The purchase-facing half of an `entities` row of type VENDOR. Read and written through the
 * entity master rather than a parallel vendor endpoint, so there is one supplier record.
 */
export interface VendorProfileDto {
  entityId: Uuid;
  paymentTerms: string | null;
  creditDays: number;
  bankName: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  openingBalance: number;
  /** An unapproved supplier can still be transacted with, but posting raises an exception. */
  isApproved: boolean;
  defaultLocationId: Uuid | null;
}

export interface UpdateVendorProfileRequest {
  paymentTerms?: string | null;
  creditDays?: number;
  bankName?: string | null;
  bankAccount?: string | null;
  bankIfsc?: string | null;
  openingBalance?: number;
  isApproved?: boolean;
  defaultLocationId?: Uuid | null;
}

/**
 * A supplier as the purchase screens need them: the entity fields that matter at the point
 * of buying, plus the purchase profile, in one payload so the header can populate itself
 * from a single lookup.
 */
export interface VendorSummaryDto {
  id: Uuid;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  stateCode: string | null;
  gstin: string | null;
  pan: string | null;
  creditLimit: number;
  accountBalance: number;
  status: MasterStatus;
  profile: VendorProfileDto;
  /** Unpaid and partially paid invoice value. Present on lookups that ask for it. */
  outstanding?: number;
}
