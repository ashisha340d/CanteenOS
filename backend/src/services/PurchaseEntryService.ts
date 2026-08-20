import {
  ExceptionSeverity,
  GstTaxability,
  PayableStatus,
  PurchaseEntryMode,
  PurchaseEntryStatus,
  PurchasePaymentMethod,
  PurchaseType,
  VendorLedgerTxnType,
  VendorPaymentStatus,
  type AccountsPayableDto,
  type AccountsPayableListQuery,
  type CreatePurchaseEntryRequest,
  type CreateVendorPaymentRequest,
  type DocumentFlowDto,
  type DocumentFlowNodeDto,
  type GoodsReceiptDto,
  type GoodsReceiptLineDto,
  type GoodsReceiptListQuery,
  type IsoDate,
  type PurchaseEntryDto,
  type PurchaseEntryLineDto,
  type PurchaseEntryLineInput,
  type PurchaseEntryListQuery,
  type PurchaseInvoiceDto,
  type PurchaseInvoiceLineDto,
  type PurchaseInvoiceListQuery,
  type PurchaseRegisterQuery,
  type PurchaseRegisterRowDto,
  type PurchaseRegisterTotalsDto,
  type RejectionReason,
  type UpdatePurchaseEntryRequest,
  type VendorAgeingRowDto,
  type VendorLedgerEntryDto,
  type VendorLedgerListQuery,
  type VendorPaymentDto,
  type VendorPaymentListQuery,
  type VendorStatementDto,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { Db, PoolConnection } from '../db/types';
import {
  purchaseDocumentRepository,
  type AccountsPayableRow,
  type GoodsReceiptDestinationRow,
  type GoodsReceiptLineRow,
  type GoodsReceiptRow,
  type PurchaseInvoiceLineRow,
  type PurchaseInvoiceRow,
  type PurchaseProductRow,
  type SupplierRow,
  type TaxProfileRow,
  type VendorLedgerEntryRow,
  type VendorPaymentAllocationRow,
  type VendorPaymentRow,
} from '../repositories/PurchaseDocumentRepository';
import {
  purchaseEntryRepository,
  type PurchaseEntryLineRow,
  type PurchaseEntryRow,
  type PurchaseEntryTotals,
  type PurchaseRegisterFilter,
  type PurchaseRegisterRow,
} from '../repositories/PurchaseEntryRepository';
import { settingsRepository } from '../repositories/SettingsRepository';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError } from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import {
  fromDbDate,
  fromDbDateTime,
  fromDbDateTimeRequired,
  toDbDateTime,
  todayIsoDate,
} from '../utils/time';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { documentNumberService } from './DocumentNumberService';
import { applyTax, isInterStateSupply, money, type TaxTreatment } from './posPricing';
import {
  mapPurchaseException,
  purchaseExceptionService,
  type ExceptionContext,
  type ExceptionLineContext,
} from './PurchaseExceptionService';
import { vendorLedgerService } from './VendorLedgerService';

/**
 * The purchase entry: drafting a supplier bill, recomputing what it actually comes to, and
 * reading back everything the chain it produced.
 *
 * Two rules run through the whole file.
 *
 *   - **Every total is computed here, from the lines, every time.** A client-supplied total is
 *     compared against ours and raised as an exception; it is never stored and never posted.
 *     `supplier_total_amount` is the only place a claimed figure is kept, and it is kept
 *     precisely so it can be disagreed with.
 *   - **There is one GST computation in this codebase** and it is `applyTax` in posPricing.
 *     A purchase bill and a sales bill differ in which way the money flows and in nothing
 *     else, so a second implementation could only ever be a way for the two to disagree.
 *
 * Posting lives in PurchasePostingService. This file never writes to the stock ledger, the
 * vendor ledger or accounts payable.
 */

/* ------------------------------------------------------------------------- numbers --- */

