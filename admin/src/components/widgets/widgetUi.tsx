import type { ComponentType, ReactNode } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The small shared pieces every widget needs: the three designed non-data states, the figure
 * treatment, and the range picker that lives in a widget header.
 *
 * A widget is roughly a 260×200 box, so `EmptyState` — which is sized for a page — cannot be
 * reused here. These are the same idea at widget scale, and they exist once so six widgets
 * do not each invent their own way of saying "nothing yet".
 */

/* -------------------------------------------------------------- date range picker */

export type WidgetRange = 'today' | 'week' | 'month';

export const WIDGET_RANGES: WidgetRange[] = ['today', 'week', 'month'];

export const RANGE_LABEL: Record<WidgetRange, string> = {
  today: 'Today',
  week: 'Last 7 days',
  month: 'Last 30 days',
};

/** What fits in a 34px header. */
export const RANGE_SHORT: Record<WidgetRange, string> = {
  today: 'Today',
  week: '7 days',
  month: '30 days',
};

/**
 * The local calendar date, not the UTC one. `toISOString()` would roll a business date back a
 * day for every evening east of Greenwich, which in India is most of the trading day.
 */
export function localIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function rangeToQuery(range: WidgetRange): { dateFrom: string; dateTo: string } {
  const today = new Date();
  const back = range === 'today' ? 0 : range === 'week' ? 6 : 29;
  const from = new Date(today.getTime());
  from.setDate(from.getDate() - back);
  return { dateFrom: localIsoDate(from), dateTo: localIsoDate(today) };
}

export function RangePicker({
  value,
  onChange,
}: {
  value: WidgetRange;
  onChange: (next: WidgetRange) => void;
}): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="widget-chip" title="Change the period">
          {RANGE_SHORT[value]}
          <ChevronDownIcon className="size-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as WidgetRange)}
        >
          {WIDGET_RANGES.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {RANGE_LABEL[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ---------------------------------------------------------------- non-data states */

/**
 * One component for empty, error and not-configured. They differ only in tone and in whether
 * there is something the reader can do about it, so they share a shape.
 */
export function WidgetMessage({
  Icon,
  title,
  detail,
  action,
  tone = 'muted',
}: {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
  tone?: 'muted' | 'danger';
}): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center">
      <Icon
        className={`size-6 ${tone === 'danger' ? 'text-tone-danger' : 'text-muted-foreground opacity-50'}`}
      />
      <p className="text-xs leading-snug font-medium">{title}</p>
      {detail && <p className="text-muted-foreground text-[0.6875rem] leading-snug">{detail}</p>}
      {action && (
        <button type="button" className="widget-link" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Shaped like the content it replaces, per the design system — never a bare spinner. */
export function WidgetSkeleton({ lines = 3 }: { lines?: number }): JSX.Element {
  return (
    <div className="flex h-full flex-col gap-2">
      <Skeleton className="h-7 w-2/3" />
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className="h-3" style={{ width: `${88 - index * 14}%` }} />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------- figures */

/**
 * Money that has to fit a 260px card. `formatMoney` stays the right call anywhere the exact
 * paise matter — a bill, a ledger, a tooltip — but "₹1,24,650.00" does not fit a widget
 * headline, and `en-IN` compact notation reads in lakh and crore rather than K and M, which
 * is what the figure would be said out loud as anyway.
 */
const COMPACT_INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function compactMoney(value: number): string {
  return COMPACT_INR.format(value);
}

/** A signed percentage change, or null when there is no baseline to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * The one numeric treatment in the widgets. Tabular figures throughout, so a column of money
 * lines up on the decimal and a changing figure does not make the row twitch.
 */
export function WidgetMetric({
  label,
  value,
  detail,
  size = 'md',
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  size?: 'md' | 'lg';
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-muted-foreground text-[0.625rem] font-medium tracking-wide uppercase">
        {label}
      </span>
      <span
        className={`truncate font-semibold tabular-nums ${size === 'lg' ? 'text-2xl leading-tight' : 'text-sm'}`}
      >
        {value}
      </span>
      {detail && <span className="text-muted-foreground truncate text-[0.6875rem]">{detail}</span>}
    </div>
  );
}
