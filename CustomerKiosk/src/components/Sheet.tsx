import { useEffect, useRef, type ReactNode } from 'react';
import { useLanguage } from '../i18n';
import type { StringKey } from '../i18n/strings';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Announced to screen readers and shown as the sheet's heading. */
  title: StringKey;
  description?: StringKey;
  descriptionValues?: Record<string, string | number>;
  children: ReactNode;
  /** A decision the guest must make (idle timeout) refuses a backdrop dismissal. */
  dismissible?: boolean;
}

/**
 * The kiosk's only overlay.
 *
 * A bottom sheet rather than a centred dialog because the tablet stands at chest height: the
 * bottom third is the only part of the screen a guest can comfortably reach, and a choice
 * placed in the middle of a 10-inch screen gets missed.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  descriptionValues,
  children,
  dismissible = true,
}: SheetProps): JSX.Element | null {
  const { t, ts, primaryLang, secondaryLang } = useLanguage();
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && dismissible) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, dismissible]);

  // The guest has no keyboard, but a screen reader walking the page behind an open sheet
  // reads a menu the guest cannot reach. Moving focus in is what stops that.
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
  }, [open]);

  if (!open) return null;

  const secondTitle = ts(title);
  const secondBody = description === undefined ? null : ts(description, descriptionValues);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label={t('setup.close')}
        tabIndex={dismissible ? 0 : -1}
        onClick={dismissible ? onClose : undefined}
        className="animate-fade absolute inset-0 bg-ink/35 backdrop-blur-[2px]"
      />
      <section
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t(title)}
        className="animate-rise safe-bottom relative mx-auto w-full max-w-4xl rounded-t-[2rem] border-t border-trim-soft bg-canvas px-7 pt-5 shadow-[var(--shadow-sheet)] outline-none"
      >
        <div className="mx-auto mb-5 h-1 w-12 rounded-pill bg-line-strong" aria-hidden />
        <h2 className="font-display text-2xl leading-tight tracking-[-0.01em]" lang={primaryLang}>
          {t(title)}
        </h2>
        {secondTitle !== null && (
          <p className="mt-0.5 font-display text-lg text-ink-soft" lang={secondaryLang}>
            {secondTitle}
          </p>
        )}
        {description !== undefined && (
          <>
            <p className="mt-1.5 text-base text-ink-soft" lang={primaryLang}>
              {t(description, descriptionValues)}
            </p>
            {secondBody !== null && (
              <p className="mt-0.5 text-sm text-ink-faint" lang={secondaryLang}>
                {secondBody}
              </p>
            )}
          </>
        )}
        <div className="mt-5 pb-3">{children}</div>
      </section>
    </div>
  );
}
