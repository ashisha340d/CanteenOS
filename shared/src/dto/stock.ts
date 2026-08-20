import type {
  InventoryLocationKind,
  StockAdjustmentReason,
  StockAdjustmentStatus,
  StockCountStatus,
  StockMovementType,
  StockSourceType,
} from '../enums';
import type { IsoDate, IsoDateTime, PageQuery, Uuid } from './common';

/**
 * Inventory contracts: balances, the stock ledger, batches, adjustments and counts.
 *
 * The ledger is read-only over the wire. There is no create/update/delete endpoint for it and
 * there never will be — movements appear because a document posted them, and a mistake is
 * corrected by posting its opposite.
 */

/* --------------------------------------------------------------------------- balances --- */

export interface StockBalanceDto {
  id: Uuid;
  productId: Uuid;
  locationId: Uuid;
  batchId: Uuid | null;
  quantity: number;
  /** Committed to a transfer or production order but not yet issued. */
  reservedQuantity: number;
  /** quantity − reservedQuantity. What a requirement calculation may actually rely on. */
  availableQuantity: number;
  averageCost: number;
  stockValue: number;
  lastMovementAt: IsoDateTime | null;
  productName?: string;
  productCode?: string | null;
  productUnit?: string;
  locationName?: string;
  locationKind?: InventoryLocationKind;
  batchNumber?: string | null;
  expiryDate?: IsoDate | null;
  /** Days until expiry; negative once expired. Absent when the batch has no expiry. */
  daysToExpiry?: number | null;
  reorderLevel?: number | null;
  isBelowReorderLevel?: boolean;
}

export interface StockBalanceListQuery extends PageQuery {
  productId?: Uuid;
  locationId?: Uuid;
  categoryId?: Uuid;
  /** Hide rows that have settled back to zero. On by default in the UI. */
  nonZeroOnly?: boolean;
  belowReorderLevel?: boolean;
  expiringWithinDays?: number;
  batchTrackedOnly?: boolean;
}

/** Headline figures for a location, or for the whole operation when no location is given. */
export interface StockSummaryDto {
  locationId: Uuid | null;
  locationName: string | null;
  distinctProducts: number;
  totalStockValue: number;
  belowReorderCount: number;
  expiringSoonCount: number;
  expiredCount: number;
  negativeBalanceCount: number;
}

/* ----------------------------------------------------------------------------- ledger --- */

export interface StockLedgerEntryDto {
  id: Uuid;
  /** Strict total order of movements. Sort by this, never by timestamp. */
  ledgerSeq: number;
  productId: Uuid;
  locationId: Uuid;
  batchId: Uuid | null;
  movementType: StockMovementType;
  direction: 'IN' | 'OUT';
  quantityIn: number;
  quantityOut: number;
  unitCost: number;
  movementValue: number;
  /** The location's balance for this product immediately after this movement. */
  balanceQuantity: number;
  balanceValue: number;
  sourceType: StockSourceType;
  sourceId: Uuid;
  sourceLineId: Uuid | null;
  sourceDocumentNumber: string | null;
  counterpartyLocationId: Uuid | null;
  occurredAt: IsoDateTime;
  businessDate: IsoDate;
  actorId: Uuid | null;
  notes: string | null;
  createdAt: IsoDateTime;
  productName?: string;
  locationName?: string;
  batchNumber?: string | null;
  expiryDate?: IsoDate | null;
  actorName?: string | null;
  counterpartyLocationName?: string | null;
}

export interface StockLedgerListQuery extends PageQuery {
  productId?: Uuid;
  locationId?: Uuid;
  batchId?: Uuid;
  movementType?: StockMovementType[];
  sourceType?: StockSourceType;
  sourceId?: Uuid;
  dateFrom?: IsoDate;
  dateTo?: IsoDate;
}

/* ----------------------------------------------------------------------------- batches --- */

export interface StockBatchDto {
  id: Uuid;
  productId: Uuid;
  batchNumber: string | null;
  manufacturingDate: IsoDate | null;
  expiryDate: IsoDate | null;
  supplierId: Uuid | null;
  firstReceivedAt: IsoDateTime;
  initialQuantity: number;
  unitCost: number;
  sourceType: StockSourceType;
  sourceId: Uuid | null;
  status: 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED' | 'QUARANTINED';
  notes: string | null;
  createdAt: IsoDateTime;
  productName?: string;
  supplierName?: string | null;
  /** Remaining across every location, or at one location when the query narrowed it. */
  quantityOnHand?: number;
  daysToExpiry?: number | null;
}

export interface StockBatchListQuery extends PageQuery {
  productId?: Uuid;
  locationId?: Uuid;
  status?: StockBatchDto['status'];
  expiringWithinDays?: number;
  onHandOnly?: boolean;
}

/* ------------------------------------------------------------------------ adjustments --- */