/** DECIMAL(14,3) for quantities. */
export function qty(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/** DECIMAL(14,4) for unit rates — a spice bought per gram is genuinely ₹0.0125. */
export function rate4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

/** DECIMAL(18,6) for unit conversion factors. */
function factor6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

const QUANTITY_EPSILON = 0.0005;

const POSTED_IS_IMMUTABLE =
  'A posted purchase entry is history and cannot be changed. Reverse it with a purchase return or a debit memo instead.';

function pagingFor(query: { page?: number; pageSize?: number }): {
  limit: number;
  offset: number;
  page: number;
  pageSize: number;
} {
  const { page, pageSize, offset } = resolvePaging(query);
  return { limit: pageSize, offset, page, pageSize };
}

/* ------------------------------------------------------- line computation contract --- */

/**
 * A line as the computation engine takes it, whether it came from an HTTP request or was read
 * back off a draft in the database. Optional fields are the ones that resolve from masters.
 */
export interface PurchaseLineInput {
  id?: string;
  productId?: string | null;
  description?: string | null;
  supplierSku?: string | null;
  quantity: number;
  purchaseUomId?: string | null;
  conversionFactor?: number | null;
  rate: number;
  discountPercent?: number;
  taxProfileId?: string | null;
  batchNumber?: string | null;
  manufacturingDate?: IsoDate | null;
  expiryDate?: IsoDate | null;
  receivedQuantity?: number | null;
  acceptedQuantity?: number | null;
  rejectedQuantity?: number | null;
  rejectionReason?: RejectionReason | null;
  destinationLocationId?: string | null;
  notes?: string | null;
  sortOrder?: number;
}

/** One fully resolved line: every figure below was computed here, none of it was sent. */
export interface ComputedPurchaseLine {
  id: string;
  productId: string | null;
  product: PurchaseProductRow | null;
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
  notes: string | null;
  sortOrder: number;
  hsnCode: string | null;
  hasSupplierMapping: boolean;
  lastPurchaseRate: number | null;
}

export interface ComputedPurchaseEntry {
  lines: ComputedPurchaseLine[];
  totals: PurchaseEntryTotals;
  supplierStateCode: string | null;
  isInterState: boolean;
}

export interface ComputeArgs {
  supplier: SupplierRow;
  purchaseType: PurchaseType;
  receivingLocationId: string | null;
  otherCharges: number;
  paidAmount: number;
  lines: readonly PurchaseLineInput[];
}

/* ------------------------------------------------------------------------- mappers --- */

function mapEntryLine(row: PurchaseEntryLineRow): PurchaseEntryLineDto {
  return {
    id: row.id,
    entryId: row.entry_id,
    productId: row.product_id,
    description: row.description,
    supplierSku: row.supplier_sku,
    quantity: Number(row.quantity),
    purchaseUomId: row.purchase_uom_id,
    stockUomId: row.stock_uom_id,
    conversionFactor: Number(row.conversion_factor),
    stockQuantity: Number(row.stock_quantity),
    rate: Number(row.rate),
    discountPercent: Number(row.discount_percent),
    discountAmount: Number(row.discount_amount),
    grossAmount: Number(row.gross_amount),
    taxableAmount: Number(row.taxable_amount),
    taxProfileId: row.tax_profile_id,
    taxRate: Number(row.tax_rate),
    cgstAmount: Number(row.cgst_amount),
    sgstAmount: Number(row.sgst_amount),
    igstAmount: Number(row.igst_amount),
    cessAmount: Number(row.cess_amount),
    taxAmount: Number(row.tax_amount),
    lineTotal: Number(row.line_total),
    batchNumber: row.batch_number,
    manufacturingDate: fromDbDate(row.manufacturing_date),
    expiryDate: fromDbDate(row.expiry_date),
    receivedQuantity: Number(row.received_quantity),
    acceptedQuantity: Number(row.accepted_quantity),
    rejectedQuantity: Number(row.rejected_quantity),
    rejectionReason: row.rejection_reason,
    destinationLocationId: row.destination_location_id,
    notes: row.notes,
    sortOrder: Number(row.sort_order),
    ...(row.product_name != null ? { productName: row.product_name } : {}),
    ...(row.product_code !== undefined ? { productCode: row.product_code } : {}),
    ...(row.product_unit != null ? { productUnit: row.product_unit } : {}),
    ...(row.purchase_uom_code !== undefined ? { purchaseUomCode: row.purchase_uom_code } : {}),
    ...(row.stock_uom_code !== undefined ? { stockUomCode: row.stock_uom_code } : {}),
    ...(row.destination_location_name !== undefined
      ? { destinationLocationName: row.destination_location_name }
      : {}),
    ...(row.last_purchase_rate !== undefined
      ? { lastPurchaseRate: row.last_purchase_rate === null ? null : Number(row.last_purchase_rate) }
      : {}),
    ...(row.is_batch_tracked !== undefined ? { isBatchTracked: row.is_batch_tracked === 1 } : {}),
    ...(row.is_expiry_tracked !== undefined
      ? { isExpiryTracked: row.is_expiry_tracked === 1 }
      : {}),
  };
}

function mapEntry(
  row: PurchaseEntryRow,
  extras?: { lines?: PurchaseEntryLineRow[]; exceptions?: PurchaseEntryDto['exceptions'] },
): PurchaseEntryDto {
  return {
    id: row.id,
    entryNumber: row.entry_number,
    businessDate: row.business_date.slice(0, 10),
    supplierId: row.supplier_id,
    purchaseType: row.purchase_type,
    entryMode: row.entry_mode,
    status: row.status,
    supplierInvoiceNumber: row.supplier_invoice_number,
    supplierInvoiceDate: fromDbDate(row.supplier_invoice_date),
    dueDate: fromDbDate(row.due_date),
    creditDays: Number(row.credit_days),
    paymentMethod: row.payment_method,
    paymentReference: row.payment_reference,
    receivingLocationId: row.receiving_location_id,
    purchaseOrderId: row.purchase_order_id,
    reference: row.reference,
    notes: row.notes,
    attachmentId: row.attachment_id,
    billScanId: row.bill_scan_id,
    supplierStateCode: row.supplier_state_code,
    isInterState: row.is_inter_state === 1,
    subtotalAmount: Number(row.subtotal_amount),
    discountAmount: Number(row.discount_amount),
    taxableAmount: Number(row.taxable_amount),
    cgstAmount: Number(row.cgst_amount),
    sgstAmount: Number(row.sgst_amount),
    igstAmount: Number(row.igst_amount),
    cessAmount: Number(row.cess_amount),
    taxAmount: Number(row.tax_amount),
    roundOffAmount: Number(row.round_off_amount),
    otherCharges: Number(row.other_charges),
    totalAmount: Number(row.total_amount),
    paidAmount: Number(row.paid_amount),
    outstandingAmount: Number(row.outstanding_amount),
    supplierTotalAmount:
      row.supplier_total_amount === null ? null : Number(row.supplier_total_amount),
    goodsReceiptId: row.goods_receipt_id,
    purchaseInvoiceId: row.purchase_invoice_id,
    createdBy: row.created_by,
    postedBy: row.posted_by,
    postedAt: fromDbDateTime(row.posted_at),
    cancelledBy: row.cancelled_by,
    cancelledAt: fromDbDateTime(row.cancelled_at),
    cancelReason: row.cancel_reason,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    revision: Number(row.revision),
    ...(row.supplier_name !== undefined ? { supplierName: row.supplier_name } : {}),
    ...(row.supplier_code !== undefined ? { supplierCode: row.supplier_code } : {}),
    ...(row.supplier_gstin !== undefined ? { supplierGstin: row.supplier_gstin } : {}),
    ...(row.receiving_location_name !== undefined
      ? { receivingLocationName: row.receiving_location_name }
      : {}),
    ...(row.created_by_name !== undefined ? { createdByName: row.created_by_name } : {}),
    ...(row.line_count !== undefined ? { lineCount: Number(row.line_count) } : {}),
    ...(extras?.lines !== undefined ? { lines: extras.lines.map(mapEntryLine) } : {}),
    ...(extras?.exceptions !== undefined ? { exceptions: extras.exceptions } : {}),
  };
}

function mapDestination(row: GoodsReceiptDestinationRow) {
  return {
    id: row.id,
    goodsReceiptLineId: row.goods_receipt_line_id,
    locationId: row.location_id,
    quantity: Number(row.quantity),
    notes: row.notes,
    sortOrder: Number(row.sort_order),
    ...(row.location_name !== undefined ? { locationName: row.location_name } : {}),
    ...(row.location_kind !== undefined ? { locationKind: row.location_kind } : {}),
  };
}

function mapReceiptLine(
  row: GoodsReceiptLineRow,
  destinations?: GoodsReceiptDestinationRow[],
): GoodsReceiptLineDto {
  const ordered = Number(row.ordered_quantity);
  const previously = Number(row.previously_received);
  return {
    id: row.id,
    goodsReceiptId: row.goods_receipt_id,
    productId: row.product_id,
    purchaseEntryLineId: row.purchase_entry_line_id,
    purchaseOrderLineId: row.purchase_order_line_id,
    orderedQuantity: ordered,
    previouslyReceived: previously,
    billedQuantity: Number(row.billed_quantity),
    receivedQuantity: Number(row.received_quantity),
    acceptedQuantity: Number(row.accepted_quantity),
    rejectedQuantity: Number(row.rejected_quantity),
    purchaseUomId: row.purchase_uom_id,
    stockUomId: row.stock_uom_id,
    conversionFactor: Number(row.conversion_factor),
    acceptedStockQuantity: Number(row.accepted_stock_quantity),
    purchaseRate: Number(row.purchase_rate),
    batchNumber: row.batch_number,
    manufacturingDate: fromDbDate(row.manufacturing_date),
    expiryDate: fromDbDate(row.expiry_date),
    batchId: row.batch_id,
    qcStatus: row.qc_status,
    rejectionReason: row.rejection_reason,
    rejectionNotes: row.rejection_notes,
    notes: row.notes,
    sortOrder: Number(row.sort_order),
    ...(row.product_name !== undefined ? { productName: row.product_name } : {}),
    ...(row.product_unit !== undefined ? { productUnit: row.product_unit } : {}),
    remainingQuantity: qty(Math.max(0, ordered - previously)),
    ...(destinations !== undefined ? { destinations: destinations.map(mapDestination) } : {}),
  };
}

function mapGoodsReceipt(row: GoodsReceiptRow, lines?: GoodsReceiptLineDto[]): GoodsReceiptDto {
  return {
    id: row.id,
    grnNumber: row.grn_number,
    businessDate: row.business_date.slice(0, 10),
    receiptDate: row.receipt_date.slice(0, 10),
    supplierId: row.supplier_id,
    purchaseEntryId: row.purchase_entry_id,
    purchaseOrderId: row.purchase_order_id,
    deliveryNote: row.delivery_note,
    locationId: row.location_id,
    status: row.status,
    notes: row.notes,
    receivedBy: row.received_by,
    qcBy: row.qc_by,
    qcAt: fromDbDateTime(row.qc_at),
    createdBy: row.created_by,
    postedBy: row.posted_by,
    postedAt: fromDbDateTime(row.posted_at),
    cancelledBy: row.cancelled_by,
    cancelledAt: fromDbDateTime(row.cancelled_at),
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    revision: Number(row.revision),
    ...(row.supplier_name !== undefined ? { supplierName: row.supplier_name } : {}),
    ...(row.location_name !== undefined ? { locationName: row.location_name } : {}),
    ...(row.line_count !== undefined ? { lineCount: Number(row.line_count) } : {}),
    ...(lines !== undefined ? { lines } : {}),
  };
}

function mapInvoiceLine(row: PurchaseInvoiceLineRow): PurchaseInvoiceLineDto {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    productId: row.product_id,
    description: row.description,
    goodsReceiptLineId: row.goods_receipt_line_id,
    purchaseEntryLineId: row.purchase_entry_line_id,
    quantity: Number(row.quantity),
    uomId: row.uom_id,
    rate: Number(row.rate),
    discountPercent: Number(row.discount_percent),
    discountAmount: Number(row.discount_amount),
    grossAmount: Number(row.gross_amount),
    taxableAmount: Number(row.taxable_amount),
    taxProfileId: row.tax_profile_id,
    hsnSacCode: row.hsn_sac_code,
    taxRate: Number(row.tax_rate),
    cgstAmount: Number(row.cgst_amount),
    sgstAmount: Number(row.sgst_amount),
    igstAmount: Number(row.igst_amount),
    cessAmount: Number(row.cess_amount),
    taxAmount: Number(row.tax_amount),
    lineTotal: Number(row.line_total),
    notes: row.notes,
    sortOrder: Number(row.sort_order),
    ...(row.product_name != null ? { productName: row.product_name } : {}),
    ...(row.uom_code !== undefined ? { uomCode: row.uom_code } : {}),
  };
}

