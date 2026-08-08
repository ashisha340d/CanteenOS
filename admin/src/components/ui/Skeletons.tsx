import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading placeholders that match the shape of what is coming. A spinner tells the user to
 * wait; a skeleton tells them what they are waiting for, and stops the layout jumping when
 * the data lands.
 */

/** Varying widths stop a skeleton block from reading as a barcode. */
const WIDTHS = ['72%', '54%', '81%', '46%', '67%', '59%', '76%', '50%'] as const;

function widthAt(index: number): string {
  return WIDTHS[index % WIDTHS.length] as string;
}

export function TableSkeleton({ rows = 8, columns = 5 }: { rows?: number; columns?: number }): JSX.Element {
  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      <div className="bg-muted/50 flex gap-4 px-4 py-3">
        {Array.from({ length: columns }).map((_unused, index) => (
          <Skeleton key={index} className="h-3" style={{ width: index === 0 ? 120 : 78 }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_unused, rowIndex) => (
        <div
          key={rowIndex}
          className="flex gap-4 border-t px-4 py-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1"
          // A gentle stagger so the block reads as filling in rather than blinking on.
          style={{ animationDelay: `${rowIndex * 32}ms`, animationFillMode: 'both' }}
        >
          {Array.from({ length: columns }).map((_col, colIndex) => (
            <Skeleton
              key={colIndex}
              className="h-4"
              style={{
                flex: colIndex === 0 ? '0 0 150px' : 1,
                maxWidth: widthAt(rowIndex + colIndex),
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 8 }: { count?: number }): JSX.Element {
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(258px,1fr))]">
      {Array.from({ length: count }).map((_unused, index) => (
        <div
          key={index}
          className="bg-card flex flex-col gap-3 rounded-xl border p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1"
          style={{ animationDelay: `${index * 38}ms`, animationFillMode: 'both' }}
        >
          <Skeleton className="size-9 rounded-lg" />
          <Skeleton className="h-5" style={{ width: widthAt(index) }} />
          <Skeleton className="h-3 w-[42%]" />
          <Skeleton className="mt-1 h-5 w-[72px] rounded-md" />
        </div>
      ))}
    </div>
  );
}

export function StatGridSkeleton({ count = 6 }: { count?: number }): JSX.Element {
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
      {Array.from({ length: count }).map((_unused, index) => (
        <div
          key={index}
          className="bg-card rounded-xl border p-5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1"
          style={{ animationDelay: `${index * 42}ms`, animationFillMode: 'both' }}
        >
          <Skeleton className="h-3 w-[55%]" />
          <Skeleton className="mt-2 h-9 w-[38%]" />
        </div>
      ))}
    </div>
  );
}

/** Full-page placeholder used while a lazily-loaded route chunk is in flight. */
export function PageSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <StatGridSkeleton count={4} />
      <TableSkeleton />
    </div>
  );
}
