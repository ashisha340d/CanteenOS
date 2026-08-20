import {
  PayableStatus,
  PurchasePaymentMethod,
  VendorLedgerTxnType,
  type IsoDate,
} from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db, type PoolConnection, type RowDataPacket } from '../db/types';
import { ConflictError, ValidationError } from '../utils/errors';
import { newId } from '../utils/ids';
import { toDbDateTime, todayIsoDate } from '../utils/time';
import { money } from './posPricing';

/**
 * Vendor accounting: the supplier ledger, accounts payable, and the allocation of payments
 * against invoices.
 *
 * This is the financial counterpart of StockLedgerService, and it holds the same line: every
 * entry in `vendor_ledger_entries` is written here and nowhere else, and there is no update or
 * delete path. A supplier balance that can be edited is a supplier balance nobody can defend
 * in front of that supplier.
 *
 * Sign convention, stated once so it is never guessed. The ledger is kept from the supplier's
 * point of view:
 *
 *   CREDIT increases what we owe them   — a purchase invoice, a credit memo
 *   DEBIT  reduces what we owe them     — a payment, a purchase return, a debit memo
 *
 * So `runningBalance` positive means we owe the supplier money.
 *
 * Every method takes an open `PoolConnection`. Vendor accounting is never the whole of a
 * transaction — an invoice, its payable and its settlement have to commit together with the
 * stock that arrived — so opening a transaction here would let the money half commit while the
 * goods half rolled back.
 */

interface SupplierBalanceRow extends RowDataPacket {
  id: string;
  name: string;
  account_balance: string;
  vendor_credit_days: number;
  vendor_is_approved: number;
}

interface PayableRow extends RowDataPacket {
  id: string;
  supplier_id: string;
  purchase_invoice_id: string;
  document_number: string;
  original_amount: string;
  paid_amount: string;
  adjusted_amount: string;
  outstanding_amount: string;
  status: string;
  due_date: string | null;
  version: number;
}

export interface LedgerPostingInput {
  supplierId: string;
  transactionType: VendorLedgerTxnType;
  documentNumber: string | null;
  sourceType: string;
  sourceId: string;
  reference?: string | null;
  narration?: string | null;
  /** Exactly one of these is non-zero. Passing both is a caller bug and is refused. */
  debitAmount?: number;
  creditAmount?: number;
  businessDate?: IsoDate;
  occurredAt?: string;
  actorId: string | null;
}

export interface PostedLedgerEntry {
  id: string;
  entrySeq: number;
  supplierId: string;
  transactionType: VendorLedgerTxnType;
  debitAmount: number;
  creditAmount: number;
  runningBalance: number;
}

export interface CreatePayableInput {
  supplierId: string;
  purchaseInvoiceId: string;
  documentNumber: string;
  supplierInvoiceNumber: string | null;
  invoiceDate: IsoDate;
  dueDate: IsoDate | null;
  creditDays: number;
  amount: number;
}

export interface AllocationInput {
  accountsPayableId: string;
  allocatedAmount: number;
}

