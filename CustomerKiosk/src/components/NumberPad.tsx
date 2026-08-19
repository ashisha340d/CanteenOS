import { DeleteIcon } from 'lucide-react';
import { useLanguage } from '../i18n';

interface NumberPadProps {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * Ten digits, and nothing else.
 *
 * The alternative is a text input, which on a tablet in kiosk mode summons the operating
 * system's keyboard — a full QWERTY panel that covers two thirds of the screen, offers
 * autocorrect and emoji to somebody typing a phone number, and on a locked-down device may
 * not appear at all. A pad drawn in the page is faster to use, impossible to escape from into
 * the rest of the tablet, and works the same on every device the hall might buy.
 *
 * Keys are large because this is the one moment a guest is asked to be precise, and they are
 * standing up.
 */
export function NumberPad({ value, onChange, maxLength = 10 }: NumberPadProps): JSX.Element {
  const { t } = useLanguage();

  const append = (digit: string): void => {
    if (value.length >= maxLength) return;
    onChange(value + digit);
  };

  const key =
    'press grid h-16 place-items-center rounded-md border border-line bg-surface font-display text-2xl tabular-nums hover:border-accent/45 hover:bg-accent-tint active:bg-accent-tint';

  return (
    <div className="grid grid-cols-3 gap-2.5">
      {KEYS.map((digit) => (
        <button key={digit} type="button" className={key} onClick={() => append(digit)}>
          {digit}
        </button>
      ))}

      <button
        type="button"
        className="press grid h-16 place-items-center rounded-md border border-line bg-surface text-sm text-ink-soft hover:border-line-strong"
        onClick={() => onChange('')}
        disabled={value === ''}
      >
        {t('wa.clear')}
      </button>

      <button type="button" className={key} onClick={() => append('0')}>
        0
      </button>

      <button
        type="button"
        aria-label={t('wa.delete')}
        className="press grid h-16 place-items-center rounded-md border border-line bg-surface text-ink-soft hover:border-line-strong"
        onClick={() => onChange(value.slice(0, -1))}
        disabled={value === ''}
      >
        <DeleteIcon className="size-6" />
      </button>
    </div>
  );
}

/**
 * The number as it is being typed, in the shape Indian mobile numbers are read in. Placeholder
 * dashes rather than an empty box, so the guest can see how many digits are still wanted.
 */
export function PhoneDisplay({ value, length = 10 }: { value: string; length?: number }): JSX.Element {
  return (
    <p className="numeric font-display text-3xl tracking-[0.12em]" aria-live="polite">
      {Array.from({ length }, (_, index) => (
        <span key={index} className={index < value.length ? 'text-ink' : 'text-line-strong'}>
          {index === 5 ? ' ' : ''}
          {value[index] ?? '–'}
        </span>
      ))}
    </p>
  );
}
