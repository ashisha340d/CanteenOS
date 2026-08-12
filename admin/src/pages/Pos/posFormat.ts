import { PosOrderType, type PosOrderDto } from '@menuboard/shared';
import type { StatusToneName } from '@/lib/tones';

/**
 * Formatting shared by the POS dashboard and the entry screen.
 *
 * Both screens show the same ticket in two contexts, so the money, the clock and the type
 * label have to read identically in each — a bill that says "Quick sale ₹120" on one screen
 * and "QUICK_SALE 120.00" on the other makes the operator check twice.
 */

const DASH = '—';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

export function formatMoney(value: number): string {
  return inr.format(value);
}

/** 24-hour, because a counter reads a schedule at a glance and "6:30 pm" is two tokens. */
const TIME_LABEL = new Intl.DateTimeFormat('en-IN', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const DAY_LABEL = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

/** How long a ticket has been sitting there — the number an operator actually acts on. */
export function relativeTime(iso: string | null): string {
  if (iso === null) return DASH;

  // A negative elapsed time means the server clock is marginally ahead, not that the ticket
  // is from the future, so it falls into "just now" rather than getting its own branch.
  const elapsed = Date.now() - new Date(iso).getTime();
  if (elapsed < MINUTE_MS) return 'just now';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / HOUR_MS);
    const minutes = Math.floor((elapsed % HOUR_MS) / MINUTE_MS);
    return minutes === 0 ? `${hours}h ago` : `${hours}h ${minutes}m ago`;
  }
  return `${Math.floor(elapsed / DAY_MS)}d ago`;
}

/** Whole calendar days between today and `when`, so 23:50 → 00:10 counts as tomorrow. */
function calendarDaysAway(when: Date): number {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(when.getTime());
  to.setHours(0, 0, 0, 0);
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

export function scheduleLabel(iso: string | null): string {
  if (iso === null) return DASH;

  const when = new Date(iso);
  const time = TIME_LABEL.format(when);
  const days = calendarDaysAway(when);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  return `${DAY_LABEL.format(when)} ${time}`;
}

export const ORDER_TYPE_LABEL: Record<PosOrderType, string> = {
  [PosOrderType.DINE_IN]: 'Dine-in',
  [PosOrderType.TAKEAWAY]: 'Takeaway',
  [PosOrderType.DELIVERY]: 'Delivery',
  [PosOrderType.QUICK_SALE]: 'Quick sale',
};

/**
 * Fulfilment mapped onto the six tones by what it means operationally, not by enum order:
 * dine-in is served and present, takeaway is leaving the counter, delivery is still in
 * transit and unsettled, and a quick sale is deliberately anonymous so it stays quiet.
 */
export const ORDER_TYPE_TONE: Record<PosOrderType, StatusToneName> = {
  [PosOrderType.DINE_IN]: 'success',
  [PosOrderType.TAKEAWAY]: 'info',
  [PosOrderType.DELIVERY]: 'progress',
  [PosOrderType.QUICK_SALE]: 'muted',
};

/** A ticket raised for somebody — a registered entity, or a one-off name typed at the till. */
export function isNamed(order: PosOrderDto): boolean {
  return order.entityId !== null || order.entityName !== null;
}
