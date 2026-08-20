import { useMemo, useState } from 'react';
import { TrophyIcon, UtensilsIcon } from 'lucide-react';
import { usePosTopItems } from '@/hooks/usePos';
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
 * What is actually selling, ranked by money rather than by count.
 *
 * Ranking by quantity would put the ₹10 tea at the top of every canteen in the country and
 * say nothing anyone can act on. Revenue share is the figure that decides what gets prepped,
 * so the bar behind each row is share of takings, and the count is secondary detail.
 */

const TOP_ITEM_LIMIT = 6;

export function TopItemsWidget(): JSX.Element {
  const [range, setRange] = useState<WidgetRange>('today');
  const query = useMemo(() => ({ ...rangeToQuery(range), limit: TOP_ITEM_LIMIT }), [range]);
  const items = usePosTopItems(query);

  if (items.isPending) return <WidgetSkeleton lines={4} />;

  if (items.isError || items.data === undefined) {
    return (
      <WidgetMessage
        Icon={UtensilsIcon}
        title="Item figures unavailable"
        detail="The till lines could not be read."
        action={{ label: 'Try again', onClick: () => void items.refetch() }}
        tone="danger"
      />
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-[0.625rem] font-medium tracking-wide uppercase">
          By revenue
        </p>
        <RangePicker value={range} onChange={setRange} />
      </div>

      {items.data.length === 0 ? (
        <WidgetMessage
          Icon={TrophyIcon}
          title="Nothing sold yet"
          detail="Settled bills in this period will rank here."
        />
      ) : (
        <ol className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto">
          {items.data.map((item, index) => {
            const name =
              item.variantName === null ? item.itemName : `${item.itemName} · ${item.variantName}`;
            return (
              <li key={`${item.menuItemId ?? 'custom'}-${name}`} className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-muted-foreground w-3 shrink-0 text-[0.625rem] tabular-nums">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.6875rem] font-medium" title={name}>
                    {name}
                  </span>
                  <span
                    className="shrink-0 text-[0.6875rem] font-semibold tabular-nums"
                    title={formatMoney(item.netAmount)}
                  >
                    {compactMoney(item.netAmount)}
                  </span>
                </div>

                <div className="flex items-center gap-2 pl-5">
                  <span
                    className="bg-muted h-1 min-w-0 flex-1 overflow-hidden rounded-full"
                    role="presentation"
                  >
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.max(2, item.share * 100)}%`,
                        background: 'var(--chart-1)',
                      }}
                    />
                  </span>
                  <span className="text-muted-foreground w-14 shrink-0 text-right text-[0.625rem] tabular-nums">
                    {Math.round(item.quantity)} × · {Math.round(item.share * 100)}%
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