function mapInvoice(row: PurchaseInvoiceRow, lines?: PurchaseInvoiceLineRow[]): PurchaseInvoiceDto {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    businessDate: row.business_date.slice(0, 10),
    supplierId: row.supplier_id,
    supplierInvoiceNumber: row.supplier_invoice_number,
    supplierInvoiceDate: row.supplier_invoice_date.slice(0, 10),
    dueDate: fromDbDate(row.due_date),
    creditDays: Number(row.credit_days),
    purchaseEntryId: row.purchase_entry_id,
    goodsReceiptId: row.goods_receipt_id,
    purchaseOrderId: row.purchase_order_id,
    locationId: row.location_id,
    status: row.status,
    matchStatus: row.match_status,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    supplierStateCode: row.supplier_state_code,
    isInterState: row.is_inter_state === 1,
    subtotalAmount: Number(row.subtotal_amount),
    discountAmount: Number(row.discount_amount),
    taxableAmount: Number(row.taxable_amount),
    cgstAmount: Number(row.cgst_amount),
    sgstAmount: Number(row.sgst_amount),
    igstAmount: Number(row.igst_amount),
    cessAmount: Number(row.cess_amount),
    taxAmount: Number(row.tax_amount),
    roundOffAmount: Number(row.round_off_amount),
    otherCharges: Number(row.other_charges),
    totalAmount: Number(row.total_amount),
    paidAmount: Number(row.paid_amount),
    outstandingAmount: Number(row.outstanding_amount),
    reference: row.reference,
    notes: row.notes,
    attachmentId: row.attachment_id,
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    approvedAt: fromDbDateTime(row.approved_at),
    postedBy: row.posted_by,
    postedAt: fromDbDateTime(row.posted_at),
    cancelledBy: row.cancelled_by,
    cancelledAt: fromDbDateTime(row.cancelled_at),
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    revision: Number(row.revision),
    ...(row.supplier_name !== undefined ? { supplierName: row.supplier_name } : {}),
    ...(row.supplier_gstin !== undefined ? { supplierGstin: row.supplier_gstin } : {}),
    ...(row.line_count !== undefined ? { lineCount: Number(row.line_count) } : {}),
    ...(lines !== undefined ? { lines: lines.map(mapInvoiceLine) } : {}),
  };
}

function mapPayable(row: AccountsPayableRow): AccountsPayableDto {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    purchaseInvoiceId: row.purchase_invoice_id,
    documentNumber: row.document_number,
    supplierInvoiceNumber: row.supplier_invoice_number,
    invoiceDate: row.invoice_date.slice(0, 10),
    dueDate: fromDbDate(row.due_date),
    creditDays: Number(row.credit_days),
    originalAmount: Number(row.original_amount),
    paidAmount: Number(row.paid_amount),
    adjustedAmount: Number(row.adjusted_amount),
    outstandingAmount: Number(row.outstanding_amount),
    status: row.status,
    isQueued: row.is_queued === 1,
    queuedBy: row.queued_by,
    queuedAt: fromDbDateTime(row.queued_at),
    notes: row.notes,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    ...(row.supplier_name !== undefined ? { supplierName: row.supplier_name } : {}),
    ...(row.days_overdue !== undefined
      ? { daysOverdue: row.days_overdue === null ? null : Number(row.days_overdue) }
      : {}),
  };
}

function mapAllocation(row: VendorPaymentAllocationRow) {
  return {
    id: row.id,
    paymentId: row.payment_id,
    accountsPayableId: row.accounts_payable_id,
    purchaseInvoiceId: row.purchase_invoice_id,
    allocatedAmount: Number(row.allocated_amount),
    createdAt: fromDbDateTimeRequired(row.created_at),
    ...(row.document_number !== undefined ? { documentNumber: row.document_number } : {}),
    ...(row.supplier_invoice_number !== undefined
      ? { supplierInvoiceNumber: row.supplier_invoice_number }
      : {}),
    ...(row.invoice_date !== undefined ? { invoiceDate: row.invoice_date.slice(0, 10) } : {}),
    ...(row.invoice_total !== undefined ? { invoiceTotal: Number(row.invoice_total) } : {}),
  };
}

function mapPayment(
  row: VendorPaymentRow,
  allocations?: VendorPaymentAllocationRow[],
): VendorPaymentDto {
  return {
    id: row.id,
    paymentNumber: row.payment_number,
    businessDate: row.business_date.slice(0, 10),
    supplierId: row.supplier_id,
    paymentDate: row.payment_date.slice(0, 10),
    method: row.method,
    status: row.status,
    amount: Number(row.amount),
    unallocatedAmount: Number(row.unallocated_amount),
    reference: row.reference,
    instrumentNumber: row.instrument_number,
    instrumentDate: fromDbDate(row.instrument_date),
    bankName: row.bank_name,
    notes: row.notes,
    purchaseEntryId: row.purchase_entry_id,
    createdBy: row.created_by,
    postedBy: row.posted_by,
    postedAt: fromDbDateTime(row.posted_at),
    cancelledBy: row.cancelled_by,
    cancelledAt: fromDbDateTime(row.cancelled_at),
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    revision: Number(row.revision),
    ...(row.supplier_name !== undefined ? { supplierName: row.supplier_name } : {}),
    ...(allocations !== undefined ? { allocations: allocations.map(mapAllocation) } : {}),
  };
}

function mapVendorLedgerEntry(row: VendorLedgerEntryRow): VendorLedgerEntryDto {
  return {
    id: row.id,
    entrySeq: Number(row.entry_seq),
    supplierId: row.supplier_id,
    businessDate: row.business_date.slice(0, 10),
    transactionType: row.transaction_type,
    documentNumber: row.document_number,
    sourceType: row.source_type,
    sourceId: row.source_id,
    reference: row.reference,
    narration: row.narration,
    debitAmount: Number(row.debit_amount),
    creditAmount: Number(row.credit_amount),
    runningBalance: Number(row.running_balance),
    occurredAt: fromDbDateTimeRequired(row.occurred_at),
    actorId: row.actor_id,
    createdAt: fromDbDateTimeRequired(row.created_at),
    ...(row.actor_name !== undefined ? { actorName: row.actor_name } : {}),
  };
}

function mapRegisterRow(row: PurchaseRegisterRow): PurchaseRegisterRowDto {
  return {
    entryId: row.entry_id,
    entryNumber: row.entry_number,
    businessDate: row.business_date.slice(0, 10),
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    supplierGstin: row.supplier_gstin,
    supplierInvoiceNumber: row.supplier_invoice_number,
    supplierInvoiceDate: fromDbDate(row.supplier_invoice_date),
    purchaseType: row.purchase_type,
    status: row.status,
    paymentMethod: row.payment_method,
    paymentStatus: (row.payment_status as PayableStatus | null) ?? null,
    lineCount: Number(row.line_count),
    totalQuantity: Number(row.total_quantity ?? 0),
    taxableAmount: Number(row.taxable_amount),
    cgstAmount: Number(row.cgst_amount),
    sgstAmount: Number(row.sgst_amount),
    igstAmount: Number(row.igst_amount),
    cessAmount: Number(row.cess_amount),
    taxAmount: Number(row.tax_amount),
    roundOffAmount: Number(row.round_off_amount),
    totalAmount: Number(row.total_amount),
    paidAmount: Number(row.paid_amount),
    outstandingAmount: Number(row.outstanding_amount),
    grnNumber: row.grn_number,
    invoiceNumber: row.invoice_number,
    openExceptionCount: Number(row.open_exception_count),
    postedAt: fromDbDateTime(row.posted_at),
    createdByName: row.created_by_name,
  };
}

/* ------------------------------------------------------------------------- service --- */

export class PurchaseEntryService {
  /* ------------------------------------------------------------- computation */

