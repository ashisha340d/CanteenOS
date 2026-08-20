import type {
  ExceptionSeverity,
  GoodsReceiptStatus,
  MatchStatus,
  PayableStatus,
  PurchaseEntryMode,
  PurchaseEntryStatus,
  PurchaseExceptionCode,
  PurchaseInvoiceStatus,
  PurchasePaymentMethod,
  PurchaseType,
  QcStatus,
  RejectionReason,
  VendorLedgerTxnType,
  VendorPaymentStatus,
} from '../enums';
import type { IsoDate, IsoDateTime, PageQuery, Uuid } from './common';

/**
 * The purchase document chain: entry, goods receipt, invoice, vendor ledger, payable, payment.
 *
 * Money fields are all rupees at two decimals. Rates carry four, because a spice bought per
 * gram is genuinely ₹0.0125 and rounding it to paise compounds into a visible error.
 *
 * Every total on every one of these types is computed server-side. The client sends lines and
 * the server sends back what they actually came to; a client-supplied total is never trusted
 * and never stored.
 */

/* -------------------------------------------------------------------- exceptions --- */

/**
 * Something wrong with a document, carried on the document itself rather than raised as a
 * dialog and forgotten. A clean purchase has none of these and posts in one keystroke.
 */
export interface PurchaseExceptionDto {
  id: Uuid;
  documentType: string;
  documentId: Uuid;
  documentLineId: Uuid | null;
  code: PurchaseExceptionCode;
  severity: ExceptionSeverity;
  message: string;
  expectedValue: string | null;
  actualValue: string | null;
  isResolved: boolean;
  resolvedBy: Uuid | null;
  resolvedAt: IsoDateTime | null;
  resolutionNote: string | null;
  createdAt: IsoDateTime;
}

/* ---------------------------------------------------------------- purchase entry --- */

export interface PurchaseEntryLineDto {
  id: Uuid;
  entryId: Uuid;
  productId: Uuid | null;
  description: string | null;
  supplierSku: string | null;
  quantity: number;
  purchaseUomId: Uuid | null;
  stockUomId: Uuid | null;
  conversionFactor: number;
  /** quantity × conversionFactor — what actually reaches the stock ledger. */
  stockQuantity: number;
  rate: number;
  discountPercent: number;
  discountAmount: number;
  grossAmount: number;
  taxableAmount: number;
  taxProfileId: Uuid | null;
  taxRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  taxAmount: number;
  lineTotal: number;
  batchNumber: string | null;
  manufacturingDate: IsoDate | null;
  expiryDate: IsoDate | null;
  receivedQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  rejectionReason: RejectionReason | null;
  destinationLocationId: Uuid | null;
  notes: string | null;
  sortOrder: number;
  productName?: string;
  productCode?: string | null;
  productUnit?: string;
  purchaseUomCode?: string | null;
  stockUomCode?: string | null;
  destinationLocationName?: string | null;
  /** Last rate paid to this supplier for this product, for the operator to sanity-check. */
  lastPurchaseRate?: number | null;
  isBatchTracked?: boolean;
  isExpiryTracked?: boolean;
}

export interface PurchaseEntryDto {
  id: Uuid;
  entryNumber: string;
  businessDate: IsoDate;
  supplierId: Uuid;
  purchaseType: PurchaseType;
  entryMode: PurchaseEntryMode;
  status: PurchaseEntryStatus;
  supplierInvoiceNumber: string | null;
  supplierInvoiceDate: IsoDate | null;
  dueDate: IsoDate | null;
  creditDays: number;
  paymentMethod: PurchasePaymentMethod;
  paymentReference: string | null;
  receivingLocationId: Uuid | null;
  purchaseOrderId: Uuid | null;
  reference: string | null;
  notes: string | null;
  attachmentId: Uuid | null;
  billScanId: Uuid | null;
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
  /** What the supplier's bill claims, when known. Compared against our own total. */
  supplierTotalAmount: number | null;
  goodsReceiptId: Uuid | null;
  purchaseInvoiceId: Uuid | null;
  createdBy: Uuid;
  postedBy: Uuid | null;
  postedAt: IsoDateTime | null;
  cancelledBy: Uuid | null;
  cancelledAt: IsoDateTime | null;
  cancelReason: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  revision: number;
  supplierName?: string;
  supplierCode?: string;
  supplierGstin?: string | null;
  receivingLocationName?: string | null;
  createdByName?: string | null;
  lineCount?: number;
  lines?: PurchaseEntryLineDto[];
  exceptions?: PurchaseExceptionDto[];
}

