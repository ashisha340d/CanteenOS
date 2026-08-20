import type {
  ExceptionSeverity,
  PurchaseEntryMode,
  PurchaseEntryStatus,
  PurchaseExceptionCode,
  PurchasePaymentMethod,
  PurchaseType,
  RejectionReason,
} from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db, type RowDataPacket } from '../db/types';
import { toDbDateTime } from '../utils/time';

/**
 * Data access for the purchase entry — header, lines, exceptions — and the purchase register
 * that reads across the whole chain.
 *
 * Row shapes live here rather than in models/rows.ts for the same reason StockRepository keeps
 * its own: nothing outside the purchase services consumes them, and the wire-facing DTOs are
 * assembled by PurchaseEntryService.
 *
 * Nothing in this file writes to `stock_ledger`, `stock_balances`, `vendor_ledger_entries` or
 * `accounts_payable`. Those move through StockLedgerService and VendorLedgerService only.
 */

/* ------------------------------------------------------------------------ row types --- */

export interface PurchaseEntryRow extends RowDataPacket {
  id: string;
  entry_number: string;
  daily_sequence: number;
  business_date: string;
  supplier_id: string;
  purchase_type: PurchaseType;
  entry_mode: PurchaseEntryMode;
  status: PurchaseEntryStatus;
  supplier_invoice_number: string | null;
  supplier_invoice_date: string | null;
  due_date: string | null;
  credit_days: number;
  payment_method: PurchasePaymentMethod;
  payment_reference: string | null;
  receiving_location_id: string | null;
  purchase_order_id: string | null;
  reference: string | null;
  notes: string | null;
  attachment_id: string | null;
  bill_scan_id: string | null;
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
  supplier_total_amount: string | null;
  goods_receipt_id: string | null;
  purchase_invoice_id: string | null;
  created_by: string;
  posted_by: string | null;
  posted_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
  supplier_name?: string;
  supplier_code?: string;
  supplier_gstin?: string | null;
  receiving_location_name?: string | null;
  created_by_name?: string | null;
  line_count?: string | number;
}

export interface PurchaseEntryLineRow extends RowDataPacket {
  id: string;
  entry_id: string;
  product_id: string | null;
  description: string | null;
  supplier_sku: string | null;
  quantity: string;
  purchase_uom_id: string | null;
  stock_uom_id: string | null;
  conversion_factor: string;
  stock_quantity: string;
  rate: string;
  discount_percent: string;
  discount_amount: string;
  gross_amount: string;
  taxable_amount: string;
  tax_profile_id: string | null;
  tax_rate: string;
  cgst_amount: string;
  sgst_amount: string;
  igst_amount: string;
  cess_amount: string;
  tax_amount: string;
  line_total: string;
  batch_number: string | null;
  manufacturing_date: string | null;
  expiry_date: string | null;
  received_quantity: string;
  accepted_quantity: string;
  rejected_quantity: string;
  rejection_reason: RejectionReason | null;
  destination_location_id: string | null;
  purchase_order_line_id: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  product_name?: string;
  product_code?: string | null;
  product_unit?: string;
  purchase_uom_code?: string | null;
  stock_uom_code?: string | null;
  destination_location_name?: string | null;
  last_purchase_rate?: string | null;
  is_batch_tracked?: number;
  is_expiry_tracked?: number;
}

export interface PurchaseExceptionRow extends RowDataPacket {
  id: string;
  document_type: string;
  document_id: string;
  document_line_id: string | null;
  code: PurchaseExceptionCode;
  severity: ExceptionSeverity;
  message: string;
  expected_value: string | null;
  actual_value: string | null;
  is_resolved: number;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
}

