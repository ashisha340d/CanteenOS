import { useLang, useT } from '../i18n';
import { IndiaFlag, UkFlag } from './Flags';

/**
 * One tap flips the whole screen between Hindi and English. Both flags stay visible — the
 * counter person is choosing between two things they can see, not toggling a state they have
 * to remember — and the live one is the lit one.
 */
export function LanguageSwitch({ compact = false }: { compact?: boolean }): JSX.Element {
  const { lang, setLang } = useLang();
  const t = useT();

  return (
    <div className={`kds-lang ${compact ? 'kds-lang--compact' : ''}`} role="group" aria-label={t.language}>
      <button
        type="button"
        className={`kds-lang__btn ${lang === 'hi' ? 'kds-lang__btn--on' : ''}`}
        onClick={() => setLang('hi')}
        aria-pressed={lang === 'hi'}
        title={t.switchToHindi}
      >
        <IndiaFlag />
        <span>{t.languageHindi}</span>
      </button>
      <button
        type="button"
        className={`kds-lang__btn ${lang === 'en' ? 'kds-lang__btn--on' : ''}`}
        onClick={() => setLang('en')}
        aria-pressed={lang === 'en'}
        title={t.switchToEnglish}
      >
        <UkFlag />
        <span>{t.languageEnglish}</span>
      </button>
    </div>
  );
}
