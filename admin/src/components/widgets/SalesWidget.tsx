import { useMemo, useState } from 'react';
import { MinusIcon, ReceiptTextIcon, TrendingDownIcon, TrendingUpIcon } from 'lucide-react';
import { usePosSalesSummary } from '@/hooks/usePos';
import { formatMoney } from '@/pages/Pos/posFormat';
import {
  compactMoney,
  percentChange,
  RangePicker,
  RANGE_LABEL,
  rangeToQuery,
  WidgetMessage,
  WidgetSkeleton,
  type WidgetRange,
} from './widgetUi';

/**
 * What the till has taken over a period, against the period before it.
 *
 * The comparison is the point. A day's takings on their own tell an operator almost nothing —
 * ₹42,000 is a triumph on a Tuesday and a disaster during a festival week — so the delta
 * against the equivalent preceding period is given the same weight as the figure itself.
 */

/** Normalised to 0–100 so the polyline is independent of the box it is drawn into. */
function sparklinePoints(values: number[]): string {
  if (values.length < 2) return '';
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 100 - ((value - min) / span) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

export function SalesWidget(): JSX.Element {
  const [range, setRange] = useState<WidgetRange>('today');
  const query = useMemo(() => rangeToQuery(range), [range]);
  const sales = usePosSalesSummary(query);

  if (sales.isPending) return <WidgetSkeleton lines={3} />;

  if (sales.isError || sales.data === undefined) {
    return (
      <WidgetMessage
        Icon={ReceiptTextIcon}
        title="Sales unavailable"
        detail="The till figures could not be read."
        action={{ label: 'Try again', onClick: () => void sales.refetch() }}
        tone="danger"
      />
    );
  }

  const data = sales.data;
  const change = percentChange(data.netSales, data.previous.netSales);
  const Trend = change === null || change === 0 ? MinusIcon : change > 0 ? TrendingUpIcon : TrendingDownIcon;
  const trendTone =
    change === null || change === 0
      ? 'text-muted-foreground'
      : change > 0
        ? 'text-tone-success'
        : 'text-tone-danger';

  const points = sparklinePoints(data.series.map((day) => day.netSales));

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className="truncate text-2xl leading-tight font-semibold tabular-nums"
            title={formatMoney(data.netSales)}
          >
            {compactMoney(data.netSales)}
          </p>
          <p className="text-muted-foreground text-[0.625rem] font-medium tracking-wide uppercase">
            Net sales
          </p>
        </div>
        <RangePicker value={range} onChange={setRange} />
      </div>

      <p className={`flex items-center gap-1 text-[0.6875rem] font-medium ${trendTone}`}>
        <Trend className="size-3.5 shrink-0" aria-hidden />
        {change === null ? (
          <span className="text-muted-foreground">No comparable period</span>
        ) : (
          <span className="tabular-nums">
            {change > 0 ? '+' : ''}
            {change.toFixed(1)}%
          </span>
        )}
        <span className="text-muted-foreground truncate font-normal">
          vs previous {RANGE_LABEL[range].replace('Last ', '').toLowerCase()}
        </span>
      </p>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-2 text-[0.6875rem]">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-muted-foreground">Bills</dt>
          <dd className="font-medium tabular-nums">{data.transactionCount}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-muted-foreground">Average</dt>
          <dd className="font-medium tabular-nums" title={formatMoney(data.averageTicket)}>
            {compactMoney(data.averageTicket)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-muted-foreground">Items</dt>
          <dd className="font-medium tabular-nums">{Math.round(data.itemsSold)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-muted-foreground">Refunded</dt>
          <dd
            className={`font-medium tabular-nums ${data.refundedAmount > 0 ? 'text-tone-danger' : ''}`}
            title={formatMoney(data.refundedAmount)}
          >
            {compactMoney(data.refundedAmount)}
          </dd>
        </div>
      </dl>

      {/* One day is a point, not a line — the sparkline only appears when it can say something. */}
      {points !== '' && (
        <svg
          className="mt-auto h-8 w-full shrink-0 overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Daily net sales across the ${RANGE_LABEL[range].toLowerCase()}`}
        >
          <polyline
            points={points}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}