export interface StockAdjustmentLineDto {
  id: Uuid;
  adjustmentId: Uuid;
  productId: Uuid;
  batchId: Uuid | null;
  direction: 'IN' | 'OUT';
  quantity: number;
  unitCost: number;
  lineValue: number;
  /** What the system believed when the line was raised. Null on a free-standing adjustment. */
  systemQuantity: number | null;
  reason: StockAdjustmentReason | null;
  notes: string | null;
  sortOrder: number;
  productName?: string;
  productUnit?: string;
  batchNumber?: string | null;
}

export interface StockAdjustmentDto {
  id: Uuid;
  adjustmentNumber: string;
  businessDate: IsoDate;
  locationId: Uuid;
  reason: StockAdjustmentReason;
  status: StockAdjustmentStatus;
  stockCountId: Uuid | null;
  notes: string | null;
  totalInValue: number;
  totalOutValue: number;
  createdBy: Uuid;
  submittedBy: Uuid | null;
  submittedAt: IsoDateTime | null;
  approvedBy: Uuid | null;
  approvedAt: IsoDateTime | null;
  postedBy: Uuid | null;
  postedAt: IsoDateTime | null;
  cancelledBy: Uuid | null;
  cancelledAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  revision: number;
  locationName?: string;
  createdByName?: string | null;
  postedByName?: string | null;
  lineCount?: number;
  lines?: StockAdjustmentLineDto[];
}

export interface CreateStockAdjustmentRequest {
  id?: Uuid;
  locationId: Uuid;
  reason: StockAdjustmentReason;
  businessDate?: IsoDate;
  notes?: string | null;
  lines: CreateStockAdjustmentLineRequest[];
}

export interface CreateStockAdjustmentLineRequest {
  id?: Uuid;
  productId: Uuid;
  batchId?: Uuid | null;
  direction: 'IN' | 'OUT';
  quantity: number;
  /** Only honoured on an IN line; stock leaves at the valuation it is held at. */
  unitCost?: number;
  reason?: StockAdjustmentReason | null;
  notes?: string | null;
}

export interface UpdateStockAdjustmentRequest {
  locationId?: Uuid;
  reason?: StockAdjustmentReason;
  notes?: string | null;
  lines?: CreateStockAdjustmentLineRequest[];
  expectedRevision?: number;
}

export interface StockAdjustmentListQuery extends PageQuery {
  locationId?: Uuid;
  status?: StockAdjustmentStatus;
  reason?: StockAdjustmentReason;
  dateFrom?: IsoDate;
  dateTo?: IsoDate;
}

/* ----------------------------------------------------------------------------- counts --- */

export interface StockCountLineDto {
  id: Uuid;
  stockCountId: Uuid;
  productId: Uuid;
  batchId: Uuid | null;
  /** Snapshotted when the sheet was raised, so variance is measured against that moment. */
  systemQuantity: number;
  physicalQuantity: number | null;
  varianceQuantity: number;
  unitCost: number;
  varianceValue: number;
  reason: StockAdjustmentReason | null;
  notes: string | null;
  isCounted: boolean;
  sortOrder: number;
  productName?: string;
  productCode?: string | null;
  productUnit?: string;
  batchNumber?: string | null;
}

export interface StockCountDto {
  id: Uuid;
  countNumber: string;
  businessDate: IsoDate;
  locationId: Uuid;
  status: StockCountStatus;
  isFullCount: boolean;
  notes: string | null;
  /** Set once approval turned the variance into a posted adjustment. */
  adjustmentId: Uuid | null;
  countedBy: Uuid | null;
  countedAt: IsoDateTime | null;
  createdBy: Uuid;
  submittedBy: Uuid | null;
  submittedAt: IsoDateTime | null;
  approvedBy: Uuid | null;
  approvedAt: IsoDateTime | null;
  postedAt: IsoDateTime | null;
  cancelledBy: Uuid | null;
  cancelledAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  revision: number;
  locationName?: string;
  createdByName?: string | null;
  adjustmentNumber?: string | null;
  lineCount?: number;
  countedLineCount?: number;
  varianceLineCount?: number;
  totalVarianceValue?: number;
  lines?: StockCountLineDto[];
}

export interface CreateStockCountRequest {
  id?: Uuid;
  locationId: Uuid;
  businessDate?: IsoDate;
  /** Full count snapshots every product holding stock; otherwise supply `productIds`. */
  isFullCount?: boolean;
  productIds?: Uuid[];
  categoryId?: Uuid;
  notes?: string | null;
}

export interface RecordStockCountLinesRequest {
  lines: {
    lineId: Uuid;
    physicalQuantity: number | null;
    reason?: StockAdjustmentReason | null;
    notes?: string | null;
  }[];
  expectedRevision?: number;
}

export interface StockCountListQuery extends PageQuery {
  locationId?: Uuid;
  status?: StockCountStatus;
  dateFrom?: IsoDate;
  dateTo?: IsoDate;
}

/** What approving a count produced. */
export interface StockCountApprovalResultDto {
  count: StockCountDto;
  /** Null when every line matched and there was nothing to adjust. */
  adjustment: StockAdjustmentDto | null;
}
