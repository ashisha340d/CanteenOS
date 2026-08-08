import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Theme state for the portal: which skin is painted and how large the type runs.
 *
 * Both preferences are applied to `<html>` — the skin as class names, the text size as a data
 * attribute — so the CSS custom properties in index.css do all the actual work. Nothing here
 * knows a colour value.
 */

export type ThemeSkin = 'light' | 'dark' | 'brand';
export type TextSize = 'compact' | 'default' | 'large';

const SKIN_KEY = 'menuboard.admin.theme';
const TEXT_SIZE_KEY = 'menuboard.admin.textSize';

/**
 * `brand` is the high-contrast skin. It carries `dark` as well as `contrast` so that any
 * component-level `dark:` utility still fires; `.contrast` is declared after `.dark` in
 * index.css, so at equal specificity its variables win.
 */
const SKIN_CLASSES: Record<ThemeSkin, string[]> = {
  light: [],
  dark: ['dark'],
  brand: ['dark', 'contrast'],
};

/** Tells the browser which way to paint scrollbars, caret and native form controls. */
const SKIN_COLOR_SCHEME: Record<ThemeSkin, string> = {
  light: 'light',
  dark: 'dark',
  brand: 'dark',
};

export function getStoredSkin(): ThemeSkin {
  const raw = localStorage.getItem(SKIN_KEY);
  if (raw === 'light' || raw === 'dark' || raw === 'brand') return raw;
  return 'light';
}

export function getStoredTextSize(): TextSize {
  const raw = localStorage.getItem(TEXT_SIZE_KEY);
  if (raw === 'compact' || raw === 'default' || raw === 'large') return raw;
  return 'default';
}

interface ThemeContextValue {
  skin: ThemeSkin;
  setSkin: (skin: ThemeSkin) => void;
  textSize: TextSize;
  setTextSize: (size: TextSize) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [skin, setSkinState] = useState<ThemeSkin>(getStoredSkin);
  const [textSize, setTextSizeState] = useState<TextSize>(getStoredTextSize);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'contrast');
    root.classList.add(...SKIN_CLASSES[skin]);
    root.style.colorScheme = SKIN_COLOR_SCHEME[skin];
  }, [skin]);

  useEffect(() => {
    document.documentElement.dataset['textSize'] = textSize;
  }, [textSize]);

  const setSkin = useCallback((next: ThemeSkin) => {
    setSkinState(next);
    localStorage.setItem(SKIN_KEY, next);
  }, []);

  const setTextSize = useCallback((next: TextSize) => {
    setTextSizeState(next);
    localStorage.setItem(TEXT_SIZE_KEY, next);
  }, []);

  const value = useMemo(
    () => ({ skin, setSkin, textSize, setTextSize }),
    [skin, setSkin, textSize, setTextSize],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}

export const SKIN_LABEL: Record<ThemeSkin, string> = {
  light: 'Light',
  dark: 'Dark',
  brand: 'High contrast',
};

export const TEXT_SIZE_LABEL: Record<TextSize, string> = {
  compact: 'Compact',
  default: 'Default',
  large: 'Large',
};
