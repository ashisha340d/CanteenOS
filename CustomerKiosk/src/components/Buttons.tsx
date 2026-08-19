import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useLanguage } from '../i18n';
import type { StringKey } from '../i18n/strings';

type Variant = 'primary' | 'quiet' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-on-accent shadow-[var(--shadow-card)] hover:bg-accent-deep disabled:bg-line-strong disabled:text-ink-faint disabled:shadow-none',
  quiet:
    'bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-raised disabled:text-ink-faint',
  ghost: 'text-ink-soft hover:text-ink disabled:text-ink-faint',
};

interface ActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /**
   * Kiosk buttons are finger targets. `lg` is the one a guest taps to move forward and `xl`
   * is the single decisive control on a screen — a tablet in a stand is read from further
   * away and touched with less precision than a phone held in two hands.
   */
  size?: 'md' | 'lg' | 'xl';
  children: ReactNode;
}

const SIZES: Record<NonNullable<ActionProps['size']>, string> = {
  md: 'min-h-12 px-5 py-2 text-base',
  lg: 'min-h-16 px-8 py-3 text-lg',
  xl: 'min-h-[4.75rem] px-10 py-3.5 text-xl',
};

export function Action({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: ActionProps): JSX.Element {
  return (
    <button
      type="button"
      className={`press inline-flex items-center justify-center gap-2.5 rounded-pill text-center font-medium disabled:cursor-not-allowed ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

interface BilingualActionProps extends Omit<ActionProps, 'children'> {
  k: StringKey;
  values?: Record<string, string | number>;
  icon?: ReactNode;
}

/**
 * The form nearly every button on a guest screen takes: a label that becomes two lines when
 * the hall is running bilingually, stacked inside the same target rather than beside it.
 */
export function ActionLabel({ k, values, icon, ...props }: BilingualActionProps): JSX.Element {
  const { t, ts, primaryLang, secondaryLang } = useLanguage();
  const second = ts(k, values);

  return (
    <Action {...props}>
      {icon}
      <span className="inline-flex flex-col items-center leading-tight">
        <span lang={primaryLang}>{t(k, values)}</span>
        {second !== null && (
          <span className="text-[0.78em] font-normal opacity-85" lang={secondaryLang}>
            {second}
          </span>
        )}
      </span>
    </Action>
  );
}
