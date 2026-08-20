import {
  ACTIVE_POS_ORDER_STATUSES,
  canTransitionPosOrderStatus,
  ENTITY_REQUIRED_PAYMENT_METHODS,
  LIMITS,
  POS_ORDER_NUMBER,
  PosDiscountType,
  PosOrderStatus,
  PosOrderType,
  PosPaymentMethod,
  PosPaymentStatus,
  type CreatePosOrderRequest,
  type PosAnalyticsQuery,
  type PosBusyHourDto,
  type PosCheckoutRequest,
  type PosCounterLoadDto,
  type PosDashboardDto,
  type PosDashboardSummaryDto,
  type PosOrderDetailDto,
  type PosOrderDto,
  type PosOrderItemInput,
  type PosOrderListQuery,
  type PosSalesSummaryDto,
  type PosTopItemDto,
  type PosVoidRequest,
  type UpdatePosOrderRequest,
  type UpdatePosOrderStatusRequest,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { Db } from '../db/types';
import type { PosOrderRow } from '../models/rows';
import { mapPosOrder, mapPosOrderItem, mapPosPayment } from '../models/mappers';
import { entityRepository } from '../repositories/EntityRepository';
import {
  posRepository,
  type InsertPosOrderItemInput,
  type InsertPosPaymentInput,
  type PosAnalyticsRange,
  type PosOrderListFilter,
  type PosOrderTotals,
  type PosSalesTotalsRow,
} from '../repositories/PosRepository';
import { settingsRepository } from '../repositories/SettingsRepository';
import {
  ConflictError,
  ForbiddenError,
  InvalidStatusTransitionError,
  NotFoundError,
  StaleWriteError,
  ValidationError,
} from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { logger } from '../utils/logger';
import { addDays, fromDbDate, toDbDateTime, todayIsoDate } from '../utils/time';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { kdsService } from './KdsService';
import {
  applyTax,
  isInterStateSupply,
  money,
  resolvePrice,
  taxTreatmentFrom,
  type TaxTreatment,
} from './posPricing';

/**
 * The till.
 *
 * Three rules shape everything below:
 *
 * 1. **The client never sets money.** It sends a menu item, a variant, a quantity and at most
 *    a discount instruction. Price, tax split and every total are resolved here from the Menu
 *    Master and the line's tax profile, so a crafted request cannot sell a dish for nothing.
 * 2. **A settled bill is immutable.** COMPLETED and CANCELLED tickets are not edited; a
 *    mistake is reversed by `voidOrder`, which writes offsetting payment rows and leaves the
 *    original ones in place. The payment ledger is append-only.
 * 3. **Rounding happens exactly once**, at the bill total, and only to whole rupees. Rounding
 *    per line would let a twenty-line ticket drift by a rupee against its own arithmetic.
 */

export interface PosScope {
  businessDate?: string;
  stationId?: string;
  counterId?: string;
}

/** How many best sellers the Top Selling Items widget asks for unless it says otherwise. */
const DEFAULT_TOP_ITEMS = 5;
const MAX_TOP_ITEMS = 25;

interface ResolvedLine extends InsertPosOrderItemInput { }

export class PosService {
  /* --------------------------------------------------------------- reading */

  async list(query: PosOrderListQuery) {
    const { page, pageSize, offset } = resolvePaging(query);
    const filter: PosOrderListFilter = {
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.orderType !== undefined ? { orderType: query.orderType } : {}),
      ...(query.paymentStatus !== undefined ? { paymentStatus: query.paymentStatus } : {}),
      ...(query.entityId !== undefined ? { entityId: query.entityId } : {}),
      ...(query.stationId !== undefined ? { stationId: query.stationId } : {}),
      ...(query.counterId !== undefined ? { counterId: query.counterId } : {}),
      ...(query.named !== undefined ? { named: query.named } : {}),
      ...(query.dateFrom !== undefined ? { dateFrom: query.dateFrom } : {}),
      ...(query.dateTo !== undefined ? { dateTo: query.dateTo } : {}),
      ...(query.search !== undefined ? { search: query.search } : {}),
      limit: pageSize,
      offset,
    };
    const { rows, total } = await posRepository.list(getPool(), filter);
    return buildPage(rows.map(mapPosOrder), total, page, pageSize);
  }

  async getDetail(id: string, db: Db = getPool()): Promise<PosOrderDetailDto> {
    const row = await posRepository.findById(db, id);
    if (row === null) throw new NotFoundError('POS order', id);

    const [items, payments] = await Promise.all([
      posRepository.listItems(db, id),
      posRepository.listPayments(db, id),
    ]);

    return {
      ...mapPosOrder(row),
      items: items.map(mapPosOrderItem),
      payments: payments.map(mapPosPayment),
    };
  }

  /**
   * Everything the POS dashboard renders, in one round trip.
   *
   * The five buckets are deliberately overlapping views of the same active set rather than
   * disjoint queries: a scheduled order raised in a customer's name belongs on both the
   * Scheduled tile and the Named tile, because an operator looking for it will look in either.
   */
  async dashboard(scope: PosScope): Promise<PosDashboardDto> {
    const pool = getPool();
    const businessDate = scope.businessDate ?? todayIsoDate();
    const scopeFilter = {
      ...(scope.stationId !== undefined ? { stationId: scope.stationId } : {}),
      ...(scope.counterId !== undefined ? { counterId: scope.counterId } : {}),
    };

    const [counts, salesToday, salesByMethod, counterLoadRows, drafts, scheduled, takeaway, named, open] =
      await Promise.all([
        posRepository.dashboardCounts(pool, businessDate, scopeFilter),
        posRepository.salesTotalForDate(pool, businessDate),
        posRepository.salesByPaymentMethodForDate(pool, businessDate),
        posRepository.counterLoad(pool, scopeFilter),
        this.bucket(pool, { ...scopeFilter, status: [PosOrderStatus.DRAFT] }),
        this.bucket(pool, { ...scopeFilter, status: [PosOrderStatus.SCHEDULED] }),
        this.bucket(pool, {
          ...scopeFilter,
          status: [PosOrderStatus.OPEN, PosOrderStatus.SCHEDULED],
          orderType: [PosOrderType.TAKEAWAY],
        }),
        this.bucket(pool, {
          ...scopeFilter,
          status: [...ACTIVE_POS_ORDER_STATUSES],
          named: true,
        }),
        this.bucket(pool, { ...scopeFilter, status: [PosOrderStatus.OPEN] }),
      ]);

    const salesTodayByMethod: Record<PosPaymentMethod, number> = {
      [PosPaymentMethod.CASH]: 0,
      [PosPaymentMethod.CARD]: 0,
      [PosPaymentMethod.UPI]: 0,
      [PosPaymentMethod.WALLET]: 0,
      [PosPaymentMethod.ACCOUNT]: 0,
      [PosPaymentMethod.COMPLIMENTARY]: 0,
    };
    for (const [method, amount] of Object.entries(salesByMethod)) {
      if (amount !== undefined) {
        salesTodayByMethod[method as PosPaymentMethod] = money(amount);
      }
    }

    const summary: PosDashboardSummaryDto = {
      businessDate,
      draftCount: 0,
      scheduledCount: 0,
      openCount: 0,
      takeawayCount: 0,
      dineInCount: 0,
      deliveryCount: 0,
      quickSaleCount: 0,
      namedCount: 0,
      completedToday: 0,
      cancelledToday: 0,
      salesToday: money(salesToday),
      salesTodayByMethod,
      outstandingAmount: 0,
    };

    for (const row of counts) {
      const total = Number(row.total);
      switch (row.status) {
        case PosOrderStatus.DRAFT:
          summary.draftCount += total;
          break;
        case PosOrderStatus.SCHEDULED:
          summary.scheduledCount += total;
          break;
        case PosOrderStatus.OPEN:
          summary.openCount += total;
          break;
        case PosOrderStatus.COMPLETED:
          summary.completedToday += total;
          break;
        case PosOrderStatus.CANCELLED:
          summary.cancelledToday += total;
          break;
      }

      const active = (ACTIVE_POS_ORDER_STATUSES as readonly string[]).includes(row.status);
      if (!active) continue;

      summary.outstandingAmount += Number(row.balance_amount);
      if (row.is_named === 1) summary.namedCount += total;
      switch (row.order_type) {
        case PosOrderType.TAKEAWAY:
          summary.takeawayCount += total;
          break;
        case PosOrderType.DINE_IN:
          summary.dineInCount += total;
          break;
        case PosOrderType.DELIVERY:
          summary.deliveryCount += total;
          break;
        case PosOrderType.QUICK_SALE:
          summary.quickSaleCount += total;
          break;
      }
    }
    summary.outstandingAmount = money(summary.outstandingAmount);

    const counterLoad: PosCounterLoadDto[] = counterLoadRows.map((row) => ({
      counterId: row.counter_id,
      code: row.code,
      name: row.name,
      activeCount: Number(row.active_count),
      openAmount: money(Number(row.open_amount)),
    }));

    return { summary, counterLoad, drafts, scheduled, takeaway, named, open };
  }

  private async bucket(db: Db, filter: Omit<PosOrderListFilter, 'limit' | 'offset'>): Promise<PosOrderDto[]> {
    // A counter that has more than this many tickets of one kind open has a bigger problem
    // than pagination; the tile is a work queue, not an archive.
    const { rows } = await posRepository.list(db, { ...filter, limit: 100, offset: 0 });
    return rows.map(mapPosOrder);
  }

  /* ------------------------------------------------------------- analytics */

  /**
   * Takings over a business-date range, against the equally long range before it.
   *
   * The comparison window is derived rather than requested, so "down on the previous period"
   * always means the same thing however wide a range the reader picked.
   */
  async salesSummary(query: PosAnalyticsQuery): Promise<PosSalesSummaryDto> {
    const range = assertAnalyticsRange(query);
    const pool = getPool();

    const [totalsRow, dayRows, itemTotalsRow, previousTotalsRow] = await Promise.all([
      posRepository.salesTotals(pool, range),
      posRepository.salesByDay(pool, range),
      posRepository.itemTotals(pool, range),
      posRepository.salesTotals(pool, precedingRange(range)),
    ]);

    const current = readSalesTotals(totalsRow);
    const previous = readSalesTotals(previousTotalsRow);

    return {
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      netSales: current.netSales,
      grossSales: current.grossSales,
      refundedAmount: current.refundedAmount,
      transactionCount: current.transactionCount,
      averageTicket: averageTicket(current.netSales, current.transactionCount),
      itemsSold: itemTotalsRow === null ? 0 : Number(itemTotalsRow.items_sold),
      discountAmount: itemTotalsRow === null ? 0 : money(Number(itemTotalsRow.discount_amount)),
      taxAmount: itemTotalsRow === null ? 0 : money(Number(itemTotalsRow.tax_amount)),
      previous: {
        netSales: previous.netSales,
        transactionCount: previous.transactionCount,
        averageTicket: averageTicket(previous.netSales, previous.transactionCount),
      },
      series: dayRows.map((row) => ({
        businessDate: fromDbDate(row.business_date) as string,
        netSales: money(Number(row.net_sales)),
        transactionCount: Number(row.transaction_count),
      })),
    };
  }

  /**
   * The best sellers of the range.
   *
   * `share` is taken over the rows returned, not over the range's whole item revenue, so the
   * proportions add up to the list the reader is actually looking at.
   */
  async topItems(query: PosAnalyticsQuery & { limit?: number }): Promise<PosTopItemDto[]> {
    const range = assertAnalyticsRange(query);
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_TOP_ITEMS, 1), MAX_TOP_ITEMS);
    const rows = await posRepository.topItems(getPool(), range, limit);

    const items = rows.map((row) => ({
      menuItemId: row.menu_item_id,
      itemName: row.item_name,
      variantName: row.variant_name,
      quantity: Number(row.quantity),
      netAmount: money(Number(row.net_amount)),
    }));
    const total = money(items.reduce((sum, item) => sum + item.netAmount, 0));

    return items.map((item) => ({
      ...item,
      share: total === 0 ? 0 : item.netAmount / total,
    }));
  }

  /**
   * Trade by hour of the day. All twenty-four are returned: the hours nothing happened in are
   * the shape of the graph as much as the peaks are, and a caller should not have to infer them.
   */
  async busyHours(query: PosAnalyticsQuery): Promise<PosBusyHourDto[]> {
    const range = assertAnalyticsRange(query);
    const rows = await posRepository.busyHours(getPool(), range);
    const byHour = new Map(rows.map((row) => [Number(row.hour), row] as const));

    return Array.from({ length: 24 }, (_unused, hour) => {
      const row = byHour.get(hour);
      return {
        hour,
        transactionCount: row === undefined ? 0 : Number(row.transaction_count),
        netSales: row === undefined ? 0 : money(Number(row.net_sales)),
      };
    });
  }

  /* -------------------------------------------------------------- creation */

  async create(input: CreatePosOrderRequest, actor: AuditActor & { userId: string }) {
    const id = input.id ?? newId();
    const status = input.status ?? PosOrderStatus.OPEN;

    await withTransaction(async (connection) => {
      const entity = await this.resolveEntity(connection, input.entityId ?? null);
      this.assertNamingIsCoherent(input.orderType, input.entityId ?? null, input.entityName ?? null);

      const businessDate = todayIsoDate();
      const dailySequence = await posRepository.nextDailySequence(connection, businessDate);

      await posRepository.insert(connection, {
        id,
        orderNumber: buildPosOrderNumber(businessDate, dailySequence),
        dailySequence,
        businessDate,
        orderType: input.orderType,
        status,
        stationId: input.stationId ?? null,
        counterId: input.counterId ?? null,
        menuId: input.menuId ?? null,
        entityId: input.entityId ?? null,
        entityType: entity?.type ?? null,
        entityName: entity?.name ?? input.entityName ?? null,
        entityPhone: entity?.phone ?? input.entityPhone ?? null,
        entityAddress: entity?.address ?? input.entityAddress ?? null,
        tableLabel: input.tableLabel ?? null,
        pax: input.pax ?? 0,
        scheduledFor: input.scheduledFor === null || input.scheduledFor === undefined
          ? null
          : toDbDateTime(new Date(input.scheduledFor)),
        notes: input.notes ?? null,
        discountType: input.discountType ?? PosDiscountType.NONE,
        discountValue: input.discountValue ?? 0,
        createdBy: actor.userId,
      });

      await this.applyItemsAndTotals(connection, id, input.items, {
        discountType: input.discountType ?? PosDiscountType.NONE,
        discountValue: input.discountValue ?? 0,
        menuId: input.menuId ?? null,
        entityDiscountPercent: entity === null ? 0 : Number(entity.discount_percent),
        entityStateCode: entity?.state_code ?? null,
      });

      if (status !== PosOrderStatus.DRAFT) {
        await posRepository.updateStatus(connection, id, { status, placedAt: toDbDateTime() }, actor.userId);
      }

      await auditService.record(connection, actor, {
        action: AuditAction.POS_ORDER_CREATED,
        entityType: 'pos_order',
        entityId: id,
        after: { orderType: input.orderType, status, itemCount: input.items.length },
      });
    });

    await this.announceKdsChange(id);
    return this.getDetail(id);
  }

  async update(id: string, input: UpdatePosOrderRequest, actor: AuditActor & { userId: string }) {
    await withTransaction(async (connection) => {
      const before = await this.loadEditable(connection, id);
      if (input.expectedRevision !== undefined && before.revision !== input.expectedRevision) {
        throw new StaleWriteError(Number(before.revision));
      }

      const entityId = input.entityId === undefined ? before.entity_id : input.entityId;
      const entity = await this.resolveEntity(connection, entityId);
      const orderType = input.orderType ?? before.order_type;
      this.assertNamingIsCoherent(
        orderType,
        entityId,
        input.entityName === undefined ? before.entity_name : input.entityName,
      );

      await posRepository.updateHeader(
        connection,
        id,
        {
          ...(input.orderType !== undefined ? { orderType: input.orderType } : {}),
          ...(input.stationId !== undefined ? { stationId: input.stationId } : {}),
          ...(input.counterId !== undefined ? { counterId: input.counterId } : {}),
          ...(input.menuId !== undefined ? { menuId: input.menuId } : {}),
          ...(input.entityId !== undefined
            ? {
              entityId: input.entityId,
              entityType: entity?.type ?? null,
              entityName: entity?.name ?? input.entityName ?? null,
              entityPhone: entity?.phone ?? input.entityPhone ?? null,
              entityAddress: entity?.address ?? input.entityAddress ?? null,
            }
            : {
              ...(input.entityName !== undefined ? { entityName: input.entityName } : {}),
              ...(input.entityPhone !== undefined ? { entityPhone: input.entityPhone } : {}),
              ...(input.entityAddress !== undefined ? { entityAddress: input.entityAddress } : {}),
            }),
          ...(input.tableLabel !== undefined ? { tableLabel: input.tableLabel } : {}),
          ...(input.pax !== undefined ? { pax: input.pax } : {}),
          ...(input.scheduledFor !== undefined
            ? {
              scheduledFor:
                input.scheduledFor === null ? null : toDbDateTime(new Date(input.scheduledFor)),
            }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.discountType !== undefined ? { discountType: input.discountType } : {}),
          ...(input.discountValue !== undefined ? { discountValue: input.discountValue } : {}),
        },
        actor.userId,
      );

      // Items and the bill discount both move the totals, so recompute whenever either could
      // have changed — cheaper than working out whether it actually did.
      const items =
        input.items ??
        (await posRepository.listItems(connection, id))
          .filter((row) => row.status === 'ACTIVE')
          .map<PosOrderItemInput>((row) => ({
            ...(row.menu_item_id !== null ? { menuItemId: row.menu_item_id } : {}),
            ...(row.variant_id !== null ? { variantId: row.variant_id } : {}),
            ...(row.custom_item_name !== null
              ? { customItemName: row.custom_item_name, unitPrice: Number(row.unit_price) }
              : {}),
            quantity: Number(row.quantity),
            unit: row.unit,
            discountType: row.discount_type,
            discountValue: Number(row.discount_value),
            notes: row.notes,
            sortOrder: Number(row.sort_order),
          }));

      await this.applyItemsAndTotals(connection, id, items, {
        discountType: input.discountType ?? before.discount_type,
        discountValue: input.discountValue ?? Number(before.discount_value),
        menuId: input.menuId === undefined ? before.menu_id : input.menuId,
        entityDiscountPercent: entity === null ? 0 : Number(entity.discount_percent),
        entityStateCode: entity?.state_code ?? null,
      });

      await auditService.record(connection, actor, {
        action: AuditAction.POS_ORDER_UPDATED,
        entityType: 'pos_order',
        entityId: id,
        before: { status: before.status, totalAmount: Number(before.total_amount) },
        after: { itemCount: items.length },
      });
    });

    await this.announceKdsChange(id);
    return this.getDetail(id);
  }

  async updateStatus(
    id: string,
    input: UpdatePosOrderStatusRequest,
    actor: AuditActor & { userId: string },
  ) {
    await withTransaction(async (connection) => {
      const before = await posRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('POS order', id);

      if (!canTransitionPosOrderStatus(before.status, input.status)) {
        throw new InvalidStatusTransitionError(before.status, input.status);
      }
      if (input.status === PosOrderStatus.COMPLETED) {
        throw new ConflictError('Complete a POS order by checking it out, not by setting status');
      }

      const activeItems = (await posRepository.listItems(connection, id)).filter(
        (row) => row.status === 'ACTIVE',
      );
      if (input.status !== PosOrderStatus.DRAFT && input.status !== PosOrderStatus.CANCELLED && activeItems.length === 0) {
        throw new ValidationError('Add at least one item before taking the order off draft');
      }

      const now = toDbDateTime();
      await posRepository.updateStatus(
        connection,
        id,
        {
          status: input.status,
          ...(input.status === PosOrderStatus.SCHEDULED
            ? { scheduledFor: toDbDateTime(new Date(input.scheduledFor as string)) }
            : {}),
          ...(input.status === PosOrderStatus.OPEN && before.placed_at === null
            ? { placedAt: now }
            : {}),
          ...(input.status === PosOrderStatus.CANCELLED
            ? {
              cancelledAt: now,
              cancelReason: input.reason ?? null,
              paymentStatus: PosPaymentStatus.VOIDED,
            }
            : {}),
        },
        actor.userId,
      );

      if (input.status === PosOrderStatus.CANCELLED) {
        await posRepository.cancelItems(connection, id, actor.userId);
      }

      await auditService.record(connection, actor, {
        action: AuditAction.POS_ORDER_STATUS_CHANGED,
        entityType: 'pos_order',
        entityId: id,
        before: { status: before.status },
        after: { status: input.status, reason: input.reason ?? null },
      });
    });

    await this.announceKdsChange(id);
    return this.getDetail(id);
  }

  /* -------------------------------------------------------------- checkout */

  /**
   * Settles the ticket.
   *
   * The payment total must match the bill to the paisa. Under-tendering is a partial payment
   * the operator has to make deliberate, not something the till infers, so it is refused
   * here; over-tendering in cash is change, which is computed and returned.
   */
  async checkout(id: string, input: PosCheckoutRequest, actor: AuditActor & { userId: string }) {
    await withTransaction(async (connection) => {
      const before = await posRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('POS order', id);
      if (before.status === PosOrderStatus.COMPLETED) {
        throw new ConflictError('This order has already been settled');
      }
      if (before.status === PosOrderStatus.CANCELLED) {
        throw new ConflictError('A cancelled order cannot be settled');
      }
      if (input.expectedRevision !== undefined && before.revision !== input.expectedRevision) {
        throw new StaleWriteError(Number(before.revision));
      }

      const entity = await this.resolveEntity(connection, before.entity_id);
      const items = (await posRepository.listItems(connection, id)).filter(
        (row) => row.status === 'ACTIVE',
      );
      if (items.length === 0) {
        throw new ValidationError('An order with no items cannot be settled');
      }

      // Re-price from the stored lines so a discount applied at the till lands on the same
      // arithmetic the operator saw, without re-reading the catalogue mid-settlement.
      const totals = await this.totalsFor(
        connection,
        items.map((row) => ({
          gross: Number(row.gross_amount),
          discount: Number(row.discount_amount),
          taxable: Number(row.taxable_amount),
          tax: Number(row.tax_amount),
        })),
        {
          discountType: input.discountType ?? before.discount_type,
          discountValue: input.discountValue ?? Number(before.discount_value),
        },
      );

      const paid = money(input.payments.reduce((sum, payment) => sum + payment.amount, 0));
      if (paid !== totals.totalAmount) {
        throw new ValidationError(
          `Payments total ${paid.toFixed(2)} but the bill is ${totals.totalAmount.toFixed(2)}`,
          [{ path: 'payments', message: 'The tendered amounts must settle the bill exactly' }],
        );
      }

      const rows: InsertPosPaymentInput[] = [];
      for (const payment of input.payments) {
        const entityIdForPayment = payment.entityId ?? before.entity_id;
        if (
          (ENTITY_REQUIRED_PAYMENT_METHODS as readonly string[]).includes(payment.method) &&
          entityIdForPayment === null
        ) {
          throw new ValidationError('An account payment needs the account it is charged to', [
            { path: 'payments', message: 'Select a customer, employee or vendor' },
          ]);
        }

        const tendered = payment.tenderedAmount ?? null;
        const change =
          payment.method === PosPaymentMethod.CASH && tendered !== null && tendered > payment.amount
            ? money(tendered - payment.amount)
            : 0;

        rows.push({
          id: newId(),
          posOrderId: id,
          method: payment.method,
          amount: money(payment.amount),
          tenderedAmount: tendered === null ? null : money(tendered),
          changeAmount: change,
          reference: payment.reference ?? null,
          notes: payment.notes ?? null,
          entityId:
            (ENTITY_REQUIRED_PAYMENT_METHODS as readonly string[]).includes(payment.method)
              ? entityIdForPayment
              : (payment.entityId ?? null),
          isReversal: false,
          receivedBy: actor.userId,
        });
      }

      const onAccount = money(
        rows
          .filter((row) => row.method === PosPaymentMethod.ACCOUNT)
          .reduce((sum, row) => sum + row.amount, 0),
      );
      if (onAccount > 0) {
        const accountEntity = entity ?? (await this.resolveEntity(connection, rows.find((r) => r.method === PosPaymentMethod.ACCOUNT)?.entityId ?? null));
        if (accountEntity === null) {
          throw new ValidationError('An account payment needs the account it is charged to');
        }
        const projected = money(Number(accountEntity.account_balance) + onAccount);
        const limit = Number(accountEntity.credit_limit);
        if (limit > 0 && projected > limit) {
          throw new ConflictError(
            `${accountEntity.name} would exceed their credit limit of ${limit.toFixed(2)}`,
          );
        }
        await entityRepository.adjustAccountBalance(connection, accountEntity.id, onAccount);
      }

      await posRepository.insertPayments(connection, rows);
      await posRepository.updateTotals(connection, id, {
        ...totals,
        paidAmount: paid,
        balanceAmount: money(totals.totalAmount - paid),
        paymentStatus: PosPaymentStatus.PAID,
      });
      await posRepository.updateStatus(
        connection,
        id,
        {
          status: PosOrderStatus.COMPLETED,
          completedAt: toDbDateTime(),
          ...(before.placed_at === null ? { placedAt: toDbDateTime() } : {}),
          paymentStatus: PosPaymentStatus.PAID,
        },
        actor.userId,
      );

      await auditService.record(connection, actor, {
        action: AuditAction.POS_ORDER_CHECKED_OUT,
        entityType: 'pos_order',
        entityId: id,
        before: { status: before.status },
        after: {
          totalAmount: totals.totalAmount,
          methods: rows.map((row) => row.method),
        },
      });
    });

    await this.announceKdsChange(id);
    return this.getDetail(id);
  }

  /**
   * Reverses a settled sale.
   *
   * The original payment rows stay exactly as they were; an offsetting negative row is written
   * for each. A ledger you can edit is a ledger nobody can rely on.
   */
  async voidOrder(id: string, input: PosVoidRequest, actor: AuditActor & { userId: string }) {
    await withTransaction(async (connection) => {
      const before = await posRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('POS order', id);
      if (before.status !== PosOrderStatus.COMPLETED) {
        throw new ConflictError('Only a settled order can be voided; cancel an open one instead');
      }

      const payments = await posRepository.listPayments(connection, id);
      const settled = payments.filter((row) => row.is_reversal === 0);
      const now = toDbDateTime();

      await posRepository.insertPayments(
        connection,
        settled.map<InsertPosPaymentInput>((row) => ({
          id: newId(),
          posOrderId: id,
          method: row.method,
          amount: money(-Number(row.amount)),
          tenderedAmount: null,
          changeAmount: 0,
          reference: row.reference,
          notes: input.reason,
          entityId: row.entity_id,
          isReversal: true,
          receivedBy: actor.userId,
        })),
      );

      // Restore the account balance for anything that was charged to one.
      for (const row of settled) {
        if (row.method !== PosPaymentMethod.ACCOUNT || row.entity_id === null) continue;
        await entityRepository.adjustAccountBalance(connection, row.entity_id, -Number(row.amount));
      }

      await posRepository.updateTotals(connection, id, {
        subtotalAmount: Number(before.subtotal_amount),
        discountAmount: Number(before.discount_amount),
        taxAmount: Number(before.tax_amount),
        roundOffAmount: Number(before.round_off_amount),
        totalAmount: Number(before.total_amount),
        paidAmount: 0,
        balanceAmount: 0,
        paymentStatus: PosPaymentStatus.VOIDED,
      });
      await posRepository.updateStatus(
        connection,
        id,
        {
          status: PosOrderStatus.CANCELLED,
          cancelledAt: now,
          cancelReason: input.reason,
          paymentStatus: PosPaymentStatus.VOIDED,
        },
        actor.userId,
      );
      await posRepository.cancelItems(connection, id, actor.userId);

      await auditService.record(connection, actor, {
        action: AuditAction.POS_ORDER_VOIDED,
        entityType: 'pos_order',
        entityId: id,
        before: { totalAmount: Number(before.total_amount), paidAmount: Number(before.paid_amount) },
        after: { reason: input.reason },
      });
    });

    await this.announceKdsChange(id);
    return this.getDetail(id);
  }

  /* ------------------------------------------------------------- internals */

  /**
   * Tells the kitchen and customer displays that this ticket moved. Strictly post-commit and
   * best-effort: a failed broadcast must not fail a sale that already happened — a display
   * that misses the hint simply refetches on its next poll.
   */
  private async announceKdsChange(orderId: string): Promise<void> {
    try {
      await kdsService.notifyPosOrderChanged(orderId);
    } catch (error) {
      logger.warn('KDS notification failed', { orderId }, error);
    }
  }

  /** A ticket may only be edited while it is still on the counter. */
  private async loadEditable(db: Db, id: string): Promise<PosOrderRow> {
    const row = await posRepository.findById(db, id);
    if (row === null) throw new NotFoundError('POS order', id);
    if (!(ACTIVE_POS_ORDER_STATUSES as readonly string[]).includes(row.status)) {
      throw new ForbiddenError(
        `A ${row.status.toLowerCase()} order can no longer be edited`,
      );
    }
    return row;
  }

  private assertNamingIsCoherent(
    orderType: PosOrderType,
    entityId: string | null,
    entityName: string | null,
  ): void {
    if (orderType !== PosOrderType.QUICK_SALE) return;
    if (entityId !== null || (entityName !== null && entityName !== '')) {
      throw new ValidationError(
        'A quick sale is anonymous — choose Takeaway, Dine-in or Delivery to name the order',
        [{ path: 'orderType', message: 'Quick sales cannot carry an entity' }],
      );
    }
  }

  private async resolveEntity(db: Db, entityId: string | null) {
    if (entityId === null) return null;
    const row = await entityRepository.findById(db, entityId);
    if (row === null) throw new NotFoundError('Entity', entityId);
    return row;
  }

  /**
   * Prices every line, writes them, and recomputes the bill.
   *
   * The entity's standing discount is applied as a line discount wherever the operator did not
   * set one of their own — an explicit discount at the counter always wins over the standing
   * rate, because the operator can see the customer and the master cannot.
   */
  private async applyItemsAndTotals(
    db: Db,
    posOrderId: string,
    items: PosOrderItemInput[],
    context: {
      discountType: PosDiscountType;
      discountValue: number;
      menuId: string | null;
      entityDiscountPercent: number;
      entityStateCode: string | null;
    },
  ): Promise<void> {
    const interState = await this.isInterState(db, context.entityStateCode);
    const lines: ResolvedLine[] = [];

    for (const [index, item] of items.entries()) {
      lines.push(
        await this.resolveLine(db, item, index, {
          menuId: context.menuId,
          entityDiscountPercent: context.entityDiscountPercent,
          interState,
        }),
      );
    }

    await posRepository.replaceItems(db, posOrderId, lines);

    const totals = await this.totalsFor(
      db,
      lines.map((line) => ({
        gross: line.grossAmount,
        discount: line.discountAmount,
        taxable: line.taxableAmount,
        tax: line.taxAmount,
      })),
      { discountType: context.discountType, discountValue: context.discountValue },
    );

    const payments = await posRepository.listPayments(db, posOrderId);
    const paid = money(payments.reduce((sum, row) => sum + Number(row.amount), 0));

    await posRepository.updateTotals(db, posOrderId, {
      ...totals,
      paidAmount: paid,
      balanceAmount: money(totals.totalAmount - paid),
      paymentStatus:
        paid <= 0
          ? PosPaymentStatus.UNPAID
          : paid >= totals.totalAmount
            ? PosPaymentStatus.PAID
            : PosPaymentStatus.PARTIAL,
    });
  }

  private async resolveLine(
    db: Db,
    item: PosOrderItemInput,
    index: number,
    context: { menuId: string | null; entityDiscountPercent: number; interState: boolean },
  ): Promise<ResolvedLine> {
    const quantity = item.quantity;
    let itemName: string;
    let variantName: string | null = null;
    let unit = item.unit ?? 'NOS';
    let unitPrice: number;
    let treatment: TaxTreatment;
    let allowDecimalQuantity = false;

    if (item.menuItemId !== null && item.menuItemId !== undefined) {
      const sellable = await posRepository.resolveSellable(db, {
        menuItemId: item.menuItemId,
        variantId: item.variantId ?? null,
        menuId: context.menuId,
      });
      if (sellable === null) {
        throw new ValidationError('That menu item is no longer available', [
          { path: `items.${index}.menuItemId`, message: 'Unknown menu item' },
        ]);
      }
      if (item.variantId !== null && item.variantId !== undefined && sellable.variant_id === null) {
        throw new ValidationError('That variant does not belong to the selected menu item', [
          { path: `items.${index}.variantId`, message: 'Unknown variant' },
        ]);
      }

      itemName = sellable.item_name;
      variantName = sellable.variant_name;
      unit = item.unit ?? sellable.variant_unit ?? sellable.item_unit;
      allowDecimalQuantity = sellable.allow_decimal_quantity === 1;
      unitPrice = item.unitPrice ?? resolvePrice(sellable);
      treatment = taxTreatmentFrom(sellable, context.interState);
    } else {
      itemName = (item.customItemName as string).trim();
      unitPrice = item.unitPrice ?? 0;
      // An ad-hoc line has no catalogue row and therefore no tax profile to inherit. Charging
      // it at zero tax is the only defensible default: inventing a rate would be a guess
      // printed on a GST bill.
      treatment = {
        taxProfileId: null,
        rate: 0,
        cessRate: 0,
        cgstRate: 0,
        sgstRate: 0,
        igstRate: 0,
        priceIsInclusive: true,
        interState: context.interState,
      };
    }

    const grossAmount = money(quantity * unitPrice);

    // The operator's own discount, else the entity's standing rate.
    const discountType =
      item.discountType !== undefined && item.discountType !== PosDiscountType.NONE
        ? item.discountType
        : context.entityDiscountPercent > 0
          ? PosDiscountType.PERCENT
          : PosDiscountType.NONE;
    const discountValue =
      item.discountType !== undefined && item.discountType !== PosDiscountType.NONE
        ? (item.discountValue ?? 0)
        : context.entityDiscountPercent;
    const discountAmount = money(
      Math.min(
        grossAmount,
        discountType === PosDiscountType.PERCENT
          ? (grossAmount * discountValue) / 100
          : discountType === PosDiscountType.AMOUNT
            ? discountValue
            : 0,
      ),
    );

    const net = money(grossAmount - discountAmount);
    const tax = applyTax(net, treatment);

    return {
      id: item.id ?? newId(),
      menuItemId: item.menuItemId ?? null,
      variantId: item.variantId ?? null,
      customItemName: item.customItemName ?? null,
      itemName,
      variantName,
      quantity,
      unit: unit.slice(0, LIMITS.UNIT_MAX),
      allowDecimalQuantity,
      unitPrice: money(unitPrice),
      grossAmount,
      discountType,
      discountValue,
      discountAmount,
      taxableAmount: tax.taxableAmount,
      taxProfileId: treatment.taxProfileId,
      taxRate: treatment.rate,
      cgstAmount: tax.cgstAmount,
      sgstAmount: tax.sgstAmount,
      igstAmount: tax.igstAmount,
      cessAmount: tax.cessAmount,
      taxAmount: tax.taxAmount,
      lineTotal: tax.lineTotal,
      notes: item.notes ?? null,
      sortOrder: item.sortOrder ?? index,
    };
  }

  /** Bill-level arithmetic: line sums, the whole-bill discount, then a single round-off. */
  private async totalsFor(
    db: Db,
    lines: { gross: number; discount: number; taxable: number; tax: number }[],
    bill: { discountType: PosDiscountType; discountValue: number },
  ): Promise<Omit<PosOrderTotals, 'paidAmount' | 'balanceAmount' | 'paymentStatus'>> {
    const lineGross = money(lines.reduce((sum, line) => sum + line.gross, 0));
    const lineDiscount = money(lines.reduce((sum, line) => sum + line.discount, 0));
    const taxAmount = money(lines.reduce((sum, line) => sum + line.tax, 0));
    const netOfLines = money(lines.reduce((sum, line) => sum + line.taxable + line.tax, 0));

    const billDiscount = money(
      Math.min(
        netOfLines,
        bill.discountType === PosDiscountType.PERCENT
          ? (netOfLines * bill.discountValue) / 100
          : bill.discountType === PosDiscountType.AMOUNT
            ? bill.discountValue
            : 0,
      ),
    );

    const payable = money(netOfLines - billDiscount);
    const roundOffEnabled = await settingsRepository.getValue<boolean>(
      db,
      'pos.round_off_enabled',
      true,
    );
    const totalAmount = roundOffEnabled ? Math.round(payable) : payable;

    return {
      subtotalAmount: lineGross,
      discountAmount: money(lineDiscount + billDiscount),
      taxAmount,
      roundOffAmount: money(totalAmount - payable),
      totalAmount: money(totalAmount),
    };
  }

  /**
   * CGST+SGST unless the customer is demonstrably in another state.
   *
   * With no home state configured the answer is always intra-state, which is right for a
   * single-site canteen and wrong for nobody: an operation that bills across state lines has
   * to set `pos.home_state_code` before it can be billed correctly, and that is a setting, not
   * a guess the till should make.
   */
  private async isInterState(db: Db, entityStateCode: string | null): Promise<boolean> {
    if (entityStateCode === null || entityStateCode === '') return false;
    const homeState = await settingsRepository.getValue<string>(db, 'pos.home_state_code', '');
    if (homeState === '') return false;
    return isInterStateSupply(homeState, entityStateCode);
  }
}

