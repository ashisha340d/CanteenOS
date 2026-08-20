import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useInWindow } from '@/services/WindowHost';

interface PageHeaderProps {
  title: string;
  /**
   * @deprecated No longer painted. Descriptive blurbs cost three or four lines at the top of
   * every screen to restate what the module already says on its own — and in a window, above
   * a form the operator opened on purpose, nobody is reading them. The prop is still accepted
   * so the call sites need not all be edited at once; it simply renders nothing.
   */
  subtitle?: string;
  /** @deprecated No longer painted. Same reasoning as `subtitle`. */
  eyebrow?: string;
  /** Live count, status pill, or anything that qualifies the title. */
  meta?: ReactNode;
  actions?: ReactNode;
  /** Rendered above everything, for back links. */
  leading?: ReactNode;
  className?: string;
}

/**
 * The single title treatment for every page — deliberately almost nothing.
 *
 * Inside a window the title is dropped entirely: the caption bar three pixels above it already
 * says "Entities", and printing it twice in a row is the clutter, not the information. What is
 * left is the row that actually does something — the count, and the buttons.
 */
export function PageHeader({
  title,
  meta,
  actions,
  leading,
  className,
}: PageHeaderProps): JSX.Element {
  const inWindow = useInWindow();

  // Nothing to draw: no title (the caption has it) and nothing to put beside it.
  if (inWindow && !meta && !actions && !leading) return <></>;

  return (
    <header className={cn('page-header mb-3', className)}>
      {leading}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {inWindow ? (
          // The caption names the module; only a qualifier like a live count earns space here.
          meta ?? <span />
        ) : (
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="font-heading min-w-0 truncate text-lg font-semibold tracking-tight">
              {title}
            </h1>
            {meta}
          </div>
        )}
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
