import type { ReactNode } from 'react';
import { CardGridSkeleton } from './ui/Skeletons';
import { EmptyState } from './ui/EmptyState';
import { cn } from '@/lib/utils';

interface EntityCardGridProps<T> {
  rows: T[];
  getRowId: (row: T) => string;
  renderCard: (row: T) => ReactNode;
  loading?: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyAction?: { label: string; onClick: () => void };
  /** True when a search or filter is responsible for the empty result. */
  filtered?: boolean;
  onCardClick?: (row: T) => void;
  onCardDoubleClick?: (row: T) => void;
}

/**
 * The card-view counterpart every listing page offers alongside its table. Cards are objects
 * you can pick up: they lift on hover, respond to the press, and stagger in on first paint.
 */
export function EntityCardGrid<T>({
  rows,
  getRowId,
  renderCard,
  loading,
  emptyTitle = 'Nothing here yet',
  emptyMessage,
  emptyAction,
  filtered = false,
  onCardClick,
  onCardDoubleClick,
}: EntityCardGridProps<T>): JSX.Element {
  if (loading) return <CardGridSkeleton />;

  if (rows.length === 0) {
    return (
      <EmptyState
        variant={filtered ? 'no-results' : 'empty'}
        title={filtered ? 'No matches' : emptyTitle}
        description={
          filtered
            ? 'Nothing matches the current search and filters. Try widening them.'
            : emptyMessage
        }
        {...(!filtered && emptyAction ? { action: emptyAction } : {})}
      />
    );
  }

  const interactive = Boolean(onCardClick || onCardDoubleClick);
  // A card's "activate" gesture is the double-click (the same contract as a table row); when a
  // page only wires the single click, that is what activation means instead.
  const activate = onCardDoubleClick ?? onCardClick;

  return (
    /* `min(320px, 100%)` rather than a bare `320px`: at the floor the track can still shrink to
       the container, so a narrow phone gets one full-width card instead of a sideways scroll. */
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(320px,100%),1fr))]">
      {rows.map((row, index) => (
        <div
          key={getRowId(row)}
          onClick={onCardClick ? () => onCardClick(row) : undefined}
          onDoubleClick={onCardDoubleClick ? () => onCardDoubleClick(row) : undefined}
          // Pointer users get click and double-click; without these a keyboard user could not
          // open a card at all, because a bare <div onClick> is neither focusable nor operable.
          {...(interactive && activate
            ? {
                role: 'button',
                tabIndex: 0,
                onKeyDown: (event: React.KeyboardEvent) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  activate(row);
                },
              }
            : {})}
          className={cn(
            'bg-card relative rounded-xl border p-4 transition-[transform,box-shadow,border-color]',
            'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2',
            interactive &&
            'focus-ring hover:border-border-strong cursor-pointer hover:-translate-y-[3px] hover:shadow-md active:translate-y-[-1px] active:scale-[0.995]',
          )}
          // Capped stagger: past ~12 cards the delay would be felt as lag, not polish.
          style={{
            animationDelay: `${Math.min(index, 12) * 26}ms`,
            animationFillMode: 'both',
          }}
        >
          {renderCard(row)}
        </div>
      ))}
    </div>
  );
}
