import type {
  GoodsReceiptStatus,
  MatchStatus,
  PayableStatus,
  PurchaseInvoiceStatus,
  PurchasePaymentMethod,
  QcStatus,
  RejectionReason,
  VendorLedgerTxnType,
  VendorPaymentStatus,
} from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db, type RowDataPacket } from '../db/types';
import { toDbDateTime } from '../utils/time';

/**
 * Data access for everything a posted purchase entry generates: the goods receipt with its
 * lines and split destinations, the purchase invoice with its lines, vendor payments and their
 * allocations, plus the read projections over the vendor ledger and accounts payable.
 *
 * Two boundaries this file respects absolutely:
 *   - it never writes `stock_ledger` or `stock_balances`  — StockLedgerService owns those;
 *   - it never writes `vendor_ledger_entries`, `accounts_payable` or
 *     `vendor_payment_allocations` — VendorLedgerService owns those. The reads below are
 *     reads.
 */

/* ------------------------------------------------------------------------ row types --- */

export interface GoodsReceiptRow extends RowDataPacket {
  id: string;
  grn_number: string;
  daily_sequence: number;
  business_date: string;
  receipt_date: string;
  supplier_id: string;
  purchase_entry_id: string | null;
  purchase_order_id: string | null;
  delivery_note: string | null;
  location_id: string;
  status: GoodsReceiptStatus;
  notes: string | null;
  received_by: string | null;
  qc_by: string | null;
  qc_at: string | null;
  created_by: string;
  posted_by: string | null;
  posted_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
  supplier_name?: string;
  location_name?: string;
  line_count?: string | number;
}

export interface GoodsReceiptLineRow extends RowDataPacket {
  id: string;
  goods_receipt_id: string;
  product_id: string;
  purchase_entry_line_id: string | null;
  purchase_order_line_id: string | null;
  ordered_quantity: string;
  previously_received: string;
  billed_quantity: string;
  received_quantity: string;
  accepted_quantity: string;
  rejected_quantity: string;
  purchase_uom_id: string | null;
  stock_uom_id: string | null;
  conversion_factor: string;
  accepted_stock_quantity: string;
  purchase_rate: string;
  batch_number: string | null;
  manufacturing_date: string | null;
  expiry_date: string | null;
  batch_id: string | null;
  qc_status: QcStatus;
  rejection_reason: RejectionReason | null;
  rejection_notes: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  product_name?: string;
  product_unit?: string;
}

export interface GoodsReceiptDestinationRow extends RowDataPacket {
  id: string;
  goods_receipt_line_id: string;
  location_id: string;
  quantity: string;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  location_name?: string;
  location_kind?: string;
}

export interface PurchaseInvoiceRow extends RowDataPacket {
  id: string;
  invoice_number: string;
  daily_sequence: number;
  business_date: string;
  supplier_id: string;
  supplier_invoice_number: string;
  supplier_invoice_date: string;
  due_date: string | null;
  credit_days: number;
  purchase_entry_id: string | null;
  goods_receipt_id: string | null;
  purchase_order_id: string | null;
  location_id: string | null;
  status: PurchaseInvoiceStatus;
  match_status: MatchStatus;
  payment_method: PurchasePaymentMethod;
  payment_status: PayableStatus;
  supplier_state_code: string | null;
  is_inter_state: number;
  subtotal_amount: string;
  discount_amount: string;
  taxable_amount: string;
  cgst_amount: string;
  sgst_amount: string;
  igst_amount: string;
  cess_amount: string;
  tax_amount: string;
  round_off_amount: string;
  other_charges: string;
  total_amount: string;
  paid_amount: string;
  outstanding_amount: string;
  reference: string | null;
  notes: string | null;
  attachment_id: string | null;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  posted_by: string | null;
  posted_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
  supplier_name?: string;
  supplier_gstin?: string | null;
  line_count?: string | number;
}

export interface PurchaseInvoiceLineRow extends RowDataPacket {
  id: string;
  invoice_id: string;
  product_id: string | null;
  description: string | null;
  goods_receipt_line_id: string | null;
  purchase_entry_line_id: string | null;
  quantity: string;
  uom_id: string | null;
  rate: string;
  discount_percent: string;
  discount_amount: string;
  gross_amount: string;
  taxable_amount: string;
  tax_profile_id: string | null;
  hsn_sac_code: string | null;
  tax_rate: string;
  cgst_amount: string;
  sgst_amount: string;
  igst_amount: string;
  cess_amount: string;
  tax_amount: string;
  line_total: string;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  product_name?: string;
  uom_code?: string | null;
}

export interface VendorLedgerEntryRow extends RowDataPacket {
  id: string;
  entry_seq: string | number;
  supplier_id: string;
  business_date: string;
  transaction_type: VendorLedgerTxnType;
  document_number: string | null;
  source_type: string;
  source_id: string;
  reference: string | null;
  narration: string | null;
  debit_amount: string;
  credit_amount: string;
  running_balance: string;
  occurred_at: string;
  actor_id: string | null;
  created_at: string;
  actor_name?: string | null;
}

export interface AccountsPayableRow extends RowDataPacket {
  id: string;
  supplier_id: string;
  purchase_invoice_id: string;
  document_number: string;
  supplier_invoice_number: string | null;
  invoice_date: string;
  due_date: string | null;
  credit_days: number;
  original_amount: string;
  paid_amount: string;
  adjusted_amount: string;
  outstanding_amount: string;
  status: PayableStatus;
  is_queued: number;
  queued_by: string | null;
  queued_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  supplier_name?: string;
  days_overdue?: number | null;
}

