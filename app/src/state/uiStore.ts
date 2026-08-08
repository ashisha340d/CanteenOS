import { create } from 'zustand';
import { settingsRepository, SETTINGS_KEYS } from '../db/repositories/settingsRepository';

export type ThemePreference = 'system' | 'light' | 'dark';

interface UiState {
  theme: ThemePreference;
  notificationSoundEnabled: boolean;
  loaded: boolean;
  loadPreferences: () => Promise<void>;
  setTheme: (theme: ThemePreference) => Promise<void>;
  setNotificationSoundEnabled: (enabled: boolean) => Promise<void>;
}

/**
 * Device-level preferences only (ARCHITECTURE.md §3: "Settings / configuration: Device
 * prefs only" for Android). No system-configuration keys are ever added here.
 */
export const useUiStore = create<UiState>((set) => ({
  theme: 'system',
  notificationSoundEnabled: true,
  loaded: false,

  loadPreferences: async () => {
    const theme = (await settingsRepository.get<ThemePreference>(SETTINGS_KEYS.THEME_PREFERENCE)) ?? 'system';
    const sound = await settingsRepository.get<boolean>(SETTINGS_KEYS.NOTIFICATION_SOUND_ENABLED);
    set({ theme, notificationSoundEnabled: sound ?? true, loaded: true });
  },

  setTheme: async (theme) => {
    await settingsRepository.set(SETTINGS_KEYS.THEME_PREFERENCE, theme);
    set({ theme });
  },

  setNotificationSoundEnabled: async (enabled) => {
    await settingsRepository.set(SETTINGS_KEYS.NOTIFICATION_SOUND_ENABLED, enabled);
    set({ notificationSoundEnabled: enabled });
  },
}));