  /**
   * Turn a set of lines into what the bill actually comes to.
   *
   * Every resolution here has a fixed precedence, and every one of them prefers what the
   * operator typed on this line over what a master says, because the bill in their hand is
   * the primary document:
   *
   *   tax profile        line override → the product's profile → no tax
   *   conversion factor  line override → the supplier mapping → the product's factor → 1
   *   destination        line override → the product's default → the entry's receiving
   *                      location → the location flagged `is_default_receiving`
   */
  async compute(db: Db, args: ComputeArgs): Promise<ComputedPurchaseEntry> {
    const productIds = [
      ...new Set(
        args.lines
          .map((line) => line.productId ?? null)
          .filter((id): id is string => id !== null),
      ),
    ];
    const products = new Map(
      (await purchaseDocumentRepository.findProducts(db, productIds)).map((row) => [row.id, row]),
    );
    const mappings = new Map(
      (
        await purchaseDocumentRepository.findSupplierProducts(db, args.supplier.id, productIds)
      ).map((row) => [row.product_id, row]),
    );

    const profileIds = [
      ...new Set(
        args.lines
          .map((line) => {
            if (line.taxProfileId !== undefined && line.taxProfileId !== null) {
              return line.taxProfileId;
            }
            const product = line.productId == null ? null : products.get(line.productId);
            return product?.tax_profile_id ?? null;
          })
          .filter((id): id is string => id !== null),
      ),
    ];
    const profiles = new Map(
      (await purchaseDocumentRepository.findTaxProfiles(db, profileIds)).map((row) => [
        row.id,
        row,
      ]),
    );

    // Read as unknown and coerce: a two-digit state code stored as JSON round-trips through
    // the driver as the number 27, not the string '27', and the comparison below is textual.
    const rawHomeState = await settingsRepository.getValue<unknown>(db, 'pos.home_state_code', '');
    const homeState =
      rawHomeState === null || rawHomeState === undefined ? '' : String(rawHomeState).trim();
    const supplierState =
      args.supplier.state_code === null || args.supplier.state_code === ''
        ? null
        : args.supplier.state_code;
    const isInterState = isInterStateSupply(homeState === '' ? null : homeState, supplierState);

    // Resolved once rather than per line: it is a table scan for a single flagged row.
    let defaultReceiving: string | null | undefined;
    const fallbackDestination = async (): Promise<string | null> => {
      if (defaultReceiving === undefined) {
        defaultReceiving = await purchaseDocumentRepository.findDefaultReceivingLocation(db);
      }
      return defaultReceiving;
    };

    const computed: ComputedPurchaseLine[] = [];
    let sortOrder = 0;

    for (const line of args.lines) {
      const productId = line.productId ?? null;
      const product = productId === null ? null : (products.get(productId) ?? null);
      if (productId !== null && product === null) {
        throw new ValidationError('A line names a product that does not exist', [
          { path: 'lines', message: `Unknown product ${productId}` },
        ]);
      }
      const mapping = productId === null ? null : (mappings.get(productId) ?? null);

      const quantity = qty(line.quantity);
      const conversionFactor = factor6(
        line.conversionFactor != null && line.conversionFactor > 0
          ? line.conversionFactor
          : mapping !== null
            ? Number(mapping.conversion_factor)
            : product !== null
              ? Number(product.purchase_conversion_factor)
              : 1,
      );
      const unitRate = rate4(line.rate);

      const grossAmount = money(quantity * unitRate);
      const discountPercent = line.discountPercent ?? 0;
      const discountAmount = money((grossAmount * discountPercent) / 100);
      const net = money(grossAmount - discountAmount);

      const taxProfileId =
        line.taxProfileId !== undefined && line.taxProfileId !== null
          ? line.taxProfileId
          : (product?.tax_profile_id ?? null);
      const profile = taxProfileId === null ? null : (profiles.get(taxProfileId) ?? null);
      const treatment = treatmentOf(profile, isInterState);
      const breakdown = applyTax(net, treatment);

      const received = qty(line.receivedQuantity ?? quantity);
      const rejected = qty(line.rejectedQuantity ?? 0);
      const accepted = qty(line.acceptedQuantity ?? Math.max(0, received - rejected));

      if (accepted + rejected > received + QUANTITY_EPSILON) {
        throw new ValidationError(
          'Accepted plus rejected quantity cannot exceed what was received',
          [
            {
              path: 'lines',
              message: `${product?.name ?? line.description ?? 'A line'}: received ${received}, accepted ${accepted}, rejected ${rejected}`,
            },
          ],
        );
      }

      const destinationLocationId =
        line.destinationLocationId ??
        product?.default_location_id ??
        args.receivingLocationId ??
        (product !== null && product.is_stocked === 1 ? await fallbackDestination() : null);

      computed.push({
        id: line.id ?? newId(),
        productId,
        product,
        description: line.description ?? null,
        supplierSku: line.supplierSku ?? mapping?.supplier_sku ?? null,
        quantity,
        purchaseUomId:
          line.purchaseUomId ?? mapping?.purchase_uom_id ?? product?.purchase_uom_id ?? null,
        stockUomId: product?.stock_uom_id ?? null,
        conversionFactor,
        stockQuantity: qty(quantity * conversionFactor),
        rate: unitRate,
        discountPercent,
        discountAmount,
        grossAmount,
        taxableAmount: breakdown.taxableAmount,
        taxProfileId,
        taxRate: treatment.rate,
        cgstAmount: breakdown.cgstAmount,
        sgstAmount: breakdown.sgstAmount,
        igstAmount: breakdown.igstAmount,
        cessAmount: breakdown.cessAmount,
        taxAmount: breakdown.taxAmount,
        lineTotal: breakdown.lineTotal,
        batchNumber: line.batchNumber ?? null,
        manufacturingDate: line.manufacturingDate ?? null,
        expiryDate: line.expiryDate ?? null,
        receivedQuantity: received,
        acceptedQuantity: accepted,
        rejectedQuantity: rejected,
        rejectionReason: line.rejectionReason ?? null,
        destinationLocationId,
        notes: line.notes ?? null,
        sortOrder: line.sortOrder ?? sortOrder,
        hsnCode: product?.hsn_code ?? null,
        hasSupplierMapping: mapping !== null,
        lastPurchaseRate:
          product?.last_purchase_rate == null ? null : Number(product.last_purchase_rate),
      });
      sortOrder += 1;
    }

    const totals = await this.totalsOf(db, computed, args.otherCharges, args.paidAmount);
    return { lines: computed, totals, supplierStateCode: supplierState, isInterState };
  }

  /**
   * Sum the lines, add the other charges, and round to the rupee when the operation rounds.
   *
   * Round-off reuses the POS setting rather than inventing a purchase-specific one: a site
   * that rounds its bills rounds its purchases, and two keys would only ever let the two
   * disagree.
   */
  private async totalsOf(
    db: Db,
    lines: readonly ComputedPurchaseLine[],
    otherCharges: number,
    paidAmount: number,
  ): Promise<PurchaseEntryTotals> {
    let subtotal = 0;
    let discount = 0;
    let taxable = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    let cess = 0;
    let tax = 0;
    for (const line of lines) {
      subtotal += line.grossAmount;
      discount += line.discountAmount;
      taxable += line.taxableAmount;
      cgst += line.cgstAmount;
      sgst += line.sgstAmount;
      igst += line.igstAmount;
      cess += line.cessAmount;
      tax += line.taxAmount;
    }

    const charges = money(otherCharges);
    const payable = money(money(taxable) + money(tax) + charges);
    const roundOffEnabled = await settingsRepository.getValue<boolean>(
      db,
      'pos.round_off_enabled',
      true,
    );
    const totalAmount = roundOffEnabled ? Math.round(payable) : payable;
    const paid = money(paidAmount);

    return {
      subtotalAmount: money(subtotal),
      discountAmount: money(discount),
      taxableAmount: money(taxable),
      cgstAmount: money(cgst),
      sgstAmount: money(sgst),
      igstAmount: money(igst),
      cessAmount: money(cess),
      taxAmount: money(tax),
      roundOffAmount: money(totalAmount - payable),
      otherCharges: charges,
      totalAmount,
      paidAmount: paid,
      outstandingAmount: money(totalAmount - paid),
    };
  }

  /** The exception engine's view of a computed entry. */
  exceptionContextOf(args: {
    entryId: string;
    businessDate: string;
    purchaseType: PurchaseType;
    supplier: SupplierRow;
    supplierInvoiceNumber: string | null;
    supplierInvoiceDate: string | null;
    supplierTotalAmount: number | null;
    computed: ComputedPurchaseEntry;
  }): ExceptionContext {
    const lines: ExceptionLineContext[] = args.computed.lines.map((line) => ({
      lineId: line.id,
      productId: line.productId,
      label: line.product?.name ?? line.description ?? 'Line',
      isBatchTracked: line.product?.is_batch_tracked === 1,
      isExpiryTracked: line.product?.is_expiry_tracked === 1,
      isStocked: line.product?.is_stocked === 1,
      hasSupplierMapping: line.hasSupplierMapping,
      lastPurchaseRate: line.lastPurchaseRate,
      quantity: line.quantity,
      receivedQuantity: line.receivedQuantity,
      acceptedQuantity: line.acceptedQuantity,
      rejectedQuantity: line.rejectedQuantity,
      rate: line.rate,
      conversionFactor: line.conversionFactor,
      batchNumber: line.batchNumber,
      expiryDate: line.expiryDate,
      destinationLocationId: line.destinationLocationId,
      taxAmount: line.taxAmount,
    }));

    return {
      documentId: args.entryId,
      businessDate: args.businessDate,
      purchaseType: args.purchaseType,
      supplierId: args.supplier.id,
      supplierIsApproved: args.supplier.vendor_is_approved === 1,
      supplierGstin: args.supplier.gstin,
      supplierInvoiceNumber: args.supplierInvoiceNumber,
      supplierInvoiceDate: args.supplierInvoiceDate,
      supplierTotalAmount: args.supplierTotalAmount,
      computedTotal: args.computed.totals.totalAmount,
      lines,
    };
  }