export interface VendorPaymentRow extends RowDataPacket {
  id: string;
  payment_number: string;
  daily_sequence: number;
  business_date: string;
  supplier_id: string;
  payment_date: string;
  method: PurchasePaymentMethod;
  status: VendorPaymentStatus;
  amount: string;
  unallocated_amount: string;
  reference: string | null;
  instrument_number: string | null;
  instrument_date: string | null;
  bank_name: string | null;
  notes: string | null;
  purchase_entry_id: string | null;
  created_by: string;
  posted_by: string | null;
  posted_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
  supplier_name?: string;
}

export interface VendorPaymentAllocationRow extends RowDataPacket {
  id: string;
  payment_id: string;
  accounts_payable_id: string;
  purchase_invoice_id: string;
  allocated_amount: string;
  created_at: string;
  document_number?: string;
  supplier_invoice_number?: string | null;
  invoice_date?: string;
  invoice_total?: string;
}

export interface VendorAgeingRow extends RowDataPacket {
  supplier_id: string;
  supplier_name: string;
  supplier_code: string;
  not_due: string | null;
  days_0_30: string | null;
  days_31_60: string | null;
  days_61_90: string | null;
  over_90: string | null;
  total: string | null;
  oldest_due_date: string | null;
}

/** A product read for the purposes of pricing and posting a purchase line. */
export interface PurchaseProductRow extends RowDataPacket {
  id: string;
  name: string;
  code: string | null;
  unit: string;
  kind: string;
  tax_profile_id: string | null;
  stock_uom_id: string | null;
  purchase_uom_id: string | null;
  purchase_conversion_factor: string;
  is_batch_tracked: number;
  is_expiry_tracked: number;
  is_stocked: number;
  default_location_id: string | null;
  last_purchase_rate: string | null;
  hsn_code: string | null;
}

export interface TaxProfileRow extends RowDataPacket {
  id: string;
  gst_taxability: string;
  gst_rate: string;
  cgst_rate: string;
  sgst_rate: string;
  igst_rate: string;
  cess_rate: string;
  price_is_inclusive: number;
}

export interface SupplierRow extends RowDataPacket {
  id: string;
  code: string;
  name: string;
  state_code: string | null;
  gstin: string | null;
  vendor_credit_days: number;
  vendor_is_approved: number;
  vendor_default_location_id: string | null;
}

export interface SupplierProductMappingRow extends RowDataPacket {
  id: string;
  supplier_id: string;
  product_id: string;
  supplier_sku: string | null;
  purchase_uom_id: string | null;
  conversion_factor: string;
  last_rate: string | null;
}

export interface IdempotencyRow extends RowDataPacket {
  id: string;
  idempotency_key: string;
  operation: string;
  request_hash: string;
  result_type: string | null;
  result_id: string | null;
  result_number: string | null;
  actor_id: string | null;
  created_at: string;
}

/* --------------------------------------------------------------------------- inputs --- */

export interface InsertGoodsReceiptInput {
  id: string;
  grnNumber: string;
  dailySequence: number;
  businessDate: string;
  receiptDate: string;
  supplierId: string;
  purchaseEntryId: string | null;
  purchaseOrderId: string | null;
  deliveryNote: string | null;
  locationId: string;
  status: GoodsReceiptStatus;
  notes: string | null;
  receivedBy: string | null;
  qcBy: string | null;
  qcAt: string | null;
  createdBy: string | null;
  postedBy: string | null;
  postedAt: string | null;
}

export interface InsertGoodsReceiptLineInput {
  id: string;
  goodsReceiptId: string;
  productId: string;
  purchaseEntryLineId: string | null;
  purchaseOrderLineId: string | null;
  orderedQuantity: number;
  previouslyReceived: number;
  billedQuantity: number;
  receivedQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  purchaseUomId: string | null;
  stockUomId: string | null;
  conversionFactor: number;
  acceptedStockQuantity: number;
  purchaseRate: number;
  batchNumber: string | null;
  manufacturingDate: string | null;
  expiryDate: string | null;
  qcStatus: QcStatus;
  rejectionReason: RejectionReason | null;
  rejectionNotes: string | null;
  notes: string | null;
  sortOrder: number;
}

export interface InsertDestinationInput {
  id: string;
  goodsReceiptLineId: string;
  locationId: string;
  quantity: number;
  notes: string | null;
  sortOrder: number;
}

export interface InsertPurchaseInvoiceInput {
  id: string;
  invoiceNumber: string;
  dailySequence: number;
  businessDate: string;
  supplierId: string;
  supplierInvoiceNumber: string;
  supplierInvoiceDate: string;
  dueDate: string | null;
  creditDays: number;
  purchaseEntryId: string | null;
  goodsReceiptId: string | null;
  purchaseOrderId: string | null;
  locationId: string | null;
  status: PurchaseInvoiceStatus;
  matchStatus: MatchStatus;
  paymentMethod: PurchasePaymentMethod;
  paymentStatus: PayableStatus;
  supplierStateCode: string | null;
  isInterState: boolean;
  subtotalAmount: number;
  discountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  taxAmount: number;
  roundOffAmount: number;
  otherCharges: number;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  reference: string | null;
  notes: string | null;
  attachmentId: string | null;
  createdBy: string | null;
  postedBy: string | null;
  postedAt: string | null;
}

export interface InsertPurchaseInvoiceLineInput {
  id: string;
  invoiceId: string;
  productId: string | null;
  description: string | null;
  goodsReceiptLineId: string | null;
  purchaseEntryLineId: string | null;
  quantity: number;
  uomId: string | null;
  rate: number;
  discountPercent: number;
  discountAmount: number;
  grossAmount: number;
  taxableAmount: number;
  taxProfileId: string | null;
  hsnSacCode: string | null;
  taxRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  taxAmount: number;
  lineTotal: number;
  notes: string | null;
  sortOrder: number;
}

