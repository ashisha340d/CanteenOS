import {
  AlertSoundSlot,
  LIMITS,
  PosDiscountType,
  PosOrderItemStatus,
  PosOrderStatus,
  PosPaymentMethod,
  type AvailabilityStatus,
  type CdsBillDto,
  type KdsConfigDto,
  type KdsExchangeRequest,
  type KdsLineDto,
  type KdsMetricsDto,
  type KdsOrderDto,
  type KdsQueueDto,
  type KdsRecentActionDto,
  type KdsStationKind,
  type KdsStationMenuDto,
  type KdsStationMenuItemDto,
  type KdsStationMenuUpsertRequest,
  type PosOrderDetailDto,
  type PosKdsLineStatus,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { Db } from '../db/types';
import { mapPosOrder, mapPosOrderItem, mapPosPayment } from '../models/mappers';
import { entityRepository } from '../repositories/EntityRepository';
import { kdsRepository, type KdsLineRow, type KdsQueueRow } from '../repositories/KdsRepository';
import {
  menuItemAssignmentRepository,
  menuItemVariantRepository,
  menuRepository,
} from '../repositories/MenuMasterRepository';
import { menuBoardRealtime } from '../realtime/menuBoardSocket';
import { menuShiftSchedulerService } from './MenuShiftSchedulerService';
import {
  posRepository,
  type InsertPosOrderItemInput,
  type SellableRow,
} from '../repositories/PosRepository';
import { alertRepository } from '../repositories/AlertRepository';
import { settingsRepository } from '../repositories/SettingsRepository';
import { realtime } from '../realtime/RealtimeGateway';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { newId } from '../utils/ids';
import { signMenuMediaUrlStable } from '../utils/mediaStorage';
import { fromDbDate, fromDbDateTime, fromDbDateTimeRequired, todayIsoDate } from '../utils/time';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { menuMasterService } from './MenuMasterService';
import { money, resolvePrice, taxTreatmentFrom, type TaxTreatment } from './posPricing';
import { SETTING_DEFINITIONS } from './SettingsService';

/**
 * The kitchen and customer displays.
 *
 * The KDS is a projection over the till, not a second order flow: it never moves money,
 * never changes an order's billing status, and every mutation is a line-level kitchen state
 * (QUEUED → ACKNOWLEDGED → SERVED, with revert the only way back). The one write that
 * touches a billed ticket is `exchange`, and it is built so the settled totals cannot move:
 * the replacement lines are netted to the paisa against the lines they replace.
 */

/**
 * A count running out is nobody's decision — the till simply sold the last portion — so the
 * audit row for it names the system rather than whoever happened to ring up that sale.
 */
const SYSTEM_STOCK_ACTOR = {
  userId: '',
  role: null,
  ip: null,
  userAgent: null,
  requestId: null,
} as unknown as AuditActor & { userId: string };

/** One exchange addition, priced and waiting for its line to be written. */
interface PreparedAddition {
  sellable: SellableRow;
  quantity: number;
  treatment: TaxTreatment;
  line: InsertPosOrderItemInput;
}

export class KdsService {
  /* --------------------------------------------------------------- reading */

  async counterQueue(counterId: string): Promise<KdsQueueDto> {
    const rows = await kdsRepository.listCounterQueue(getPool(), counterId);
    return buildQueue({ counterId }, rows);
  }

  async kitchenQueue(printingGroupId: string): Promise<KdsQueueDto> {
    const rows = await kdsRepository.listKitchenQueue(getPool(), printingGroupId);
    return buildQueue({ printingGroupId }, rows);
  }

  async recentActions(counterId: string): Promise<KdsRecentActionDto[]> {
    const pool = getPool();
    const window = await this.revertWindow(pool);
    const rows = await kdsRepository.listRecentServed(pool, counterId, window);
    return rows.map((row) => ({
      lineId: row.line_id,
      orderId: row.order_id,
      orderNumber: row.order_number,
      itemName: row.item_name,
      variantName: row.variant_name,
      quantity: Number(row.quantity),
      servedAt: fromDbDateTimeRequired(row.served_at),
      servedByName: row.served_by_name,
    }));
  }

  async metrics(counterId: string): Promise<KdsMetricsDto> {
    const pool = getPool();
    const defaultPrepSeconds = await settingsRepository.getValue<number>(
      pool,
      'kds.default_prep_seconds',
      SETTING_DEFINITIONS['kds.default_prep_seconds'].default,
    );

    const [pending, served, overdueLines] = await Promise.all([
      kdsRepository.pendingCounts(pool, counterId),
      kdsRepository.servedTodayCounts(pool, counterId, todayIsoDate()),
      kdsRepository.overdueCount(pool, counterId, defaultPrepSeconds),
    ]);

    return {
      pendingLines: pending === null ? 0 : Number(pending.pending_lines),
      pendingOrders: pending === null ? 0 : Number(pending.pending_orders),
      servedTodayLines: served === null ? 0 : Number(served.served_lines),
      servedTodayOrders: served === null ? 0 : Number(served.served_orders),
      avgServeSeconds:
        served === null || served.avg_serve_seconds === null
          ? null
          : Math.round(Number(served.avg_serve_seconds)),
      overdueLines,
    };
  }

  async config(): Promise<KdsConfigDto> {
    const pool = getPool();
    // The three buzzer slots the front desk uploads on the Alerts page are the KDS tones:
    // NORMAL announces a new order, WARNING is the due-soon call, CRITICAL the overdue repeat.
    // A slot with no file yields null and the display falls back to its synth pattern.
    const [
      sounds,
      defaultPrepSeconds,
      dueSoonSeconds,
      overdueRepeatSeconds,
      revertWindow,
      alarmVolume,
    ] = await Promise.all([
      alertRepository.listSounds(pool),
      settingsRepository.getValue<number>(
        pool, 'kds.default_prep_seconds', SETTING_DEFINITIONS['kds.default_prep_seconds'].default,
      ),
      settingsRepository.getValue<number>(
        pool, 'kds.due_soon_seconds', SETTING_DEFINITIONS['kds.due_soon_seconds'].default,
      ),
      settingsRepository.getValue<number>(
        pool, 'kds.overdue_repeat_seconds', SETTING_DEFINITIONS['kds.overdue_repeat_seconds'].default,
      ),
      settingsRepository.getValue<number>(
        pool, 'kds.revert_window', SETTING_DEFINITIONS['kds.revert_window'].default,
      ),
      settingsRepository.getValue<number>(
        pool, 'kds.alarm_volume', SETTING_DEFINITIONS['kds.alarm_volume'].default,
      ),
    ]);

    // The bytes live at `/sounds/:slot/file` — the bare `/sounds/:slot` is the upload route and
    // answers nothing to a GET, which is exactly how a board ends up silently on its synth.
    const toneFor = (slot: AlertSoundSlot): string | null =>
      sounds.find((sound) => sound.slot === slot && sound.storage_path !== null)
        ? `/api/v1/alerts/sounds/${slot}/file`
        : null;
    // The board's own slot wins; an unfilled board slot borrows the phone buzzer rather than
    // dropping to the synth, so a half-configured system still speaks.
    const boardTone = (own: AlertSoundSlot, shared: AlertSoundSlot): string | null =>
      toneFor(own) ?? toneFor(shared);

    return {
      toneNewOrder: boardTone(AlertSoundSlot.KDS_NEW, AlertSoundSlot.NORMAL),
      toneDueSoon: boardTone(AlertSoundSlot.KDS_ATTENTION, AlertSoundSlot.WARNING),
      toneOverdue: boardTone(AlertSoundSlot.KDS_CRITICAL, AlertSoundSlot.CRITICAL),
      alarmVolume: Math.min(1, Math.max(0, alarmVolume / 100)),
      defaultPrepSeconds,
      dueSoonSeconds,
      overdueRepeatSeconds,
      revertWindow,
    };
  }

  /**
   * The bill a customer display shows at a counter.
   *
   * The QR is not a property of the counter, it is a property of *this* bill: it appears only
   * once the bill is settled by UPI, because that is the moment the customer has something to
   * scan. A cash bill shows a total and a thank-you, never a QR.
   */
  async cdsBill(counterId: string): Promise<CdsBillDto | null> {
    const pool = getPool();
    const holdSeconds = await settingsRepository.getValue<number>(
      pool, 'kds.cds_bill_hold_seconds', SETTING_DEFINITIONS['kds.cds_bill_hold_seconds'].default,
    );
    const order = await kdsRepository.findCdsOrderForCounter(pool, counterId, holdSeconds);
    if (order === null) return null;

    const [items, payments, upiId] = await Promise.all([
      posRepository.listItems(pool, order.id),
      posRepository.listPayments(pool, order.id),
      settingsRepository.getValue<string>(
        pool, 'payments.upi_id', SETTING_DEFINITIONS['payments.upi_id'].default,
      ),
    ]);

    const totalAmount = Number(order.total_amount);
    const isSettled = order.status === PosOrderStatus.COMPLETED;
    // Reversals belong to a void, not to how the customer paid.
    const paymentMethods = [
      ...new Set(payments.filter((row) => row.is_reversal === 0).map((row) => row.method)),
    ];
    const paidByUpi = paymentMethods.includes(PosPaymentMethod.UPI);

    const upiLink =
      isSettled && paidByUpi && upiId !== ''
        ? `upi://pay?pa=${encodeURIComponent(upiId)}&am=${totalAmount.toFixed(2)}&cu=INR` +
        `&tn=${encodeURIComponent(order.order_number)}`
        : null;

    return {
      orderId: order.id,
      orderNumber: order.order_number,
      counterName: order.counter_name,
      lines: items
        .filter((row) => row.status === PosOrderItemStatus.ACTIVE)
        .map((row) => ({
          itemName: row.item_name,
          variantName: row.variant_name,
          quantity: Number(row.quantity),
          lineTotal: Number(row.line_total),
        })),
      subtotalAmount: Number(order.subtotal_amount),
      discountAmount: Number(order.discount_amount),
      taxAmount: Number(order.tax_amount),
      roundOffAmount: Number(order.round_off_amount),
      totalAmount,
      upiLink,
      isSettled,
      paymentMethods,
      updatedAt: fromDbDateTimeRequired(order.updated_at),
    };
  }

  /* -------------------------------------------------------- station pickers */

  /** Just enough for a display's login screen to name the station it stands at. */
  async listCounters(): Promise<{ id: string; name: string; code: string | null }[]> {
    const rows = await kdsRepository.listActiveCounters(getPool());
    return rows.map((row) => ({ id: row.id, name: row.name, code: row.code }));
  }

  async listPrintingGroups(): Promise<{ id: string; name: string; code: string | null }[]> {
    const rows = await kdsRepository.listActivePrintingGroups(getPool());
    return rows.map((row) => ({ id: row.id, name: row.name, code: row.code }));
  }

  /**
   * The counter's sellable menu tree, for the exchange flow. Resolution follows the counter's
   * own recent billing; a brand-new counter falls back to the first published menu.
   */
  async sellables(counterId: string, actor: AuditActor & { userId: string }) {
    const menuId = await kdsRepository.menuIdForCounter(getPool(), counterId);
    if (menuId === null) {
      throw new NotFoundError('Published menu for this counter', counterId);
    }
    const menu = await menuRepository.findById(getPool(), menuId);
    if (menu === null) throw new NotFoundError('Menu', menuId);
    return menuMasterService.getMenuTree(menu.code, actor.userId, () => '');
  }

  /* ------------------------------------------------------- station menu file */

  /**
   * The station's own menu file: every dish this screen is responsible for, with its renames
   * and finished flags laid over the master. The master file is never touched.
   *
   * Scope is the routing table, not one menu: a dish routed to this station belongs here
   * whichever published menu carries it (a counter's dish can easily live on a menu that
   * counter has never billed from), and a dish routed nowhere at all is sold everywhere so it
   * belongs here too. A dish routed only to other stations is not this screen's work.
   */
  async stationMenu(
    stationKind: KdsStationKind,
    stationId: string,
    actor: AuditActor & { userId: string },
  ): Promise<KdsStationMenuDto> {
    const pool = getPool();

    const [routedHere, routedAnywhere, overrides] = await Promise.all([
      stationKind === 'counter'
        ? kdsRepository.menuItemIdsRoutedToCounter(pool, stationId)
        : kdsRepository.menuItemIdsRoutedToPrintingGroup(pool, stationId),
      stationKind === 'counter'
        ? kdsRepository.menuItemIdsWithCounterRoutes(pool)
        : kdsRepository.menuItemIdsWithPrintingRoutes(pool),
      kdsRepository.listStationOverrides(pool, stationKind, stationId),
    ]);
    const here = new Set(routedHere);
    const anywhere = new Set(routedAnywhere);
    const byItem = new Map(overrides.map((row) => [row.menu_item_id, row]));

    // Counted stock is a counter's business, and only for the shift it was counted in.
    const businessDate = todayIsoDate();
    const shift = await menuShiftSchedulerService.currentShift();
    const stock =
      stationKind === 'counter'
        ? await kdsRepository.listStock(pool, stationId, businessDate, shift)
        : [];
    const issued = await kdsRepository.issuedQtyForStock(
      pool,
      stationId,
      businessDate,
      stock.map((row) => ({ menuItemId: row.menu_item_id, registeredAt: row.registered_at })),
    );
    const stockByItem = new Map(stock.map((row) => [row.menu_item_id, row]));

    const rows = await kdsRepository.listStationMenuRows(pool);
    if (rows.length === 0) {
      throw new NotFoundError('Published menu for this station', stationId);
    }

    const items: KdsStationMenuItemDto[] = [];
    const seen = new Set<string>();
    const exhausted: string[] = [];
    for (const row of rows) {
      if (seen.has(row.food_item_id)) continue;
      if (!here.has(row.food_item_id) && anywhere.has(row.food_item_id)) continue;
      seen.add(row.food_item_id);

      const override = byItem.get(row.food_item_id);
      const customName = override?.display_name?.trim() ?? '';
      const counted = stockByItem.get(row.food_item_id);
      const openingQty = counted === undefined ? null : Number(counted.opening_qty);
      const issuedQty = counted === undefined ? 0 : (issued.get(row.food_item_id) ?? 0);
      const remainingQty = openingQty === null ? null : Math.max(0, openingQty - issuedQty);
      const isFinished = row.availability !== 'AVAILABLE';
      if (remainingQty === 0 && !isFinished) exhausted.push(row.food_item_id);

      // Stable-bucket signatures: this list is polled, so a URL that changed every call would
      // make the screen re-download photography it already has.
      const mediaId = row.item_media_id ?? row.food_media_id;
      items.push({
        menuItemId: row.food_item_id,
        categoryName: row.category_name,
        masterName: row.name,
        displayName: customName !== '' ? customName : row.name,
        hasCustomName: customName !== '',
        isFinished,
        availability: row.availability,
        openingQty,
        issuedQty,
        remainingQty,
        qtyRegisteredAt:
          counted === undefined ? null : fromDbDateTimeRequired(counted.registered_at),
        primaryMediaUrl: mediaId === null ? null : signMenuMediaUrlStable(mediaId, actor.userId),
        basePrice: row.base_price === null ? null : Number(row.base_price),
      });
    }

    // A count that has run out hides the dish even if nobody has pressed anything. The sale
    // itself normally does this (`applyStockExhaustion`); this is the backstop for a count that
    // was already spent before it was registered.
    if (exhausted.length > 0) {
      for (const menuItemId of exhausted) {
        await this.setDishAvailability(menuItemId, false, actor);
        const row = items.find((entry) => entry.menuItemId === menuItemId);
        if (row !== undefined) {
          row.isFinished = true;
          row.availability = 'SOLD_OUT';
        }
      }
    }

    items.sort((a, b) =>
      a.categoryName === b.categoryName
        ? a.displayName.localeCompare(b.displayName)
        : a.categoryName.localeCompare(b.categoryName),
    );
    return { stationKind, stationId, shift, businessDate, items };
  }

  /**
   * One write from a station's menu file. Three separable things, deliberately in one call
   * because the screen presents them as one row:
   *
   *  - **displayName** is local to this screen. It never touches Menu Master, so a counter can
   *    call a dish whatever its regulars call it without renaming it for anyone else.
   *  - **isFinished** is not local at all: it writes the menu's own availability, which is what
   *    the Digital Menu Board reads. Running out is a fact about the food, not about a screen.
   *  - **openingQty** registers counted stock for this shift; from then on every portion the
   *    counter sells is deducted and zero marks the dish finished by itself.
   */
  async saveStationMenuItem(
    stationKind: KdsStationKind,
    stationId: string,
    menuItemId: string,
    body: KdsStationMenuUpsertRequest,
    actor: AuditActor & { userId: string },
  ): Promise<{ menuItemId: string; displayName: string | null; isFinished: boolean }> {
    const pool = getPool();
    if (!(await kdsRepository.menuItemExists(pool, menuItemId))) {
      throw new NotFoundError('Menu item', menuItemId);
    }

    const current = (await kdsRepository.listStationOverrides(pool, stationKind, stationId)).find(
      (row) => row.menu_item_id === menuItemId,
    );
    const displayName =
      body.displayName === undefined
        ? (current?.display_name ?? null)
        : body.displayName === null || body.displayName.trim() === ''
          ? null
          : body.displayName.trim();

    if (displayName === null) {
      await kdsRepository.deleteStationOverride(pool, stationKind, stationId, menuItemId);
    } else {
      await kdsRepository.upsertStationOverride(pool, {
        id: newId(),
        stationKind,
        stationId,
        menuItemId,
        displayName,
        // The column stays for history; availability is the live answer.
        isFinished: false,
        updatedBy: actor.userId,
      });
    }

    if (body.openingQty !== undefined) {
      if (stationKind !== 'counter') {
        throw new ValidationError('Only a service counter counts stock', [
          { path: 'openingQty', message: 'A kitchen screen has no counter stock' },
        ]);
      }
      const businessDate = todayIsoDate();
      const shift = await menuShiftSchedulerService.currentShift();
      if (body.openingQty === null) {
        await kdsRepository.deleteStock(pool, stationId, menuItemId, businessDate, shift);
      } else {
        await kdsRepository.upsertStock(pool, {
          id: newId(),
          counterId: stationId,
          menuItemId,
          businessDate,
          shift,
          openingQty: body.openingQty,
          registeredBy: actor.userId,
        });
        // Registering zero says "there is none" — the same statement as marking it finished.
        if (body.openingQty === 0) await this.setDishAvailability(menuItemId, false, actor);
      }
    }

    let isFinished = body.isFinished ?? false;
    if (body.isFinished !== undefined) {
      await this.setDishAvailability(menuItemId, !body.isFinished, actor);
      // Putting a dish back with a spent count would flip it straight off again; the count is
      // stale by definition, so clear it and let the counter re-register what it actually has.
      if (!body.isFinished && stationKind === 'counter') {
        await kdsRepository.deleteStock(
          pool,
          stationId,
          menuItemId,
          todayIsoDate(),
          await menuShiftSchedulerService.currentShift(),
        );
      }
    } else {
      isFinished = body.openingQty === 0;
    }

    return { menuItemId, displayName, isFinished };
  }

  /**
   * Marks a dish available or sold out everywhere it is offered.
   *
   * Availability lives on the menu assignment (and the variants under it), which is exactly
   * what `MenuBoardService` renders and what `MenuShiftSchedulerService` puts back at the next
   * morning/evening boundary — so a counter marking something finished takes it off the wall
   * screens for the rest of the shift and no longer.
   */
  private async setDishAvailability(
    menuItemId: string,
    available: boolean,
    actor: AuditActor & { userId: string },
  ): Promise<void> {
    const pool = getPool();
    const assignments = await menuItemAssignmentRepository.listForFoodItem(pool, menuItemId);
    const target: AvailabilityStatus = available ? 'AVAILABLE' : 'SOLD_OUT';
    let changed = 0;

    for (const assignment of assignments) {
      if (assignment.availability === target) continue;
      // Never overrule a deliberate UNAVAILABLE (the office withdrew the dish) by un-hiding it
      // from a counter; only the shift reset does that.
      if (available && assignment.availability === 'UNAVAILABLE') continue;
      await menuItemAssignmentRepository.update(pool, assignment.id, { availability: target });
      changed += 1;
    }

    for (const variant of await menuItemVariantRepository.listForFoodItem(pool, menuItemId, false)) {
      if (variant.availability === target) continue;
      if (available && variant.availability === 'UNAVAILABLE') continue;
      await menuItemVariantRepository.update(pool, variant.id, { availability: target });
      changed += 1;
    }

    if (changed === 0) return;

    await auditService.record(pool, actor, {
      action: AuditAction.MENU_ITEM_AVAILABILITY_SET,
      entityType: 'menu_item',
      entityId: menuItemId,
      after: { availability: target, source: 'KDS' },
    });
    // Every board holding this dish repaints now rather than on its next poll.
    menuBoardRealtime.announceChange(`kds-availability:${menuItemId}`);
  }

  /* ------------------------------------------------------------- line flow */

  async acknowledgeLine(lineId: string, actor: AuditActor & { userId: string }) {
    const line = await withTransaction(async (connection) => {
      const line = await this.loadActiveLine(connection, lineId);
      if (line.kds_status === 'SERVED') {
        throw new ConflictError('A served line cannot be acknowledged — revert it first');
      }
      // Already acknowledged is a no-op rather than an error: two screens can both tap a
      // fresh line, and the second tap did nothing wrong.
      if (line.kds_status === 'QUEUED') {
        await kdsRepository.markAcknowledged(connection, lineId, actor.userId);
      }
      return line;
    });

    await this.emitLineChange(line);
    return { lineId, kdsStatus: 'ACKNOWLEDGED' as PosKdsLineStatus };
  }

  async serveLine(lineId: string, actor: AuditActor & { userId: string }) {
    const line = await withTransaction(async (connection) => {
      const line = await this.loadActiveLine(connection, lineId);
      if (line.kds_status === 'SERVED') {
        throw new ConflictError('This line has already been served');
      }
      await kdsRepository.markServed(connection, [lineId], actor.userId);
      return line;
    });

    await this.emitLineChange(line);
    return { lineId, kdsStatus: 'SERVED' as PosKdsLineStatus };
  }

  /**
   * Undo a serve. Guarded by the revert window: a line may come back only while it is still
   * among the counter's most recent serves, so an old ticket cannot quietly reopen.
   */
  async revertLine(lineId: string, actor: AuditActor & { userId: string }) {
    const line = await withTransaction(async (connection) => {
      const line = await this.loadActiveLine(connection, lineId);
      if (line.kds_status !== 'SERVED') {
        throw new ConflictError('Only a served line can be reverted');
      }

      const window = await this.revertWindow(connection);
      const scopes = await kdsRepository.scopesForLines(connection, [lineId]);
      const counters = new Set(scopes.counterIds);
      if (line.order_counter_id !== null) counters.add(line.order_counter_id);

      const recentIds = new Set<string>();
      for (const counterId of counters) {
        for (const row of await kdsRepository.listRecentServed(connection, counterId, window)) {
          recentIds.add(row.line_id);
        }
      }
      if (!recentIds.has(lineId)) {
        throw new ConflictError('This line is beyond the revert window and can no longer be called back');
      }

      await kdsRepository.markReverted(connection, lineId);
      return line;
    });

    await this.emitLineChange(line);
    return { lineId, kdsStatus: 'ACKNOWLEDGED' as PosKdsLineStatus };
  }

  /** The counter's "bump" on a whole card: every one of its unserved lines, in one write. */
  async serveOrderForCounter(orderId: string, counterId: string, actor: AuditActor & { userId: string }) {
    const lineIds = await withTransaction(async (connection) => {
      const order = await posRepository.findById(connection, orderId);
      if (order === null) throw new NotFoundError('POS order', orderId);

      const lines = await kdsRepository.listServeableLines(connection, orderId, counterId);
      const lineIds = lines.map((line) => line.id);
      await kdsRepository.markServed(connection, lineIds, actor.userId);
      return lineIds;
    });

    const scopes = await kdsRepository.scopesForLines(getPool(), lineIds);
    const counters = new Set([...scopes.counterIds, counterId]);
    const order = await posRepository.findById(getPool(), orderId);
    if (order?.counter_id != null) counters.add(order.counter_id);
    for (const id of counters) realtime.emitKdsChanged({ counterId: id });
    for (const printingGroupId of scopes.printingGroupIds) {
      realtime.emitKdsChanged({ printingGroupId });
    }
    await this.emitCdsBill(order?.counter_id ?? counterId);

    return { orderId, servedLines: lineIds.length };
  }

  /* ---------------------------------------------------------------- exchange */

  /**
   * Swaps billed lines for different ones without moving the bill.
   *
   * The exchanged lines are cancelled as EXCHANGED — they stay on the ticket, cancelled,
   * because they are a record of what the customer first paid for. The additions are priced
   * through the same sellable resolution the till uses, then netted to the exchanged lines'
   * combined lineTotal by a discount on the final added line. Order totals, payments and
   * status are deliberately untouched: the customer paid the bill, and the bill still adds up.
   */
  async exchange(
    orderId: string,
    body: KdsExchangeRequest,
    actor: AuditActor & { userId: string },
  ): Promise<PosOrderDetailDto> {
    const orderCounter = await withTransaction(async (connection) => {
      const order = await posRepository.findById(connection, orderId);
      if (order === null) throw new NotFoundError('POS order', orderId);
      if (order.status !== PosOrderStatus.OPEN) {
        throw new ConflictError('Only an open order can exchange lines');
      }

      const wanted = new Set(body.lineIds);
      const items = await posRepository.listItems(connection, orderId);
      const exchanged = items.filter((row) => wanted.has(row.id));
      if (exchanged.length !== wanted.size) {
        throw new ValidationError('Every exchanged line must belong to this order', [
          { path: 'lineIds', message: 'Unknown line for this order' },
        ]);
      }
      if (exchanged.some((row) => row.status !== PosOrderItemStatus.ACTIVE)) {
        throw new ConflictError('A line can only be exchanged while it is still active');
      }
      const exchangedTotal = money(
        exchanged.reduce((sum, row) => sum + Number(row.line_total), 0),
      );
      if (Math.abs(exchangedTotal - body.expectedValue) > 0.01) {
        throw new ValidationError('The exchanged lines no longer add up to the expected value', [
          { path: 'expectedValue', message: `The lines on the bill add up to ${exchangedTotal.toFixed(2)}` },
        ]);
      }

      const entity =
        order.entity_id === null ? null : await entityRepository.findById(connection, order.entity_id);
      const homeState = await settingsRepository.getValue<string>(
        connection, 'pos.home_state_code', SETTING_DEFINITIONS['pos.home_state_code'].default,
      );
      const interState =
        entity !== null &&
        entity.state_code !== null &&
        entity.state_code !== '' &&
        homeState !== '' &&
        homeState !== entity.state_code;

      const additions: PreparedAddition[] = [];
      for (const [index, addition] of body.additions.entries()) {
        const sellable = await posRepository.resolveSellable(connection, {
          menuItemId: addition.menuItemId,
          variantId: addition.variantId ?? null,
          menuId: order.menu_id,
        });
        if (sellable === null) {
          throw new ValidationError('That menu item is no longer available', [
            { path: `additions.${index}.menuItemId`, message: 'Unknown menu item' },
          ]);
        }
        if (
          addition.variantId !== null &&
          addition.variantId !== undefined &&
          sellable.variant_id === null
        ) {
          throw new ValidationError('That variant does not belong to the selected menu item', [
            { path: `additions.${index}.variantId`, message: 'Unknown variant' },
          ]);
        }
        const treatment = taxTreatmentFrom(sellable, interState);
        additions.push({
          sellable,
          quantity: addition.quantity,
          treatment,
          line: this.priceExchangeLine(sellable, addition.quantity, treatment, 0),
        });
      }

      const additionsValue = money(
        additions.reduce((sum, addition) => sum + addition.line.lineTotal, 0),
      );
      if (Math.abs(additionsValue - body.expectedValue) > 0.01) {
        throw new ValidationError('The additions do not match the value of the lines being exchanged', [
          { path: 'additions', message: `The additions price out at ${additionsValue.toFixed(2)}` },
        ]);
      }

      this.netExchangeToExchangedTotal(additions, exchangedTotal);

      const cancelled = await kdsRepository.cancelLines(
        connection, orderId, [...wanted], 'EXCHANGED', actor.userId,
      );
      if (cancelled !== wanted.size) {
        throw new ConflictError('A line on this order changed while the exchange was being applied');
      }

      let sortOrder = (await kdsRepository.maxLineSortOrder(connection, orderId)) + 1;
      for (const addition of additions) addition.line.sortOrder = sortOrder++;
      await kdsRepository.insertLines(connection, orderId, additions.map((addition) => addition.line));

      await auditService.record(connection, actor, {
        action: AuditAction.KDS_ORDER_EXCHANGED,
        entityType: 'pos_order',
        entityId: orderId,
        before: { lineIds: [...wanted], total: exchangedTotal },
        after: {
          lineIds: additions.map((addition) => addition.line.id),
          total: money(additions.reduce((sum, addition) => sum + addition.line.lineTotal, 0)),
        },
      });

      return {
        counterId: order.counter_id,
        lineIds: [...wanted, ...additions.map((addition) => addition.line.id)],
      };
    });

    const scopes = await kdsRepository.scopesForLines(getPool(), orderCounter.lineIds);
    const counters = new Set(scopes.counterIds);
    if (orderCounter.counterId !== null) counters.add(orderCounter.counterId);
    for (const counterId of counters) realtime.emitKdsChanged({ counterId });
    for (const printingGroupId of scopes.printingGroupIds) {
      realtime.emitKdsChanged({ printingGroupId });
    }
    await this.emitCdsBill(orderCounter.counterId);

    const row = await posRepository.findById(getPool(), orderId);
    if (row === null) throw new NotFoundError('POS order', orderId);
    const [items, payments] = await Promise.all([
      posRepository.listItems(getPool(), orderId),
      posRepository.listPayments(getPool(), orderId),
    ]);
    return {
      ...mapPosOrder(row),
      items: items.map(mapPosOrderItem),
      payments: payments.map(mapPosPayment),
    };
  }

  /* ---------------------------------------------------------------- sockets */

  /**
   * Post-commit hook for PosService: a ticket was created, edited or moved state, so every
   * display showing any of its lines refetches, and the counter's customer display gets the
   * fresh bill (or a clear, when no open ticket remains).
   */
  async notifyPosOrderChanged(orderId: string): Promise<void> {
    const pool = getPool();
    const order = await posRepository.findById(pool, orderId);
    if (order === null) return;

    const items = await posRepository.listItems(pool, orderId);
    const activeLineIds = items
      .filter((row) => row.status === PosOrderItemStatus.ACTIVE)
      .map((row) => row.id);
    const scopes = await kdsRepository.scopesForLines(pool, activeLineIds);

    const counters = new Set(scopes.counterIds);
    if (order.counter_id !== null) counters.add(order.counter_id);
    for (const counterId of counters) realtime.emitKdsChanged({ counterId });
    for (const printingGroupId of scopes.printingGroupIds) {
      realtime.emitKdsChanged({ printingGroupId });
    }
    await this.emitCdsBill(order.counter_id);

    // Selling is what spends a count, so this is the moment to notice one hitting zero — the
    // dish leaves the wall screens as the sale is rung up, not when somebody next opens a board.
    const soldItemIds = [
      ...new Set(
        items
          .filter((row) => row.status === PosOrderItemStatus.ACTIVE && row.menu_item_id !== null)
          .map((row) => row.menu_item_id as string),
      ),
    ];
    await this.applyStockExhaustion(soldItemIds);
  }

  /**
   * Marks any of these dishes sold out whose counted stock is spent at every counter counting
   * it. A dish counted at one counter and untouched at another is only hidden when the counting
   * counter runs dry — nobody else made a claim about how much there was.
   */
  private async applyStockExhaustion(menuItemIds: string[]): Promise<void> {
    if (menuItemIds.length === 0) return;
    const pool = getPool();
    const businessDate = todayIsoDate();
    const shift = await menuShiftSchedulerService.currentShift();

    for (const menuItemId of menuItemIds) {
      const counterIds = await kdsRepository.countersWithStockForItem(
        pool, menuItemId, businessDate, shift,
      );
      if (counterIds.length === 0) continue;

      let anyLeft = false;
      for (const counterId of counterIds) {
        const stock = (await kdsRepository.listStock(pool, counterId, businessDate, shift)).find(
          (row) => row.menu_item_id === menuItemId,
        );
        if (stock === undefined) continue;
        const issued = await kdsRepository.issuedQtyForStock(pool, counterId, businessDate, [
          { menuItemId, registeredAt: stock.registered_at },
        ]);
        if (Number(stock.opening_qty) - (issued.get(menuItemId) ?? 0) > 0) {
          anyLeft = true;
          break;
        }
      }
      if (!anyLeft) await this.setDishAvailability(menuItemId, false, SYSTEM_STOCK_ACTOR);
    }
  }

  /* ------------------------------------------------------------- internals */

  private async loadActiveLine(db: Db, lineId: string): Promise<KdsLineRow> {
    const line = await kdsRepository.findLine(db, lineId);
    if (line === null) throw new NotFoundError('POS order line', lineId);
    if (line.line_status !== PosOrderItemStatus.ACTIVE) {
      throw new ConflictError('A cancelled line is no longer on the board');
    }
    return line;
  }

  private async revertWindow(db: Db): Promise<number> {
    return settingsRepository.getValue<number>(
      db, 'kds.revert_window', SETTING_DEFINITIONS['kds.revert_window'].default,
    );
  }

  /** kds:changed to every board showing the line, then the counter's customer display. */
  private async emitLineChange(line: KdsLineRow): Promise<void> {
    const scopes = await kdsRepository.scopesForLines(getPool(), [line.line_id]);
    const counters = new Set(scopes.counterIds);
    if (line.order_counter_id !== null) counters.add(line.order_counter_id);
    for (const counterId of counters) realtime.emitKdsChanged({ counterId });
    for (const printingGroupId of scopes.printingGroupIds) {
      realtime.emitKdsChanged({ printingGroupId });
    }
    await this.emitCdsBill(line.order_counter_id);
  }

  private async emitCdsBill(counterId: string | null): Promise<void> {
    if (counterId === null) return;
    realtime.emitCdsBill(counterId, await this.cdsBill(counterId));
  }

  /**
   * One exchange line at its natural catalogue price, with the tax split computed exactly as
   * PosService.resolveLine does — an exchanged dish is taxed the way the menu says, and only
   * the paisa-level net-off below distinguishes it from a line rung up at the till.
   */
  private priceExchangeLine(
    sellable: SellableRow,
    quantity: number,
    treatment: TaxTreatment,
    discountAmount: number,
  ): InsertPosOrderItemInput {
    const unitPrice = money(resolvePrice(sellable));
    const grossAmount = money(quantity * unitPrice);
    const net = money(grossAmount - discountAmount);
    const combinedRate = treatment.rate + treatment.cessRate;
    const taxableAmount = treatment.priceIsInclusive
      ? money(net / (1 + combinedRate / 100))
      : net;
    const taxAmount = money(
      treatment.priceIsInclusive ? net - taxableAmount : (net * combinedRate) / 100,
    );

    const cess = money((taxableAmount * treatment.cessRate) / 100);
    const gstPortion = money(taxAmount - cess);
    const cgstAmount = treatment.interState ? 0 : money(gstPortion / 2);
    const sgstAmount = treatment.interState ? 0 : money(gstPortion - cgstAmount);
    const igstAmount = treatment.interState ? gstPortion : 0;

    return {
      id: newId(),
      menuItemId: sellable.menu_item_id,
      variantId: sellable.variant_id,
      customItemName: null,
      itemName: sellable.item_name,
      variantName: sellable.variant_name,
      quantity,
      unit: (sellable.variant_unit ?? sellable.item_unit).slice(0, LIMITS.UNIT_MAX),
      allowDecimalQuantity: sellable.allow_decimal_quantity === 1,
      unitPrice,
      grossAmount,
      discountType: discountAmount === 0 ? PosDiscountType.NONE : PosDiscountType.AMOUNT,
      discountValue: discountAmount,
      discountAmount,
      taxableAmount,
      taxProfileId: treatment.taxProfileId,
      taxRate: treatment.rate,
      cgstAmount,
      sgstAmount,
      igstAmount,
      cessAmount: cess,
      taxAmount,
      lineTotal: money(taxableAmount + taxAmount),
      notes: null,
      sortOrder: 0,
    };
  }

  /**
   * Moves the final addition's lineTotal by the residual between the natural sum and what the
   * exchanged lines were billed at. The residual is paisa-level by the time we get here (the
   * request was validated against expectedValue), so a single discount on the last line
   * settles it; exclusive-tax rounding can fight back by a paisa, hence the bounded retries.
   */
  private netExchangeToExchangedTotal(
    additions: PreparedAddition[],
    exchangedTotal: number,
  ): void {
    const final = additions[additions.length - 1];
    if (final === undefined) {
      throw new ValidationError('An exchange needs at least one addition', [
        { path: 'additions', message: 'Provide the replacement lines' },
      ]);
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const sum = money(additions.reduce((total, addition) => total + addition.line.lineTotal, 0));
      const residual = money(exchangedTotal - sum);
      if (residual === 0) return;

      const combinedRate = final.treatment.rate + final.treatment.cessRate;
      const netDelta = final.treatment.priceIsInclusive
        ? residual
        : money(residual / (1 + combinedRate / 100));
      const discount = money(final.line.discountAmount - netDelta);
      if (discount > final.line.grossAmount) {
        throw new ConflictError('The exchange cannot be priced without making a line negative');
      }
      final.line = this.priceExchangeLine(final.sellable, final.quantity, final.treatment, discount);
    }

    throw new ConflictError('The exchange cannot be priced to match the exchanged lines exactly');
  }
}

/** Folds flat queue rows into order cards; rows arrive pre-sorted by the query. */
function buildQueue(
  scope: { counterId?: string; printingGroupId?: string },
  rows: KdsQueueRow[],
): KdsQueueDto {
  const orders: KdsOrderDto[] = [];
  const byOrder = new Map<string, KdsOrderDto>();
  const summary = new Map<string, number>();

  for (const row of rows) {
    let order = byOrder.get(row.order_id);
    if (order === undefined) {
      order = {
        id: row.order_id,
        orderNumber: row.order_number,
        dailySequence: Number(row.daily_sequence),
        businessDate: fromDbDate(row.business_date) as string,
        orderType: row.order_type,
        counterId: row.counter_id,
        counterName: row.counter_name,
        entityName: row.entity_name,
        placedAt: fromDbDateTime(row.placed_at),
        createdAt: fromDbDateTimeRequired(row.order_created_at),
        notes: row.order_notes,
        lines: [],
      };
      byOrder.set(row.order_id, order);
      orders.push(order);
    }

    order.lines.push({
      id: row.line_id,
      itemName: row.item_name,
      variantName: row.variant_name,
      customItemName: row.custom_item_name,
      quantity: Number(row.quantity),
      notes: row.line_notes,
      lineTotal: Number(row.line_total),
      kdsStatus: row.kds_status,
      acknowledgedAt: fromDbDateTime(row.acknowledged_at),
      servedAt: fromDbDateTime(row.served_at),
      servedByName: row.served_by_name,
      printingGroupId: row.printing_group_id,
      printingGroupName: row.printing_group_name,
      prepSeconds: row.prep_seconds === null ? null : Number(row.prep_seconds),
    });

    if (row.kds_status !== 'SERVED') {
      summary.set(row.item_name, (summary.get(row.item_name) ?? 0) + Number(row.quantity));
    }
  }

  return {
    scope,
    orders,
    summary: [...summary.entries()]
      .map(([itemName, quantity]) => ({ itemName, quantity }))
      .sort((a, b) => a.itemName.localeCompare(b.itemName)),
  };
}

export const kdsService = new KdsService();