/** One row of the purchase register — flat by design; it is read as a dense grid. */
export interface PurchaseRegisterRow extends RowDataPacket {
  entry_id: string;
  entry_number: string;
  business_date: string;
  supplier_id: string;
  supplier_name: string;
  supplier_gstin: string | null;
  supplier_invoice_number: string | null;
  supplier_invoice_date: string | null;
  purchase_type: PurchaseType;
  status: PurchaseEntryStatus;
  payment_method: PurchasePaymentMethod;
  payment_status: string | null;
  line_count: string | number;
  total_quantity: string | null;
  taxable_amount: string;
  cgst_amount: string;
  sgst_amount: string;
  igst_amount: string;
  cess_amount: string;
  tax_amount: string;
  round_off_amount: string;
  total_amount: string;
  paid_amount: string;
  outstanding_amount: string;
  grn_number: string | null;
  invoice_number: string | null;
  open_exception_count: string | number;
  posted_at: string | null;
  created_by_name: string | null;
}

export interface PurchaseRegisterTotalsRow extends RowDataPacket {
  entry_count: string | number;
  taxable_amount: string | null;
  cgst_amount: string | null;
  sgst_amount: string | null;
  igst_amount: string | null;
  cess_amount: string | null;
  tax_amount: string | null;
  total_amount: string | null;
  paid_amount: string | null;
  outstanding_amount: string | null;
}

/* --------------------------------------------------------------------------- inputs --- */

export interface PurchaseEntryListFilter {
  supplierId?: string;
  status?: PurchaseEntryStatus;
  purchaseType?: PurchaseType;
  paymentMethod?: PurchasePaymentMethod;
  locationId?: string;
  dateFrom?: string;
  dateTo?: string;
  withExceptionsOnly?: boolean;
  limit: number;
  offset: number;
}

export interface PurchaseRegisterFilter {
  supplierId?: string;
  status?: PurchaseEntryStatus;
  purchaseType?: PurchaseType;
  paymentMethod?: PurchasePaymentMethod;
  paymentStatus?: string;
  locationId?: string;
  productId?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMin?: number;
  amountMax?: number;
  withExceptionsOnly?: boolean;
  limit: number;
  offset: number;
}

export interface InsertPurchaseEntryInput {
  id: string;
  entryNumber: string;
  dailySequence: number;
  businessDate: string;
  supplierId: string;
  purchaseType: PurchaseType;
  entryMode: PurchaseEntryMode;
  supplierInvoiceNumber: string | null;
  supplierInvoiceDate: string | null;
  dueDate: string | null;
  creditDays: number;
  paymentMethod: PurchasePaymentMethod;
  paymentReference: string | null;
  receivingLocationId: string | null;
  purchaseOrderId: string | null;
  reference: string | null;
  notes: string | null;
  attachmentId: string | null;
  billScanId: string | null;
  supplierStateCode: string | null;
  isInterState: boolean;
  otherCharges: number;
  supplierTotalAmount: number | null;
  createdBy: string | null;
}

export interface PurchaseEntryHeaderPatch {
  supplierId?: string;
  purchaseType?: PurchaseType;
  entryMode?: PurchaseEntryMode;
  businessDate?: string;
  supplierInvoiceNumber?: string | null;
  supplierInvoiceDate?: string | null;
  dueDate?: string | null;
  creditDays?: number;
  paymentMethod?: PurchasePaymentMethod;
  paymentReference?: string | null;
  receivingLocationId?: string | null;
  purchaseOrderId?: string | null;
  reference?: string | null;
  notes?: string | null;
  attachmentId?: string | null;
  billScanId?: string | null;
  supplierStateCode?: string | null;
  isInterState?: boolean;
  otherCharges?: number;
  supplierTotalAmount?: number | null;
}