  /** Read a draft's stored lines back into the shape the computation engine takes. */
  linesFromRows(rows: readonly PurchaseEntryLineRow[]): PurchaseLineInput[] {
    return rows.map((row) => ({
      id: row.id,
      productId: row.product_id,
      description: row.description,
      supplierSku: row.supplier_sku,
      quantity: Number(row.quantity),
      purchaseUomId: row.purchase_uom_id,
      // The stored factor is what the operator agreed to on this bill, so it is carried as a
      // line override rather than re-resolved: a pack size edited on the master afterwards
      // must not silently restate what arrived.
      conversionFactor: Number(row.conversion_factor),
      rate: Number(row.rate),
      discountPercent: Number(row.discount_percent),
      taxProfileId: row.tax_profile_id,
      batchNumber: row.batch_number,
      manufacturingDate: fromDbDate(row.manufacturing_date),
      expiryDate: fromDbDate(row.expiry_date),
      receivedQuantity: Number(row.received_quantity),
      acceptedQuantity: Number(row.accepted_quantity),
      rejectedQuantity: Number(row.rejected_quantity),
      rejectionReason: row.rejection_reason,
      destinationLocationId: row.destination_location_id,
      notes: row.notes,
      sortOrder: Number(row.sort_order),
    }));
  }

  /** Rewrite a draft's lines from a fresh computation. */
  async writeLines(
    cx: PoolConnection,
    entryId: string,
    computed: readonly ComputedPurchaseLine[],
  ): Promise<void> {
    await purchaseEntryRepository.deleteLines(cx, entryId);
    for (const line of computed) {
      await purchaseEntryRepository.insertLine(cx, {
        id: line.id,
        entryId,
        productId: line.productId,
        description: line.description,
        supplierSku: line.supplierSku,
        quantity: line.quantity,
        purchaseUomId: line.purchaseUomId,
        stockUomId: line.stockUomId,
        conversionFactor: line.conversionFactor,
        stockQuantity: line.stockQuantity,
        rate: line.rate,
        discountPercent: line.discountPercent,
        discountAmount: line.discountAmount,
        grossAmount: line.grossAmount,
        taxableAmount: line.taxableAmount,
        taxProfileId: line.taxProfileId,
        taxRate: line.taxRate,
        cgstAmount: line.cgstAmount,
        sgstAmount: line.sgstAmount,
        igstAmount: line.igstAmount,
        cessAmount: line.cessAmount,
        taxAmount: line.taxAmount,
        lineTotal: line.lineTotal,
        batchNumber: line.batchNumber,
        manufacturingDate: line.manufacturingDate,
        expiryDate: line.expiryDate,
        receivedQuantity: line.receivedQuantity,
        acceptedQuantity: line.acceptedQuantity,
        rejectedQuantity: line.rejectedQuantity,
        rejectionReason: line.rejectionReason,
        destinationLocationId: line.destinationLocationId,
        purchaseOrderLineId: null,
        notes: line.notes,
        sortOrder: line.sortOrder,
      });
    }
  }

  async requireSupplier(db: Db, supplierId: string): Promise<SupplierRow> {
    const supplier = await purchaseDocumentRepository.findSupplier(db, supplierId);
    if (supplier === null) throw new NotFoundError('Supplier', supplierId);
    return supplier;
  }

  /* ------------------------------------------------------------------ entries */

  async listEntries(query: PurchaseEntryListQuery) {
    const paging = pagingFor(query);
    const { rows, total } = await purchaseEntryRepository.listEntries(getPool(), {
      ...(query.supplierId !== undefined ? { supplierId: query.supplierId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.purchaseType !== undefined ? { purchaseType: query.purchaseType } : {}),
      ...(query.paymentMethod !== undefined ? { paymentMethod: query.paymentMethod } : {}),
      ...(query.locationId !== undefined ? { locationId: query.locationId } : {}),
      ...(query.dateFrom !== undefined ? { dateFrom: query.dateFrom } : {}),
      ...(query.dateTo !== undefined ? { dateTo: query.dateTo } : {}),
      ...(query.withExceptionsOnly !== undefined
        ? { withExceptionsOnly: query.withExceptionsOnly }
        : {}),
      limit: paging.limit,
      offset: paging.offset,
    });
    return buildPage(
      rows.map((row) => mapEntry(row)),
      total,
      paging.page,
      paging.pageSize,
    );
  }

  async getEntry(id: string): Promise<PurchaseEntryDto> {
    return this.readEntry(getPool(), id);
  }

  async readEntry(db: Db, id: string): Promise<PurchaseEntryDto> {
    const row = await purchaseEntryRepository.findEntry(db, id);
    if (row === null) throw new NotFoundError('Purchase entry', id);
    const lines = await purchaseEntryRepository.listLines(db, id);
    const exceptions = await purchaseEntryRepository.listExceptions(db, 'PURCHASE_ENTRY', id);
    return mapEntry(row, { lines, exceptions: exceptions.map(mapPurchaseException) });
  }

  async createEntry(
    input: CreatePurchaseEntryRequest & { lines: PurchaseLineInput[] },
    actor: AuditActor,
  ): Promise<PurchaseEntryDto> {
    return withTransaction(async (cx) => {
      const businessDate = input.businessDate ?? todayIsoDate();
      const supplier = await this.requireSupplier(cx, input.supplierId);
      const purchaseType = input.purchaseType ?? PurchaseType.STOCK;
      const paymentMethod = input.paymentMethod ?? PurchasePaymentMethod.CASH;
      const creditDays = input.creditDays ?? Number(supplier.vendor_credit_days);
      const receivingLocationId =
        input.receivingLocationId ?? supplier.vendor_default_location_id ?? null;

      const computed = await this.compute(cx, {
        supplier,
        purchaseType,
        receivingLocationId,
        otherCharges: input.otherCharges ?? 0,
        paidAmount: 0,
        lines: input.lines,
      });

      const { documentNumber, dailySequence } = await documentNumberService.next(
        cx,
        'PURCHASE_ENTRY',
        businessDate,
      );

      const id = input.id ?? newId();
      const invoiceDate = input.supplierInvoiceDate ?? null;
      await purchaseEntryRepository.insertEntry(cx, {
        id,
        entryNumber: documentNumber,
        dailySequence,
        businessDate,
        supplierId: supplier.id,
        purchaseType,
        entryMode: input.entryMode ?? PurchaseEntryMode.QUICK,
        supplierInvoiceNumber: input.supplierInvoiceNumber ?? null,
        supplierInvoiceDate: invoiceDate,
        dueDate:
          input.dueDate ??
          vendorLedgerService.resolveDueDate(invoiceDate ?? businessDate, paymentMethod, creditDays),
        creditDays,
        paymentMethod,
        paymentReference: input.paymentReference ?? null,
        receivingLocationId,
        purchaseOrderId: input.purchaseOrderId ?? null,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        attachmentId: input.attachmentId ?? null,
        billScanId: input.billScanId ?? null,
        supplierStateCode: computed.supplierStateCode,
        isInterState: computed.isInterState,
        otherCharges: computed.totals.otherCharges,
        supplierTotalAmount: input.supplierTotalAmount ?? null,
        createdBy: actor.userId,
      });

      await this.writeLines(cx, id, computed.lines);
      await purchaseEntryRepository.setEntryTotals(cx, id, computed.totals);
      await this.refreshExceptions(cx, {
        entryId: id,
        businessDate,
        purchaseType,
        supplier,
        supplierInvoiceNumber: input.supplierInvoiceNumber ?? null,
        supplierInvoiceDate: invoiceDate,
        supplierTotalAmount: input.supplierTotalAmount ?? null,
        computed,
      });

      await auditService.record(cx, actor, {
        action: AuditAction.PURCHASE_ENTRY_CREATED,
        entityType: 'purchase_entry',
        entityId: id,
        after: {
          entryNumber: documentNumber,
          supplierId: supplier.id,
          purchaseType,
          paymentMethod,
          lineCount: computed.lines.length,
          totalAmount: computed.totals.totalAmount,
        },
      });

      return this.readEntry(cx, id);
    });
  }

  async updateEntry(
    id: string,
    input: UpdatePurchaseEntryRequest & { lines?: PurchaseLineInput[] },
    actor: AuditActor,
  ): Promise<PurchaseEntryDto> {
    return withTransaction(async (cx) => {
      const before = await purchaseEntryRepository.lockEntry(cx, id);
      if (before === null) throw new NotFoundError('Purchase entry', id);
      this.assertEditable(before);
      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== Number(before.revision)
      ) {
        throw new StaleWriteError(Number(before.revision));
      }

      const supplierId = input.supplierId ?? before.supplier_id;
      const supplier = await this.requireSupplier(cx, supplierId);
      const businessDate = input.businessDate ?? before.business_date.slice(0, 10);
      const purchaseType = input.purchaseType ?? before.purchase_type;
      const paymentMethod = input.paymentMethod ?? before.payment_method;
      const creditDays = input.creditDays ?? Number(before.credit_days);
      const receivingLocationId =
        input.receivingLocationId !== undefined
          ? input.receivingLocationId
          : before.receiving_location_id;
      const supplierInvoiceNumber =
        input.supplierInvoiceNumber !== undefined
          ? input.supplierInvoiceNumber
          : before.supplier_invoice_number;
      const supplierInvoiceDate =
        input.supplierInvoiceDate !== undefined
          ? input.supplierInvoiceDate
          : fromDbDate(before.supplier_invoice_date);
      const supplierTotalAmount =
        input.supplierTotalAmount !== undefined
          ? input.supplierTotalAmount
          : before.supplier_total_amount === null
            ? null
            : Number(before.supplier_total_amount);
      const otherCharges = input.otherCharges ?? Number(before.other_charges);

      const lineInputs =
        input.lines ?? this.linesFromRows(await purchaseEntryRepository.listLines(cx, id));

      const computed = await this.compute(cx, {
        supplier,
        purchaseType,
        receivingLocationId,
        otherCharges,
        paidAmount: Number(before.paid_amount),
        lines: lineInputs,
      });

      await purchaseEntryRepository.updateEntryHeader(cx, id, {
        supplierId,
        purchaseType,
        businessDate,
        paymentMethod,
        creditDays,
        receivingLocationId,
        supplierInvoiceNumber,
        supplierInvoiceDate,
        supplierTotalAmount,
        otherCharges: computed.totals.otherCharges,
        supplierStateCode: computed.supplierStateCode,
        isInterState: computed.isInterState,
        dueDate:
          input.dueDate ??
          vendorLedgerService.resolveDueDate(
            supplierInvoiceDate ?? businessDate,
            paymentMethod,
            creditDays,
          ),
        ...(input.entryMode !== undefined ? { entryMode: input.entryMode } : {}),
        ...(input.paymentReference !== undefined
          ? { paymentReference: input.paymentReference }
          : {}),
        ...(input.purchaseOrderId !== undefined ? { purchaseOrderId: input.purchaseOrderId } : {}),
        ...(input.reference !== undefined ? { reference: input.reference } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.attachmentId !== undefined ? { attachmentId: input.attachmentId } : {}),
        ...(input.billScanId !== undefined ? { billScanId: input.billScanId } : {}),
      });

      await this.writeLines(cx, id, computed.lines);
      await purchaseEntryRepository.setEntryTotals(cx, id, computed.totals);
      await this.refreshExceptions(cx, {
        entryId: id,
        businessDate,
        purchaseType,
        supplier,
        supplierInvoiceNumber,
        supplierInvoiceDate,
        supplierTotalAmount,
        computed,
      });

      await auditService.record(cx, actor, {
        action: AuditAction.PURCHASE_ENTRY_UPDATED,
        entityType: 'purchase_entry',
        entityId: id,
        before: {
          status: before.status,
          supplierId: before.supplier_id,
          totalAmount: Number(before.total_amount),
        },
        after: {
          supplierId,
          lineCount: computed.lines.length,
          totalAmount: computed.totals.totalAmount,
        },
      });

      return this.readEntry(cx, id);
    });
  }