export class VendorLedgerService {
  /**
   * Append one entry to a supplier's ledger and move their running balance.
   *
   * The supplier row is locked first, which is what serialises two invoices posted against the
   * same supplier in the same instant. Without it both would read the same opening balance and
   * one of the two running balances would be wrong forever — and because the ledger is
   * append-only, wrong forever means exactly that.
   */
  async post(db: PoolConnection, input: LedgerPostingInput): Promise<PostedLedgerEntry> {
    const debit = money(input.debitAmount ?? 0);
    const credit = money(input.creditAmount ?? 0);

    if (debit < 0 || credit < 0) {
      throw new ValidationError('A vendor ledger amount cannot be negative');
    }
    if (debit > 0 && credit > 0) {
      throw new ValidationError(
        'A vendor ledger entry moves money one way; it cannot be both a debit and a credit',
      );
    }
    if (debit === 0 && credit === 0 && input.transactionType !== VendorLedgerTxnType.OPENING_BALANCE) {
      throw new ValidationError('A vendor ledger entry must carry an amount');
    }
    if (input.sourceId.trim() === '') {
      throw new ValidationError('A vendor ledger entry must name the document that caused it');
    }

    const supplier = await this.lockSupplier(db, input.supplierId);
    const opening = money(Number(supplier.account_balance));
    const runningBalance = money(opening + credit - debit);

    const id = newId();
    const businessDate = input.businessDate ?? todayIsoDate();
    const occurredAt = input.occurredAt ?? toDbDateTime();

    const result = await mutate(
      db,
      `INSERT INTO vendor_ledger_entries
         (id, supplier_id, business_date, transaction_type, document_number, source_type,
          source_id, reference, narration, debit_amount, credit_amount, running_balance,
          occurred_at, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.supplierId,
        businessDate,
        input.transactionType,
        input.documentNumber,
        input.sourceType,
        input.sourceId,
        input.reference ?? null,
        input.narration ?? null,
        debit,
        credit,
        runningBalance,
        occurredAt,
        input.actorId,
        toDbDateTime(),
      ],
    );

    // The denormalised balance on the entity master, kept in step inside the same transaction
    // so the supplier list never disagrees with the supplier's own statement.
    await mutate(db, 'UPDATE entities SET account_balance = ?, updated_at = ? WHERE id = ?', [
      runningBalance,
      toDbDateTime(),
      input.supplierId,
    ]);

    return {
      id,
      entrySeq: Number(result.insertId),
      supplierId: input.supplierId,
      transactionType: input.transactionType,
      debitAmount: debit,
      creditAmount: credit,
      runningBalance,
    };
  }

  /**
   * Create the payable for a posted invoice.
   *
   * One payable per invoice, enforced by a unique index — so a retried post cannot create the
   * liability twice.
   */
  async createPayable(db: PoolConnection, input: CreatePayableInput): Promise<string> {
    const amount = money(input.amount);
    if (amount <= 0) {
      throw new ValidationError('A payable must be for a positive amount');
    }

    const id = newId();
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO accounts_payable
         (id, supplier_id, purchase_invoice_id, document_number, supplier_invoice_number,
          invoice_date, due_date, credit_days, original_amount, paid_amount, adjusted_amount,
          outstanding_amount, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
      [
        id,
        input.supplierId,
        input.purchaseInvoiceId,
        input.documentNumber,
        input.supplierInvoiceNumber,
        input.invoiceDate,
        input.dueDate,
        input.creditDays,
        amount,
        amount,
        PayableStatus.UNPAID,
        now,
        now,
      ],
    );
    return id;
  }

  /**
   * Apply a payment against a set of payables.
   *
   * Each payable is locked and version-checked before it moves, and an allocation may never
   * exceed what is still outstanding — over-allocating is how a supplier ends up apparently
   * owed a negative amount. Returns the total actually allocated so the caller can record the
   * remainder as an advance rather than silently losing it.
   */
  async allocatePayment(
    db: PoolConnection,
    args: {
      paymentId: string;
      supplierId: string;
      allocations: readonly AllocationInput[];
      paymentAmount: number;
    },
  ): Promise<{ allocatedTotal: number; unallocated: number }> {
    let allocatedTotal = 0;

    for (const allocation of args.allocations) {
      const amount = money(allocation.allocatedAmount);
      if (amount <= 0) {
        throw new ValidationError('A payment allocation must be for a positive amount');
      }

      const payable = await this.lockPayable(db, allocation.accountsPayableId);
      if (payable.supplier_id !== args.supplierId) {
        throw new ValidationError(
          'A payment cannot be allocated to another supplier’s invoice',
        );
      }
      if (payable.status === PayableStatus.CANCELLED) {
        throw new ConflictError(`Payable ${payable.document_number} has been cancelled`);
      }

      const outstanding = money(Number(payable.outstanding_amount));
      if (amount > outstanding) {
        throw new ValidationError(
          `Cannot allocate ${amount} to ${payable.document_number}: only ${outstanding} is outstanding`,
        );
      }

      const paid = money(Number(payable.paid_amount) + amount);
      const newOutstanding = money(outstanding - amount);

      await mutate(
        db,
        `INSERT INTO vendor_payment_allocations
           (id, payment_id, accounts_payable_id, purchase_invoice_id, allocated_amount, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          newId(),
          args.paymentId,
          payable.id,
          payable.purchase_invoice_id,
          amount,
          toDbDateTime(),
        ],
      );

      await this.applyPayableMovement(db, payable, { paidAmount: paid, outstanding: newOutstanding });
      await this.syncInvoicePayment(db, payable.purchase_invoice_id, paid, newOutstanding);

      allocatedTotal = money(allocatedTotal + amount);
    }

