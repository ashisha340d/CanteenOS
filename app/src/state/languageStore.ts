import { create } from 'zustand';
import { settingsRepository, SETTINGS_KEYS } from '../db/repositories';
import type { Language } from '../i18n';

/**
 * Interface language, held per device.
 *
 * Employees get Hindi by default. On a kitchen floor the board is read by whoever is nearest
 * to it, and making them find a settings screen before they can read today's orders defeats
 * the point; everyone else defaults to English and can switch. The choice, once made, is the
 * user's and is never overridden by role again.
 */
interface LanguageState {
  language: Language;
  /** False until the stored preference has been read, so screens don't flash the wrong language. */
  isLoaded: boolean;
  load: (role: string | undefined) => Promise<void>;
  setLanguage: (language: Language) => Promise<void>;
}

export const useLanguageStore = create<LanguageState>((set) => ({
  language: 'en',
  isLoaded: false,

  load: async (role) => {
    const stored = await settingsRepository.get<Language>(SETTINGS_KEYS.LANGUAGE);
    if (stored === 'en' || stored === 'hi') {
      set({ language: stored, isLoaded: true });
      return;
    }
    const initial: Language = role === 'EMPLOYEE' ? 'hi' : 'en';
    await settingsRepository.set(SETTINGS_KEYS.LANGUAGE, initial);
    set({ language: initial, isLoaded: true });
  },

  setLanguage: async (language) => {
    await settingsRepository.set(SETTINGS_KEYS.LANGUAGE, language);
    set({ language });
  },
}));

/** Convenience for components that only need to read the current language. */
export function useLanguage(): Language {
  return useLanguageStore((state) => state.language);
}