  /**
   * Mark a draft as reviewed and ready to post.
   *
   * READY does not mean clean: it means somebody has looked. A blocking exception still
   * refuses at the moment of posting, which is where refusing belongs.
   */
  async markReady(id: string, actor: AuditActor): Promise<PurchaseEntryDto> {
    return withTransaction(async (cx) => {
      const row = await purchaseEntryRepository.lockEntry(cx, id);
      if (row === null) throw new NotFoundError('Purchase entry', id);
      if (row.status === PurchaseEntryStatus.POSTED) throw new ConflictError(POSTED_IS_IMMUTABLE);
      if (row.status !== PurchaseEntryStatus.DRAFT) {
        throw new ConflictError(`A ${row.status} purchase entry cannot be marked ready`);
      }
      const lines = await purchaseEntryRepository.listLines(cx, id);
      if (lines.length === 0) {
        throw new ValidationError('A purchase entry needs at least one line before it is ready');
      }

      await purchaseEntryRepository.setEntryStatus(cx, id, { status: PurchaseEntryStatus.READY });
      await auditService.record(cx, actor, {
        action: AuditAction.PURCHASE_ENTRY_READY,
        entityType: 'purchase_entry',
        entityId: id,
        before: { status: row.status },
        after: { status: PurchaseEntryStatus.READY },
      });
      return this.readEntry(cx, id);
    });
  }

  async cancelEntry(
    id: string,
    reason: string | null,
    actor: AuditActor,
  ): Promise<PurchaseEntryDto> {
    return withTransaction(async (cx) => {
      const row = await purchaseEntryRepository.lockEntry(cx, id);
      if (row === null) throw new NotFoundError('Purchase entry', id);
      if (row.status === PurchaseEntryStatus.POSTED) throw new ConflictError(POSTED_IS_IMMUTABLE);
      if (row.status === PurchaseEntryStatus.CANCELLED) {
        throw new ConflictError('This purchase entry is already cancelled');
      }

      await purchaseEntryRepository.setEntryStatus(cx, id, {
        status: PurchaseEntryStatus.CANCELLED,
        cancelledBy: actor.userId,
        cancelledAt: toDbDateTime(),
        cancelReason: reason,
      });
      await auditService.record(cx, actor, {
        action: AuditAction.PURCHASE_ENTRY_CANCELLED,
        entityType: 'purchase_entry',
        entityId: id,
        before: { status: row.status },
        after: { status: PurchaseEntryStatus.CANCELLED, reason },
      });
      return this.readEntry(cx, id);
    });
  }

  /** Detect and rewrite this entry's exceptions. Called on every save and on every preview. */
  async refreshExceptions(
    cx: PoolConnection,
    args: {
      entryId: string;
      businessDate: string;
      purchaseType: PurchaseType;
      supplier: SupplierRow;
      supplierInvoiceNumber: string | null;
      supplierInvoiceDate: string | null;
      supplierTotalAmount: number | null;
      computed: ComputedPurchaseEntry;
    },
  ) {
    const context = this.exceptionContextOf(args);
    const drafts = await purchaseExceptionService.detect(cx, context);
    await purchaseExceptionService.replace(cx, args.entryId, drafts);
    return drafts;
  }

  private assertEditable(row: PurchaseEntryRow): void {
    if (row.status === PurchaseEntryStatus.POSTED) throw new ConflictError(POSTED_IS_IMMUTABLE);
    if (row.status === PurchaseEntryStatus.CANCELLED) {
      throw new ConflictError('A cancelled purchase entry can no longer be edited');
    }
  }

  /* ----------------------------------------------------------------- register */

  private registerFilterOf(query: PurchaseRegisterQuery, limit: number, offset: number) {
    const filter: PurchaseRegisterFilter = { limit, offset };
    if (query.supplierId !== undefined) filter.supplierId = query.supplierId;
    if (query.status !== undefined) filter.status = query.status;
    if (query.purchaseType !== undefined) filter.purchaseType = query.purchaseType;
    if (query.paymentMethod !== undefined) filter.paymentMethod = query.paymentMethod;
    if (query.paymentStatus !== undefined) filter.paymentStatus = query.paymentStatus;
    if (query.locationId !== undefined) filter.locationId = query.locationId;
    if (query.productId !== undefined) filter.productId = query.productId;
    if (query.dateFrom !== undefined) filter.dateFrom = query.dateFrom;
    if (query.dateTo !== undefined) filter.dateTo = query.dateTo;
    if (query.amountMin !== undefined) filter.amountMin = query.amountMin;
    if (query.amountMax !== undefined) filter.amountMax = query.amountMax;
    if (query.withExceptionsOnly !== undefined) {
      filter.withExceptionsOnly = query.withExceptionsOnly;
    }
    return filter;
  }

  async register(query: PurchaseRegisterQuery) {
    const paging = pagingFor(query);
    const { rows, total } = await purchaseEntryRepository.listRegister(
      getPool(),
      this.registerFilterOf(query, paging.limit, paging.offset),
    );
    return buildPage(rows.map(mapRegisterRow), total, paging.page, paging.pageSize);
  }

  async registerTotals(query: PurchaseRegisterQuery): Promise<PurchaseRegisterTotalsDto> {
    const row = await purchaseEntryRepository.registerTotals(
      getPool(),
      this.registerFilterOf(query, 1, 0),
    );
    return {
      entryCount: Number(row.entry_count),
      taxableAmount: money(Number(row.taxable_amount ?? 0)),
      cgstAmount: money(Number(row.cgst_amount ?? 0)),
      sgstAmount: money(Number(row.sgst_amount ?? 0)),
      igstAmount: money(Number(row.igst_amount ?? 0)),
      cessAmount: money(Number(row.cess_amount ?? 0)),
      taxAmount: money(Number(row.tax_amount ?? 0)),
      totalAmount: money(Number(row.total_amount ?? 0)),
      paidAmount: money(Number(row.paid_amount ?? 0)),
      outstandingAmount: money(Number(row.outstanding_amount ?? 0)),
    };
  }

  /* ------------------------------------------------------- generated documents */

