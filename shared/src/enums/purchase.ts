/**
 * Purchase, inventory and vendor-accounting enums.
 *
 * Kept in their own module rather than piled into enums/index.ts, matching the split already
 * used for equipment and cleaning. Every value here is stored verbatim in a MySQL ENUM column,
 * so a value may be added but never renamed or removed without a migration.
 */

/* ------------------------------------------------------------------ locations & units --- */

/**
 * What kind of place stock physically sits in.
 *
 * The distinction matters operationally, not just cosmetically: a WAREHOUSE is a staging
 * store that goods are later dispatched out of, whereas a DAY_STORE or KITCHEN is a working
 * store consumed in place. DIRECT_CONSUMPTION is the escape hatch for goods that are used the
 * moment they arrive and never form a balance — it accepts stock in and immediately issues it
 * out, so the ledger still records the movement but no stock is left sitting anywhere.
 */
export const InventoryLocationKind = {
  WAREHOUSE: 'WAREHOUSE',
  DAY_STORE: 'DAY_STORE',
  KITCHEN: 'KITCHEN',
  PRODUCTION_STORE: 'PRODUCTION_STORE',
  BAKERY_STORE: 'BAKERY_STORE',
  BAR_COUNTER: 'BAR_COUNTER',
  DEPARTMENT_STORE: 'DEPARTMENT_STORE',
  DIRECT_CONSUMPTION: 'DIRECT_CONSUMPTION',
  OTHER: 'OTHER',
} as const;
export type InventoryLocationKind =
  (typeof InventoryLocationKind)[keyof typeof InventoryLocationKind];

/**
 * Locations that hold a durable balance. DIRECT_CONSUMPTION deliberately does not: goods
 * booked there are expensed on arrival, so a positive balance would be a bug.
 */
export const STOCK_HOLDING_LOCATION_KINDS: readonly InventoryLocationKind[] = [
  InventoryLocationKind.WAREHOUSE,
  InventoryLocationKind.DAY_STORE,
  InventoryLocationKind.KITCHEN,
  InventoryLocationKind.PRODUCTION_STORE,
  InventoryLocationKind.BAKERY_STORE,
  InventoryLocationKind.BAR_COUNTER,
  InventoryLocationKind.DEPARTMENT_STORE,
  InventoryLocationKind.OTHER,
];

/** The physical dimension a unit measures. Conversions only exist within one dimension. */
export const UomDimension = {
  WEIGHT: 'WEIGHT',
  VOLUME: 'VOLUME',
  COUNT: 'COUNT',
  LENGTH: 'LENGTH',
  /** Packaging units (CASE, CARTON, BAG) whose factor is product-specific, not universal. */
  PACK: 'PACK',
} as const;
export type UomDimension = (typeof UomDimension)[keyof typeof UomDimension];

/* -------------------------------------------------------------------- product master --- */

/**
 * What a product is for. Only STOCK products form an inventory balance; SERVICE and EXPENSE
 * exist so a supplier bill for freight or a repair can be captured on the same document as
 * the goods without inventing a fake stock item.
 */
export const ProductKind = {
  STOCK: 'STOCK',
  SERVICE: 'SERVICE',
  EXPENSE: 'EXPENSE',
  ASSET: 'ASSET',
} as const;
export type ProductKind = (typeof ProductKind)[keyof typeof ProductKind];

/**
 * How a product's stock is valued.
 *
 * Set per product rather than globally because a canteen genuinely needs both: perishables
 * are consumed strictly oldest-first (FIFO), while a bulk staple bought weekly at a drifting
 * price is far better represented by a moving average.
 */
export const ValuationMethod = {
  /** Weighted moving average, recomputed on every receipt. The default. */
  MOVING_AVERAGE: 'MOVING_AVERAGE',
  FIFO: 'FIFO',
  /** Fixed cost held on the product; variance is expensed on receipt. */
  STANDARD: 'STANDARD',
} as const;
export type ValuationMethod = (typeof ValuationMethod)[keyof typeof ValuationMethod];

