import { useRef } from 'react';
import { KioskLanguageMode } from '@menuboard/shared';
import { LANGUAGE_MODES, LANGUAGE_MODE_LABEL, useLanguage } from '../i18n';
import { Dual } from './Bilingual';
import { LotusMark, VegMark } from './Marks';

/** Held for this long on the brand mark, the tablet opens its device settings. */
const LONG_PRESS_MS = 3500;

interface HeaderProps {
  outletName: string;
  /** Null when the registry has no Devanagari name for this stand; `Dual` then shows one line. */
  outletNameHi: string | null;
  /** Staff-only escape hatch; there is deliberately no visible button for it. */
  onSettings: () => void;
  compact?: boolean;
}

export function Header({
  outletName,
  outletNameHi,
  onSettings,
  compact = false,
}: HeaderProps): JSX.Element {
  const { t } = useLanguage();
  const timer = useRef<number | null>(null);

  const startPress = (): void => {
    timer.current = window.setTimeout(onSettings, LONG_PRESS_MS);
  };
  const cancelPress = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  return (
    <header className="safe-top relative z-10 shrink-0 bg-canvas/85 backdrop-blur-xl">
      <div
        className={`mx-auto flex max-w-7xl items-center justify-between gap-4 px-7 ${
          compact ? 'py-3' : 'py-4'
        }`}
      >
        <div className="flex min-w-0 items-center gap-3.5">
          <button
            type="button"
            aria-label={t('setup.exit')}
            onPointerDown={startPress}
            onPointerUp={cancelPress}
            onPointerLeave={cancelPress}
            onPointerCancel={cancelPress}
            className="press grid size-11 shrink-0 place-items-center rounded-full border border-trim-soft bg-surface text-trim"
          >
            <LotusMark className="size-6" />
          </button>
          <div className="min-w-0">
            <Dual
              english={outletName}
              hindi={outletNameHi}
              as="h1"
              className={`truncate font-display tracking-[-0.015em] ${
                compact ? 'text-lg' : 'text-xl'
              }`}
              secondaryClassName="mt-0.5 block truncate text-[0.72em] font-normal text-ink-soft"
            />
            {!compact && (
              <p className="mt-1 flex items-center gap-2 text-2xs text-ink-faint uppercase">
                <VegMark className="size-3 text-veg" />
                {t('menu.pureVeg')}
              </p>
            )}
          </div>
        </div>

        <LanguageToggle />
      </div>
      <div className="hairline h-px" />
    </header>
  );
}

/**
 * Three modes, not two.
 *
 * The Admin Portal decides what the hall starts in; this is here so a guest who reads Hindi
 * does not have to find a member of staff to be able to order. The choice lasts one order —
 * the kiosk drops it on reset, so the next person meets the organisation's setting rather
 * than the last person's.
 */
export function LanguageToggle(): JSX.Element {
  const { mode, setMode, t } = useLanguage();

  return (
    <div
      className="flex shrink-0 items-center rounded-pill border border-line bg-surface p-1"
      role="group"
      aria-label={t('menu.language')}
    >
      {LANGUAGE_MODES.map((option) => {
        const active = option === mode;
        return (
          <button
            key={option}
            type="button"
            lang={option === KioskLanguageMode.HI ? 'hi' : 'en'}
            aria-pressed={active}
            onClick={() => setMode(option)}
            className={`press rounded-pill px-4 py-2.5 text-sm whitespace-nowrap ${
              active ? 'bg-accent text-on-accent shadow-[var(--shadow-card)]' : 'text-ink-soft'
            }`}
          >
            {LANGUAGE_MODE_LABEL[option]}
          </button>
        );
      })}
    </div>
  );
}
