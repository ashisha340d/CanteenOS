import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  /** One line of orienting context. Omit rather than pad it with filler. */
  subtitle?: string;
  /** Small caps label above the title — usually the section the page belongs to. */
  eyebrow?: string;
  /** Live count, status pill, or anything that qualifies the title. */
  meta?: ReactNode;
  actions?: ReactNode;
  /** Rendered above everything, for back links. */
  leading?: ReactNode;
  className?: string;
}

/**
 * The single title treatment for every page. Large type carries the hierarchy so pages do
 * not each invent their own heading size, and actions always land in the same place.
 *
 * On mobile the actions drop below the title and stretch, because a row of small buttons
 * pinned to the right edge of a narrow screen is neither readable nor tappable.
 */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  meta,
  actions,
  leading,
  className,
}: PageHeaderProps): JSX.Element {
  return (
    <header className={cn('mb-6', className)}>
      {leading}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end sm:gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1 text-xs font-medium tracking-[0.06em] text-muted-foreground uppercase">
              {eyebrow}
            </p>
          )}
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="font-heading min-w-0 truncate text-2xl font-bold tracking-tight sm:text-3xl">
              {title}
            </h1>
            {meta}
          </div>
          {subtitle && (
            <p className="text-muted-foreground mt-1.5 max-w-[68ch] text-sm">{subtitle}</p>
          )}
        </div>
        {actions && (
          /* On a narrow screen these stretch *and* grow to a thumb-sized target — the default
             control height is tuned for a dense desktop grid and is too small to hit reliably. */
          <div className="flex shrink-0 flex-wrap items-center gap-2 *:max-sm:min-h-11 *:max-sm:flex-1">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