const HEADER_COLUMNS: Readonly<Record<keyof PurchaseEntryHeaderPatch, string>> = {
  supplierId: 'supplier_id',
  purchaseType: 'purchase_type',
  entryMode: 'entry_mode',
  businessDate: 'business_date',
  supplierInvoiceNumber: 'supplier_invoice_number',
  supplierInvoiceDate: 'supplier_invoice_date',
  dueDate: 'due_date',
  creditDays: 'credit_days',
  paymentMethod: 'payment_method',
  paymentReference: 'payment_reference',
  receivingLocationId: 'receiving_location_id',
  purchaseOrderId: 'purchase_order_id',
  reference: 'reference',
  notes: 'notes',
  attachmentId: 'attachment_id',
  billScanId: 'bill_scan_id',
  supplierStateCode: 'supplier_state_code',
  isInterState: 'is_inter_state',
  otherCharges: 'other_charges',
  supplierTotalAmount: 'supplier_total_amount',
};

export interface PurchaseEntryTotals {
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
}

export interface PurchaseEntryStatusPatch {
  status?: PurchaseEntryStatus;
  postedBy?: string | null;
  postedAt?: string | null;
  cancelledBy?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  goodsReceiptId?: string | null;
  purchaseInvoiceId?: string | null;
  dueDate?: string | null;
  paidAmount?: number;
  outstandingAmount?: number;
}

export interface InsertPurchaseEntryLineInput {
  id: string;
  entryId: string;
  productId: string | null;
  description: string | null;
  supplierSku: string | null;
  quantity: number;
  purchaseUomId: string | null;
  stockUomId: string | null;
  conversionFactor: number;
  stockQuantity: number;
  rate: number;
  discountPercent: number;
  discountAmount: number;
  grossAmount: number;
  taxableAmount: number;
  taxProfileId: string | null;
  taxRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  taxAmount: number;
  lineTotal: number;
  batchNumber: string | null;
  manufacturingDate: string | null;
  expiryDate: string | null;
  receivedQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  rejectionReason: RejectionReason | null;
  destinationLocationId: string | null;
  purchaseOrderLineId: string | null;
  notes: string | null;
  sortOrder: number;
}

export interface InsertPurchaseExceptionInput {
  id: string;
  documentType: string;
  documentId: string;
  documentLineId: string | null;
  code: PurchaseExceptionCode;
  severity: ExceptionSeverity;
  message: string;
  expectedValue: string | null;
  actualValue: string | null;
}

/* ------------------------------------------------------------------------------ SQL --- */

const ENTRY_SELECT = `
  SELECT pe.*, s.name AS supplier_name, s.code AS supplier_code, s.gstin AS supplier_gstin,
         il.name AS receiving_location_name, cu.name AS created_by_name,
         (SELECT COUNT(*) FROM purchase_entry_lines l WHERE l.entry_id = pe.id) AS line_count
    FROM purchase_entries pe
    JOIN entities s ON s.id = pe.supplier_id
    LEFT JOIN inventory_locations il ON il.id = pe.receiving_location_id
    LEFT JOIN users cu ON cu.id = pe.created_by`;

const LINE_SELECT = `
  SELECT pel.*, p.name AS product_name, p.code AS product_code, p.unit AS product_unit,
         p.last_purchase_rate, p.is_batch_tracked, p.is_expiry_tracked,
         pu.code AS purchase_uom_code, su.code AS stock_uom_code,
         dl.name AS destination_location_name
    FROM purchase_entry_lines pel
    LEFT JOIN products p ON p.id = pel.product_id
    LEFT JOIN uoms pu ON pu.id = pel.purchase_uom_id
    LEFT JOIN uoms su ON su.id = pel.stock_uom_id
    LEFT JOIN inventory_locations dl ON dl.id = pel.destination_location_id`;

const OPEN_EXCEPTIONS = `(SELECT COUNT(*) FROM purchase_exceptions x
    WHERE x.document_type = 'PURCHASE_ENTRY' AND x.document_id = pe.id AND x.is_resolved = 0)`;

function whereOf(conditions: readonly string[]): string {
  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
}

async function countOf(db: Db, sql: string, params: readonly unknown[]): Promise<number> {
  const row = await selectOne<RowDataPacket & { total: string | number }>(db, sql, params);
  return row === null ? 0 : Number(row.total);
}