/** Both ends of an analytics range are inclusive, so an inverted one answers nothing. */
function assertAnalyticsRange(query: PosAnalyticsQuery): PosAnalyticsRange {
  if (query.dateFrom > query.dateTo) {
    throw new ValidationError('The reporting period is inverted', [
      { path: 'dateTo', message: 'The end date must not be before the start date' },
    ]);
  }
  return { dateFrom: query.dateFrom, dateTo: query.dateTo };
}

/** The equally long window ending the day before the one asked for. */
function precedingRange(range: PosAnalyticsRange): PosAnalyticsRange {
  const from = new Date(`${range.dateFrom}T00:00:00.000Z`);
  const to = new Date(`${range.dateTo}T00:00:00.000Z`);
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const previousTo = addDays(from, -1);
  return {
    dateFrom: addDays(previousTo, -(days - 1)).toISOString().slice(0, 10),
    dateTo: previousTo.toISOString().slice(0, 10),
  };
}

function readSalesTotals(row: PosSalesTotalsRow | null) {
  return {
    netSales: row === null ? 0 : money(Number(row.net_sales)),
    grossSales: row === null ? 0 : money(Number(row.gross_sales)),
    refundedAmount: row === null ? 0 : money(Number(row.refunded_amount)),
    transactionCount: row === null ? 0 : Number(row.transaction_count),
  };
}

function averageTicket(netSales: number, transactionCount: number): number {
  return transactionCount === 0 ? 0 : money(netSales / transactionCount);
}

/** `POS-YYYYMMDD-NNNN`, zero-padded so the day's bills sort lexically. */
function buildPosOrderNumber(businessDate: string, sequence: number): string {
  return `${POS_ORDER_NUMBER.PREFIX}-${businessDate.replace(/-/g, '')}-${String(sequence).padStart(POS_ORDER_NUMBER.SEQUENCE_PAD, '0')}`;
}

export const posService = new PosService();
