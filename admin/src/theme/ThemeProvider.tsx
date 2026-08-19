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

/**
 * The look of the OS shell — wallpaper, window chrome, status bar — as opposed to `ThemeSkin`,
 * which paints the page content inside a window. The two are independent on purpose, exactly
 * as a real desktop separates its theme from the applications running on it.
 */
export type DesktopSkin = 'sandalwood' | 'graphite' | 'azure' | 'beta';

export const DESKTOP_SKINS: DesktopSkin[] = ['sandalwood', 'graphite', 'azure', 'beta'];

const SKIN_KEY = 'menuboard.admin.theme';
const TEXT_SIZE_KEY = 'menuboard.admin.textSize';
const DESKTOP_SKIN_KEY = 'menuboard.admin.desktopSkin';

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

export function getStoredDesktopSkin(): DesktopSkin {
  const raw = localStorage.getItem(DESKTOP_SKIN_KEY);
  if (DESKTOP_SKINS.includes(raw as DesktopSkin)) return raw as DesktopSkin;
  return 'sandalwood';
}

interface ThemeContextValue {
  skin: ThemeSkin;
  setSkin: (skin: ThemeSkin) => void;
  textSize: TextSize;
  setTextSize: (size: TextSize) => void;
  desktopSkin: DesktopSkin;
  setDesktopSkin: (skin: DesktopSkin) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [skin, setSkinState] = useState<ThemeSkin>(getStoredSkin);
  const [textSize, setTextSizeState] = useState<TextSize>(getStoredTextSize);
  const [desktopSkin, setDesktopSkinState] = useState<DesktopSkin>(getStoredDesktopSkin);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'contrast');
    root.classList.add(...SKIN_CLASSES[skin]);
    root.style.colorScheme = SKIN_COLOR_SCHEME[skin];
  }, [skin]);

  useEffect(() => {
    document.documentElement.dataset['textSize'] = textSize;
  }, [textSize]);

  useEffect(() => {
    document.documentElement.dataset['desktopSkin'] = desktopSkin;
  }, [desktopSkin]);

  const setSkin = useCallback((next: ThemeSkin) => {
    setSkinState(next);
    localStorage.setItem(SKIN_KEY, next);
  }, []);

  const setTextSize = useCallback((next: TextSize) => {
    setTextSizeState(next);
    localStorage.setItem(TEXT_SIZE_KEY, next);
  }, []);

  const setDesktopSkin = useCallback((next: DesktopSkin) => {
    setDesktopSkinState(next);
    localStorage.setItem(DESKTOP_SKIN_KEY, next);
  }, []);

  const value = useMemo(
    () => ({ skin, setSkin, textSize, setTextSize, desktopSkin, setDesktopSkin }),
    [skin, setSkin, textSize, setTextSize, desktopSkin, setDesktopSkin],
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

export const DESKTOP_SKIN_LABEL: Record<DesktopSkin, string> = {
  sandalwood: 'Sandalwood',
  graphite: 'Graphite',
  azure: 'Azure',
  beta: 'Beta',
};

/** The two colours each skin is recognisable by, for the swatch in the compact picker. */
export const DESKTOP_SKIN_SWATCH: Record<DesktopSkin, [string, string]> = {
  sandalwood: ['#fdf9f4', '#c1440e'],
  graphite: ['#23252b', '#6ea8fe'],
  azure: ['#eef2f7', '#0f6cbd'],
  beta: ['#111318', '#948dff'],
};

export const DESKTOP_SKIN_HINT: Record<DesktopSkin, string> = {
  sandalwood: 'Warm ivory and terracotta. Easy on the eye over a long shift.',
  graphite: 'Low-light slate. For dim rooms and screens viewed after dark.',
  azure: 'Cool steel. The highest contrast of the three in daylight.',
  beta: 'Fluent graphite in the brand accent. Flat surfaces, hairline borders, tight 8px frames — the workstation skin. Pair it with the Dark window content theme.',
};

/**
 * Enough of each palette to paint a miniature of the desktop in the picker. Duplicated from
 * desktopSkins.css by necessity — a preview has to show a skin that is *not* currently applied,
 * so it cannot read the live custom properties.
 */
export interface DesktopSkinPreview {
  bg: string;
  chromeFrom: string;
  chromeTo: string;
  body: string;
  bar: string;
  border: string;
  accent: string;
}

export const DESKTOP_SKIN_PREVIEW: Record<DesktopSkin, DesktopSkinPreview> = {
  sandalwood: {
    bg: '#fdf9f4',
    chromeFrom: '#d2c6b2',
    chromeTo: '#b8a890',
    body: '#ffffff',
    bar: '#e4dbcc',
    border: '#a89880',
    accent: '#c1440e',
  },
  graphite: {
    bg: '#17181d',
    chromeFrom: '#343841',
    chromeTo: '#262930',
    body: '#15151f',
    bar: '#1f2127',
    border: '#464a54',
    accent: '#6ea8fe',
  },
  azure: {
    bg: '#eef2f7',
    chromeFrom: '#dce6f2',
    chromeTo: '#c3d3e8',
    body: '#ffffff',
    bar: '#dce6f2',
    border: '#9db3cd',
    accent: '#0f6cbd',
  },
  beta: {
    bg: '#111318',
    chromeFrom: '#22252b',
    chromeTo: '#22252b',
    body: '#1c1f24',
    bar: '#15171c',
    border: '#2e323a',
    accent: '#948dff',
  },
};
