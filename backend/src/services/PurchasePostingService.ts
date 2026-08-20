import { createHash } from 'node:crypto';
import {
  ERROR_CODES,
  ExceptionSeverity,
  GoodsReceiptStatus,
  MatchStatus,
  PayableStatus,
  PurchaseEntryStatus,
  PurchaseExceptionCode,
  PurchaseInvoiceStatus,
  PurchaseType,
  QcStatus,
  StockMovementType,
  StockSourceType,
  VendorLedgerTxnType,
  VendorPaymentStatus,
  type ApiFieldError,
  type PostPurchaseEntryRequest,
  type PostPurchaseEntryResultDto,
  type PurchasePostPreviewDto,
  type ReceiptDestinationInput,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { Db, PoolConnection } from '../db/types';
import { purchaseDocumentRepository } from '../repositories/PurchaseDocumentRepository';
import {
  purchaseEntryRepository,
  type PurchaseEntryRow,
} from '../repositories/PurchaseEntryRepository';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { newId } from '../utils/ids';
import { toDbDateTime } from '../utils/time';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { documentNumberService } from './DocumentNumberService';
import { money } from './posPricing';
import {
  mapPurchaseException,
  purchaseExceptionService,
  type PurchaseExceptionDraft,
} from './PurchaseExceptionService';
import {
  mapPayable as mapPayableRow,
  mapVendorLedgerEntry as mapLedgerRow,
  purchaseEntryService,
  qty,
  rate4,
  type ComputedPurchaseEntry,
  type ComputedPurchaseLine,
} from './PurchaseEntryService';
import { stockLedgerService, type StockMovementRequest } from './StockLedgerService';
import { vendorLedgerService } from './VendorLedgerService';

/**
 * The atomic post.
 *
 * One `withTransaction` produces the goods receipt, the stock movements, the purchase
 * invoice, the vendor ledger credit, the payable and — for an immediate payment method — the
 * payment, its allocation and the matching ledger debit. If anything in that list throws,
 * none of it happened. That is the entire point of this file: a canteen that has taken
 * delivery of the goods but lost the liability, or booked the bill but not the stock, has no
 * way back to a true position.
 *
 * Three rules, and none of them bends:
 *
 *   - **Nothing the client sent is posted.** Every line and every total is recomputed here
 *     from the masters and the document. `supplier_total_amount` is compared against our
 *     figure and raised as an exception; it is never used in place of it.
 *   - **Only accepted quantity becomes stock.** Received is what arrived, accepted is what we
 *     are keeping, and the ledger only ever sees the second.
 *   - **Stock moves through StockLedgerService and money moves through VendorLedgerService.**
 *     This service decides *what* to post and in what order; it writes neither ledger itself.
 */

const OPERATION = 'purchase.post';
const QUANTITY_EPSILON = 0.0005;

/** One received line's split across locations. Supplied at post time, not stored on the draft. */
export interface PostLineDestinationInput {
  lineId: string;
  destinations: ReceiptDestinationInput[];
}

export interface PostPurchaseEntryRequestEx extends PostPurchaseEntryRequest {
  /**
   * Where each line's accepted quantity is going, when it is going to more than one place.
   * Omit a line to send all of it to its resolved destination. Quantities are in the line's
   * purchase unit and must sum to its accepted quantity.
   */
  lineDestinations?: PostLineDestinationInput[];
}

export interface PostOptions {
  /** The `X-Idempotency-Key` header, when the client supplied one. */
  idempotencyKey?: string | null;
}

/** A resolved destination for one line, after defaults and splits have been applied. */
interface ResolvedDestination {
  locationId: string;
  quantity: number;
  notes: string | null;
}

/**
 * Raised when a purchase carries exceptions that stop it. The list travels with the error so
 * the UI can offer a resolution path rather than a dead end.
 */
export class PurchaseExceptionsUnresolvedError extends AppError {
  constructor(details: ApiFieldError[]) {
    super(
      409,
      ERROR_CODES.PURCHASE_EXCEPTIONS_UNRESOLVED,
      'This purchase cannot be posted until its exceptions are resolved or explicitly accepted',
      { details },
    );
  }
}

export class PurchasePostingService {
  /* ------------------------------------------------------------------- preview */

  /**
   * What a post would do, without doing it.
   *
   * Recomputes the lines and the exceptions exactly as the post will, and rewrites the stored
   * exception set so the entry screen and the Post button can never disagree about why a bill
   * is stuck.
   */
  async preview(entryId: string): Promise<PurchasePostPreviewDto> {
    return withTransaction(async (cx) => {
      const entry = await purchaseEntryRepository.lockEntry(cx, entryId);
      if (entry === null) throw new NotFoundError('Purchase entry', entryId);

      const { computed, drafts } = await this.recompute(cx, entry, { persist: true });

      const blocking = drafts.filter((d) => d.severity === ExceptionSeverity.BLOCKING);
      const overridable = drafts.filter((d) => d.severity === ExceptionSeverity.OVERRIDABLE);
      const advisory = drafts.filter(
        (d) => d.severity === ExceptionSeverity.INFO || d.severity === ExceptionSeverity.WARNING,
      );

      const stored = await purchaseEntryRepository.listExceptions(cx, 'PURCHASE_ENTRY', entryId);
      const bySeverity = (severity: ExceptionSeverity) =>
        stored.filter((row) => row.severity === severity).map(mapPurchaseException);

      const stockLines = this.stockLines(entry.purchase_type, computed);
      const immediate = vendorLedgerService.isImmediate(entry.payment_method);
      const postable =
        entry.status === PurchaseEntryStatus.DRAFT || entry.status === PurchaseEntryStatus.READY;

      return {
        entryId,
        canPost: postable && blocking.length === 0,
        blocking: bySeverity(ExceptionSeverity.BLOCKING),
        overridable: bySeverity(ExceptionSeverity.OVERRIDABLE),
        advisory: [
          ...bySeverity(ExceptionSeverity.WARNING),
          ...bySeverity(ExceptionSeverity.INFO),
        ],
        computedTotal: computed.totals.totalAmount,
        willCreateGoodsReceipt: stockLines.length > 0,
        willCreateInvoice: true,
        willCreatePayable: computed.totals.totalAmount > 0,
        willCreatePayment: immediate && computed.totals.totalAmount > 0,
        // One movement per line at its resolved destination; a split supplied at post time
        // only ever raises this, never lowers it.
        stockMovementCount: stockLines.length,
      };
    });
  }

  /* ---------------------------------------------------------------------- post */

  async postEntry(
    entryId: string,
    request: PostPurchaseEntryRequestEx,
    actor: AuditActor,
    options: PostOptions = {},
  ): Promise<PostPurchaseEntryResultDto> {
    return withTransaction(async (cx) => {
      /* 1 — lock the entry. */
      const entry = await purchaseEntryRepository.lockEntry(cx, entryId);
      if (entry === null) throw new NotFoundError('Purchase entry', entryId);

      /*
       * 2 — idempotency, so a retried post looks like success rather than a duplicate.
       *
       * Claimed before the status is judged, deliberately: the case this exists for is a
       * client that timed out on a post which actually succeeded, and by then the entry is
       * POSTED. Refusing that retry would tell the client the opposite of the truth.
       */
      const key = options.idempotencyKey ?? null;
      if (key !== null && key !== '') {
        const claimed = await purchaseDocumentRepository.claimIdempotency(cx, {
          id: newId(),
          key,
          operation: OPERATION,
          requestHash: hashRequest(entryId, request),
          actorId: actor.userId,
        });
        if (!claimed) {
          const previous = await purchaseDocumentRepository.findIdempotency(cx, OPERATION, key);
          if (previous?.result_id != null) {
            return this.readResult(cx, previous.result_id);
          }
          throw new ConflictError(
            'A post with this idempotency key is already in progress; retry in a moment',
          );
        }
      }

      /* Refuse anything that is not postable. */
      if (entry.status === PurchaseEntryStatus.POSTED) {
        throw new ConflictError(
          'This purchase entry has already been posted. Reverse it with a purchase return or a debit memo rather than posting it again.',
        );
      }
      if (entry.status === PurchaseEntryStatus.CANCELLED) {
        throw new ConflictError('A cancelled purchase entry cannot be posted');
      }
      // Belt and braces: the unique indexes below would catch a replay anyway, but a clear
      // refusal beats a constraint violation.
      if (entry.goods_receipt_id !== null) {
        await stockLedgerService.assertNotAlreadyPosted(
          cx,
          StockSourceType.GOODS_RECEIPT,
          entry.goods_receipt_id,
        );
      }
      if (entry.purchase_invoice_id !== null) {
        await vendorLedgerService.assertNotAlreadyPosted(
          cx,
          'purchase_invoice',
          entry.purchase_invoice_id,
        );
      }

      /* 3 & 4 — recompute everything, then decide whether it may post. */
      const { computed, drafts, supplier } = await this.recompute(cx, entry, { persist: true });
      this.enforce(drafts, request.acceptedExceptionCodes ?? []);

      const businessDate = entry.business_date.slice(0, 10);
      const invoiceDate = (entry.supplier_invoice_date ?? businessDate).slice(0, 10);
      const supplierBill =
        entry.supplier_invoice_number === null || entry.supplier_invoice_number === ''
          ? entry.entry_number
          : entry.supplier_invoice_number;
      const creditDays = Number(entry.credit_days);
      const dueDate = vendorLedgerService.resolveDueDate(
        invoiceDate,
        entry.payment_method,
        creditDays,
      );

      /* 5 — the goods receipt, for stock lines only. */
      const stockLines = this.stockLines(entry.purchase_type, computed);
      const receiptLineIds = new Map<string, string>();
      let goodsReceiptId: string | null = null;
      let grnNumber: string | null = null;

      if (stockLines.length > 0) {
        const locationId =
          entry.receiving_location_id ??
          stockLines[0]?.destinationLocationId ??
          (await purchaseDocumentRepository.findDefaultReceivingLocation(cx));
        if (locationId == null) {
          throw new ValidationError('This purchase has no location to be received into');
        }

        const allocated = await documentNumberService.next(cx, 'GOODS_RECEIPT', businessDate);
        goodsReceiptId = newId();
        grnNumber = allocated.documentNumber;
        const now = toDbDateTime();

        await purchaseDocumentRepository.insertGoodsReceipt(cx, {
          id: goodsReceiptId,
          grnNumber: allocated.documentNumber,
          dailySequence: allocated.dailySequence,
          businessDate,
          receiptDate: businessDate,
          supplierId: entry.supplier_id,
          purchaseEntryId: entry.id,
          purchaseOrderId: entry.purchase_order_id,
          deliveryNote: entry.reference,
          locationId,
          status: GoodsReceiptStatus.POSTED,
          notes: entry.notes,
          receivedBy: actor.userId,
          qcBy: actor.userId,
          qcAt: now,
          createdBy: actor.userId,
          postedBy: actor.userId,
          postedAt: now,
        });

        let sortOrder = 0;
        const movements: StockMovementRequest[] = [];
        for (const line of stockLines) {
          const receiptLineId = newId();
          receiptLineIds.set(line.id, receiptLineId);

          await purchaseDocumentRepository.insertGoodsReceiptLine(cx, {
            id: receiptLineId,
            goodsReceiptId,
            productId: line.productId as string,
            purchaseEntryLineId: line.id,
            purchaseOrderLineId: null,
            orderedQuantity: 0,
            previouslyReceived: 0,
            billedQuantity: line.quantity,
            receivedQuantity: line.receivedQuantity,
            acceptedQuantity: line.acceptedQuantity,
            rejectedQuantity: line.rejectedQuantity,
            purchaseUomId: line.purchaseUomId,
            stockUomId: line.stockUomId,
            conversionFactor: line.conversionFactor,
            acceptedStockQuantity: qty(line.acceptedQuantity * line.conversionFactor),
            purchaseRate: line.rate,
            batchNumber: line.batchNumber,
            manufacturingDate: line.manufacturingDate,
            expiryDate: line.expiryDate,
            qcStatus: qcStatusOf(line),
            rejectionReason: line.rejectionReason,
            rejectionNotes: null,
            notes: line.notes,
            sortOrder,
          });
          sortOrder += 1;

          const destinations = this.resolveDestinations(line, request.lineDestinations ?? []);
          let destinationOrder = 0;
          for (const destination of destinations) {
            await purchaseDocumentRepository.insertDestination(cx, {
              id: newId(),
              goodsReceiptLineId: receiptLineId,
              locationId: destination.locationId,
              quantity: destination.quantity,
              notes: destination.notes,
              sortOrder: destinationOrder,
            });
            destinationOrder += 1;

            movements.push({
              productId: line.productId as string,
              locationId: destination.locationId,
              movementType: StockMovementType.PURCHASE_RECEIPT,
              // Purchase units on the document, stock units in the ledger.
              quantity: qty(destination.quantity * line.conversionFactor),
              // Cost excludes recoverable tax: stock is held at what the goods cost, not at
              // what the bill totalled.
              unitCost: netRatePerStockUnit(line),
              sourceLineId: receiptLineId,
              ...(line.product?.is_batch_tracked === 1
                ? {
                  batch: {
                    batchNumber: line.batchNumber,
                    manufacturingDate: line.manufacturingDate,
                    expiryDate: line.expiryDate,
                    supplierId: entry.supplier_id,
                  },
                }
                : {}),
            });
          }
        }

        /* 6 — the only call in this service that moves stock. */
        await stockLedgerService.post(cx, movements, {
          sourceType: StockSourceType.GOODS_RECEIPT,
          sourceId: goodsReceiptId,
          sourceDocumentNumber: allocated.documentNumber,
          businessDate,
          actorId: actor.userId,
        });

        // Point each receipt line at the batch the ledger resolved or created for it.
        for (const receiptLineId of receiptLineIds.values()) {
          const batchId = await purchaseDocumentRepository.findBatchForSourceLine(
            cx,
            StockSourceType.GOODS_RECEIPT,
            goodsReceiptId,
            receiptLineId,
          );
          if (batchId !== null) {
            await purchaseDocumentRepository.setGoodsReceiptLineBatch(cx, receiptLineId, batchId);
          }
        }

        await auditService.record(cx, actor, {
          action: AuditAction.GOODS_RECEIPT_CREATED,
          entityType: 'goods_receipt',
          entityId: goodsReceiptId,
          after: {
            grnNumber: allocated.documentNumber,
            purchaseEntryId: entry.id,
            lineCount: stockLines.length,
          },
        });
        await auditService.record(cx, actor, {
          action: AuditAction.GOODS_RECEIPT_POSTED,
          entityType: 'goods_receipt',
          entityId: goodsReceiptId,
          after: { grnNumber: allocated.documentNumber, movements: movements.length },
        });
      }

      /* 7 — the purchase invoice. */
      const invoiceAllocated = await documentNumberService.next(
        cx,
        'PURCHASE_INVOICE',
        businessDate,
      );
      const invoiceId = newId();
      const postedAt = toDbDateTime();
      const totals = computed.totals;

      await purchaseDocumentRepository.insertPurchaseInvoice(cx, {
        id: invoiceId,
        invoiceNumber: invoiceAllocated.documentNumber,
        dailySequence: invoiceAllocated.dailySequence,
        businessDate,
        supplierId: entry.supplier_id,
        supplierInvoiceNumber: supplierBill,
        supplierInvoiceDate: invoiceDate,
        dueDate,
        creditDays,
        purchaseEntryId: entry.id,
        goodsReceiptId,
        purchaseOrderId: entry.purchase_order_id,
        locationId: entry.receiving_location_id,
        status: PurchaseInvoiceStatus.POSTED,
        matchStatus: MatchStatus.MATCHED,
        paymentMethod: entry.payment_method,
        paymentStatus: PayableStatus.UNPAID,
        supplierStateCode: computed.supplierStateCode,
        isInterState: computed.isInterState,
        subtotalAmount: totals.subtotalAmount,
        discountAmount: totals.discountAmount,
        taxableAmount: totals.taxableAmount,
        cgstAmount: totals.cgstAmount,
        sgstAmount: totals.sgstAmount,
        igstAmount: totals.igstAmount,
        cessAmount: totals.cessAmount,
        taxAmount: totals.taxAmount,
        roundOffAmount: totals.roundOffAmount,
        otherCharges: totals.otherCharges,
        totalAmount: totals.totalAmount,
        paidAmount: 0,
        outstandingAmount: totals.totalAmount,
        reference: entry.reference,
        notes: entry.notes,
        attachmentId: entry.attachment_id,
        createdBy: actor.userId,
        postedBy: actor.userId,
        postedAt,
      });

      let invoiceLineOrder = 0;
      for (const line of computed.lines) {
        await purchaseDocumentRepository.insertPurchaseInvoiceLine(cx, {
          id: newId(),
          invoiceId,
          productId: line.productId,
          description: line.description ?? line.product?.name ?? null,
          goodsReceiptLineId: receiptLineIds.get(line.id) ?? null,
          purchaseEntryLineId: line.id,
          quantity: line.quantity,
          uomId: line.purchaseUomId,
          rate: line.rate,
          discountPercent: line.discountPercent,
          discountAmount: line.discountAmount,
          grossAmount: line.grossAmount,
          taxableAmount: line.taxableAmount,
          taxProfileId: line.taxProfileId,
          hsnSacCode: line.hsnCode,
          taxRate: line.taxRate,
          cgstAmount: line.cgstAmount,
          sgstAmount: line.sgstAmount,
          igstAmount: line.igstAmount,
          cessAmount: line.cessAmount,
          taxAmount: line.taxAmount,
          lineTotal: line.lineTotal,
          notes: line.notes,
          sortOrder: invoiceLineOrder,
        });
        invoiceLineOrder += 1;
      }

      await auditService.record(cx, actor, {
        action: AuditAction.PURCHASE_INVOICE_CREATED,
        entityType: 'purchase_invoice',
        entityId: invoiceId,
        after: {
          invoiceNumber: invoiceAllocated.documentNumber,
          supplierInvoiceNumber: supplierBill,
          totalAmount: totals.totalAmount,
        },
      });

      /* 8 — the vendor ledger credit. CREDIT increases what we owe them. */
      await vendorLedgerService.post(cx, {
        supplierId: entry.supplier_id,
        transactionType: VendorLedgerTxnType.PURCHASE_INVOICE,
        documentNumber: invoiceAllocated.documentNumber,
        sourceType: 'purchase_invoice',
        sourceId: invoiceId,
        reference: supplierBill,
        narration: `Purchase invoice ${invoiceAllocated.documentNumber} (bill ${supplierBill})`,
        creditAmount: totals.totalAmount,
        businessDate,
        actorId: actor.userId,
      });

      await auditService.record(cx, actor, {
        action: AuditAction.PURCHASE_INVOICE_POSTED,
        entityType: 'purchase_invoice',
        entityId: invoiceId,
        after: { invoiceNumber: invoiceAllocated.documentNumber, totalAmount: totals.totalAmount },
      });

      /* 9 — the liability. */
      let payableId: string | null = null;
      if (totals.totalAmount > 0) {
        payableId = await vendorLedgerService.createPayable(cx, {
          supplierId: entry.supplier_id,
          purchaseInvoiceId: invoiceId,
          documentNumber: invoiceAllocated.documentNumber,
          supplierInvoiceNumber: supplierBill,
          invoiceDate,
          dueDate,
          creditDays,
          amount: totals.totalAmount,
        });
      }

      /* 10 — settlement, when the method settles on the spot. */
      let paidAmount = 0;
      let paymentId: string | null = null;
      if (
        vendorLedgerService.isImmediate(entry.payment_method) &&
        payableId !== null &&
        totals.totalAmount > 0
      ) {
        const requested = request.paidAmount ?? totals.totalAmount;
        paidAmount = money(Math.min(Math.max(requested, 0), totals.totalAmount));

        if (paidAmount > 0) {
          const paymentAllocated = await documentNumberService.next(
            cx,
            'VENDOR_PAYMENT',
            businessDate,
          );
          paymentId = newId();
          await purchaseDocumentRepository.insertVendorPayment(cx, {
            id: paymentId,
            paymentNumber: paymentAllocated.documentNumber,
            dailySequence: paymentAllocated.dailySequence,
            businessDate,
            supplierId: entry.supplier_id,
            paymentDate: businessDate,
            method: entry.payment_method,
            status: VendorPaymentStatus.POSTED,
            amount: paidAmount,
            unallocatedAmount: 0,
            reference: request.paymentReference ?? entry.payment_reference,
            instrumentNumber: null,
            instrumentDate: null,
            bankName: null,
            notes: null,
            purchaseEntryId: entry.id,
            createdBy: actor.userId,
            postedBy: actor.userId,
            postedAt,
          });

          const { unallocated } = await vendorLedgerService.allocatePayment(cx, {
            paymentId,
            supplierId: entry.supplier_id,
            paymentAmount: paidAmount,
            allocations: [{ accountsPayableId: payableId, allocatedAmount: paidAmount }],
          });
          await purchaseDocumentRepository.setPaymentUnallocated(cx, paymentId, unallocated);

          await vendorLedgerService.post(cx, {
            supplierId: entry.supplier_id,
            transactionType: VendorLedgerTxnType.PAYMENT,
            documentNumber: paymentAllocated.documentNumber,
            sourceType: 'vendor_payment',
            sourceId: paymentId,
            reference: request.paymentReference ?? entry.payment_reference,
            narration: `Payment ${paymentAllocated.documentNumber} against ${invoiceAllocated.documentNumber}`,
            debitAmount: paidAmount,
            businessDate,
            actorId: actor.userId,
          });

          await auditService.record(cx, actor, {
            action: AuditAction.VENDOR_PAYMENT_POSTED,
            entityType: 'vendor_payment',
            entityId: paymentId,
            after: {
              paymentNumber: paymentAllocated.documentNumber,
              amount: paidAmount,
              invoiceNumber: invoiceAllocated.documentNumber,
            },
          });
        }
      }

      /* 11 — price history and the last-rate caches the next bill is checked against. */
      for (const line of computed.lines) {
        if (line.productId === null) continue;
        const netRate = netRatePerStockUnit(line);
        await purchaseDocumentRepository.insertPriceHistory(cx, {
          id: newId(),
          productId: line.productId,
          supplierId: entry.supplier_id,
          businessDate,
          sourceType: 'PURCHASE_INVOICE',
          sourceId: invoiceId,
          documentNumber: invoiceAllocated.documentNumber,
          quantity: line.quantity,
          uomId: line.purchaseUomId,
          rate: line.rate,
          discountPercent: line.discountPercent,
          taxRate: line.taxRate,
          netRatePerStockUnit: netRate,
        });
        await purchaseDocumentRepository.setProductLastPurchase(cx, line.productId, line.rate);
        if (line.hasSupplierMapping) {
          await purchaseDocumentRepository.setSupplierProductLastRate(
            cx,
            entry.supplier_id,
            line.productId,
            line.rate,
          );
        }
      }

      /* 12 — the entry itself. */
      await purchaseEntryRepository.setEntryStatus(cx, entry.id, {
        status: PurchaseEntryStatus.POSTED,
        postedBy: actor.userId,
        postedAt,
        goodsReceiptId,
        purchaseInvoiceId: invoiceId,
        dueDate,
        paidAmount,
        outstandingAmount: money(totals.totalAmount - paidAmount),
      });

      /* 13 — audit the entry last, so its row records what the whole post produced. */
      await auditService.record(cx, actor, {
        action: AuditAction.PURCHASE_ENTRY_POSTED,
        entityType: 'purchase_entry',
        entityId: entry.id,
        before: { status: entry.status },
        after: {
          status: PurchaseEntryStatus.POSTED,
          entryNumber: entry.entry_number,
          grnNumber,
          invoiceNumber: invoiceAllocated.documentNumber,
          totalAmount: totals.totalAmount,
          paidAmount,
          acceptedExceptionCodes: request.acceptedExceptionCodes ?? [],
          overrideNote: request.overrideNote ?? null,
        },
      });

      /* 14 — record the result so a retry replays it instead of posting again. */
      if (key !== null && key !== '') {
        await purchaseDocumentRepository.recordIdempotencyResult(cx, {
          operation: OPERATION,
          key,
          resultType: 'purchase_entry',
          resultId: entry.id,
          resultNumber: entry.entry_number,
        });
      }

      return this.readResult(cx, entry.id);
    });
  }

  /* -------------------------------------------------------------------- internals */

  /**
   * Recompute the whole document from the masters, write the recomputed figures back, and
   * redetect the exceptions. Shared by `/preview` and by the post, so the two can never
   * arrive at different answers.
   */
  private async recompute(
    cx: PoolConnection,
    entry: PurchaseEntryRow,
    options: { persist: boolean },
  ): Promise<{
    computed: ComputedPurchaseEntry;
    drafts: PurchaseExceptionDraft[];
    supplier: Awaited<ReturnType<typeof purchaseEntryService.requireSupplier>>;
  }> {
    const supplier = await purchaseEntryService.requireSupplier(cx, entry.supplier_id);
    const rows = await purchaseEntryRepository.listLines(cx, entry.id);
    if (rows.length === 0) {
      throw new ValidationError('A purchase entry with no lines cannot be posted');
    }

    const computed = await purchaseEntryService.compute(cx, {
      supplier,
      purchaseType: entry.purchase_type,
      receivingLocationId: entry.receiving_location_id,
      otherCharges: Number(entry.other_charges),
      paidAmount: 0,
      lines: purchaseEntryService.linesFromRows(rows),
    });

    if (options.persist && entry.status !== PurchaseEntryStatus.POSTED) {
      await purchaseEntryService.writeLines(cx, entry.id, computed.lines);
      await purchaseEntryRepository.setEntryTotals(cx, entry.id, computed.totals);
    }

    const drafts = await purchaseEntryService.refreshExceptions(cx, {
      entryId: entry.id,
      businessDate: entry.business_date.slice(0, 10),
      purchaseType: entry.purchase_type,
      supplier,
      supplierInvoiceNumber: entry.supplier_invoice_number,
      supplierInvoiceDate:
        entry.supplier_invoice_date === null ? null : entry.supplier_invoice_date.slice(0, 10),
      supplierTotalAmount:
        entry.supplier_total_amount === null ? null : Number(entry.supplier_total_amount),
      computed,
    });

    return { computed, drafts, supplier };
  }

  /**
   * The severity rules, applied.
   *
   * BLOCKING never posts. OVERRIDABLE posts only when the caller named the code — silence is
   * not consent, and a UI that posts past an exception nobody acknowledged is a UI that will
   * eventually post a duplicate bill.
   */
  private enforce(
    drafts: readonly PurchaseExceptionDraft[],
    accepted: readonly PurchaseExceptionCode[],
  ): void {
    const acceptedSet = new Set<string>(accepted);
    const offenders = drafts.filter(
      (draft) =>
        draft.severity === ExceptionSeverity.BLOCKING ||
        (draft.severity === ExceptionSeverity.OVERRIDABLE && !acceptedSet.has(draft.code)),
    );
    if (offenders.length === 0) return;

    throw new PurchaseExceptionsUnresolvedError(
      offenders.map((draft) => ({
        path: `exceptions.${draft.code}`,
        message: `[${draft.severity}] ${draft.message}`,
      })),
    );
  }

  /** Only STOCK purchases with a real product and something accepted reach the stock ledger. */
  private stockLines(
    purchaseType: PurchaseType,
    computed: ComputedPurchaseEntry,
  ): ComputedPurchaseLine[] {
    if (purchaseType !== PurchaseType.STOCK) return [];
    return computed.lines.filter(
      (line) =>
        line.productId !== null &&
        line.product?.is_stocked === 1 &&
        line.acceptedQuantity > QUANTITY_EPSILON,
    );
  }

  /**
   * Where one line's accepted quantity is going.
   *
   * A split has to add up. The sum cannot be expressed as a row-level CHECK, so it is asserted
   * here and surfaced as DESTINATION_SPLIT_MISMATCH — the case migration 007 explicitly
   * delegates to the posting engine.
   */
  private resolveDestinations(
    line: ComputedPurchaseLine,
    splits: readonly PostLineDestinationInput[],
  ): ResolvedDestination[] {
    const split = splits.find((entry) => entry.lineId === line.id);
    const label = line.product?.name ?? line.description ?? 'line';

    if (split === undefined || split.destinations.length === 0) {
      if (line.destinationLocationId === null) {
        throw new ValidationError(`${label} has no location to be received into`);
      }
      return [
        { locationId: line.destinationLocationId, quantity: line.acceptedQuantity, notes: null },
      ];
    }

    // The unique index is (line, location), so two shares of the same store are one row.
    const merged = new Map<string, ResolvedDestination>();
    for (const destination of split.destinations) {
      const existing = merged.get(destination.locationId);
      const quantity = qty(destination.quantity);
      if (quantity <= 0) {
        throw new ValidationError(`${label} has a destination with a non-positive quantity`);
      }
      if (existing === undefined) {
        merged.set(destination.locationId, {
          locationId: destination.locationId,
          quantity,
          notes: destination.notes ?? null,
        });
      } else {
        existing.quantity = qty(existing.quantity + quantity);
      }
    }

    const total = qty([...merged.values()].reduce((sum, d) => sum + d.quantity, 0));
    if (Math.abs(total - line.acceptedQuantity) > QUANTITY_EPSILON) {
      throw new PurchaseExceptionsUnresolvedError([
        {
          path: `exceptions.${PurchaseExceptionCode.DESTINATION_SPLIT_MISMATCH}`,
          message:
            `[${ExceptionSeverity.BLOCKING}] ${label}: destinations total ${total} but ` +
            `${line.acceptedQuantity} was accepted.`,
        },
      ]);
    }
    return [...merged.values()];
  }

  /** Everything one post produced, read back from the database rather than assembled in memory. */
  async readResult(db: Db, entryId: string): Promise<PostPurchaseEntryResultDto> {
    const entry = await purchaseEntryService.readEntry(db, entryId);

    const goodsReceipt =
      entry.goodsReceiptId === null
        ? null
        : await purchaseEntryService.readReceipt(db, entry.goodsReceiptId);
    const invoice =
      entry.purchaseInvoiceId === null
        ? null
        : await purchaseEntryService.readInvoice(db, entry.purchaseInvoiceId);

    const payableRow =
      entry.purchaseInvoiceId === null
        ? null
        : await purchaseDocumentRepository.findPayableByInvoice(db, entry.purchaseInvoiceId);
    const paymentRow = await purchaseDocumentRepository.findPaymentByEntry(db, entryId);

    const ledgerRows = [
      ...(entry.purchaseInvoiceId === null
        ? []
        : await purchaseDocumentRepository.listVendorLedgerBySource(
          db,
          'purchase_invoice',
          entry.purchaseInvoiceId,
        )),
      ...(paymentRow === null
        ? []
        : await purchaseDocumentRepository.listVendorLedgerBySource(
          db,
          'vendor_payment',
          paymentRow.id,
        )),
    ];

    const movementRows =
      entry.goodsReceiptId === null
        ? []
        : await purchaseDocumentRepository.listMovementsForSource(
          db,
          StockSourceType.GOODS_RECEIPT,
          entry.goodsReceiptId,
        );

    return {
      entry,
      goodsReceipt,
      invoice,
      payable: payableRow === null ? null : mapPayableRow(payableRow),
      payment: paymentRow === null ? null : await purchaseEntryService.readPayment(db, paymentRow.id),
      vendorLedgerEntries: ledgerRows.map(mapLedgerRow),
      stockMovements: movementRows.map((row) => ({
        ledgerId: row.id,
        ledgerSeq: Number(row.ledger_seq),
        productId: row.product_id,
        productName: row.product_name,
        locationId: row.location_id,
        locationName: row.location_name,
        quantity: Number(row.quantity_in),
        unitCost: Number(row.unit_cost),
        balanceAfter: Number(row.balance_quantity),
      })),
    };
  }

  /** The read-only form used by the controller after a post has already committed. */
  async getResult(entryId: string): Promise<PostPurchaseEntryResultDto> {
    return this.readResult(getPool(), entryId);
  }
}

/** Net rate per stock unit: what the goods cost, with recoverable tax excluded. */
function netRatePerStockUnit(line: ComputedPurchaseLine): number {
  if (line.stockQuantity <= QUANTITY_EPSILON) return 0;
  return rate4(line.taxableAmount / line.stockQuantity);
}

function qcStatusOf(line: ComputedPurchaseLine): QcStatus {
  if (line.rejectedQuantity <= QUANTITY_EPSILON) return QcStatus.ACCEPTED;
  if (line.acceptedQuantity <= QUANTITY_EPSILON) return QcStatus.REJECTED;
  return QcStatus.PARTIAL;
}

/**
 * The request hash is stored beside the idempotency key so a replay under the same key with a
 * genuinely different request is visible in the table rather than silently conflated.
 */
function hashRequest(entryId: string, request: PostPurchaseEntryRequestEx): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        entryId,
        acceptedExceptionCodes: [...(request.acceptedExceptionCodes ?? [])].sort(),
        paidAmount: request.paidAmount ?? null,
        paymentReference: request.paymentReference ?? null,
        lineDestinations: request.lineDestinations ?? null,
      }),
    )
    .digest('hex');
}

export const purchasePostingService = new PurchasePostingService();
