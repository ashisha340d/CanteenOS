import type { ReactNode } from 'react';
import { InboxIcon, SearchXIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  title: string;
  /** Say what would put something here, not merely that nothing is here. */
  description?: string;
  action?: { label: string; onClick: () => void };
  /** Overrides the default mark. Keep it geometric — no clip art. */
  icon?: ReactNode;
  /** Use when a filter or search produced the emptiness, not an empty dataset. */
  variant?: 'empty' | 'no-results';
  className?: string;
}

/**
 * Empty is a state worth designing, not an accident. A whisper of the accent behind the mark
 * keeps the void feeling like part of the product rather than a rendering failure.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  variant = 'empty',
  className,
}: EmptyStateProps): JSX.Element {
  return (
    <Empty
      className={cn(
        'bg-[radial-gradient(ellipse_60%_70%_at_50%_0%,var(--sidebar-accent),transparent_70%)] py-14 md:py-20',
        className,
      )}
    >
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-card text-muted-foreground size-14 rounded-xl border shadow-sm">
          {icon ?? (variant === 'no-results' ? <SearchXIcon /> : <InboxIcon />)}
        </EmptyMedia>
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && (
        <EmptyContent>
          <Button onClick={action.onClick}>{action.label}</Button>
        </EmptyContent>
      )}
    </Empty>
  );
}
