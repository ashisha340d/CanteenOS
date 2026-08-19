import { useLanguage } from '../i18n';
import type { StringKey } from '../i18n/strings';
import { LottieMark } from '../lottie/Lottie';
import { Action } from './Buttons';
import { Bilingual } from './Bilingual';
import { LotusMark } from './Marks';

/**
 * Loading is a designed state: a lotus opening and closing, and what is being waited for.
 *
 * Not a spinner. A spinner tells a guest the machine is busy; a flower that breathes tells
 * them to wait a moment, which is the thing actually worth saying to somebody standing in a
 * hall — and it is the one ornament this kiosk allows itself, so it may as well be the
 * organisation's own mark rather than a borrowed circle.
 */
export function Loading({ k }: { k: StringKey }): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-24">
      <LottieMark name="lotus" size={104} className="text-trim" />
      <Bilingual
        k={k}
        as="p"
        className="text-center text-2xs tracking-[0.24em] text-ink-faint uppercase"
        secondaryClassName="mt-1 block text-[0.95em] tracking-[0.14em]"
      />
    </div>
  );
}

interface NoticeProps {
  title: StringKey;
  body: StringKey;
  /**
   * The server's own wording, when there is one. Untranslated on purpose — a message written
   * by the backend is more useful to the staff member the guest is about to fetch than a
   * generic sentence in the right language would be.
   */
  detail?: string | null;
  onRetry?: () => void;
}

export function Notice({ title, body, detail, onRetry }: NoticeProps): JSX.Element {
  const { t, ts, primaryLang, secondaryLang } = useLanguage();
  const retrySecond = ts('error.retry');

  return (
    <div className="animate-emerge flex flex-1 flex-col items-center justify-center gap-4 px-8 py-24 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-accent-tint text-accent">
        <LotusMark className="size-9" />
      </span>
      <Bilingual k={title} as="h2" className="font-display text-2xl" />
      <Bilingual
        k={body}
        as="p"
        className="max-w-md text-base leading-relaxed text-ink-soft"
        secondaryClassName="mt-1.5 block text-[0.92em] text-ink-faint"
      />
      {detail !== undefined && detail !== null && detail !== '' && (
        <p className="max-w-md rounded-sm border border-line bg-surface px-4 py-2.5 text-xs text-ink-faint">
          {detail}
        </p>
      )}
      {onRetry !== undefined && (
        <Action variant="quiet" size="lg" onClick={onRetry} className="mt-2">
          <span className="inline-flex flex-col items-center leading-tight">
            <span lang={primaryLang}>{t('error.retry')}</span>
            {retrySecond !== null && (
              <span className="text-[0.78em] font-normal opacity-85" lang={secondaryLang}>
                {retrySecond}
              </span>
            )}
          </span>
        </Action>
      )}
    </div>
  );
}
