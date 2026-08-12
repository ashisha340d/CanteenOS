import { useColorScheme } from 'react-native';
import { useUiStore } from '../state/uiStore';
import { colors as lightColors, darkColors, type ColorPalette } from './tokens';

export function useThemeColors(): { mode: 'light' | 'dark'; colors: ColorPalette } {
  const pref = useUiStore((s) => s.theme);
  const system = useColorScheme();
  const mode = pref === 'system' ? (system === 'dark' ? 'dark' : 'light') : pref;
  return { mode, colors: mode === 'dark' ? darkColors : lightColors };
}