/** Which batch a picking operation should reach for first. */
export const BatchIssuePolicy = {
  /** First-expiry-first-out. Correct for anything perishable. */
  FEFO: 'FEFO',
  /** First-in-first-out. Correct for non-perishables where receipt order is what matters. */
  FIFO: 'FIFO',
} as const;
export type BatchIssuePolicy = (typeof BatchIssuePolicy)[keyof typeof BatchIssuePolicy];

/* --------------------------------------------------------------------- stock movement --- */

/**
 * Why a stock movement happened. Every stock ledger row carries one, and every one of them
 * has a source document — there is no such thing as an unexplained movement.
 */
export const StockMovementType = {
  OPENING_STOCK: 'OPENING_STOCK',
  PURCHASE_RECEIPT: 'PURCHASE_RECEIPT',
  PURCHASE_RETURN: 'PURCHASE_RETURN',
  TRANSFER_IN: 'TRANSFER_IN',
  TRANSFER_OUT: 'TRANSFER_OUT',
  ADJUSTMENT_IN: 'ADJUSTMENT_IN',
  ADJUSTMENT_OUT: 'ADJUSTMENT_OUT',
  PRODUCTION_OUTPUT: 'PRODUCTION_OUTPUT',
  PRODUCTION_CONSUMPTION: 'PRODUCTION_CONSUMPTION',
  POS_SALE: 'POS_SALE',
  WASTAGE: 'WASTAGE',
  EXPIRY: 'EXPIRY',
  DIRECT_ISSUE: 'DIRECT_ISSUE',
} as const;
export type StockMovementType = (typeof StockMovementType)[keyof typeof StockMovementType];

/** Movement types that increase the balance at a location. */
export const STOCK_IN_MOVEMENT_TYPES: readonly StockMovementType[] = [
  StockMovementType.OPENING_STOCK,
  StockMovementType.PURCHASE_RECEIPT,
  StockMovementType.TRANSFER_IN,
  StockMovementType.ADJUSTMENT_IN,
  StockMovementType.PRODUCTION_OUTPUT,
];

/** Movement types that decrease the balance at a location. */
export const STOCK_OUT_MOVEMENT_TYPES: readonly StockMovementType[] = [
  StockMovementType.PURCHASE_RETURN,
  StockMovementType.TRANSFER_OUT,
  StockMovementType.ADJUSTMENT_OUT,
  StockMovementType.PRODUCTION_CONSUMPTION,
  StockMovementType.POS_SALE,
  StockMovementType.WASTAGE,
  StockMovementType.EXPIRY,
  StockMovementType.DIRECT_ISSUE,
];

/**
 * The document that caused a stock movement. Paired with a source id on every ledger row so
 * any movement can be traced back to the transaction that produced it.
 */
export const StockSourceType = {
  GOODS_RECEIPT: 'GOODS_RECEIPT',
  PURCHASE_RETURN: 'PURCHASE_RETURN',
  STOCK_TRANSFER: 'STOCK_TRANSFER',
  STOCK_ADJUSTMENT: 'STOCK_ADJUSTMENT',
  STOCK_COUNT: 'STOCK_COUNT',
  OPENING_BALANCE: 'OPENING_BALANCE',
  PRODUCTION_ORDER: 'PRODUCTION_ORDER',
  POS_ORDER: 'POS_ORDER',
} as const;
export type StockSourceType = (typeof StockSourceType)[keyof typeof StockSourceType];

/* ------------------------------------------------------------------- stock documents --- */

