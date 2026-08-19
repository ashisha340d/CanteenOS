import { MasterStatus, type AvailabilityStatus } from '@menuboard/shared';
import { getPool } from '../db/pool';
import type { MenuItemAssignmentRow } from '../models/rows';
import { menuBoardRealtime } from '../realtime/menuBoardSocket';
import {
  menuItemAssignmentRepository,
  menuItemScheduleRepository,
  menuItemVariantRepository,
  menuRepository,
} from '../repositories/MenuMasterRepository';
import { logger } from '../utils/logger';
import { todayIsoDate } from '../utils/time';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { settingsService } from './SettingsService';

/**
 * The morning/evening shift auto-reset.
 *
 * A counter operator marks a dish `UNAVAILABLE` or `SOLD_OUT` the moment it runs out — that is
 * the whole point of the flag, and it must never require a second click to set. What it must not
 * do is outlive the reason it was set: yesterday's 86'd Gulab Jamun should not still read
 * unavailable at tomorrow's breakfast rush with nobody around to notice and un-hide it. This
 * service is that un-hide, run automatically at two moments a day rather than left to memory.
 *
 * It only ever turns things *on*. Nothing here ever sets an item to `UNAVAILABLE` — that
 * decision belongs to whoever is standing at the counter and can see the empty tray, and
 * inventing an automatic "hide" would be a behaviour nobody asked for and a guest would have no
 * way to predict. The two shifts differ only in *which* items are un-hidden:
 *
 *  - **Morning shift begins** (`menu.morning_shift_start`): only items scheduled for the
 *    MORNING shift today, plus anything flagged `always_available` — read straight out of
 *    `menu_item_schedules`, the same table the Digital Menu Board's own morning filter reads
 *    (`MenuBoardService.snapshot`, `menuItemScheduleRepository.findFoodItemsInShift`). An item
 *    with no morning slot at all is left exactly as it was.
 *  - **Evening shift begins** (`menu.evening_shift_start`): every item on the menu. The evening
 *    shift is "the whole catalogue is back", not a second filtered window.
 */

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const RESETTABLE: readonly AvailabilityStatus[] = ['UNAVAILABLE', 'SOLD_OUT'];

/** The sweep acts on nobody's behalf; its audit rows are attributed to the system. */
const SYSTEM_ACTOR: AuditActor = {
  userId: null,
  role: null,
  ip: null,
  userAgent: null,
  requestId: null,
};

export interface ShiftResetSummary {
  shift: 'MORNING' | 'EVENING';
  menusChecked: number;
  assignmentsReset: number;
  variantsReset: number;
}

export class MenuShiftSchedulerService {
  private timer: NodeJS.Timeout | null = null;

  /** Started from server.ts alongside the other background work. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.checkQuietly();
    }, CHECK_INTERVAL_MS);
    this.timer.unref();
    // Also checked once at boot: a restart landing moments after a shift boundary must not
    // wait up to CHECK_INTERVAL_MS to catch up, and `lastApplied` below makes this safe to run
    // redundantly against a boundary already handled before the restart.
    void this.checkQuietly();
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async checkQuietly(): Promise<void> {
    try {
      const shift = await this.currentShift();
      const stamp = `${shift}:${todayIsoDate()}`;
      const lastApplied = await settingsService.get<string>('menu.last_shift_reset');
      if (lastApplied === stamp) return; // already handled this boundary

      const summary = await this.applyShiftReset(shift);
      await settingsService.set('menu.last_shift_reset', stamp, SYSTEM_ACTOR);

      if (summary.assignmentsReset > 0 || summary.variantsReset > 0) {
        logger.info('Menu shift reset applied', { ...summary });
      }
    } catch (error) {
      // A missed reset is recoverable at the next tick five minutes later; it must never take
      // the process down.
      logger.error('Menu shift reset failed', undefined, error);
    }
  }

  /**
   * Which shift `now` falls in, per the two configured boundary times. Public because the KDS
   * counts stock per shift and must agree with the reset sweep about where the line is — two
   * definitions of "morning" would strand a count in the shift it was not written for.
   */
  async currentShift(): Promise<'MORNING' | 'EVENING'> {
    const morningStart = await settingsService.get<string>('menu.morning_shift_start');
    const eveningStart = await settingsService.get<string>('menu.evening_shift_start');
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const morningMinutes = toMinutes(morningStart);
    const eveningMinutes = toMinutes(eveningStart);

    // The morning window is [morningStart, eveningStart) on a normal day. If the operator has
    // configured an inverted pair (evening before morning — an overnight-only kitchen), the
    // window still resolves consistently rather than throwing: it is just the complement.
    if (morningMinutes <= eveningMinutes) {
      return nowMinutes >= morningMinutes && nowMinutes < eveningMinutes ? 'MORNING' : 'EVENING';
    }
    return nowMinutes >= morningMinutes || nowMinutes < eveningMinutes ? 'MORNING' : 'EVENING';
  }