export interface PurchaseEntryLineInput {
  id?: Uuid;
  productId?: Uuid | null;
  description?: string | null;
  supplierSku?: string | null;
  quantity: number;
  purchaseUomId?: Uuid | null;
  conversionFactor?: number;
  rate: number;
  discountPercent?: number;
  /** Omit to inherit the product's tax profile — the normal case. */
  taxProfileId?: Uuid | null;
  batchNumber?: string | null;
  manufacturingDate?: IsoDate | null;
  expiryDate?: IsoDate | null;
  /** Defaults to `quantity` when omitted: the common case is that everything arrived. */
  receivedQuantity?: number;
  /** Defaults to `receivedQuantity` when omitted: the common case is that nothing was rejected. */
  acceptedQuantity?: number;
  rejectedQuantity?: number;
  rejectionReason?: RejectionReason | null;
  /** Defaults to the product's default location, then the entry's receiving location. */
  destinationLocationId?: Uuid | null;
  notes?: string | null;
  sortOrder?: number;
}

export interface CreatePurchaseEntryRequest {
  id?: Uuid;
  supplierId: Uuid;
  purchaseType?: PurchaseType;
  entryMode?: PurchaseEntryMode;
  businessDate?: IsoDate;
  supplierInvoiceNumber?: string | null;
  supplierInvoiceDate?: IsoDate | null;
  dueDate?: IsoDate | null;
  creditDays?: number;
  paymentMethod?: PurchasePaymentMethod;
  paymentReference?: string | null;
  receivingLocationId?: Uuid | null;
  purchaseOrderId?: Uuid | null;
  reference?: string | null;
  notes?: string | null;
  attachmentId?: Uuid | null;
  billScanId?: Uuid | null;
  otherCharges?: number;
  supplierTotalAmount?: number | null;
  lines: PurchaseEntryLineInput[];
}

export interface UpdatePurchaseEntryRequest
  extends Partial<Omit<CreatePurchaseEntryRequest, 'id'>> {
  expectedRevision?: number;
}

export interface PurchaseEntryListQuery extends PageQuery {
  supplierId?: Uuid;
  status?: PurchaseEntryStatus;
  purchaseType?: PurchaseType;
  paymentMethod?: PurchasePaymentMethod;
  locationId?: Uuid;
  dateFrom?: IsoDate;
  dateTo?: IsoDate;
  /** Only entries carrying unresolved exceptions. */
  withExceptionsOnly?: boolean;
}

/* ------------------------------------------------------------------ goods receipt --- */

export interface GoodsReceiptLineDestinationDto {
  id: Uuid;
  goodsReceiptLineId: Uuid;
  locationId: Uuid;
  quantity: number;
  notes: string | null;
  sortOrder: number;
  locationName?: string;
  locationKind?: string;
}

export interface GoodsReceiptLineDto {
  id: Uuid;
  goodsReceiptId: Uuid;
  productId: Uuid;
  purchaseEntryLineId: Uuid | null;
  purchaseOrderLineId: Uuid | null;
  orderedQuantity: number;
  previouslyReceived: number;
  billedQuantity: number;
  receivedQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  purchaseUomId: Uuid | null;
  stockUomId: Uuid | null;
  conversionFactor: number;
  acceptedStockQuantity: number;
  purchaseRate: number;
  batchNumber: string | null;
  manufacturingDate: IsoDate | null;
  expiryDate: IsoDate | null;
  batchId: Uuid | null;
  qcStatus: QcStatus;
  rejectionReason: RejectionReason | null;
  rejectionNotes: string | null;
  notes: string | null;
  sortOrder: number;
  productName?: string;
  productUnit?: string;
  /** Ordered less previously received — what is still outstanding on the PO. */
  remainingQuantity?: number;
  destinations?: GoodsReceiptLineDestinationDto[];
}

export interface GoodsReceiptDto {
  id: Uuid;
  grnNumber: string;
  businessDate: IsoDate;
  receiptDate: IsoDate;
  supplierId: Uuid;
  purchaseEntryId: Uuid | null;
  purchaseOrderId: Uuid | null;
  deliveryNote: string | null;
  locationId: Uuid;
  status: GoodsReceiptStatus;
  notes: string | null;
  receivedBy: Uuid | null;
  qcBy: Uuid | null;
  qcAt: IsoDateTime | null;
  createdBy: Uuid;
  postedBy: Uuid | null;
  postedAt: IsoDateTime | null;
  cancelledBy: Uuid | null;
  cancelledAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  revision: number;
  supplierName?: string;
  locationName?: string;
  lineCount?: number;
  lines?: GoodsReceiptLineDto[];
  exceptions?: PurchaseExceptionDto[];
}