export const StockTransferStatus = {
  DRAFT: 'DRAFT',
  REQUESTED: 'REQUESTED',
  APPROVED: 'APPROVED',
  PICKED: 'PICKED',
  /** Stock has left the source location. The OUT movement is posted at this point. */
  DISPATCHED: 'DISPATCHED',
  /** Stock has arrived. The IN movement is posted at this point. */
  RECEIVED: 'RECEIVED',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;
export type StockTransferStatus = (typeof StockTransferStatus)[keyof typeof StockTransferStatus];

export const StockCountStatus = {
  DRAFT: 'DRAFT',
  COUNTING: 'COUNTING',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  /** Variance has been turned into an adjustment. Terminal. */
  POSTED: 'POSTED',
  CANCELLED: 'CANCELLED',
} as const;
export type StockCountStatus = (typeof StockCountStatus)[keyof typeof StockCountStatus];

export const StockAdjustmentReason = {
  COUNT_VARIANCE: 'COUNT_VARIANCE',
  WASTAGE: 'WASTAGE',
  EXPIRY: 'EXPIRY',
  DAMAGE: 'DAMAGE',
  THEFT: 'THEFT',
  OPENING: 'OPENING',
  CORRECTION: 'CORRECTION',
  OTHER: 'OTHER',
} as const;
export type StockAdjustmentReason =
  (typeof StockAdjustmentReason)[keyof typeof StockAdjustmentReason];

export const StockAdjustmentStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  POSTED: 'POSTED',
  CANCELLED: 'CANCELLED',
} as const;
export type StockAdjustmentStatus =
  (typeof StockAdjustmentStatus)[keyof typeof StockAdjustmentStatus];

/* ---------------------------------------------------------------- purchase documents --- */

/** Where a requirement line came from. Drives how the suggested quantity was derived. */
export const RequirementSource = {
  MANUAL: 'MANUAL',
  MINIMUM_STOCK: 'MINIMUM_STOCK',
  REORDER_LEVEL: 'REORDER_LEVEL',
  MAXIMUM_STOCK: 'MAXIMUM_STOCK',
  PRODUCTION: 'PRODUCTION',
  RECIPE: 'RECIPE',
  FORECAST: 'FORECAST',
  PENDING_ORDERS: 'PENDING_ORDERS',
  DEPARTMENT_REQUEST: 'DEPARTMENT_REQUEST',
  WAREHOUSE_REQUEST: 'WAREHOUSE_REQUEST',
  DAY_STORE_REQUEST: 'DAY_STORE_REQUEST',
  OTHER: 'OTHER',
} as const;
export type RequirementSource = (typeof RequirementSource)[keyof typeof RequirementSource];

export const PurchaseRequirementStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  PARTIALLY_ORDERED: 'PARTIALLY_ORDERED',
  FULLY_ORDERED: 'FULLY_ORDERED',
  CANCELLED: 'CANCELLED',
  CLOSED: 'CLOSED',
} as const;
export type PurchaseRequirementStatus =
  (typeof PurchaseRequirementStatus)[keyof typeof PurchaseRequirementStatus];

export const PurchasePriority = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;
export type PurchasePriority = (typeof PurchasePriority)[keyof typeof PurchasePriority];

export const PurchaseOrderStatus = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  SENT: 'SENT',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  FULLY_RECEIVED: 'FULLY_RECEIVED',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;
export type PurchaseOrderStatus = (typeof PurchaseOrderStatus)[keyof typeof PurchaseOrderStatus];

/** Purchase orders that may still be received against. */
export const OPEN_PURCHASE_ORDER_STATUSES: readonly PurchaseOrderStatus[] = [
  PurchaseOrderStatus.APPROVED,
  PurchaseOrderStatus.SENT,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
];

/** What is being bought. Only STOCK reaches the stock ledger. */
export const PurchaseType = {
  STOCK: 'STOCK',
  EXPENSE: 'EXPENSE',
  ASSET: 'ASSET',
  OTHER: 'OTHER',
} as const;
export type PurchaseType = (typeof PurchaseType)[keyof typeof PurchaseType];

/**
 * The purchase entry lifecycle. DRAFT and READY are editable; POSTED is immutable and is the
 * point at which stock, invoice, vendor ledger and settlement all came into existence.
 */
export const PurchaseEntryStatus = {
  DRAFT: 'DRAFT',
  /** Validated and awaiting a post. Exceptions, if any, have been reviewed. */
  READY: 'READY',
  POSTED: 'POSTED',
  CANCELLED: 'CANCELLED',
} as const;
export type PurchaseEntryStatus = (typeof PurchaseEntryStatus)[keyof typeof PurchaseEntryStatus];

