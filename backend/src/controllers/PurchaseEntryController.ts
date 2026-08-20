import type { Request, Response } from 'express';
import {
  HEADERS,
  type AccountsPayableListQuery,
  type CreatePurchaseEntryRequest,
  type CreateVendorPaymentRequest,
  type GoodsReceiptListQuery,
  type IsoDate,
  type PurchaseEntryListQuery,
  type PurchaseInvoiceListQuery,
  type PurchaseRegisterQuery,
  type UpdatePurchaseEntryRequest,
  type VendorLedgerListQuery,
  type VendorPaymentListQuery,
} from '@menuboard/shared';
import {
  purchaseEntryService,
  type PurchaseLineInput,
} from '../services/PurchaseEntryService';
import {
  purchasePostingService,
  type PostPurchaseEntryRequestEx,
} from '../services/PurchasePostingService';
import { getPool } from '../db/pool';
import { created, ok, paginated } from '../utils/http';
import { actorFrom } from './context';

/**
 * The purchase entry chain over HTTP.
 *
 * HTTP in, HTTP out; every rule lives in the services. The one thing this layer does decide is
 * where the idempotency key comes from — the `X-Idempotency-Key` header rather than the body,
 * so a client can retry the identical request bytes and have it recognised as the same post.
 */
export const PurchaseEntryController = {
  /* ------------------------------------------------------------------- entries */

  async listEntries(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await purchaseEntryService.listEntries(req.query as unknown as PurchaseEntryListQuery),
    );
  },

  async createEntry(req: Request, res: Response): Promise<void> {
    created(
      res,
      await purchaseEntryService.createEntry(
        req.body as CreatePurchaseEntryRequest & { lines: PurchaseLineInput[] },
        actorFrom(req),
      ),
    );
  },

  async getEntry(req: Request, res: Response): Promise<void> {
    ok(res, await purchaseEntryService.getEntry(req.params.entryId as string));
  },

  async updateEntry(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await purchaseEntryService.updateEntry(
        req.params.entryId as string,
        req.body as UpdatePurchaseEntryRequest & { lines?: PurchaseLineInput[] },
        actorFrom(req),
      ),
    );
  },

  async markReady(req: Request, res: Response): Promise<void> {
    ok(res, await purchaseEntryService.markReady(req.params.entryId as string, actorFrom(req)));
  },

  async preview(req: Request, res: Response): Promise<void> {
    ok(res, await purchasePostingService.preview(req.params.entryId as string));
  },

  async post(req: Request, res: Response): Promise<void> {
    const raw = req.headers[HEADERS.IDEMPOTENCY_KEY];
    const key = (Array.isArray(raw) ? raw[0] : raw) ?? null;
    ok(
      res,
      await purchasePostingService.postEntry(
        req.params.entryId as string,
        req.body as PostPurchaseEntryRequestEx,
        actorFrom(req),
        { idempotencyKey: key },
      ),
    );
  },

  async cancelEntry(req: Request, res: Response): Promise<void> {
    const body = req.body as { reason?: string | null };
    ok(
      res,
      await purchaseEntryService.cancelEntry(
        req.params.entryId as string,
        body.reason ?? null,
        actorFrom(req),
      ),
    );
  },

  async flow(req: Request, res: Response): Promise<void> {
    ok(res, await purchaseEntryService.documentFlow(req.params.entryId as string));
  },

  /* ------------------------------------------------------------------ register */

  async register(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await purchaseEntryService.register(req.query as unknown as PurchaseRegisterQuery),
    );
  },

  async registerTotals(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await purchaseEntryService.registerTotals(req.query as unknown as PurchaseRegisterQuery),
    );
  },

  /* -------------------------------------------------------- generated documents */

  async listInvoices(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await purchaseEntryService.listInvoices(req.query as unknown as PurchaseInvoiceListQuery),
    );
  },

  async getInvoice(req: Request, res: Response): Promise<void> {
    ok(res, await purchaseEntryService.getInvoice(req.params.invoiceId as string));
  },

  async listReceipts(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await purchaseEntryService.listReceipts(req.query as unknown as GoodsReceiptListQuery),
    );
  },

  async getReceipt(req: Request, res: Response): Promise<void> {
    ok(res, await purchaseEntryService.getReceipt(req.params.receiptId as string));
  },

  /* -------------------------------------------------------------- vendor ledger */

  async listVendorLedger(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await purchaseEntryService.listVendorLedger(req.query as unknown as VendorLedgerListQuery),
    );
  },

  async vendorStatement(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await purchaseEntryService.vendorStatement(
        req.params.supplierId as string,
        req.query as unknown as { dateFrom?: IsoDate; dateTo?: IsoDate; page?: number; pageSize?: number },
      ),
    );
  },

  async vendorAgeing(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as { supplierId?: string };
    ok(res, await purchaseEntryService.vendorAgeing(query.supplierId));
  },

  /* ---------------------------------------------------------- payables & payments */

  async listPayables(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await purchaseEntryService.listPayables(req.query as unknown as AccountsPayableListQuery),
    );
  },

  async queuePayable(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await purchaseEntryService.queuePayable(req.params.payableId as string, actorFrom(req)),
    );
  },

  async listPayments(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await purchaseEntryService.listPayments(req.query as unknown as VendorPaymentListQuery),
    );
  },

  async getPayment(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await purchaseEntryService.readPayment(getPool(), req.params.paymentId as string),
    );
  },

  async createPayment(req: Request, res: Response): Promise<void> {
    created(
      res,
      await purchaseEntryService.createPayment(
        req.body as CreateVendorPaymentRequest,
        actorFrom(req),
      ),
    );
  },
};
