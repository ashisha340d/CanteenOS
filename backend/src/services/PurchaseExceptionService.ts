import {
  ExceptionSeverity,
  PURCHASE_TOLERANCE,
  PurchaseExceptionCode,
  PurchaseType,
  type PurchaseExceptionDto,
} from '@menuboard/shared';
import type { Db, PoolConnection } from '../db/types';
import {
  purchaseDocumentRepository,
} from '../repositories/PurchaseDocumentRepository';
import {
  purchaseEntryRepository,
  type PurchaseExceptionRow,
} from '../repositories/PurchaseEntryRepository';
import { settingsRepository } from '../repositories/SettingsRepository';
import { newId } from '../utils/ids';
import { fromDbDateTimeRequired } from '../utils/time';

/**
 * What is wrong with a purchase, computed from the document rather than remembered from the
 * last time somebody looked.
 *
 * The whole set is recomputed on every save and on every preview, and the previous set is
 * deleted before the new one is written. An exception that outlives the condition that
 * produced it is worse than no exception at all: the operator learns to click past them, and
 * then clicks past the one that mattered.
 *
 * Severity is what decides whether a post happens:
 *
 *   INFO / WARNING  post silently — they are there to be read afterwards
 *   OVERRIDABLE     posts only when the caller names the code in `acceptedExceptionCodes`
 *   BLOCKING        never posts
 */

export const PURCHASE_ENTRY_DOCUMENT_TYPE = 'PURCHASE_ENTRY';

/** A detected exception before it has an id or a row. */
export interface PurchaseExceptionDraft {
  documentLineId: string | null;
  code: PurchaseExceptionCode;
  severity: ExceptionSeverity;
  message: string;
  expectedValue: string | null;
  actualValue: string | null;
}

/** One line, reduced to exactly what exception detection needs to see. */
export interface ExceptionLineContext {
  lineId: string;
  productId: string | null;
  label: string;
  isBatchTracked: boolean;
  isExpiryTracked: boolean;
  isStocked: boolean;
  hasSupplierMapping: boolean;
  lastPurchaseRate: number | null;
  quantity: number;
  receivedQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  rate: number;
  conversionFactor: number;
  batchNumber: string | null;
  expiryDate: string | null;
  destinationLocationId: string | null;
  taxAmount: number;
}

export interface ExceptionContext {
  documentId: string;
  businessDate: string;
  purchaseType: PurchaseType;
  supplierId: string;
  supplierIsApproved: boolean;
  supplierGstin: string | null;
  supplierInvoiceNumber: string | null;
  supplierInvoiceDate: string | null;
  supplierTotalAmount: number | null;
  computedTotal: number;
  lines: readonly ExceptionLineContext[];
}

export interface PurchaseTolerances {
  rateVariancePercent: number;
  invoiceTotalTolerance: number;
  nearExpiryDays: number;
  quantityOverReceiptPercent: number;
  taxTolerance: number;
}