    const paymentAmount = money(args.paymentAmount);
    if (allocatedTotal > paymentAmount) {
      throw new ValidationError(
        `Allocations total ${allocatedTotal} but the payment is only ${paymentAmount}`,
      );
    }

    return { allocatedTotal, unallocated: money(paymentAmount - allocatedTotal) };
  }

  /**
   * Reduce a payable by something other than money — a return, or a debit/credit memo.
   *
   * Tracked separately from `paid_amount` so a statement can still show what was actually
   * paid versus what was written off against goods going back.
   */
  async adjustPayable(
    db: PoolConnection,
    payableId: string,
    amount: number,
  ): Promise<void> {
    const value = money(amount);
    if (value <= 0) throw new ValidationError('A payable adjustment must be positive');

    const payable = await this.lockPayable(db, payableId);
    const outstanding = money(Number(payable.outstanding_amount));
    if (value > outstanding) {
      throw new ValidationError(
        `Cannot adjust ${value} against ${payable.document_number}: only ${outstanding} is outstanding`,
      );
    }

    const adjusted = money(Number(payable.adjusted_amount) + value);
    const newOutstanding = money(outstanding - value);
    await this.applyPayableMovement(db, payable, {
      adjustedAmount: adjusted,
      outstanding: newOutstanding,
    });
    await this.syncInvoicePayment(
      db,
      payable.purchase_invoice_id,
      money(Number(payable.paid_amount)),
      newOutstanding,
    );
  }

  /** Whether this method settles on the spot or leaves a liability behind. */
  isImmediate(method: PurchasePaymentMethod): boolean {
    return method !== PurchasePaymentMethod.CREDIT;
  }

  /**
   * Compute a due date. An immediate method is due the day it is raised; credit adds the
   * supplier's terms, falling back to whatever the document itself specified.
   */
  resolveDueDate(
    invoiceDate: IsoDate,
    method: PurchasePaymentMethod,
    creditDays: number,
  ): IsoDate {
    if (this.isImmediate(method) || creditDays <= 0) return invoiceDate;
    const date = new Date(`${invoiceDate}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + creditDays);
    return date.toISOString().slice(0, 10);
  }

  /** A supplier's statement rows, oldest first. */
  async listStatement(
    db: Db,
    supplierId: string,
    range: { from?: IsoDate; to?: IsoDate; limit: number; offset: number },
  ): Promise<RowDataPacket[]> {
    const conditions = ['vle.supplier_id = ?'];
    const params: unknown[] = [supplierId];
    if (range.from !== undefined) {
      conditions.push('vle.business_date >= ?');
      params.push(range.from);
    }
    if (range.to !== undefined) {
      conditions.push('vle.business_date <= ?');
      params.push(range.to);
    }
    return selectRows(
      db,
      `SELECT vle.*, u.name AS actor_name
         FROM vendor_ledger_entries vle
         LEFT JOIN users u ON u.id = vle.actor_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY vle.entry_seq ASC
        LIMIT ? OFFSET ?`,
      [...params, range.limit, range.offset],
    );
  }

  /**
   * The supplier's balance immediately before a date — the opening figure on a statement.
   * Derived from the ledger rather than read from a cache, because a statement that does not
   * reconcile to the ledger is worse than no statement.
   */
  async openingBalance(db: Db, supplierId: string, before: IsoDate): Promise<number> {
    const row = await selectOne<RowDataPacket & { opening: string | null }>(
      db,
      `SELECT COALESCE(SUM(credit_amount) - SUM(debit_amount), 0) AS opening
         FROM vendor_ledger_entries
        WHERE supplier_id = ? AND business_date < ?`,
      [supplierId, before],
    );
    return row === null || row.opening === null ? 0 : money(Number(row.opening));
  }

  /** Refuse to post the same document into the ledger twice. */
  async assertNotAlreadyPosted(db: Db, sourceType: string, sourceId: string): Promise<void> {
    const row = await selectOne<RowDataPacket & { total: string }>(
      db,
      'SELECT COUNT(*) AS total FROM vendor_ledger_entries WHERE source_type = ? AND source_id = ?',
      [sourceType, sourceId],
    );
    if (row !== null && Number(row.total) > 0) {
      throw new ConflictError(
        'This document has already been posted to the vendor ledger. Reverse it rather than posting it again.',
      );
    }
  }

  /* ------------------------------------------------------------------- internals */

  private async lockSupplier(db: PoolConnection, supplierId: string): Promise<SupplierBalanceRow> {
    const row = await selectOne<SupplierBalanceRow>(
      db,
      `SELECT id, name, account_balance, vendor_credit_days, vendor_is_approved
         FROM entities WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
      [supplierId],
    );
    if (row === null) throw new ValidationError(`Unknown supplier ${supplierId}`);
    return row;
  }

  private async lockPayable(db: PoolConnection, payableId: string): Promise<PayableRow> {
    const row = await selectOne<PayableRow>(
      db,
      'SELECT * FROM accounts_payable WHERE id = ? FOR UPDATE',
      [payableId],
    );
    if (row === null) throw new ValidationError(`Unknown payable ${payableId}`);
    return row;
  }

  /**
   * Write a payable's new position, deriving the status from the amounts rather than trusting a
   * caller to keep the two in step. OVERDUE is deliberately not stored — it is a function of
   * today's date and would otherwise need a nightly job to stay true.
   */
  private async applyPayableMovement(
    db: PoolConnection,
    payable: PayableRow,
    next: { paidAmount?: number; adjustedAmount?: number; outstanding: number },
  ): Promise<void> {
    const paid = next.paidAmount ?? money(Number(payable.paid_amount));
    const adjusted = next.adjustedAmount ?? money(Number(payable.adjusted_amount));
    const outstanding = money(next.outstanding);

    const status =
      outstanding <= 0
        ? PayableStatus.PAID
        : paid > 0 || adjusted > 0
          ? PayableStatus.PARTIALLY_PAID
          : PayableStatus.UNPAID;

    const result = await mutate(
      db,
      `UPDATE accounts_payable
          SET paid_amount = ?, adjusted_amount = ?, outstanding_amount = ?, status = ?,
              updated_at = ?, version = version + 1
        WHERE id = ? AND version = ?`,
      [paid, adjusted, outstanding, status, toDbDateTime(), payable.id, payable.version],
    );
    if (result.affectedRows === 0) {
      throw new ConflictError(
        `Payable ${payable.document_number} changed while it was being settled; retry`,
      );
    }
  }

  /** Keep the invoice's own paid/outstanding figures in step with its payable. */
  private async syncInvoicePayment(
    db: PoolConnection,
    invoiceId: string,
    paidAmount: number,
    outstanding: number,
  ): Promise<void> {
    const status =
      outstanding <= 0
        ? PayableStatus.PAID
        : paidAmount > 0
          ? PayableStatus.PARTIALLY_PAID
          : PayableStatus.UNPAID;

    await mutate(
      db,
      `UPDATE purchase_invoices
          SET paid_amount = ?, outstanding_amount = ?, payment_status = ?, updated_at = ?
        WHERE id = ?`,
      [paidAmount, outstanding, status, toDbDateTime(), invoiceId],
    );
  }
}

export const vendorLedgerService = new VendorLedgerService();