/** One received line's destination split. Quantities must sum to the accepted quantity. */
export interface ReceiptDestinationInput {
  locationId: Uuid;
  quantity: number;
  notes?: string | null;
}

export interface GoodsReceiptLineInput {
  id?: Uuid;
  productId: Uuid;
  purchaseEntryLineId?: Uuid | null;
  purchaseOrderLineId?: Uuid | null;
  orderedQuantity?: number;
  billedQuantity?: number;
  receivedQuantity: number;
  acceptedQuantity?: number;
  rejectedQuantity?: number;
  purchaseUomId?: Uuid | null;
  conversionFactor?: number;
  purchaseRate: number;
  batchNumber?: string | null;
  manufacturingDate?: IsoDate | null;
  expiryDate?: IsoDate | null;
  rejectionReason?: RejectionReason | null;
  rejectionNotes?: string | null;
  notes?: string | null;
  sortOrder?: number;
  /** Omit for a single destination; supply to split across locations. */
  destinations?: ReceiptDestinationInput[];
  /** Used when `destinations` is omitted. Falls back to the product/receipt default. */
  destinationLocationId?: Uuid | null;
}

export interface CreateGoodsReceiptRequest {
  id?: Uuid;
  supplierId: Uuid;
  locationId: Uuid;
  receiptDate?: IsoDate;
  businessDate?: IsoDate;
  purchaseEntryId?: Uuid | null;
  purchaseOrderId?: Uuid | null;
  deliveryNote?: string | null;
  notes?: string | null;
  lines: GoodsReceiptLineInput[];
}

export interface QcLineInput {
  lineId: Uuid;
  acceptedQuantity: number;
  rejectedQuantity: number;
  rejectionReason?: RejectionReason | null;
  rejectionNotes?: string | null;
  destinations?: ReceiptDestinationInput[];
}

export interface RecordQcRequest {
  lines: QcLineInput[];
  expectedRevision?: number;
}

export interface GoodsReceiptListQuery extends PageQuery {
  supplierId?: Uuid;
  status?: GoodsReceiptStatus;
  locationId?: Uuid;
  purchaseEntryId?: Uuid;
  dateFrom?: IsoDate;
  dateTo?: IsoDate;
}

/* --------------------------------------------------------------- purchase invoice --- */

export interface PurchaseInvoiceLineDto {
  id: Uuid;
  invoiceId: Uuid;
  productId: Uuid | null;
  description: string | null;
  goodsReceiptLineId: Uuid | null;
  purchaseEntryLineId: Uuid | null;
  quantity: number;
  uomId: Uuid | null;
  rate: number;
  discountPercent: number;
  discountAmount: number;
  grossAmount: number;
  taxableAmount: number;
  taxProfileId: Uuid | null;
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
  productName?: string;
  uomCode?: string | null;
}

export interface PurchaseInvoiceDto {
  id: Uuid;
  invoiceNumber: string;
  businessDate: IsoDate;
  supplierId: Uuid;
  supplierInvoiceNumber: string;
  supplierInvoiceDate: IsoDate;
  dueDate: IsoDate | null;
  creditDays: number;
  purchaseEntryId: Uuid | null;
  goodsReceiptId: Uuid | null;
  purchaseOrderId: Uuid | null;
  locationId: Uuid | null;
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
  attachmentId: Uuid | null;
  createdBy: Uuid;
  approvedBy: Uuid | null;
  approvedAt: IsoDateTime | null;
  postedBy: Uuid | null;
  postedAt: IsoDateTime | null;
  cancelledBy: Uuid | null;
  cancelledAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  revision: number;
  supplierName?: string;
  supplierGstin?: string | null;
  lineCount?: number;
  lines?: PurchaseInvoiceLineDto[];
  exceptions?: PurchaseExceptionDto[];
}

export interface PurchaseInvoiceListQuery extends PageQuery {
  supplierId?: Uuid;
  status?: PurchaseInvoiceStatus;
  paymentStatus?: PayableStatus;
  matchStatus?: MatchStatus;
  dateFrom?: IsoDate;
  dateTo?: IsoDate;
  overdueOnly?: boolean;
}