  /**
   * Applies one shift's reset across every active menu, right now — this is also what the
   * manual "Apply now" action in the Admin Portal calls, so a shift boundary crossed while the
   * server happened to be down is not stuck waiting for the next natural one.
   */
  async applyShiftReset(shift: 'MORNING' | 'EVENING'): Promise<ShiftResetSummary> {
    const pool = getPool();
    const { rows: menus } = await menuRepository.list(pool, {
      status: MasterStatus.ACTIVE,
      limit: 500,
      offset: 0,
    });

    let assignmentsReset = 0;
    let variantsReset = 0;

    for (const menu of menus) {
      const { rows: assignments } = await menuItemAssignmentRepository.list(pool, {
        menuId: menu.id,
        status: MasterStatus.ACTIVE,
        limit: 1000,
        offset: 0,
      });
      const hidden = assignments.filter((a) => RESETTABLE.includes(a.availability));
      if (hidden.length === 0) continue;

      const eligible: MenuItemAssignmentRow[] =
        shift === 'EVENING'
          ? hidden
          : await this.morningEligible(pool, hidden);
      if (eligible.length === 0) continue;

      const resetAssignments = await menuItemAssignmentRepository.resetAvailability(
        pool,
        eligible.map((a) => a.id),
      );
      const resetVariants = await menuItemVariantRepository.resetAvailability(
        pool,
        [...new Set(eligible.map((a) => a.food_item_id))],
      );
      assignmentsReset += resetAssignments;
      variantsReset += resetVariants;
    }

    const summary: ShiftResetSummary = {
      shift,
      menusChecked: menus.length,
      assignmentsReset,
      variantsReset,
    };

    if (assignmentsReset > 0 || variantsReset > 0) {
      await auditService.record(pool, SYSTEM_ACTOR, {
        action: AuditAction.MENU_SHIFT_RESET,
        entityType: 'menu_shift_reset',
        entityId: shift,
        after: { ...summary },
      });
      // The board's own morning filter and every price/availability it reads move together
      // here — a connected screen should catch up immediately, not wait for its next poll.
      menuBoardRealtime.announceChange(`shift-reset:${shift}`);
    }

    return summary;
  }

  /** Narrows a menu's hidden assignments to the ones scheduled MORNING today (or always-on). */
  private async morningEligible(
    pool: ReturnType<typeof getPool>,
    hidden: MenuItemAssignmentRow[],
  ): Promise<MenuItemAssignmentRow[]> {
    const foodItemIds = [...new Set(hidden.map((a) => a.food_item_id))];
    const morningIds = await menuItemScheduleRepository.findFoodItemsForMorningReset(
      pool,
      foodItemIds,
      new Date().getDay(),
    );
    return hidden.filter((a) => morningIds.has(a.food_item_id));
  }
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export const menuShiftSchedulerService = new MenuShiftSchedulerService();