  async listReceipts(query: GoodsReceiptListQuery) {
    const paging = pagingFor(query);
    const { rows, total } = await purchaseDocumentRepository.listGoodsReceipts(getPool(), {
      ...(query.supplierId !== undefined ? { supplierId: query.supplierId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.locationId !== undefined ? { locationId: query.locationId } : {}),
      ...(query.purchaseEntryId !== undefined ? { purchaseEntryId: query.purchaseEntryId } : {}),
      ...(query.dateFrom !== undefined ? { dateFrom: query.dateFrom } : {}),
      ...(query.dateTo !== undefined ? { dateTo: query.dateTo } : {}),
      limit: paging.limit,
      offset: paging.offset,
    });
    return buildPage(
      rows.map((row) => mapGoodsReceipt(row)),
      total,
      paging.page,
      paging.pageSize,
    );
  }

  async getReceipt(id: string): Promise<GoodsReceiptDto> {
    return this.readReceipt(getPool(), id);
  }

  async readReceipt(db: Db, id: string): Promise<GoodsReceiptDto> {
    const row = await purchaseDocumentRepository.findGoodsReceipt(db, id);
    if (row === null) throw new NotFoundError('Goods receipt', id);
    return mapGoodsReceipt(row, await this.readReceiptLines(db, id));
  }

  private async readReceiptLines(db: Db, receiptId: string): Promise<GoodsReceiptLineDto[]> {
    const lines = await purchaseDocumentRepository.listGoodsReceiptLines(db, receiptId);
    const destinations = await purchaseDocumentRepository.listDestinations(
      db,
      lines.map((line) => line.id),
    );
    const byLine = new Map<string, GoodsReceiptDestinationRow[]>();
    for (const destination of destinations) {
      const list = byLine.get(destination.goods_receipt_line_id) ?? [];
      list.push(destination);
      byLine.set(destination.goods_receipt_line_id, list);
    }
    return lines.map((line) => mapReceiptLine(line, byLine.get(line.id) ?? []));
  }

  async listInvoices(query: PurchaseInvoiceListQuery) {
    const paging = pagingFor(query);
    const { rows, total } = await purchaseDocumentRepository.listInvoices(getPool(), {
      ...(query.supplierId !== undefined ? { supplierId: query.supplierId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.paymentStatus !== undefined ? { paymentStatus: query.paymentStatus } : {}),
      ...(query.matchStatus !== undefined ? { matchStatus: query.matchStatus } : {}),
      ...(query.dateFrom !== undefined ? { dateFrom: query.dateFrom } : {}),
      ...(query.dateTo !== undefined ? { dateTo: query.dateTo } : {}),
      ...(query.overdueOnly !== undefined ? { overdueOnly: query.overdueOnly } : {}),
      limit: paging.limit,
      offset: paging.offset,
    });
    return buildPage(
      rows.map((row) => mapInvoice(row)),
      total,
      paging.page,
      paging.pageSize,
    );
  }

  async getInvoice(id: string): Promise<PurchaseInvoiceDto> {
    return this.readInvoice(getPool(), id);
  }

  async readInvoice(db: Db, id: string): Promise<PurchaseInvoiceDto> {
    const row = await purchaseDocumentRepository.findInvoice(db, id);
    if (row === null) throw new NotFoundError('Purchase invoice', id);
    const lines = await purchaseDocumentRepository.listInvoiceLines(db, id);
    return mapInvoice(row, lines);
  }

  /* -------------------------------------------------------------- vendor ledger */

  async listVendorLedger(query: VendorLedgerListQuery) {
    const paging = pagingFor(query);
    const { rows, total } = await purchaseDocumentRepository.listVendorLedger(getPool(), {
      ...(query.supplierId !== undefined ? { supplierId: query.supplierId } : {}),
      ...(query.transactionType !== undefined ? { transactionType: query.transactionType } : {}),
      ...(query.dateFrom !== undefined ? { dateFrom: query.dateFrom } : {}),
      ...(query.dateTo !== undefined ? { dateTo: query.dateTo } : {}),
      limit: paging.limit,
      offset: paging.offset,
    });
    return buildPage(rows.map(mapVendorLedgerEntry), total, paging.page, paging.pageSize);
  }

  /**
   * A supplier's statement. The opening figure is derived from the ledger rather than read
   * from the cached balance, so a statement that does not reconcile to the ledger is
   * impossible rather than merely unlikely.
   */
  async vendorStatement(
    supplierId: string,
    query: { dateFrom?: IsoDate; dateTo?: IsoDate; page?: number; pageSize?: number },
  ): Promise<VendorStatementDto> {
    const pool = getPool();
    const supplier = await this.requireSupplier(pool, supplierId);
    const paging = pagingFor(query);

    const opening =
      query.dateFrom === undefined
        ? 0
        : await vendorLedgerService.openingBalance(pool, supplierId, query.dateFrom);

    const rows = await vendorLedgerService.listStatement(pool, supplierId, {
      ...(query.dateFrom !== undefined ? { from: query.dateFrom } : {}),
      ...(query.dateTo !== undefined ? { to: query.dateTo } : {}),
      limit: paging.limit,
      offset: paging.offset,
    });
    const entries = (rows as VendorLedgerEntryRow[]).map(mapVendorLedgerEntry);

    let debits = 0;
    let credits = 0;
    for (const entry of entries) {
      debits += entry.debitAmount;
      credits += entry.creditAmount;
    }

    return {
      supplierId,
      supplierName: supplier.name,
      supplierCode: supplier.code,
      fromDate: query.dateFrom ?? null,
      toDate: query.dateTo ?? null,
      openingBalance: money(opening),
      totalDebits: money(debits),
      totalCredits: money(credits),
      closingBalance:
        entries.length > 0
          ? (entries[entries.length - 1] as VendorLedgerEntryDto).runningBalance
          : money(opening),
      entries,
    };
  }

  async vendorAgeing(supplierId?: string): Promise<VendorAgeingRowDto[]> {
    const rows = await purchaseDocumentRepository.vendorAgeing(getPool(), supplierId);
    return rows.map((row) => ({
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      supplierCode: row.supplier_code,
      notDue: money(Number(row.not_due ?? 0)),
      days0to30: money(Number(row.days_0_30 ?? 0)),
      days31to60: money(Number(row.days_31_60 ?? 0)),
      days61to90: money(Number(row.days_61_90 ?? 0)),
      over90: money(Number(row.over_90 ?? 0)),
      total: money(Number(row.total ?? 0)),
      oldestDueDate: fromDbDate(row.oldest_due_date),
    }));
  }

  /* ------------------------------------------------------------------ payables */

  async listPayables(query: AccountsPayableListQuery) {
    const paging = pagingFor(query);
    const { rows, total } = await purchaseDocumentRepository.listPayables(getPool(), {
      ...(query.supplierId !== undefined ? { supplierId: query.supplierId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.queuedOnly !== undefined ? { queuedOnly: query.queuedOnly } : {}),
      ...(query.overdueOnly !== undefined ? { overdueOnly: query.overdueOnly } : {}),
      ...(query.dueBefore !== undefined ? { dueBefore: query.dueBefore } : {}),
      limit: paging.limit,
      offset: paging.offset,
    });
    return buildPage(rows.map(mapPayable), total, paging.page, paging.pageSize);
  }

  async queuePayable(id: string, actor: AuditActor): Promise<AccountsPayableDto> {
    return withTransaction(async (cx) => {
      const payable = await purchaseDocumentRepository.findPayable(cx, id);
      if (payable === null) throw new NotFoundError('Payable', id);
      const queued = await purchaseDocumentRepository.queuePayable(cx, id, actor.userId);
      if (!queued) {
        throw new ConflictError(`A ${payable.status} payable cannot be queued for payment`);
      }
      const after = await purchaseDocumentRepository.findPayable(cx, id);
      if (after === null) throw new NotFoundError('Payable', id);
      return mapPayable(after);
    });
  }

  /* ------------------------------------------------------------------ payments */

  async listPayments(query: VendorPaymentListQuery) {
    const paging = pagingFor(query);
    const { rows, total } = await purchaseDocumentRepository.listPayments(getPool(), {
      ...(query.supplierId !== undefined ? { supplierId: query.supplierId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.method !== undefined ? { method: query.method } : {}),
      ...(query.dateFrom !== undefined ? { dateFrom: query.dateFrom } : {}),
      ...(query.dateTo !== undefined ? { dateTo: query.dateTo } : {}),
      limit: paging.limit,
      offset: paging.offset,
    });
    return buildPage(
      rows.map((row) => mapPayment(row)),
      total,
      paging.page,
      paging.pageSize,
    );
  }

  /**
   * Pay a supplier and allocate it against their open bills.
   *
   * Payment, allocation and the ledger debit commit as one unit. Anything left over after the
   * allocations is recorded as unallocated rather than discarded — money paid on account is
   * still money paid.
   */
  async createPayment(
    input: CreateVendorPaymentRequest,
    actor: AuditActor,
  ): Promise<VendorPaymentDto> {
    return withTransaction(async (cx) => {
      const supplier = await this.requireSupplier(cx, input.supplierId);
      const businessDate = input.businessDate ?? todayIsoDate();
      const paymentDate = input.paymentDate ?? businessDate;
      const amount = money(input.amount);
      if (amount <= 0) throw new ValidationError('A payment must be for a positive amount');

      const { documentNumber, dailySequence } = await documentNumberService.next(
        cx,
        'VENDOR_PAYMENT',
        businessDate,
      );
      const id = input.id ?? newId();
      const now = toDbDateTime();

      await purchaseDocumentRepository.insertVendorPayment(cx, {
        id,
        paymentNumber: documentNumber,
        dailySequence,
        businessDate,
        supplierId: supplier.id,
        paymentDate,
        method: input.method,
        status: VendorPaymentStatus.POSTED,
        amount,
        unallocatedAmount: amount,
        reference: input.reference ?? null,
        instrumentNumber: input.instrumentNumber ?? null,
        instrumentDate: input.instrumentDate ?? null,
        bankName: input.bankName ?? null,
        notes: input.notes ?? null,
        purchaseEntryId: null,
        createdBy: actor.userId,
        postedBy: actor.userId,
        postedAt: now,
      });

      const { unallocated } = await vendorLedgerService.allocatePayment(cx, {
        paymentId: id,
        supplierId: supplier.id,
        paymentAmount: amount,
        allocations: (input.allocations ?? []).map((allocation) => ({
          accountsPayableId: allocation.accountsPayableId,
          allocatedAmount: allocation.allocatedAmount,
        })),
      });
      await purchaseDocumentRepository.setPaymentUnallocated(cx, id, unallocated);

      await vendorLedgerService.post(cx, {
        supplierId: supplier.id,
        transactionType:
          (input.allocations ?? []).length === 0
            ? VendorLedgerTxnType.ADVANCE
            : VendorLedgerTxnType.PAYMENT,
        documentNumber,
        sourceType: 'vendor_payment',
        sourceId: id,
        reference: input.reference ?? null,
        narration: `Payment ${documentNumber} to ${supplier.name}`,
        debitAmount: amount,
        businessDate,
        actorId: actor.userId,
      });

      await auditService.record(cx, actor, {
        action: AuditAction.VENDOR_PAYMENT_POSTED,
        entityType: 'vendor_payment',
        entityId: id,
        after: {
          paymentNumber: documentNumber,
          supplierId: supplier.id,
          method: input.method,
          amount,
          allocations: (input.allocations ?? []).length,
          unallocated,
        },
      });

      return this.readPayment(cx, id);
    });
  }

  async readPayment(db: Db, id: string): Promise<VendorPaymentDto> {
    const row = await purchaseDocumentRepository.findPayment(db, id);
    if (row === null) throw new NotFoundError('Vendor payment', id);
    const allocations = await purchaseDocumentRepository.listAllocations(db, id);
    return mapPayment(row, allocations);
  }

  /* --------------------------------------------------------------- document flow */

  /**
   * The real chain a purchase produced, read from the database.
   *
   * Nodes that do not exist are not fabricated: a credit purchase has no payment node, and an
   * unposted entry has exactly one node. A flow diagram that shows a document which was never
   * created is worse than no diagram.
   */
  async documentFlow(entryId: string): Promise<DocumentFlowDto> {
    const pool = getPool();
    const entry = await purchaseEntryRepository.findEntry(pool, entryId);
    if (entry === null) throw new NotFoundError('Purchase entry', entryId);

    const nodes: DocumentFlowNodeDto[] = [
      {
        documentType: 'PURCHASE_ENTRY',
        documentId: entry.id,
        documentNumber: entry.entry_number,
        label: 'Purchase Entry',
        status: entry.status,
        occurredAt: fromDbDateTimeRequired(entry.created_at),
        amount: Number(entry.total_amount),
        href: `/purchase/entry?entryId=${entry.id}`,
      },
    ];

    const receipt =
      entry.goods_receipt_id === null
        ? await purchaseDocumentRepository.findGoodsReceiptByEntry(pool, entry.id)
        : await purchaseDocumentRepository.findGoodsReceipt(pool, entry.goods_receipt_id);
    if (receipt !== null) {
      nodes.push({
        documentType: 'GOODS_RECEIPT',
        documentId: receipt.id,
        documentNumber: receipt.grn_number,
        label: 'Goods Receipt',
        status: receipt.status,
        occurredAt: fromDbDateTime(receipt.posted_at) ?? fromDbDateTimeRequired(receipt.created_at),
        amount: null,
        href: `/stock?tab=ledger&sourceId=${receipt.id}`,
      });
    }

    const invoice =
      entry.purchase_invoice_id === null
        ? null
        : await purchaseDocumentRepository.findInvoice(pool, entry.purchase_invoice_id);
    if (invoice !== null) {
      nodes.push({
        documentType: 'PURCHASE_INVOICE',
        documentId: invoice.id,
        documentNumber: invoice.invoice_number,
        label: 'Purchase Invoice',
        status: invoice.status,
        occurredAt: fromDbDateTime(invoice.posted_at) ?? fromDbDateTimeRequired(invoice.created_at),
        amount: Number(invoice.total_amount),
        href: `/purchase/invoices?invoiceId=${invoice.id}`,
      });

      for (const ledger of await purchaseDocumentRepository.listVendorLedgerBySource(
        pool,
        'purchase_invoice',
        invoice.id,
      )) {
        nodes.push({
          documentType: 'VENDOR_LEDGER',
          documentId: ledger.id,
          documentNumber: ledger.document_number ?? String(ledger.entry_seq),
          label: 'Vendor Ledger',
          status: ledger.transaction_type,
          occurredAt: fromDbDateTimeRequired(ledger.occurred_at),
          amount: Number(ledger.credit_amount) - Number(ledger.debit_amount),
          href: `/purchase/vendor-ledger?supplierId=${ledger.supplier_id}`,
        });
      }

      const payable = await purchaseDocumentRepository.findPayableByInvoice(pool, invoice.id);
      if (payable !== null) {
        nodes.push({
          documentType: 'ACCOUNTS_PAYABLE',
          documentId: payable.id,
          documentNumber: payable.document_number,
          label: 'Accounts Payable',
          status: payable.status,
          occurredAt: fromDbDateTimeRequired(payable.created_at),
          amount: Number(payable.outstanding_amount),
          href: `/purchase/payables?payableId=${payable.id}`,
        });
      }
    }

    const payment = await purchaseDocumentRepository.findPaymentByEntry(pool, entry.id);
    if (payment !== null) {
      nodes.push({
        documentType: 'VENDOR_PAYMENT',
        documentId: payment.id,
        documentNumber: payment.payment_number,
        label: 'Vendor Payment',
        status: payment.status,
        occurredAt: fromDbDateTime(payment.posted_at) ?? fromDbDateTimeRequired(payment.created_at),
        amount: Number(payment.amount),
        href: `/purchase/payments?paymentId=${payment.id}`,
      });
    }

    return { rootType: 'PURCHASE_ENTRY', rootId: entry.id, nodes };
  }
}

/**
 * Build the tax treatment for a line from its resolved profile.
 *
 * EXEMPT / NIL_RATED / ZERO_RATED / NON_GST all produce no tax; the profile already carries
 * zero rates for those, but reading the taxability makes the intent explicit rather than
 * dependent on the master being maintained correctly.
 */
function treatmentOf(profile: TaxProfileRow | null, interState: boolean): TaxTreatment {
  if (profile === null) {
    return {
      taxProfileId: null,
      rate: 0,
      cessRate: 0,
      cgstRate: 0,
      sgstRate: 0,
      igstRate: 0,
      // A line with no tax profile is a net figure: adding nothing to it is the same as
      // extracting nothing from it, but exclusive keeps `taxableAmount` equal to the net.
      priceIsInclusive: false,
      interState,
    };
  }
  const taxable = profile.gst_taxability === GstTaxability.TAXABLE;
  return {
    taxProfileId: profile.id,
    rate: taxable ? Number(profile.gst_rate) : 0,
    cessRate: taxable ? Number(profile.cess_rate) : 0,
    cgstRate: Number(profile.cgst_rate),
    sgstRate: Number(profile.sgst_rate),
    igstRate: Number(profile.igst_rate),
    priceIsInclusive: profile.price_is_inclusive !== 0,
    interState,
  };
}

export { ExceptionSeverity, mapEntry, mapGoodsReceipt, mapInvoice, mapPayable, mapPayment, mapVendorLedgerEntry };
export type { PurchaseEntryLineInput };

export const purchaseEntryService = new PurchaseEntryService();