/* ----------------------------------------------------------------- vendor ledger --- */

/**
 * A vendor ledger line. Kept from the supplier's point of view: a credit increases what we
 * owe them, a debit reduces it. So an invoice is a credit and paying it is a debit.
 */
export interface VendorLedgerEntryDto {
  id: Uuid;
  entrySeq: number;
  supplierId: Uuid;
  businessDate: IsoDate;
  transactionType: VendorLedgerTxnType;
  documentNumber: string | null;
  sourceType: string;
  sourceId: Uuid;
  reference: string | null;
  narration: string | null;
  debitAmount: number;
  creditAmount: number;
  /** The supplier's balance after this entry. */
  runningBalance: number;
  occurredAt: IsoDateTime;
  actorId: Uuid | null;
  createdAt: IsoDateTime;
  actorName?: string | null;
}

export interface VendorLedgerListQuery extends PageQuery {
  supplierId?: Uuid;
  transactionType?: VendorLedgerTxnType;
  dateFrom?: IsoDate;
  dateTo?: IsoDate;
}

export interface VendorStatementDto {
  supplierId: Uuid;
  supplierName: string;
  supplierCode: string;
  fromDate: IsoDate | null;
  toDate: IsoDate | null;
  openingBalance: number;
  totalDebits: number;
  totalCredits: number;
  closingBalance: number;
  entries: VendorLedgerEntryDto[];
}

/** Outstanding split into ageing buckets, per supplier. */
export interface VendorAgeingRowDto {
  supplierId: Uuid;
  supplierName: string;
  supplierCode: string;
  notDue: number;
  days0to30: number;
  days31to60: number;
  days61to90: number;
  over90: number;
  total: number;
  oldestDueDate: IsoDate | null;
}

/* -------------------------------------------------------------- accounts payable --- */

export interface AccountsPayableDto {
  id: Uuid;
  supplierId: Uuid;
  purchaseInvoiceId: Uuid;
  documentNumber: string;
  supplierInvoiceNumber: string | null;
  invoiceDate: IsoDate;
  dueDate: IsoDate | null;
  creditDays: number;
  originalAmount: number;
  paidAmount: number;
  /** Reduced by a debit/credit memo or a return rather than by money changing hands. */
  adjustedAmount: number;
  outstandingAmount: number;
  status: PayableStatus;
  isQueued: boolean;
  queuedBy: Uuid | null;
  queuedAt: IsoDateTime | null;
  notes: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  supplierName?: string;
  /** Negative until the due date, positive once overdue. */
  daysOverdue?: number | null;
}

export interface AccountsPayableListQuery extends PageQuery {
  supplierId?: Uuid;
  status?: PayableStatus;
  queuedOnly?: boolean;
  overdueOnly?: boolean;
  dueBefore?: IsoDate;
}

/* -------------------------------------------------------------- vendor payments --- */

export interface VendorPaymentAllocationDto {
  id: Uuid;
  paymentId: Uuid;
  accountsPayableId: Uuid;
  purchaseInvoiceId: Uuid;
  allocatedAmount: number;
  createdAt: IsoDateTime;
  documentNumber?: string;
  supplierInvoiceNumber?: string | null;
  invoiceDate?: IsoDate;
  invoiceTotal?: number;
}

export interface VendorPaymentDto {
  id: Uuid;
  paymentNumber: string;
  businessDate: IsoDate;
  supplierId: Uuid;
  paymentDate: IsoDate;
  method: PurchasePaymentMethod;
  status: VendorPaymentStatus;
  amount: number;
  /** Paid without naming an invoice — an advance, or money on account. */
  unallocatedAmount: number;
  reference: string | null;
  instrumentNumber: string | null;
  instrumentDate: IsoDate | null;
  bankName: string | null;
  notes: string | null;
  purchaseEntryId: Uuid | null;
  createdBy: Uuid;
  postedBy: Uuid | null;
  postedAt: IsoDateTime | null;
  cancelledBy: Uuid | null;
  cancelledAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  revision: number;
  supplierName?: string;
  allocations?: VendorPaymentAllocationDto[];
}

export interface CreateVendorPaymentRequest {
  id?: Uuid;
  supplierId: Uuid;
  paymentDate?: IsoDate;
  businessDate?: IsoDate;
  method: PurchasePaymentMethod;
  amount: number;
  reference?: string | null;
  instrumentNumber?: string | null;
  instrumentDate?: IsoDate | null;
  bankName?: string | null;
  notes?: string | null;
  /** Omit entirely to record an advance. */
  allocations?: { accountsPayableId: Uuid; allocatedAmount: number }[];
}

