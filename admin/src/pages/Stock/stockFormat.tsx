import { TONE_CHIP_CLASS, TONE_TEXT_CLASS, type StatusToneName } from '@/lib/tones';
import { cn } from '@/lib/utils';

/**
 * Formatting shared by the four stock screens. The same balance is read on the list, in the
 * stock card and on a count sheet, so a quantity, a value and an expiry have to look
 * identical in all three.
 */

export const DASH = '—';

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

const DATE_LABEL = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const TIME_LABEL = new Intl.DateTimeFormat('en-IN', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function money(value: number | null | undefined): string {
  return value === null || value === undefined ? DASH : INR.format(value);
}

/** Quantities carry three decimals at most, and never trailing zeros. */
export function qty(value: number | null | undefined): string {
  return value === null || value === undefined
    ? DASH
    : value.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

export function dash(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? DASH : value;
}

export function formatDate(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return DASH;
  const when = new Date(value);
  return Number.isNaN(when.getTime()) ? DASH : DATE_LABEL.format(when);
}

export function formatDateTime(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return DASH;
  const when = new Date(value);
  return Number.isNaN(when.getTime())
    ? DASH
    : `${DATE_LABEL.format(when)} ${TIME_LABEL.format(when)}`;
}

/** The window a store manager is expected to act inside. Also what the "expiring soon" tile filters on. */
export const EXPIRY_SOON_DAYS = 14;
const EXPIRY_CRITICAL_DAYS = 3;

export function expiryTone(days: number | null | undefined): StatusToneName {
  if (days === null || days === undefined) return 'muted';
  if (days <= EXPIRY_CRITICAL_DAYS) return 'danger';
  if (days <= EXPIRY_SOON_DAYS) return 'progress';
  return 'muted';
}

function expiryLabel(days: number): string {
  if (days < 0) return `Expired ${Math.abs(days)}d`;
  if (days === 0) return 'Expires today';
  return `${days}d left`;
}

export function Chip({
  tone,
  children,
  className,
}: {
  tone: StatusToneName;
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border px-1.5 py-0.5 whitespace-nowrap',
        'text-[0.7188rem] leading-none font-semibold tracking-[0.01em]',
        TONE_CHIP_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The date, plus the number a store manager actually acts on: how long is left. */
export function ExpiryCell({
  expiryDate,
  daysToExpiry,
}: {
  expiryDate: string | null | undefined;
  daysToExpiry: number | null | undefined;
}): JSX.Element {
  if (expiryDate === null || expiryDate === undefined || expiryDate === '') {
    return <span className="text-muted-foreground">{DASH}</span>;
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className="tabular-nums">{formatDate(expiryDate)}</span>
      {daysToExpiry !== null && daysToExpiry !== undefined && (
        <Chip tone={expiryTone(daysToExpiry)}>{expiryLabel(daysToExpiry)}</Chip>
      )}
    </span>
  );
}

/** Movement direction colouring: what came in reads healthy, what left reads spent. */
export function quantityClass(direction: 'IN' | 'OUT'): string {
  return direction === 'IN' ? TONE_TEXT_CLASS.success : TONE_TEXT_CLASS.danger;
}

/** Zero variance is not news; anything else is, and the sign says which way. */
export function varianceClass(value: number | null): string {
  if (value === null || value === 0) return 'text-muted-foreground';
  return value > 0 ? TONE_TEXT_CLASS.info : TONE_TEXT_CLASS.danger;
}

export function signed(value: number | null): string {
  if (value === null) return DASH;
  if (value === 0) return '0';
  return `${value > 0 ? '+' : ''}${qty(value)}`;
}