export class PurchaseEntryRepository {
  /* --------------------------------------------------------------------- entries */

  async findEntry(db: Db, id: string): Promise<PurchaseEntryRow | null> {
    return selectOne<PurchaseEntryRow>(db, `${ENTRY_SELECT} WHERE pe.id = ?`, [id]);
  }

  /**
   * Read an entry and hold a row lock on it for the rest of the transaction.
   *
   * Unjoined on purpose: the lock has to be on `purchase_entries` alone, and two clients
   * racing the Post button must serialise here rather than both reaching the ledgers.
   */
  async lockEntry(db: Db, id: string): Promise<PurchaseEntryRow | null> {
    return selectOne<PurchaseEntryRow>(
      db,
      'SELECT * FROM purchase_entries WHERE id = ? FOR UPDATE',
      [id],
    );
  }

  async listEntries(
    db: Db,
    filter: PurchaseEntryListFilter,
  ): Promise<{ rows: PurchaseEntryRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.supplierId !== undefined) {
      conditions.push('pe.supplier_id = ?');
      params.push(filter.supplierId);
    }
    if (filter.status !== undefined) {
      conditions.push('pe.status = ?');
      params.push(filter.status);
    }
    if (filter.purchaseType !== undefined) {
      conditions.push('pe.purchase_type = ?');
      params.push(filter.purchaseType);
    }
    if (filter.paymentMethod !== undefined) {
      conditions.push('pe.payment_method = ?');
      params.push(filter.paymentMethod);
    }
    if (filter.locationId !== undefined) {
      conditions.push('pe.receiving_location_id = ?');
      params.push(filter.locationId);
    }
    if (filter.dateFrom !== undefined) {
      conditions.push('pe.business_date >= ?');
      params.push(filter.dateFrom);
    }
    if (filter.dateTo !== undefined) {
      conditions.push('pe.business_date <= ?');
      params.push(filter.dateTo);
    }
    if (filter.withExceptionsOnly === true) conditions.push(`${OPEN_EXCEPTIONS} > 0`);

