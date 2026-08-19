import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { KioskLanguageMode } from '@menuboard/shared';
import { LANGUAGE_MODE_LABEL, STRINGS, type StringKey } from './strings';

/**
 * Three modes over two tables.
 *
 * `BOTH` is not a fallback for a missing translation — it is a deliberate setting for a hall
 * whose queue is mixed, and it renders every label twice rather than choosing. That is why
 * nothing here returns a pre-joined "Name / नाम" string: a joined string cannot be styled,
 * cannot be given the leading Devanagari needs, and cannot wrap in two places. Every reader
 * gets a primary and an optional secondary, and the component decides how to stack them.
 *
 * The mode is chosen once in the Admin Portal and pushed to every kiosk in the hall. A guest
 * may still switch it for their own order from the header — a reader of Hindi should not have
 * to find a member of staff — and the choice is dropped when the kiosk returns to the menu, so
 * the next person meets the house setting rather than the last person's.
 */

export interface LanguageContextValue {
  mode: KioskLanguageMode;
  /** Overrides the organisation's mode for this guest only. */
  setMode: (mode: KioskLanguageMode) => void;
  /** Drops any guest override; called when the kiosk resets for the next person. */
  resetMode: () => void;
  /** What `Intl` should format numbers, money and clock times with. */
  locale: 'en-IN' | 'hi-IN';
  /** The primary line: `t('eta.ready', { minutes: 12 })` — placeholders are `{name}`. */
  t: (key: StringKey, values?: Record<string, string | number>) => string;
  /** The second line, or null when the mode shows only one language. */
  ts: (key: StringKey, values?: Record<string, string | number>) => string | null;
  /** Picks the right column of a Menu Master row for the primary line. */
  pick: (english: string, hindi: string | null | undefined) => string;
  /** The same row's other column, or null when there is nothing worth showing twice. */
  picks: (english: string, hindi: string | null | undefined) => string | null;
  /** `lang` attribute for the primary and secondary lines, so the right font is picked. */
  primaryLang: 'en' | 'hi';
  secondaryLang: 'en' | 'hi';
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function fill(template: string, values?: Record<string, string | number>): string {
  if (values === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    values[name] === undefined ? match : String(values[name]),
  );
}

interface LanguageProviderProps {
  /** The organisation's setting. Changing it re-bases the kiosk unless a guest has overridden. */
  defaultMode: KioskLanguageMode;
  children: ReactNode;
}

export function LanguageProvider({ defaultMode, children }: LanguageProviderProps): JSX.Element {
  const [override, setOverride] = useState<KioskLanguageMode | null>(null);
  const mode = override ?? defaultMode;

  // Set on <html> rather than on a wrapper: the Devanagari font rule keys off `:lang(hi)`,
  // and a document that never declares its language leaves the whole tree in the Latin face.
  useEffect(() => {
    document.documentElement.lang = mode === KioskLanguageMode.HI ? 'hi' : 'en';
  }, [mode]);

  const setMode = useCallback((next: KioskLanguageMode) => setOverride(next), []);
  const resetMode = useCallback(() => setOverride(null), []);

  const value = useMemo<LanguageContextValue>(() => {
    const primary = mode === KioskLanguageMode.HI ? STRINGS.hi : STRINGS.en;
    const secondary = mode === KioskLanguageMode.BOTH ? STRINGS.hi : null;
    const hindiPrimary = mode === KioskLanguageMode.HI;

    return {
      mode,
      setMode,
      resetMode,
      locale: hindiPrimary ? 'hi-IN' : 'en-IN',
      t: (key, values) => fill(primary[key], values),
      ts: (key, values) => (secondary === null ? null : fill(secondary[key], values)),
      pick: (english, hindi) => (hindiPrimary && hindi ? hindi : english),
      picks: (english, hindi) => {
        if (mode !== KioskLanguageMode.BOTH) return null;
        // A row whose Hindi column was never filled in, or was filled in with the English
        // name, would otherwise print the same words twice under each other.
        if (!hindi || hindi.trim() === '' || hindi.trim() === english.trim()) return null;
        return hindi;
      },
      primaryLang: hindiPrimary ? 'hi' : 'en',
      secondaryLang: 'hi',
    };
  }, [mode, setMode, resetMode]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (context === null) throw new Error('useLanguage must be used inside LanguageProvider');
  return context;
}

export const LANGUAGE_MODES = [
  KioskLanguageMode.EN,
  KioskLanguageMode.HI,
  KioskLanguageMode.BOTH,
] as const;

export { LANGUAGE_MODE_LABEL };
export type { StringKey };