/** How the operator is entering the bill. Purely a UI mode; the posted result is identical. */
export const PurchaseEntryMode = {
  QUICK: 'QUICK',
  DETAILED: 'DETAILED',
  BILL_SCAN: 'BILL_SCAN',
} as const;
export type PurchaseEntryMode = (typeof PurchaseEntryMode)[keyof typeof PurchaseEntryMode];

export const GoodsReceiptStatus = {
  DRAFT: 'DRAFT',
  /** Quantities entered, awaiting accept/reject. */
  PENDING_QC: 'PENDING_QC',
  QC_DONE: 'QC_DONE',
  /** Accepted quantity has hit the stock ledger. Immutable. */
  POSTED: 'POSTED',
  CANCELLED: 'CANCELLED',
} as const;
export type GoodsReceiptStatus = (typeof GoodsReceiptStatus)[keyof typeof GoodsReceiptStatus];

export const QcStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  /** Some accepted, some rejected. The line carries both quantities. */
  PARTIAL: 'PARTIAL',
  REJECTED: 'REJECTED',
} as const;
export type QcStatus = (typeof QcStatus)[keyof typeof QcStatus];

export const RejectionReason = {
  DAMAGED: 'DAMAGED',
  EXPIRED: 'EXPIRED',
  NEAR_EXPIRY: 'NEAR_EXPIRY',
  QUALITY: 'QUALITY',
  WRONG_PRODUCT: 'WRONG_PRODUCT',
  SHORT_SUPPLY: 'SHORT_SUPPLY',
  EXCESS_SUPPLY: 'EXCESS_SUPPLY',
  CONTAMINATED: 'CONTAMINATED',
  TEMPERATURE: 'TEMPERATURE',
  PACKAGING: 'PACKAGING',
  OTHER: 'OTHER',
} as const;
export type RejectionReason = (typeof RejectionReason)[keyof typeof RejectionReason];

export const PurchaseInvoiceStatus = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  POSTED: 'POSTED',
  CANCELLED: 'CANCELLED',
} as const;
export type PurchaseInvoiceStatus =
  (typeof PurchaseInvoiceStatus)[keyof typeof PurchaseInvoiceStatus];

export const PurchaseReturnStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  POSTED: 'POSTED',
  CANCELLED: 'CANCELLED',
} as const;
export type PurchaseReturnStatus =
  (typeof PurchaseReturnStatus)[keyof typeof PurchaseReturnStatus];

export const PurchaseReturnReason = {
  DAMAGED: 'DAMAGED',
  EXPIRED: 'EXPIRED',
  QUALITY: 'QUALITY',
  WRONG_PRODUCT: 'WRONG_PRODUCT',
  EXCESS_SUPPLY: 'EXCESS_SUPPLY',
  RATE_DISPUTE: 'RATE_DISPUTE',
  NOT_REQUIRED: 'NOT_REQUIRED',
  OTHER: 'OTHER',
} as const;
export type PurchaseReturnReason =
  (typeof PurchaseReturnReason)[keyof typeof PurchaseReturnReason];

/* ------------------------------------------------------------------- vendor accounting --- */

/** Debit and credit memos share a table and a lifecycle; this is the discriminator. */
export const VendorMemoKind = {
  /** We charge the supplier. Reduces what we owe. */
  DEBIT: 'DEBIT',
  /** The supplier credits us. Also reduces what we owe, but on their initiative. */
  CREDIT: 'CREDIT',
} as const;
export type VendorMemoKind = (typeof VendorMemoKind)[keyof typeof VendorMemoKind];

export const VendorMemoStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  POSTED: 'POSTED',
  CANCELLED: 'CANCELLED',
} as const;
export type VendorMemoStatus = (typeof VendorMemoStatus)[keyof typeof VendorMemoStatus];