    const where = whereOf(conditions);
    const rows = await selectRows<PurchaseEntryRow>(
      db,
      `${ENTRY_SELECT} ${where}
        ORDER BY pe.business_date DESC, pe.daily_sequence DESC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const total = await countOf(
      db,
      `SELECT COUNT(*) AS total FROM purchase_entries pe ${where}`,
      params,
    );
    return { rows, total };
  }

  async insertEntry(db: Db, input: InsertPurchaseEntryInput): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO purchase_entries
         (id, entry_number, daily_sequence, business_date, supplier_id, purchase_type,
          entry_mode, status, supplier_invoice_number, supplier_invoice_date, due_date,
          credit_days, payment_method, payment_reference, receiving_location_id,
          purchase_order_id, reference, notes, attachment_id, bill_scan_id,
          supplier_state_code, is_inter_state, other_charges, supplier_total_amount,
          created_by, created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        input.id,
        input.entryNumber,
        input.dailySequence,
        input.businessDate,
        input.supplierId,
        input.purchaseType,
        input.entryMode,
        input.supplierInvoiceNumber,
        input.supplierInvoiceDate,
        input.dueDate,
        input.creditDays,
        input.paymentMethod,
        input.paymentReference,
        input.receivingLocationId,
        input.purchaseOrderId,
        input.reference,
        input.notes,
        input.attachmentId,
        input.billScanId,
        input.supplierStateCode,
        input.isInterState ? 1 : 0,
        input.otherCharges,
        input.supplierTotalAmount,
        input.createdBy,
        now,
        now,
      ],
    );
  }

  async updateEntryHeader(db: Db, id: string, patch: PurchaseEntryHeaderPatch): Promise<void> {
    const assignments: string[] = [];
    const params: unknown[] = [];
    for (const [key, column] of Object.entries(HEADER_COLUMNS)) {
      const value = patch[key as keyof PurchaseEntryHeaderPatch];
      if (value === undefined) continue;
      assignments.push(`${column} = ?`);
      params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }
    if (assignments.length === 0) return;
    assignments.push('updated_at = ?', 'revision = revision + 1');
    params.push(toDbDateTime(), id);
    await mutate(db, `UPDATE purchase_entries SET ${assignments.join(', ')} WHERE id = ?`, params);
  }

  /** Totals are only ever written from a server-side recomputation of the lines. */
  async setEntryTotals(db: Db, id: string, totals: PurchaseEntryTotals): Promise<void> {
    await mutate(
      db,
      `UPDATE purchase_entries
          SET subtotal_amount = ?, discount_amount = ?, taxable_amount = ?, cgst_amount = ?,
              sgst_amount = ?, igst_amount = ?, cess_amount = ?, tax_amount = ?,
              round_off_amount = ?, other_charges = ?, total_amount = ?, paid_amount = ?,
              outstanding_amount = ?, updated_at = ?
        WHERE id = ?`,
      [
        totals.subtotalAmount,
        totals.discountAmount,
        totals.taxableAmount,
        totals.cgstAmount,
        totals.sgstAmount,
        totals.igstAmount,
        totals.cessAmount,
        totals.taxAmount,
        totals.roundOffAmount,
        totals.otherCharges,
        totals.totalAmount,
        totals.paidAmount,
        totals.outstandingAmount,
        toDbDateTime(),
        id,
      ],
    );
  }

  async setEntryStatus(db: Db, id: string, patch: PurchaseEntryStatusPatch): Promise<void> {
    const assignments: string[] = [];
    const params: unknown[] = [];
    const columns: Readonly<Record<string, unknown>> = {
      status: patch.status,
      posted_by: patch.postedBy,
      posted_at: patch.postedAt,
      cancelled_by: patch.cancelledBy,
      cancelled_at: patch.cancelledAt,
      cancel_reason: patch.cancelReason,
      goods_receipt_id: patch.goodsReceiptId,
      purchase_invoice_id: patch.purchaseInvoiceId,
      due_date: patch.dueDate,
      paid_amount: patch.paidAmount,
      outstanding_amount: patch.outstandingAmount,
    };
    for (const [column, value] of Object.entries(columns)) {
      if (value === undefined) continue;
      assignments.push(`${column} = ?`);
      params.push(value);
    }
    if (assignments.length === 0) return;
    assignments.push('updated_at = ?', 'revision = revision + 1');
    params.push(toDbDateTime(), id);
    await mutate(db, `UPDATE purchase_entries SET ${assignments.join(', ')} WHERE id = ?`, params);
  }

  /* ----------------------------------------------------------------------- lines */

  async listLines(db: Db, entryId: string): Promise<PurchaseEntryLineRow[]> {
    return selectRows<PurchaseEntryLineRow>(
      db,
      `${LINE_SELECT} WHERE pel.entry_id = ? ORDER BY pel.sort_order ASC`,
      [entryId],
    );
  }

  async deleteLines(db: Db, entryId: string): Promise<void> {
    await mutate(db, 'DELETE FROM purchase_entry_lines WHERE entry_id = ?', [entryId]);
  }

  async insertLine(db: Db, input: InsertPurchaseEntryLineInput): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO purchase_entry_lines
         (id, entry_id, product_id, description, supplier_sku, quantity, purchase_uom_id,
          stock_uom_id, conversion_factor, stock_quantity, rate, discount_percent,
          discount_amount, gross_amount, taxable_amount, tax_profile_id, tax_rate,
          cgst_amount, sgst_amount, igst_amount, cess_amount, tax_amount, line_total,
          batch_number, manufacturing_date, expiry_date, received_quantity, accepted_quantity,
          rejected_quantity, rejection_reason, destination_location_id, purchase_order_line_id,
          notes, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.entryId,
        input.productId,
        input.description,
        input.supplierSku,
        input.quantity,
        input.purchaseUomId,
        input.stockUomId,
        input.conversionFactor,
        input.stockQuantity,
        input.rate,
        input.discountPercent,
        input.discountAmount,
        input.grossAmount,
        input.taxableAmount,
        input.taxProfileId,
        input.taxRate,
        input.cgstAmount,
        input.sgstAmount,
        input.igstAmount,
        input.cessAmount,
        input.taxAmount,
        input.lineTotal,
        input.batchNumber,
        input.manufacturingDate,
        input.expiryDate,
        input.receivedQuantity,
        input.acceptedQuantity,
        input.rejectedQuantity,
        input.rejectionReason,
        input.destinationLocationId,
        input.purchaseOrderLineId,
        input.notes,
        input.sortOrder,
        now,
        now,
      ],
    );
  }

  /* ------------------------------------------------------------------ exceptions */

  async listExceptions(
    db: Db,
    documentType: string,
    documentId: string,
  ): Promise<PurchaseExceptionRow[]> {
    return selectRows<PurchaseExceptionRow>(
      db,
      `SELECT * FROM purchase_exceptions
        WHERE document_type = ? AND document_id = ?
        ORDER BY FIELD(severity,'BLOCKING','OVERRIDABLE','WARNING','INFO'), created_at ASC`,
      [documentType, documentId],
    );
  }

  /**
   * Exceptions are deleted and rewritten on every save. An exception that outlives the
   * condition that produced it is worse than none: the operator learns to ignore them.
   */
  async deleteExceptions(db: Db, documentType: string, documentId: string): Promise<void> {
    await mutate(
      db,
      'DELETE FROM purchase_exceptions WHERE document_type = ? AND document_id = ?',
      [documentType, documentId],
    );
  }

  async insertException(db: Db, input: InsertPurchaseExceptionInput): Promise<void> {
    await mutate(
      db,
      `INSERT INTO purchase_exceptions
         (id, document_type, document_id, document_line_id, code, severity, message,
          expected_value, actual_value, is_resolved, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        input.id,
        input.documentType,
        input.documentId,
        input.documentLineId,
        input.code,
        input.severity,
        input.message,
        input.expectedValue,
        input.actualValue,
        toDbDateTime(),
      ],
    );
  }

  /* -------------------------------------------------------------------- register */

  private registerWhere(filter: PurchaseRegisterFilter): { where: string; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.supplierId !== undefined) {
      conditions.push('pe.supplier_id = ?');
      params.push(filter.supplierId);
    }
    if (filter.status !== undefined) {
      conditions.push('pe.status = ?');
      params.push(filter.status);
    }
    if (filter.purchaseType !== undefined) {
      conditions.push('pe.purchase_type = ?');
      params.push(filter.purchaseType);
    }
    if (filter.paymentMethod !== undefined) {
      conditions.push('pe.payment_method = ?');
      params.push(filter.paymentMethod);
    }
    if (filter.paymentStatus !== undefined) {
      conditions.push('pi.payment_status = ?');
      params.push(filter.paymentStatus);
    }
    if (filter.locationId !== undefined) {
      conditions.push('pe.receiving_location_id = ?');
      params.push(filter.locationId);
    }
    if (filter.productId !== undefined) {
      conditions.push(
        'EXISTS (SELECT 1 FROM purchase_entry_lines pl WHERE pl.entry_id = pe.id AND pl.product_id = ?)',
      );
      params.push(filter.productId);
    }
    if (filter.dateFrom !== undefined) {
      conditions.push('pe.business_date >= ?');
      params.push(filter.dateFrom);
    }
    if (filter.dateTo !== undefined) {
      conditions.push('pe.business_date <= ?');
      params.push(filter.dateTo);
    }
    if (filter.amountMin !== undefined) {
      conditions.push('pe.total_amount >= ?');
      params.push(filter.amountMin);
    }
    if (filter.amountMax !== undefined) {
      conditions.push('pe.total_amount <= ?');
      params.push(filter.amountMax);
    }
    if (filter.withExceptionsOnly === true) conditions.push(`${OPEN_EXCEPTIONS} > 0`);
    return { where: whereOf(conditions), params };
  }

  private static readonly REGISTER_FROM = `
    FROM purchase_entries pe
    JOIN entities s ON s.id = pe.supplier_id
    LEFT JOIN goods_receipts grn ON grn.id = pe.goods_receipt_id
    LEFT JOIN purchase_invoices pi ON pi.id = pe.purchase_invoice_id
    LEFT JOIN users cu ON cu.id = pe.created_by`;

  async listRegister(
    db: Db,
    filter: PurchaseRegisterFilter,
  ): Promise<{ rows: PurchaseRegisterRow[]; total: number }> {
    const { where, params } = this.registerWhere(filter);
    const rows = await selectRows<PurchaseRegisterRow>(
      db,
      `SELECT pe.id AS entry_id, pe.entry_number, pe.business_date, pe.supplier_id,
              s.name AS supplier_name, s.gstin AS supplier_gstin,
              pe.supplier_invoice_number, pe.supplier_invoice_date, pe.purchase_type,
              pe.status, pe.payment_method, pi.payment_status,
              (SELECT COUNT(*) FROM purchase_entry_lines l WHERE l.entry_id = pe.id) AS line_count,
              (SELECT COALESCE(SUM(l.quantity), 0) FROM purchase_entry_lines l
                WHERE l.entry_id = pe.id) AS total_quantity,
              pe.taxable_amount, pe.cgst_amount, pe.sgst_amount, pe.igst_amount, pe.cess_amount,
              pe.tax_amount, pe.round_off_amount, pe.total_amount, pe.paid_amount,
              pe.outstanding_amount, grn.grn_number, pi.invoice_number,
              ${OPEN_EXCEPTIONS} AS open_exception_count,
              pe.posted_at, cu.name AS created_by_name
       ${PurchaseEntryRepository.REGISTER_FROM} ${where}
        ORDER BY pe.business_date DESC, pe.daily_sequence DESC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const total = await countOf(
      db,
      `SELECT COUNT(*) AS total ${PurchaseEntryRepository.REGISTER_FROM} ${where}`,
      params,
    );
    return { rows, total };
  }

  /** Column totals over the whole filtered set, not just the page being displayed. */
  async registerTotals(
    db: Db,
    filter: PurchaseRegisterFilter,
  ): Promise<PurchaseRegisterTotalsRow> {
    const { where, params } = this.registerWhere(filter);
    const row = await selectOne<PurchaseRegisterTotalsRow>(
      db,
      `SELECT COUNT(*) AS entry_count,
              COALESCE(SUM(pe.taxable_amount),0) AS taxable_amount,
              COALESCE(SUM(pe.cgst_amount),0) AS cgst_amount,
              COALESCE(SUM(pe.sgst_amount),0) AS sgst_amount,
              COALESCE(SUM(pe.igst_amount),0) AS igst_amount,
              COALESCE(SUM(pe.cess_amount),0) AS cess_amount,
              COALESCE(SUM(pe.tax_amount),0) AS tax_amount,
              COALESCE(SUM(pe.total_amount),0) AS total_amount,
              COALESCE(SUM(pe.paid_amount),0) AS paid_amount,
              COALESCE(SUM(pe.outstanding_amount),0) AS outstanding_amount
       ${PurchaseEntryRepository.REGISTER_FROM} ${where}`,
      params,
    );
    if (row === null) throw new Error('Purchase register totals returned no row');
    return row;
  }
}

export const purchaseEntryRepository = new PurchaseEntryRepository();
