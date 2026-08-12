import type { ReactNode } from 'react';
import { TONE_BG_CLASS, TONE_BORDER_CLASS, TONE_TEXT_CLASS, type StatusToneName } from '@/lib/tones';
import { cn } from '@/lib/utils';

interface StatTileProps {
  label: string;
  value: string | number;
  /** Short qualifier under the number — a comparison, a unit, a timestamp. */
  hint?: string;
  tone?: StatusToneName;
  icon?: ReactNode;
  /** Draws attention to the one number that should change behaviour, e.g. overdue orders. */
  emphasis?: boolean;
  onClick?: () => void;
}

/**
 * A single figure, sized to be read across a room. The label sits above the number because
 * the eye lands on the largest element first and should already know what it is looking at.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
  emphasis = false,
  onClick,
}: StatTileProps): JSX.Element {
  const interactive = Boolean(onClick);

  return (
    <div
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={cn(
        'bg-card relative overflow-hidden rounded-xl border p-4 transition-[transform,box-shadow,border-color]',
        emphasis ? TONE_BORDER_CLASS[tone] : 'border-border',
        interactive &&
          'focus-ring hover:border-border-strong cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:translate-y-0',
      )}
    >
      {/* A tinted wash rather than a coloured card: the number stays the loudest thing. */}
      {emphasis && (
        <div
          aria-hidden
          className={cn('pointer-events-none absolute inset-0 opacity-70', TONE_BG_CLASS[tone])}
          style={{ maskImage: 'radial-gradient(ellipse 90% 130% at 100% 0%, #000, transparent 62%)' }}
        />
      )}

      <div className="relative flex items-center justify-between gap-2">
        <span className="text-muted-foreground min-w-0 truncate text-xs font-medium tracking-[0.06em] uppercase">
          {label}
        </span>
        {icon && (
          <span
            aria-hidden
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-md [&_svg]:size-4',
              TONE_BG_CLASS[tone],
              TONE_TEXT_CLASS[tone],
            )}
          >
            {icon}
          </span>
        )}
      </div>

      <p
        className={cn(
          'relative mt-1.5 font-bold tabular-nums',
          'text-[clamp(1.5rem,1.1rem+1vw,2.25rem)] leading-[1.05] tracking-[-0.03em]',
          emphasis ? TONE_TEXT_CLASS[tone] : 'text-foreground',
        )}
      >
        {value}
      </p>

      {hint && <p className="text-muted-foreground relative mt-1 text-xs">{hint}</p>}
    </div>
  );
}