export const VendorMemoReason = {
  SHORT_SUPPLY: 'SHORT_SUPPLY',
  DAMAGED_GOODS: 'DAMAGED_GOODS',
  QUALITY_REJECTION: 'QUALITY_REJECTION',
  RATE_ADJUSTMENT: 'RATE_ADJUSTMENT',
  COMMERCIAL_ADJUSTMENT: 'COMMERCIAL_ADJUSTMENT',
  PURCHASE_RETURN: 'PURCHASE_RETURN',
  OVERBILLING: 'OVERBILLING',
  REBATE: 'REBATE',
  OTHER: 'OTHER',
} as const;
export type VendorMemoReason = (typeof VendorMemoReason)[keyof typeof VendorMemoReason];

/**
 * The document types that appear on a vendor ledger.
 *
 * Sign convention, stated once so it is never guessed: the ledger is kept from the supplier's
 * point of view. A CREDIT increases what we owe them, a DEBIT reduces it. So a purchase
 * invoice is a credit, and paying it is a debit.
 */
export const VendorLedgerTxnType = {
  OPENING_BALANCE: 'OPENING_BALANCE',
  PURCHASE_INVOICE: 'PURCHASE_INVOICE',
  PAYMENT: 'PAYMENT',
  PURCHASE_RETURN: 'PURCHASE_RETURN',
  DEBIT_MEMO: 'DEBIT_MEMO',
  CREDIT_MEMO: 'CREDIT_MEMO',
  ADVANCE: 'ADVANCE',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;
export type VendorLedgerTxnType = (typeof VendorLedgerTxnType)[keyof typeof VendorLedgerTxnType];

export const PayableStatus = {
  UNPAID: 'UNPAID',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  /** Derived from the due date, not stored as a transition. */
  OVERDUE: 'OVERDUE',
  CANCELLED: 'CANCELLED',
} as const;
export type PayableStatus = (typeof PayableStatus)[keyof typeof PayableStatus];

/**
 * How a purchase is settled.
 *
 * CREDIT is the odd one out and is deliberately in the same enum: choosing it at the point of
 * entry is exactly the decision that determines whether a payable is created, so the operator
 * picks it from the same control as CASH or UPI.
 */
export const PurchasePaymentMethod = {
  CASH: 'CASH',
  UPI: 'UPI',
  BANK: 'BANK',
  CARD: 'CARD',
  CHEQUE: 'CHEQUE',
  CREDIT: 'CREDIT',
  OTHER: 'OTHER',
} as const;
export type PurchasePaymentMethod =
  (typeof PurchasePaymentMethod)[keyof typeof PurchasePaymentMethod];

/** Methods that settle the bill on the spot; everything else leaves a payable behind. */
export const IMMEDIATE_PURCHASE_PAYMENT_METHODS: readonly PurchasePaymentMethod[] = [
  PurchasePaymentMethod.CASH,
  PurchasePaymentMethod.UPI,
  PurchasePaymentMethod.BANK,
  PurchasePaymentMethod.CARD,
  PurchasePaymentMethod.CHEQUE,
];

export const VendorPaymentStatus = {
  DRAFT: 'DRAFT',
  /** Queued for payment but not yet paid. */
  SCHEDULED: 'SCHEDULED',
  POSTED: 'POSTED',
  CANCELLED: 'CANCELLED',
} as const;
export type VendorPaymentStatus = (typeof VendorPaymentStatus)[keyof typeof VendorPaymentStatus];

/* --------------------------------------------------------- matching, exceptions & OCR --- */

/** The verdict of comparing PO ↔ GRN ↔ Invoice (or GRN ↔ Invoice for a direct purchase). */
export const MatchStatus = {
  MATCHED: 'MATCHED',
  QUANTITY_DIFFERENCE: 'QUANTITY_DIFFERENCE',
  RATE_DIFFERENCE: 'RATE_DIFFERENCE',
  TAX_DIFFERENCE: 'TAX_DIFFERENCE',
  PRODUCT_DIFFERENCE: 'PRODUCT_DIFFERENCE',
  UNMATCHED: 'UNMATCHED',
  REQUIRES_APPROVAL: 'REQUIRES_APPROVAL',
} as const;
export type MatchStatus = (typeof MatchStatus)[keyof typeof MatchStatus];

/**
 * Everything that can be wrong with a purchase, surfaced on the transaction itself rather
 * than buried in a validation dialog. The UI is exception-driven: a clean purchase shows
 * none of these and posts in one keystroke.
 */
export const PurchaseExceptionCode = {
  DUPLICATE_INVOICE: 'DUPLICATE_INVOICE',
  POSSIBLE_DUPLICATE_INVOICE: 'POSSIBLE_DUPLICATE_INVOICE',
  RATE_VARIANCE: 'RATE_VARIANCE',
  QUANTITY_VARIANCE: 'QUANTITY_VARIANCE',
  TAX_MISMATCH: 'TAX_MISMATCH',
  TOTAL_MISMATCH: 'TOTAL_MISMATCH',
  SHORT_RECEIPT: 'SHORT_RECEIPT',
  EXCESS_RECEIPT: 'EXCESS_RECEIPT',
  REJECTED_QUANTITY: 'REJECTED_QUANTITY',
  EXPIRED_GOODS: 'EXPIRED_GOODS',
  NEAR_EXPIRY_GOODS: 'NEAR_EXPIRY_GOODS',
  MISSING_BATCH: 'MISSING_BATCH',
  MISSING_EXPIRY: 'MISSING_EXPIRY',
  UNKNOWN_PRODUCT: 'UNKNOWN_PRODUCT',
  UNEXPECTED_PRODUCT: 'UNEXPECTED_PRODUCT',
  MISSING_PRODUCT: 'MISSING_PRODUCT',
  MISSING_SUPPLIER_MAPPING: 'MISSING_SUPPLIER_MAPPING',
  INVALID_UNIT_CONVERSION: 'INVALID_UNIT_CONVERSION',
  MISSING_DESTINATION: 'MISSING_DESTINATION',
  DESTINATION_SPLIT_MISMATCH: 'DESTINATION_SPLIT_MISMATCH',
  UNAPPROVED_SUPPLIER: 'UNAPPROVED_SUPPLIER',
  GSTIN_MISSING: 'GSTIN_MISSING',
  PRICE_ANOMALY: 'PRICE_ANOMALY',
  NEGATIVE_STOCK: 'NEGATIVE_STOCK',
  OCR_LOW_CONFIDENCE: 'OCR_LOW_CONFIDENCE',
} as const;
export type PurchaseExceptionCode =
  (typeof PurchaseExceptionCode)[keyof typeof PurchaseExceptionCode];

/**
 * How hard an exception blocks.
 *
 * INFO and WARNING post without ceremony. BLOCKING cannot post at all. OVERRIDABLE is the
 * interesting one: it posts only when a user who holds the right capability explicitly
 * confirms it, and that confirmation is recorded on the document.
 */
export const ExceptionSeverity = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  OVERRIDABLE: 'OVERRIDABLE',
  BLOCKING: 'BLOCKING',
} as const;
export type ExceptionSeverity = (typeof ExceptionSeverity)[keyof typeof ExceptionSeverity];

export const BillScanStatus = {
  UPLOADED: 'UPLOADED',
  EXTRACTING: 'EXTRACTING',
  EXTRACTED: 'EXTRACTED',
  /** Turned into a draft purchase entry. Terminal for the scan. */
  DRAFTED: 'DRAFTED',
  FAILED: 'FAILED',
} as const;
export type BillScanStatus = (typeof BillScanStatus)[keyof typeof BillScanStatus];

/** How a supplier or product on a scanned bill was resolved to a master record. */
export const MatchConfidence = {
  /** Exact identifier hit — GSTIN, barcode, or a stored supplier SKU mapping. */
  EXACT: 'EXACT',
  HIGH: 'HIGH',
  LOW: 'LOW',
  /** Nothing plausible found. The operator must choose. */
  NONE: 'NONE',
} as const;
export type MatchConfidence = (typeof MatchConfidence)[keyof typeof MatchConfidence];

/** Confidences a human must confirm before the value is trusted on a posted document. */
export const CONFIRMATION_REQUIRED_CONFIDENCES: readonly MatchConfidence[] = [
  MatchConfidence.LOW,
  MatchConfidence.NONE,
];