export interface VendorPaymentListQuery extends PageQuery {
  supplierId?: Uuid;
  status?: VendorPaymentStatus;
  method?: PurchasePaymentMethod;
  dateFrom?: IsoDate;
  dateTo?: IsoDate;
}

/* ------------------------------------------------------------------- posting --- */

/**
 * What a post is going to do, before it does it.
 *
 * The entry screen calls this as the operator types so exceptions surface while the supplier's
 * driver is still standing there, rather than at the moment of posting.
 */
export interface PurchasePostPreviewDto {
  entryId: Uuid;
  canPost: boolean;
  /** Exceptions that stop the post outright. */
  blocking: PurchaseExceptionDto[];
  /** Exceptions a suitably privileged user may explicitly confirm past. */
  overridable: PurchaseExceptionDto[];
  advisory: PurchaseExceptionDto[];
  computedTotal: number;
  willCreateGoodsReceipt: boolean;
  willCreateInvoice: boolean;
  willCreatePayable: boolean;
  willCreatePayment: boolean;
  stockMovementCount: number;
}

export interface PostPurchaseEntryRequest {
  /**
   * Codes of overridable exceptions the user is explicitly accepting. Anything overridable and
   * not listed here refuses the post — silence is not consent.
   */
  acceptedExceptionCodes?: PurchaseExceptionCode[];
  overrideNote?: string | null;
  /** Amount settled now. Defaults to the full total for an immediate payment method. */
  paidAmount?: number;
  paymentReference?: string | null;
}

/** Everything a single atomic post produced. */
export interface PostPurchaseEntryResultDto {
  entry: PurchaseEntryDto;
  goodsReceipt: GoodsReceiptDto | null;
  invoice: PurchaseInvoiceDto | null;
  payable: AccountsPayableDto | null;
  payment: VendorPaymentDto | null;
  vendorLedgerEntries: VendorLedgerEntryDto[];
  stockMovements: {
    ledgerId: Uuid;
    ledgerSeq: number;
    productId: Uuid;
    productName: string;
    locationId: Uuid;
    locationName: string;
    quantity: number;
    unitCost: number;
    balanceAfter: number;
  }[];
}

/* -------------------------------------------------------- register & traceability --- */

/**
 * One row of the purchase register — the MARG-style day book. Deliberately flat: this is read
 * as a dense grid, and every column here is one the operator scans rather than drills into.
 */
export interface PurchaseRegisterRowDto {
  entryId: Uuid;
  entryNumber: string;
  businessDate: IsoDate;
  supplierId: Uuid;
  supplierName: string;
  supplierGstin: string | null;
  supplierInvoiceNumber: string | null;
  supplierInvoiceDate: IsoDate | null;
  purchaseType: PurchaseType;
  status: PurchaseEntryStatus;
  paymentMethod: PurchasePaymentMethod;
  paymentStatus: PayableStatus | null;
  lineCount: number;
  totalQuantity: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  taxAmount: number;
  roundOffAmount: number;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  grnNumber: string | null;
  invoiceNumber: string | null;
  openExceptionCount: number;
  postedAt: IsoDateTime | null;
  createdByName: string | null;
}

/** Column totals for the register, over the whole filtered set rather than the current page. */
export interface PurchaseRegisterTotalsDto {
  entryCount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
}

export interface PurchaseRegisterQuery extends PageQuery {
  supplierId?: Uuid;
  status?: PurchaseEntryStatus;
  purchaseType?: PurchaseType;
  paymentMethod?: PurchasePaymentMethod;
  paymentStatus?: PayableStatus;
  locationId?: Uuid;
  productId?: Uuid;
  dateFrom?: IsoDate;
  dateTo?: IsoDate;
  amountMin?: number;
  amountMax?: number;
  withExceptionsOnly?: boolean;
}

/** One node in a document-flow view. */
export interface DocumentFlowNodeDto {
  documentType: string;
  documentId: Uuid;
  documentNumber: string;
  label: string;
  status: string;
  occurredAt: IsoDateTime | null;
  amount: number | null;
  /** Route the UI should open for this node. */
  href: string | null;
}

/** The full chain a purchase produced, for the traceability panel. */
export interface DocumentFlowDto {
  rootType: string;
  rootId: Uuid;
  nodes: DocumentFlowNodeDto[];
}