export interface InsertVendorPaymentInput {
  id: string;
  paymentNumber: string;
  dailySequence: number;
  businessDate: string;
  supplierId: string;
  paymentDate: string;
  method: PurchasePaymentMethod;
  status: VendorPaymentStatus;
  amount: number;
  unallocatedAmount: number;
  reference: string | null;
  instrumentNumber: string | null;
  instrumentDate: string | null;
  bankName: string | null;
  notes: string | null;
  purchaseEntryId: string | null;
  createdBy: string | null;
  postedBy: string | null;
  postedAt: string | null;
}

export interface InsertPriceHistoryInput {
  id: string;
  productId: string;
  supplierId: string;
  businessDate: string;
  sourceType: string;
  sourceId: string;
  documentNumber: string | null;
  quantity: number;
  uomId: string | null;
  rate: number;
  discountPercent: number;
  taxRate: number;
  netRatePerStockUnit: number;
}

export interface GoodsReceiptListFilter {
  supplierId?: string;
  status?: GoodsReceiptStatus;
  locationId?: string;
  purchaseEntryId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  offset: number;
}

export interface PurchaseInvoiceListFilter {
  supplierId?: string;
  status?: PurchaseInvoiceStatus;
  paymentStatus?: PayableStatus;
  matchStatus?: MatchStatus;
  dateFrom?: string;
  dateTo?: string;
  overdueOnly?: boolean;
  limit: number;
  offset: number;
}

export interface VendorLedgerListFilter {
  supplierId?: string;
  transactionType?: VendorLedgerTxnType;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  offset: number;
}

export interface PayableListFilter {
  supplierId?: string;
  status?: PayableStatus;
  queuedOnly?: boolean;
  overdueOnly?: boolean;
  dueBefore?: string;
  limit: number;
  offset: number;
}

export interface VendorPaymentListFilter {
  supplierId?: string;
  status?: VendorPaymentStatus;
  method?: PurchasePaymentMethod;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  offset: number;
}

/* ------------------------------------------------------------------------------ SQL --- */

const GRN_SELECT = `
  SELECT gr.*, s.name AS supplier_name, il.name AS location_name,
         (SELECT COUNT(*) FROM goods_receipt_lines l WHERE l.goods_receipt_id = gr.id) AS line_count
    FROM goods_receipts gr
    JOIN entities s ON s.id = gr.supplier_id
    JOIN inventory_locations il ON il.id = gr.location_id`;

const INVOICE_SELECT = `
  SELECT pi.*, s.name AS supplier_name, s.gstin AS supplier_gstin,
         (SELECT COUNT(*) FROM purchase_invoice_lines l WHERE l.invoice_id = pi.id) AS line_count
    FROM purchase_invoices pi
    JOIN entities s ON s.id = pi.supplier_id`;

const PAYMENT_SELECT = `
  SELECT vp.*, s.name AS supplier_name
    FROM vendor_payments vp
    JOIN entities s ON s.id = vp.supplier_id`;

function whereOf(conditions: readonly string[]): string {
  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
}

async function countOf(db: Db, sql: string, params: readonly unknown[]): Promise<number> {
  const row = await selectOne<RowDataPacket & { total: string | number }>(db, sql, params);
  return row === null ? 0 : Number(row.total);
}

export class PurchaseDocumentRepository {
  /* -------------------------------------------------------------- master lookups */