/** Days between two calendar dates, positive when `later` is after `earlier`. */
function daysBetween(earlier: string, later: string): number {
  const a = Date.parse(`${earlier}T00:00:00.000Z`);
  const b = Date.parse(`${later}T00:00:00.000Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

function numeric(raw: unknown, fallback: number): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function mapPurchaseException(row: PurchaseExceptionRow): PurchaseExceptionDto {
  return {
    id: row.id,
    documentType: row.document_type,
    documentId: row.document_id,
    documentLineId: row.document_line_id,
    code: row.code,
    severity: row.severity,
    message: row.message,
    expectedValue: row.expected_value,
    actualValue: row.actual_value,
    isResolved: row.is_resolved === 1,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at === null ? null : fromDbDateTimeRequired(row.resolved_at),
    resolutionNote: row.resolution_note,
    createdAt: fromDbDateTimeRequired(row.created_at),
  };
}

export class PurchaseExceptionService {
  /** The live tolerances. Defaults come from shared constants; a site may tune each one. */
  async tolerances(db: Db): Promise<PurchaseTolerances> {
    const [rate, total, expiry, over, tax] = await Promise.all([
      settingsRepository.getValue<unknown>(
        db,
        'purchase.rate_variance_percent',
        PURCHASE_TOLERANCE.RATE_VARIANCE_PERCENT,
      ),
      settingsRepository.getValue<unknown>(
        db,
        'purchase.invoice_total_tolerance',
        PURCHASE_TOLERANCE.INVOICE_TOTAL_TOLERANCE,
      ),
      settingsRepository.getValue<unknown>(
        db,
        'purchase.near_expiry_days',
        PURCHASE_TOLERANCE.NEAR_EXPIRY_DAYS,
      ),
      settingsRepository.getValue<unknown>(
        db,
        'purchase.quantity_over_receipt_percent',
        PURCHASE_TOLERANCE.QUANTITY_OVER_RECEIPT_PERCENT,
      ),
      settingsRepository.getValue<unknown>(
        db,
        'purchase.tax_tolerance',
        PURCHASE_TOLERANCE.TAX_TOLERANCE,
      ),
    ]);
    return {
      rateVariancePercent: numeric(rate, PURCHASE_TOLERANCE.RATE_VARIANCE_PERCENT),
      invoiceTotalTolerance: numeric(total, PURCHASE_TOLERANCE.INVOICE_TOTAL_TOLERANCE),
      nearExpiryDays: Math.trunc(numeric(expiry, PURCHASE_TOLERANCE.NEAR_EXPIRY_DAYS)),
      quantityOverReceiptPercent: numeric(
        over,
        PURCHASE_TOLERANCE.QUANTITY_OVER_RECEIPT_PERCENT,
      ),
      taxTolerance: numeric(tax, PURCHASE_TOLERANCE.TAX_TOLERANCE),
    };
  }

  /**
   * Everything wrong with this document, in one pass.
   *
   * Read-only: it queries for duplicate bills but writes nothing, so `/preview` can call it
   * against an entry it has no intention of posting.
   */
  async detect(db: Db, context: ExceptionContext): Promise<PurchaseExceptionDraft[]> {
    const tolerances = await this.tolerances(db);
    const drafts: PurchaseExceptionDraft[] = [];

    await this.detectDuplicates(db, context, drafts);
    this.detectHeader(context, tolerances, drafts);
    for (const line of context.lines) this.detectLine(context, line, tolerances, drafts);

    return drafts;
  }

  /** Replace this document's exceptions with a freshly detected set. */
  async replace(
    cx: PoolConnection,
    documentId: string,
    drafts: readonly PurchaseExceptionDraft[],
    documentType: string = PURCHASE_ENTRY_DOCUMENT_TYPE,
  ): Promise<void> {
    await purchaseEntryRepository.deleteExceptions(cx, documentType, documentId);
    for (const draft of drafts) {
      await purchaseEntryRepository.insertException(cx, {
        id: newId(),
        documentType,
        documentId,
        documentLineId: draft.documentLineId,
        code: draft.code,
        severity: draft.severity,
        message: draft.message,
        expectedValue: draft.expectedValue,
        actualValue: draft.actualValue,
      });
    }
  }

  /* ------------------------------------------------------------------ detectors */

  private async detectDuplicates(
    db: Db,
    context: ExceptionContext,
    drafts: PurchaseExceptionDraft[],
  ): Promise<void> {
    const bill = context.supplierInvoiceNumber;
    if (bill !== null && bill !== '') {
      const duplicate = await purchaseDocumentRepository.findPostedInvoiceByBill(
        db,
        context.supplierId,
        bill,
        context.documentId,
      );
      if (duplicate !== null) {
        drafts.push({
          documentLineId: null,
          code: PurchaseExceptionCode.DUPLICATE_INVOICE,
          severity: ExceptionSeverity.BLOCKING,
          message:
            `Bill ${bill} from this supplier has already been posted as ${duplicate.invoice_number}. ` +
            'Raise a debit or credit memo rather than entering it twice.',
          expectedValue: 'a bill number not already posted',
          actualValue: duplicate.invoice_number,
        });
      }
    }

    const invoiceDate = context.supplierInvoiceDate;
    if (invoiceDate !== null && context.computedTotal > 0) {
      const lookalike = await purchaseDocumentRepository.findSameDayInvoiceByTotal(db, {
        supplierId: context.supplierId,
        invoiceDate,
        totalAmount: context.computedTotal,
        excludeBillNumber: bill,
        excludeEntryId: context.documentId,
      });
      if (lookalike !== null) {
        drafts.push({
          documentLineId: null,
          code: PurchaseExceptionCode.POSSIBLE_DUPLICATE_INVOICE,
          severity: ExceptionSeverity.OVERRIDABLE,
          message:
            `${lookalike.invoice_number} is the same supplier, the same date and the same ` +
            'amount under a different bill number. Confirm this is genuinely a second bill.',
          expectedValue: null,
          actualValue: `${lookalike.supplier_invoice_number} @ ${lookalike.total_amount}`,
        });
      }
    }
  }

  private detectHeader(
    context: ExceptionContext,
    tolerances: PurchaseTolerances,
    drafts: PurchaseExceptionDraft[],
  ): void {
    if (!context.supplierIsApproved) {
      drafts.push({
        documentLineId: null,
        code: PurchaseExceptionCode.UNAPPROVED_SUPPLIER,
        severity: ExceptionSeverity.OVERRIDABLE,
        message: 'This supplier is not approved for purchasing.',
        expectedValue: 'an approved supplier',
        actualValue: 'not approved',
      });
    }

    const claimed = context.supplierTotalAmount;
    if (claimed !== null) {
      const gap = Math.abs(claimed - context.computedTotal);
      if (gap > tolerances.invoiceTotalTolerance) {
        drafts.push({
          documentLineId: null,
          code: PurchaseExceptionCode.TOTAL_MISMATCH,
          severity: ExceptionSeverity.OVERRIDABLE,
          message:
            `The supplier's bill says ${claimed.toFixed(2)} but the lines come to ` +
            `${context.computedTotal.toFixed(2)} — a difference of ${gap.toFixed(2)}.`,
          expectedValue: context.computedTotal.toFixed(2),
          actualValue: claimed.toFixed(2),
        });
      }
    }

    const taxCharged = context.lines.reduce((sum, line) => sum + line.taxAmount, 0);
    if (taxCharged > 0 && (context.supplierGstin === null || context.supplierGstin === '')) {
      drafts.push({
        documentLineId: null,
        code: PurchaseExceptionCode.GSTIN_MISSING,
        severity: ExceptionSeverity.WARNING,
        message:
          'Tax has been charged on this bill but the supplier has no GSTIN on file, so the ' +
          'input credit cannot be claimed against them.',
        expectedValue: 'a GSTIN on the supplier master',
        actualValue: null,
      });
    }
  }

  private detectLine(
    context: ExceptionContext,
    line: ExceptionLineContext,
    tolerances: PurchaseTolerances,
    drafts: PurchaseExceptionDraft[],
  ): void {
    const stockLine = context.purchaseType === PurchaseType.STOCK && line.productId !== null;

    if (line.conversionFactor <= 0) {
      drafts.push({
        documentLineId: line.lineId,
        code: PurchaseExceptionCode.INVALID_UNIT_CONVERSION,
        severity: ExceptionSeverity.BLOCKING,
        message: `${line.label} has a unit conversion factor of ${line.conversionFactor}.`,
        expectedValue: '> 0',
        actualValue: String(line.conversionFactor),
      });
    }

    if (line.rate > 0 && line.lastPurchaseRate !== null && line.lastPurchaseRate > 0) {
      const variance = ((line.rate - line.lastPurchaseRate) / line.lastPurchaseRate) * 100;
      if (variance > tolerances.rateVariancePercent) {
        drafts.push({
          documentLineId: line.lineId,
          code: PurchaseExceptionCode.RATE_VARIANCE,
          severity: ExceptionSeverity.OVERRIDABLE,
          message:
            `${line.label} is ${variance.toFixed(1)}% above the last purchase rate of ` +
            `${line.lastPurchaseRate.toFixed(4)}.`,
          expectedValue: `<= ${(line.lastPurchaseRate * (1 + tolerances.rateVariancePercent / 100)).toFixed(4)}`,
          actualValue: line.rate.toFixed(4),
        });
      }
    }

    if (line.expiryDate !== null) {
      const daysLeft = daysBetween(context.businessDate, line.expiryDate);
      if (daysLeft <= 0) {
        drafts.push({
          documentLineId: line.lineId,
          code: PurchaseExceptionCode.EXPIRED_GOODS,
          severity: ExceptionSeverity.BLOCKING,
          message: `${line.label} expires on ${line.expiryDate}, on or before the business date.`,
          expectedValue: `after ${context.businessDate}`,
          actualValue: line.expiryDate,
        });
      } else if (daysLeft <= tolerances.nearExpiryDays) {
        drafts.push({
          documentLineId: line.lineId,
          code: PurchaseExceptionCode.NEAR_EXPIRY_GOODS,
          severity: ExceptionSeverity.WARNING,
          message: `${line.label} expires in ${daysLeft} day(s), on ${line.expiryDate}.`,
          expectedValue: `more than ${tolerances.nearExpiryDays} days`,
          actualValue: `${daysLeft} days`,
        });
      }
    }

    if (stockLine && line.isBatchTracked && (line.batchNumber === null || line.batchNumber === '')) {
      drafts.push({
        documentLineId: line.lineId,
        code: PurchaseExceptionCode.MISSING_BATCH,
        severity: ExceptionSeverity.BLOCKING,
        message: `${line.label} is batch tracked but no batch number was entered.`,
        expectedValue: 'a batch number',
        actualValue: null,
      });
    }
    if (stockLine && line.isExpiryTracked && line.expiryDate === null) {
      drafts.push({
        documentLineId: line.lineId,
        code: PurchaseExceptionCode.MISSING_EXPIRY,
        severity: ExceptionSeverity.BLOCKING,
        message: `${line.label} is expiry tracked but no expiry date was entered.`,
        expectedValue: 'an expiry date',
        actualValue: null,
      });
    }

    if (line.rejectedQuantity > 0) {
      drafts.push({
        documentLineId: line.lineId,
        code: PurchaseExceptionCode.REJECTED_QUANTITY,
        severity: ExceptionSeverity.WARNING,
        message:
          `${line.rejectedQuantity} of ${line.label} was rejected and will not reach stock.`,
        expectedValue: '0 rejected',
        actualValue: String(line.rejectedQuantity),
      });
    }

    if (line.receivedQuantity + 0.0005 < line.quantity) {
      drafts.push({
        documentLineId: line.lineId,
        code: PurchaseExceptionCode.SHORT_RECEIPT,
        severity: ExceptionSeverity.WARNING,
        message:
          `${line.label} was billed for ${line.quantity} but only ${line.receivedQuantity} arrived.`,
        expectedValue: String(line.quantity),
        actualValue: String(line.receivedQuantity),
      });
    }

    if (line.receivedQuantity > line.quantity * (1 + tolerances.quantityOverReceiptPercent / 100)) {
      drafts.push({
        documentLineId: line.lineId,
        code: PurchaseExceptionCode.EXCESS_RECEIPT,
        severity: ExceptionSeverity.WARNING,
        message:
          `${line.label} was billed for ${line.quantity} but ${line.receivedQuantity} arrived.`,
        expectedValue: String(line.quantity),
        actualValue: String(line.receivedQuantity),
      });
    }

    if (
      stockLine &&
      line.isStocked &&
      line.acceptedQuantity > 0 &&
      line.destinationLocationId === null
    ) {
      drafts.push({
        documentLineId: line.lineId,
        code: PurchaseExceptionCode.MISSING_DESTINATION,
        severity: ExceptionSeverity.BLOCKING,
        message: `${line.label} has no location to be received into.`,
        expectedValue: 'a destination location',
        actualValue: null,
      });
    }

    if (line.productId !== null && !line.hasSupplierMapping) {
      drafts.push({
        documentLineId: line.lineId,
        code: PurchaseExceptionCode.MISSING_SUPPLIER_MAPPING,
        severity: ExceptionSeverity.INFO,
        message:
          `${line.label} has no supplier mapping, so their SKU and pack size cannot be ` +
          'checked against this bill.',
        expectedValue: null,
        actualValue: null,
      });
    }
  }
}

export const purchaseExceptionService = new PurchaseExceptionService();
