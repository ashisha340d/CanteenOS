import { useMemo, useState } from 'react';
import { ActivityIcon, ChevronDownIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePosBusyHours } from '@/hooks/usePos';
import { formatMoney } from '@/pages/Pos/posFormat';
import {
  compactMoney,
  RangePicker,
  rangeToQuery,
  WidgetMessage,
  WidgetSkeleton,
  type WidgetRange,
} from './widgetUi';

/**
 * When the rush actually happens. X axis is the hour of the day, Y is either the number of
 * bills or the money taken in that hour.
 *
 * Both measures are offered because they answer different questions and regularly disagree:
 * the transaction peak is when the queue is longest and staffing has to be highest, while the
 * revenue peak is when the expensive items move. A canteen rostering its counters needs the
 * first; one deciding what to prep needs the second.
 *
 * Drawn with grid cells rather than SVG deliberately — the bars then reflow with the widget
 * at any size, and the axis labels stay at their real type size instead of being scaled by a
 * viewBox until they are unreadable.
 */

type Metric = 'transactions' | 'sales';

const METRIC_LABEL: Record<Metric, string> = {
  transactions: 'Bills',
  sales: 'Sales',
};

/** Every third hour, which is as many labels as fit without collision at the minimum width. */
const LABELLED_HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}`;
}

export function BusyHoursWidget(): JSX.Element {
  const [range, setRange] = useState<WidgetRange>('week');
  const [metric, setMetric] = useState<Metric>('transactions');
  const query = useMemo(() => rangeToQuery(range), [range]);
  const hours = usePosBusyHours(query);

  if (hours.isPending) return <WidgetSkeleton lines={4} />;

  if (hours.isError || hours.data === undefined) {
    return (
      <WidgetMessage
        Icon={ActivityIcon}
        title="Hourly figures unavailable"
        detail="The till timeline could not be read."
        action={{ label: 'Try again', onClick: () => void hours.refetch() }}
        tone="danger"
      />
    );
  }

  const valueOf = (row: (typeof hours.data)[number]): number =>
    metric === 'transactions' ? row.transactionCount : row.netSales;

  const peak = Math.max(...hours.data.map(valueOf), 0);
  const busiest = hours.data.reduce<(typeof hours.data)[number] | null>(
    (best, row) => (best === null || valueOf(row) > valueOf(best) ? row : best),
    null,
  );

  const axisMax = (value: number): string =>
    metric === 'transactions' ? String(Math.round(value)) : compactMoney(value);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="widget-chip" title="Change what the bars measure">
              {METRIC_LABEL[metric]}
              <ChevronDownIcon className="size-3 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuRadioGroup
              value={metric}
              onValueChange={(next) => setMetric(next as Metric)}
            >
              <DropdownMenuRadioItem value="transactions">
                Number of transactions
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="sales">Volume of sales</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <RangePicker value={range} onChange={setRange} />
      </div>

      {peak === 0 ? (
        <WidgetMessage
          Icon={ActivityIcon}
          title="No trade in this period"
          detail="Settled bills will build the hourly profile."
        />
      ) : (
        <>
          <p className="text-[0.6875rem]">
            <span className="text-muted-foreground">Busiest </span>
            <span className="font-semibold tabular-nums">
              {hourLabel(busiest?.hour ?? 0)}:00–{hourLabel(((busiest?.hour ?? 0) + 1) % 24)}:00
            </span>
            <span className="text-muted-foreground">
              {' · '}
              {metric === 'transactions'
                ? `${busiest?.transactionCount ?? 0} bills`
                : compactMoney(busiest?.netSales ?? 0)}
            </span>
          </p>

          <figure className="widget-bars" aria-hidden>
            <span className="widget-bars__axis">{axisMax(peak)}</span>

            <div className="widget-bars__plot">
              {hours.data.map((row) => {
                const value = valueOf(row);
                return (
                  <span
                    key={row.hour}
                    className={`widget-bars__slot ${row.hour === busiest?.hour ? 'widget-bars__slot--peak' : ''}`}
                    title={`${hourLabel(row.hour)}:00 — ${row.transactionCount} bills, ${formatMoney(row.netSales)}`}
                  >
                    <span
                      className="widget-bars__bar"
                      style={{ height: `${peak === 0 ? 0 : (value / peak) * 100}%` }}
                    />
                  </span>
                );
              })}
            </div>

            <div className="widget-bars__ticks">
              {hours.data.map((row) => (
                <span key={row.hour} className="widget-bars__tick">
                  {LABELLED_HOURS.includes(row.hour) ? hourLabel(row.hour) : ''}
                </span>
              ))}
            </div>
          </figure>

          {/* The chart is decorative to a screen reader; this is the same data as a sentence. */}
          <p className="sr-only">
            Hourly {METRIC_LABEL[metric].toLowerCase()}:{' '}
            {hours.data
              .filter((row) => valueOf(row) > 0)
              .map(
                (row) =>
                  `${hourLabel(row.hour)}:00, ${metric === 'transactions'
                    ? `${row.transactionCount} bills`
                    : formatMoney(row.netSales)
                  }`,
              )
              .join('; ')}
          </p>
        </>
      )}
    </div>
  );
}