  async findSupplier(db: Db, id: string): Promise<SupplierRow | null> {
    return selectOne<SupplierRow>(
      db,
      `SELECT id, code, name, state_code, gstin, vendor_credit_days, vendor_is_approved,
              vendor_default_location_id
         FROM entities WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  async findProducts(db: Db, ids: readonly string[]): Promise<PurchaseProductRow[]> {
    if (ids.length === 0) return [];
    return selectRows<PurchaseProductRow>(
      db,
      `SELECT p.id, p.name, p.code, p.unit, p.kind, p.tax_profile_id, p.stock_uom_id,
              p.purchase_uom_id, p.purchase_conversion_factor, p.is_batch_tracked,
              p.is_expiry_tracked, p.is_stocked, p.default_location_id, p.last_purchase_rate,
              h.code AS hsn_code
         FROM products p
         LEFT JOIN hsn_sac_master h ON h.id = p.hsn_sac_id
        WHERE p.id IN (${ids.map(() => '?').join(', ')}) AND p.deleted_at IS NULL`,
      ids,
    );
  }

  async findTaxProfiles(db: Db, ids: readonly string[]): Promise<TaxProfileRow[]> {
    if (ids.length === 0) return [];
    return selectRows<TaxProfileRow>(
      db,
      `SELECT id, gst_taxability, gst_rate, cgst_rate, sgst_rate, igst_rate, cess_rate,
              price_is_inclusive
         FROM tax_profiles
        WHERE id IN (${ids.map(() => '?').join(', ')}) AND deleted_at IS NULL`,
      ids,
    );
  }

  async findSupplierProducts(
    db: Db,
    supplierId: string,
    productIds: readonly string[],
  ): Promise<SupplierProductMappingRow[]> {
    if (productIds.length === 0) return [];
    return selectRows<SupplierProductMappingRow>(
      db,
      `SELECT id, supplier_id, product_id, supplier_sku, purchase_uom_id, conversion_factor,
              last_rate
         FROM supplier_products
        WHERE supplier_id = ? AND product_id IN (${productIds.map(() => '?').join(', ')})
          AND deleted_at IS NULL`,
      [supplierId, ...productIds],
    );
  }

  /** The location flagged `is_default_receiving`, the last fallback for a destination. */
  async findDefaultReceivingLocation(db: Db): Promise<string | null> {
    const row = await selectOne<RowDataPacket & { id: string }>(
      db,
      `SELECT id FROM inventory_locations
        WHERE is_default_receiving = 1 AND status = 'ACTIVE' AND deleted_at IS NULL
        ORDER BY sort_order ASC LIMIT 1`,
    );
    return row === null ? null : row.id;
  }

  /* ------------------------------------------------------- duplicate bill checks */

  /** A posted invoice already carrying this supplier's bill number. The blocking case. */
  async findPostedInvoiceByBill(
    db: Db,
    supplierId: string,
    supplierInvoiceNumber: string,
    excludeEntryId: string | null,
  ): Promise<PurchaseInvoiceRow | null> {
    const params: unknown[] = [supplierId, supplierInvoiceNumber];
    let exclusion = '';
    if (excludeEntryId !== null) {
      exclusion = 'AND (purchase_entry_id IS NULL OR purchase_entry_id <> ?)';
      params.push(excludeEntryId);
    }
    return selectOne<PurchaseInvoiceRow>(
      db,
      `SELECT * FROM purchase_invoices
        WHERE supplier_id = ? AND supplier_invoice_number = ? AND status = 'POSTED' ${exclusion}
        LIMIT 1`,
      params,
    );
  }

  /** Same supplier, same date, same money, a different bill number. The suspicious case. */
  async findSameDayInvoiceByTotal(
    db: Db,
    args: {
      supplierId: string;
      invoiceDate: string;
      totalAmount: number;
      excludeBillNumber: string | null;
      excludeEntryId: string | null;
    },
  ): Promise<PurchaseInvoiceRow | null> {
    const params: unknown[] = [args.supplierId, args.invoiceDate, args.totalAmount];
    let exclusion = '';
    if (args.excludeBillNumber !== null) {
      exclusion += ' AND supplier_invoice_number <> ?';
      params.push(args.excludeBillNumber);
    }
    if (args.excludeEntryId !== null) {
      exclusion += ' AND (purchase_entry_id IS NULL OR purchase_entry_id <> ?)';
      params.push(args.excludeEntryId);
    }
    return selectOne<PurchaseInvoiceRow>(
      db,
      `SELECT * FROM purchase_invoices
        WHERE supplier_id = ? AND supplier_invoice_date = ?
          AND ABS(total_amount - ?) < 0.005 AND status <> 'CANCELLED' ${exclusion}
        LIMIT 1`,
      params,
    );
  }

  /* -------------------------------------------------------------- goods receipts */

  async insertGoodsReceipt(db: Db, input: InsertGoodsReceiptInput): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO goods_receipts
         (id, grn_number, daily_sequence, business_date, receipt_date, supplier_id,
          purchase_entry_id, purchase_order_id, delivery_note, location_id, status, notes,
          received_by, qc_by, qc_at, created_by, posted_by, posted_at, created_at, updated_at,
          revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        input.id,
        input.grnNumber,
        input.dailySequence,
        input.businessDate,
        input.receiptDate,
        input.supplierId,
        input.purchaseEntryId,
        input.purchaseOrderId,
        input.deliveryNote,
        input.locationId,
        input.status,
        input.notes,
        input.receivedBy,
        input.qcBy,
        input.qcAt,
        input.createdBy,
        input.postedBy,
        input.postedAt,
        now,
        now,
      ],
    );
  }

  async insertGoodsReceiptLine(db: Db, input: InsertGoodsReceiptLineInput): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO goods_receipt_lines
         (id, goods_receipt_id, product_id, purchase_entry_line_id, purchase_order_line_id,
          ordered_quantity, previously_received, billed_quantity, received_quantity,
          accepted_quantity, rejected_quantity, purchase_uom_id, stock_uom_id,
          conversion_factor, accepted_stock_quantity, purchase_rate, batch_number,
          manufacturing_date, expiry_date, qc_status, rejection_reason, rejection_notes,
          notes, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.goodsReceiptId,
        input.productId,
        input.purchaseEntryLineId,
        input.purchaseOrderLineId,
        input.orderedQuantity,
        input.previouslyReceived,
        input.billedQuantity,
        input.receivedQuantity,
        input.acceptedQuantity,
        input.rejectedQuantity,
        input.purchaseUomId,
        input.stockUomId,
        input.conversionFactor,
        input.acceptedStockQuantity,
        input.purchaseRate,
        input.batchNumber,
        input.manufacturingDate,
        input.expiryDate,
        input.qcStatus,
        input.rejectionReason,
        input.rejectionNotes,
        input.notes,
        input.sortOrder,
        now,
        now,
      ],
    );
  }

  async insertDestination(db: Db, input: InsertDestinationInput): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO goods_receipt_line_destinations
         (id, goods_receipt_line_id, location_id, quantity, notes, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.goodsReceiptLineId,
        input.locationId,
        input.quantity,
        input.notes,
        input.sortOrder,
        now,
        now,
      ],
    );
  }

  /** Record the batch the ledger resolved for a received line, so the GRN can be traced to it. */
  async setGoodsReceiptLineBatch(db: Db, lineId: string, batchId: string | null): Promise<void> {
    await mutate(
      db,
      'UPDATE goods_receipt_lines SET batch_id = ?, updated_at = ? WHERE id = ?',
      [batchId, toDbDateTime(), lineId],
    );
  }

  async findGoodsReceipt(db: Db, id: string): Promise<GoodsReceiptRow | null> {
    return selectOne<GoodsReceiptRow>(db, `${GRN_SELECT} WHERE gr.id = ?`, [id]);
  }

  async findGoodsReceiptByEntry(db: Db, entryId: string): Promise<GoodsReceiptRow | null> {
    return selectOne<GoodsReceiptRow>(db, `${GRN_SELECT} WHERE gr.purchase_entry_id = ?`, [
      entryId,
    ]);
  }

  async listGoodsReceipts(
    db: Db,
    filter: GoodsReceiptListFilter,
  ): Promise<{ rows: GoodsReceiptRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.supplierId !== undefined) {
      conditions.push('gr.supplier_id = ?');
      params.push(filter.supplierId);
    }
    if (filter.status !== undefined) {
      conditions.push('gr.status = ?');
      params.push(filter.status);
    }
    if (filter.locationId !== undefined) {
      conditions.push('gr.location_id = ?');
      params.push(filter.locationId);
    }
    if (filter.purchaseEntryId !== undefined) {
      conditions.push('gr.purchase_entry_id = ?');
      params.push(filter.purchaseEntryId);
    }
    if (filter.dateFrom !== undefined) {
      conditions.push('gr.business_date >= ?');
      params.push(filter.dateFrom);
    }
    if (filter.dateTo !== undefined) {
      conditions.push('gr.business_date <= ?');
      params.push(filter.dateTo);
    }
    const where = whereOf(conditions);
    const rows = await selectRows<GoodsReceiptRow>(
      db,
      `${GRN_SELECT} ${where}
        ORDER BY gr.business_date DESC, gr.daily_sequence DESC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const total = await countOf(
      db,
      `SELECT COUNT(*) AS total FROM goods_receipts gr ${where}`,
      params,
    );
    return { rows, total };
  }

  async listGoodsReceiptLines(db: Db, receiptId: string): Promise<GoodsReceiptLineRow[]> {
    return selectRows<GoodsReceiptLineRow>(
      db,
      `SELECT grl.*, p.name AS product_name, p.unit AS product_unit
         FROM goods_receipt_lines grl
         JOIN products p ON p.id = grl.product_id
        WHERE grl.goods_receipt_id = ? ORDER BY grl.sort_order ASC`,
      [receiptId],
    );
  }

  async listDestinations(
    db: Db,
    lineIds: readonly string[],
  ): Promise<GoodsReceiptDestinationRow[]> {
    if (lineIds.length === 0) return [];
    return selectRows<GoodsReceiptDestinationRow>(
      db,
      `SELECT d.*, il.name AS location_name, il.kind AS location_kind
         FROM goods_receipt_line_destinations d
         JOIN inventory_locations il ON il.id = d.location_id
        WHERE d.goods_receipt_line_id IN (${lineIds.map(() => '?').join(', ')})
        ORDER BY d.sort_order ASC`,
      lineIds,
    );
  }

  /* ------------------------------------------------------------ purchase invoices */

  async insertPurchaseInvoice(db: Db, input: InsertPurchaseInvoiceInput): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO purchase_invoices
         (id, invoice_number, daily_sequence, business_date, supplier_id,
          supplier_invoice_number, supplier_invoice_date, due_date, credit_days,
          purchase_entry_id, goods_receipt_id, purchase_order_id, location_id, status,
          match_status, payment_method, payment_status, supplier_state_code, is_inter_state,
          subtotal_amount, discount_amount, taxable_amount, cgst_amount, sgst_amount,
          igst_amount, cess_amount, tax_amount, round_off_amount, other_charges, total_amount,
          paid_amount, outstanding_amount, reference, notes, attachment_id, created_by,
          posted_by, posted_at, created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        input.id,
        input.invoiceNumber,
        input.dailySequence,
        input.businessDate,
        input.supplierId,
        input.supplierInvoiceNumber,
        input.supplierInvoiceDate,
        input.dueDate,
        input.creditDays,
        input.purchaseEntryId,
        input.goodsReceiptId,
        input.purchaseOrderId,
        input.locationId,
        input.status,
        input.matchStatus,
        input.paymentMethod,
        input.paymentStatus,
        input.supplierStateCode,
        input.isInterState ? 1 : 0,
        input.subtotalAmount,
        input.discountAmount,
        input.taxableAmount,
        input.cgstAmount,
        input.sgstAmount,
        input.igstAmount,
        input.cessAmount,
        input.taxAmount,
        input.roundOffAmount,
        input.otherCharges,
        input.totalAmount,
        input.paidAmount,
        input.outstandingAmount,
        input.reference,
        input.notes,
        input.attachmentId,
        input.createdBy,
        input.postedBy,
        input.postedAt,
        now,
        now,
      ],
    );
  }

  async insertPurchaseInvoiceLine(db: Db, input: InsertPurchaseInvoiceLineInput): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO purchase_invoice_lines
         (id, invoice_id, product_id, description, goods_receipt_line_id,
          purchase_entry_line_id, quantity, uom_id, rate, discount_percent, discount_amount,
          gross_amount, taxable_amount, tax_profile_id, hsn_sac_code, tax_rate, cgst_amount,
          sgst_amount, igst_amount, cess_amount, tax_amount, line_total, notes, sort_order,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.invoiceId,
        input.productId,
        input.description,
        input.goodsReceiptLineId,
        input.purchaseEntryLineId,
        input.quantity,
        input.uomId,
        input.rate,
        input.discountPercent,
        input.discountAmount,
        input.grossAmount,
        input.taxableAmount,
        input.taxProfileId,
        input.hsnSacCode,
        input.taxRate,
        input.cgstAmount,
        input.sgstAmount,
        input.igstAmount,
        input.cessAmount,
        input.taxAmount,
        input.lineTotal,
        input.notes,
        input.sortOrder,
        now,
        now,
      ],
    );
  }

  async findInvoice(db: Db, id: string): Promise<PurchaseInvoiceRow | null> {
    return selectOne<PurchaseInvoiceRow>(db, `${INVOICE_SELECT} WHERE pi.id = ?`, [id]);
  }

  async listInvoices(
    db: Db,
    filter: PurchaseInvoiceListFilter,
  ): Promise<{ rows: PurchaseInvoiceRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.supplierId !== undefined) {
      conditions.push('pi.supplier_id = ?');
      params.push(filter.supplierId);
    }
    if (filter.status !== undefined) {
      conditions.push('pi.status = ?');
      params.push(filter.status);
    }
    if (filter.paymentStatus !== undefined) {
      conditions.push('pi.payment_status = ?');
      params.push(filter.paymentStatus);
    }
    if (filter.matchStatus !== undefined) {
      conditions.push('pi.match_status = ?');
      params.push(filter.matchStatus);
    }
    if (filter.dateFrom !== undefined) {
      conditions.push('pi.business_date >= ?');
      params.push(filter.dateFrom);
    }
    if (filter.dateTo !== undefined) {
      conditions.push('pi.business_date <= ?');
      params.push(filter.dateTo);
    }
    if (filter.overdueOnly === true) {
      conditions.push(
        "pi.outstanding_amount > 0 AND pi.due_date IS NOT NULL AND pi.due_date < CURDATE()",
      );
    }
    const where = whereOf(conditions);
    const rows = await selectRows<PurchaseInvoiceRow>(
      db,
      `${INVOICE_SELECT} ${where}
        ORDER BY pi.business_date DESC, pi.daily_sequence DESC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const total = await countOf(
      db,
      `SELECT COUNT(*) AS total FROM purchase_invoices pi ${where}`,
      params,
    );
    return { rows, total };
  }

  async listInvoiceLines(db: Db, invoiceId: string): Promise<PurchaseInvoiceLineRow[]> {
    return selectRows<PurchaseInvoiceLineRow>(
      db,
      `SELECT pil.*, p.name AS product_name, u.code AS uom_code
         FROM purchase_invoice_lines pil
         LEFT JOIN products p ON p.id = pil.product_id
         LEFT JOIN uoms u ON u.id = pil.uom_id
        WHERE pil.invoice_id = ? ORDER BY pil.sort_order ASC`,
      [invoiceId],
    );
  }

  /* ------------------------------------------------------------- vendor payments */

  async insertVendorPayment(db: Db, input: InsertVendorPaymentInput): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO vendor_payments
         (id, payment_number, daily_sequence, business_date, supplier_id, payment_date, method,
          status, amount, unallocated_amount, reference, instrument_number, instrument_date,
          bank_name, notes, purchase_entry_id, created_by, posted_by, posted_at, created_at,
          updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        input.id,
        input.paymentNumber,
        input.dailySequence,
        input.businessDate,
        input.supplierId,
        input.paymentDate,
        input.method,
        input.status,
        input.amount,
        input.unallocatedAmount,
        input.reference,
        input.instrumentNumber,
        input.instrumentDate,
        input.bankName,
        input.notes,
        input.purchaseEntryId,
        input.createdBy,
        input.postedBy,
        input.postedAt,
        now,
        now,
      ],
    );
  }

  async setPaymentUnallocated(db: Db, id: string, unallocated: number): Promise<void> {
    await mutate(
      db,
      'UPDATE vendor_payments SET unallocated_amount = ?, updated_at = ? WHERE id = ?',
      [unallocated, toDbDateTime(), id],
    );
  }

  async findPayment(db: Db, id: string): Promise<VendorPaymentRow | null> {
    return selectOne<VendorPaymentRow>(db, `${PAYMENT_SELECT} WHERE vp.id = ?`, [id]);
  }

  async findPaymentByEntry(db: Db, entryId: string): Promise<VendorPaymentRow | null> {
    return selectOne<VendorPaymentRow>(
      db,
      `${PAYMENT_SELECT} WHERE vp.purchase_entry_id = ? ORDER BY vp.created_at ASC LIMIT 1`,
      [entryId],
    );
  }

  async listPayments(
    db: Db,
    filter: VendorPaymentListFilter,
  ): Promise<{ rows: VendorPaymentRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.supplierId !== undefined) {
      conditions.push('vp.supplier_id = ?');
      params.push(filter.supplierId);
    }
    if (filter.status !== undefined) {
      conditions.push('vp.status = ?');
      params.push(filter.status);
    }
    if (filter.method !== undefined) {
      conditions.push('vp.method = ?');
      params.push(filter.method);
    }
    if (filter.dateFrom !== undefined) {
      conditions.push('vp.business_date >= ?');
      params.push(filter.dateFrom);
    }
    if (filter.dateTo !== undefined) {
      conditions.push('vp.business_date <= ?');
      params.push(filter.dateTo);
    }
    const where = whereOf(conditions);
    const rows = await selectRows<VendorPaymentRow>(
      db,
      `${PAYMENT_SELECT} ${where}
        ORDER BY vp.business_date DESC, vp.daily_sequence DESC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const total = await countOf(
      db,
      `SELECT COUNT(*) AS total FROM vendor_payments vp ${where}`,
      params,
    );
    return { rows, total };
  }

  async listAllocations(db: Db, paymentId: string): Promise<VendorPaymentAllocationRow[]> {
    return selectRows<VendorPaymentAllocationRow>(
      db,
      `SELECT a.*, ap.document_number, ap.supplier_invoice_number, ap.invoice_date,
              pi.total_amount AS invoice_total
         FROM vendor_payment_allocations a
         JOIN accounts_payable ap ON ap.id = a.accounts_payable_id
         LEFT JOIN purchase_invoices pi ON pi.id = a.purchase_invoice_id
        WHERE a.payment_id = ? ORDER BY a.created_at ASC`,
      [paymentId],
    );
  }

  /* ----------------------------------------------------------- accounts payable */

  async findPayable(db: Db, id: string): Promise<AccountsPayableRow | null> {
    return selectOne<AccountsPayableRow>(
      db,
      `SELECT ap.*, s.name AS supplier_name, DATEDIFF(CURDATE(), ap.due_date) AS days_overdue
         FROM accounts_payable ap JOIN entities s ON s.id = ap.supplier_id
        WHERE ap.id = ?`,
      [id],
    );
  }

  async findPayableByInvoice(db: Db, invoiceId: string): Promise<AccountsPayableRow | null> {
    return selectOne<AccountsPayableRow>(
      db,
      `SELECT ap.*, s.name AS supplier_name, DATEDIFF(CURDATE(), ap.due_date) AS days_overdue
         FROM accounts_payable ap JOIN entities s ON s.id = ap.supplier_id
        WHERE ap.purchase_invoice_id = ?`,
      [invoiceId],
    );
  }

  async listPayables(
    db: Db,
    filter: PayableListFilter,
  ): Promise<{ rows: AccountsPayableRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.supplierId !== undefined) {
      conditions.push('ap.supplier_id = ?');
      params.push(filter.supplierId);
    }
    if (filter.status !== undefined) {
      conditions.push('ap.status = ?');
      params.push(filter.status);
    }
    if (filter.queuedOnly === true) conditions.push('ap.is_queued = 1');
    if (filter.overdueOnly === true) {
      conditions.push(
        "ap.outstanding_amount > 0 AND ap.due_date IS NOT NULL AND ap.due_date < CURDATE()",
      );
    }
    if (filter.dueBefore !== undefined) {
      conditions.push('ap.due_date IS NOT NULL AND ap.due_date <= ?');
      params.push(filter.dueBefore);
    }
    const where = whereOf(conditions);
    const rows = await selectRows<AccountsPayableRow>(
      db,
      `SELECT ap.*, s.name AS supplier_name, DATEDIFF(CURDATE(), ap.due_date) AS days_overdue
         FROM accounts_payable ap JOIN entities s ON s.id = ap.supplier_id
        ${where}
        ORDER BY ap.due_date IS NULL ASC, ap.due_date ASC, ap.created_at ASC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const total = await countOf(
      db,
      `SELECT COUNT(*) AS total FROM accounts_payable ap ${where}`,
      params,
    );
    return { rows, total };
  }

  /**
   * Queue a payable for the payment run. The only mutation of `accounts_payable` outside
   * VendorLedgerService, and deliberately so: it touches no money column.
   */
  async queuePayable(db: Db, id: string, queuedBy: string | null): Promise<boolean> {
    const result = await mutate(
      db,
      `UPDATE accounts_payable
          SET is_queued = 1, queued_by = ?, queued_at = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND status <> 'PAID' AND status <> 'CANCELLED'`,
      [queuedBy, toDbDateTime(), toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  }

  /* --------------------------------------------------------------- vendor ledger */

  async listVendorLedger(
    db: Db,
    filter: VendorLedgerListFilter,
  ): Promise<{ rows: VendorLedgerEntryRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.supplierId !== undefined) {
      conditions.push('vle.supplier_id = ?');
      params.push(filter.supplierId);
    }
    if (filter.transactionType !== undefined) {
      conditions.push('vle.transaction_type = ?');
      params.push(filter.transactionType);
    }
    if (filter.dateFrom !== undefined) {
      conditions.push('vle.business_date >= ?');
      params.push(filter.dateFrom);
    }
    if (filter.dateTo !== undefined) {
      conditions.push('vle.business_date <= ?');
      params.push(filter.dateTo);
    }
    const where = whereOf(conditions);
    const rows = await selectRows<VendorLedgerEntryRow>(
      db,
      `SELECT vle.*, u.name AS actor_name
         FROM vendor_ledger_entries vle
         LEFT JOIN users u ON u.id = vle.actor_id
        ${where} ORDER BY vle.entry_seq DESC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const total = await countOf(
      db,
      `SELECT COUNT(*) AS total FROM vendor_ledger_entries vle ${where}`,
      params,
    );
    return { rows, total };
  }

  async listVendorLedgerBySource(
    db: Db,
    sourceType: string,
    sourceId: string,
  ): Promise<VendorLedgerEntryRow[]> {
    return selectRows<VendorLedgerEntryRow>(
      db,
      `SELECT vle.*, u.name AS actor_name
         FROM vendor_ledger_entries vle
         LEFT JOIN users u ON u.id = vle.actor_id
        WHERE vle.source_type = ? AND vle.source_id = ? ORDER BY vle.entry_seq ASC`,
      [sourceType, sourceId],
    );
  }

  /**
   * Outstanding payables bucketed by how long they have been due, per supplier.
   *
   * Ageing is measured against the due date rather than the invoice date: a bill on 30-day
   * terms is not overdue on day one, and reporting it as such would make the whole report
   * useless for deciding who to pay.
   */
  async vendorAgeing(db: Db, supplierId?: string): Promise<VendorAgeingRow[]> {
    const conditions = ["ap.status <> 'PAID'", "ap.status <> 'CANCELLED'", 'ap.outstanding_amount > 0'];
    const params: unknown[] = [];
    if (supplierId !== undefined) {
      conditions.push('ap.supplier_id = ?');
      params.push(supplierId);
    }
    return selectRows<VendorAgeingRow>(
      db,
      `SELECT ap.supplier_id, s.name AS supplier_name, s.code AS supplier_code,
              COALESCE(SUM(CASE WHEN ap.due_date IS NULL OR ap.due_date >= CURDATE()
                                THEN ap.outstanding_amount END), 0) AS not_due,
              COALESCE(SUM(CASE WHEN ap.due_date < CURDATE()
                                 AND DATEDIFF(CURDATE(), ap.due_date) BETWEEN 1 AND 30
                                THEN ap.outstanding_amount END), 0) AS days_0_30,
              COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ap.due_date) BETWEEN 31 AND 60
                                THEN ap.outstanding_amount END), 0) AS days_31_60,
              COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ap.due_date) BETWEEN 61 AND 90
                                THEN ap.outstanding_amount END), 0) AS days_61_90,
              COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ap.due_date) > 90
                                THEN ap.outstanding_amount END), 0) AS over_90,
              COALESCE(SUM(ap.outstanding_amount), 0) AS total,
              MIN(ap.due_date) AS oldest_due_date
         FROM accounts_payable ap
         JOIN entities s ON s.id = ap.supplier_id
        WHERE ${conditions.join(' AND ')}
        GROUP BY ap.supplier_id, s.name, s.code
        ORDER BY total DESC`,
      params,
    );
  }

  /* -------------------------------------------------------------- price history */

  async insertPriceHistory(db: Db, input: InsertPriceHistoryInput): Promise<void> {
    await mutate(
      db,
      `INSERT INTO purchase_price_history
         (id, product_id, supplier_id, business_date, source_type, source_id, document_number,
          quantity, uom_id, rate, discount_percent, tax_rate, net_rate_per_stock_unit, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.productId,
        input.supplierId,
        input.businessDate,
        input.sourceType,
        input.sourceId,
        input.documentNumber,
        input.quantity,
        input.uomId,
        input.rate,
        input.discountPercent,
        input.taxRate,
        input.netRatePerStockUnit,
        toDbDateTime(),
      ],
    );
  }

  async setProductLastPurchase(db: Db, productId: string, rate: number): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      'UPDATE products SET last_purchase_rate = ?, last_purchased_at = ?, updated_at = ? WHERE id = ?',
      [rate, now, now, productId],
    );
  }

  async setSupplierProductLastRate(
    db: Db,
    supplierId: string,
    productId: string,
    rate: number,
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE supplier_products SET last_rate = ?, last_purchased_at = ?, updated_at = ?
        WHERE supplier_id = ? AND product_id = ? AND deleted_at IS NULL`,
      [rate, now, now, supplierId, productId],
    );
  }

  /* ---------------------------------------------------------------- idempotency */

  /**
   * Claim an idempotency key. Returns false when the key has already been used for this
   * operation, which is the caller's signal to replay the original result rather than post
   * again. The unique index is what makes the guarantee; this is only how it is read.
   */
  async claimIdempotency(
    db: Db,
    input: { id: string; key: string; operation: string; requestHash: string; actorId: string | null },
  ): Promise<boolean> {
    const result = await mutate(
      db,
      `INSERT IGNORE INTO posting_idempotency
         (id, idempotency_key, operation, request_hash, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.id, input.key, input.operation, input.requestHash, input.actorId, toDbDateTime()],
    );
    return result.affectedRows > 0;
  }

  async findIdempotency(db: Db, operation: string, key: string): Promise<IdempotencyRow | null> {
    return selectOne<IdempotencyRow>(
      db,
      'SELECT * FROM posting_idempotency WHERE operation = ? AND idempotency_key = ?',
      [operation, key],
    );
  }

  async recordIdempotencyResult(
    db: Db,
    args: { operation: string; key: string; resultType: string; resultId: string; resultNumber: string },
  ): Promise<void> {
    await mutate(
      db,
      `UPDATE posting_idempotency SET result_type = ?, result_id = ?, result_number = ?
        WHERE operation = ? AND idempotency_key = ?`,
      [args.resultType, args.resultId, args.resultNumber, args.operation, args.key],
    );
  }

  /* ------------------------------------------------------------ posted movements */

  /** The stock movements one goods receipt produced, with the names a human needs to read them. */
  async listMovementsForSource(
    db: Db,
    sourceType: string,
    sourceId: string,
  ): Promise<
    (RowDataPacket & {
      id: string;
      ledger_seq: string | number;
      product_id: string;
      product_name: string;
      location_id: string;
      location_name: string;
      quantity_in: string;
      unit_cost: string;
      balance_quantity: string;
    })[]
  > {
    return selectRows(
      db,
      `SELECT sl.id, sl.ledger_seq, sl.product_id, p.name AS product_name, sl.location_id,
              il.name AS location_name, sl.quantity_in, sl.unit_cost, sl.balance_quantity
         FROM stock_ledger sl
         JOIN products p ON p.id = sl.product_id
         JOIN inventory_locations il ON il.id = sl.location_id
        WHERE sl.source_type = ? AND sl.source_id = ?
        ORDER BY sl.ledger_seq ASC`,
      [sourceType, sourceId],
    );
  }

  /** The batch the ledger resolved for one receipt line, so the GRN can point at it. */
  async findBatchForSourceLine(
    db: Db,
    sourceType: string,
    sourceId: string,
    sourceLineId: string,
  ): Promise<string | null> {
    const row = await selectOne<RowDataPacket & { batch_id: string | null }>(
      db,
      `SELECT batch_id FROM stock_ledger
        WHERE source_type = ? AND source_id = ? AND source_line_id = ? AND batch_id IS NOT NULL
        LIMIT 1`,
      [sourceType, sourceId, sourceLineId],
    );
    return row === null ? null : row.batch_id;
  }
}

export const purchaseDocumentRepository = new PurchaseDocumentRepository();
