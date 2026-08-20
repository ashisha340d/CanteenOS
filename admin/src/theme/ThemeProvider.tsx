import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  defaultIconSetFor,
  iconSetSuits,
  iconSetsForSkin,
  type IconSetDefinition,
} from './iconSets';

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
export type DesktopSkin = 'sandalwood' | 'graphite' | 'azure' | 'meridian';

export const DESKTOP_SKINS: DesktopSkin[] = ['sandalwood', 'graphite', 'azure', 'meridian'];

/** The typeface the entire portal is set in. Stacks live in theme/appearance.css. */
export type FontChoice =
  | 'geist'
  | 'inter'
  | 'manrope'
  | 'jakarta'
  | 'figtree'
  | 'lexend'
  | 'plex'
  | 'source'
  | 'public'
  | 'outfit'
  | 'dmsans'
  | 'grotesk';

export const FONT_CHOICES: FontChoice[] = [
  'geist',
  'inter',
  'manrope',
  'jakarta',
  'figtree',
  'lexend',
  'plex',
  'source',
  'public',
  'outfit',
  'dmsans',
  'grotesk',
];

const SKIN_KEY = 'menuboard.admin.theme';
const TEXT_SIZE_KEY = 'menuboard.admin.textSize';
const DESKTOP_SKIN_KEY = 'menuboard.admin.desktopSkin';
const FONT_KEY = 'menuboard.admin.font';
const ICON_SET_KEY = 'menuboard.admin.iconSet';
const WALLPAPER_KEY = 'menuboard.admin.wallpaper';

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

export function getStoredFont(): FontChoice {
  const raw = localStorage.getItem(FONT_KEY);
  if (FONT_CHOICES.includes(raw as FontChoice)) return raw as FontChoice;
  return 'geist';
}

/**
 * Icon sets are chosen *per skin*, not once globally: a set belongs to the wallpaper it was
 * drawn for, so switching to Graphite and back to Sandalwood should return the icons you had
 * under Sandalwood rather than the nearest legal substitute for a Graphite set.
 */
function getStoredIconSets(): Partial<Record<DesktopSkin, string>> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(ICON_SET_KEY) ?? '{}');
    if (typeof raw !== 'object' || raw === null) return {};
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).filter(
        ([skin, id]) =>
          DESKTOP_SKINS.includes(skin as DesktopSkin) &&
          typeof id === 'string' &&
          iconSetSuits(id, skin as DesktopSkin),
      ),
    ) as Partial<Record<DesktopSkin, string>>;
  } catch {
    return {};
  }
}

interface ThemeContextValue {
  skin: ThemeSkin;
  setSkin: (skin: ThemeSkin) => void;
  textSize: TextSize;
  setTextSize: (size: TextSize) => void;
  desktopSkin: DesktopSkin;
  setDesktopSkin: (skin: DesktopSkin) => void;
  font: FontChoice;
  setFont: (font: FontChoice) => void;
  /** Always a set that suits the current desktop skin. */
  iconSet: string;
  setIconSet: (set: string) => void;
  /** The sets the current skin offers, for the picker and the context menu. */
  iconSetOptions: IconSetDefinition[];
  /** The operator's own desktop picture as a data URL, or null for the skin's own wallpaper. */
  wallpaper: string | null;
  setWallpaper: (dataUrl: string | null) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [skin, setSkinState] = useState<ThemeSkin>(getStoredSkin);
  const [textSize, setTextSizeState] = useState<TextSize>(getStoredTextSize);
  const [desktopSkin, setDesktopSkinState] = useState<DesktopSkin>(getStoredDesktopSkin);
  const [font, setFontState] = useState<FontChoice>(getStoredFont);
  const [iconSets, setIconSets] = useState<Partial<Record<DesktopSkin, string>>>(getStoredIconSets);
  const [wallpaper, setWallpaperState] = useState<string | null>(
    () => localStorage.getItem(WALLPAPER_KEY),
  );

  /* Resolved rather than stored: whatever this skin was last given, falling back to the set
     the skin ships with. This is what makes an incompatible pairing unrepresentable — there
     is no state in which the active skin and the active icon set disagree. */
  const iconSet = iconSets[desktopSkin] ?? defaultIconSetFor(desktopSkin);
  const iconSetOptions = useMemo(() => iconSetsForSkin(desktopSkin), [desktopSkin]);

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

  useEffect(() => {
    document.documentElement.dataset['font'] = font;
  }, [font]);

  useEffect(() => {
    document.documentElement.dataset['iconSet'] = iconSet;
  }, [iconSet]);

  /* Published as a custom property rather than an <img>, so the desktop stylesheet keeps full
     control of layer order — the picture sits under the skin's glows, not over them. */
  useEffect(() => {
    const root = document.documentElement;
    if (wallpaper === null) root.style.removeProperty('--desk-user-image');
    else root.style.setProperty('--desk-user-image', `url("${wallpaper}")`);
  }, [wallpaper]);

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

  const setFont = useCallback((next: FontChoice) => {
    setFontState(next);
    localStorage.setItem(FONT_KEY, next);
  }, []);

  const setWallpaper = useCallback((next: string | null) => {
    setWallpaperState(next);
    if (next === null) localStorage.removeItem(WALLPAPER_KEY);
    else localStorage.setItem(WALLPAPER_KEY, next);
  }, []);

  const setIconSet = useCallback(
    (next: string) => {
      if (!iconSetSuits(next, desktopSkin)) return;
      setIconSets((prev) => {
        const merged = { ...prev, [desktopSkin]: next };
        localStorage.setItem(ICON_SET_KEY, JSON.stringify(merged));
        return merged;
      });
    },
    [desktopSkin],
  );

  const value = useMemo(
    () => ({
      skin,
      setSkin,
      textSize,
      setTextSize,
      desktopSkin,
      setDesktopSkin,
      font,
      setFont,
      iconSet,
      setIconSet,
      iconSetOptions,
      wallpaper,
      setWallpaper,
    }),
    [
      skin,
      setSkin,
      textSize,
      setTextSize,
      desktopSkin,
      setDesktopSkin,
      font,
      setFont,
      iconSet,
      setIconSet,
      iconSetOptions,
      wallpaper,
      setWallpaper,
    ],
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

/**
 * Ten faces chosen for a dense operational portal read over a long shift: open apertures,
 * unambiguous digits, and a tall enough x-height to stay legible at the compact text size.
 * The hint says what each one is actually good at, not what it looks like.
 */
export const FONT_LABEL: Record<FontChoice, string> = {
  geist: 'Geist',
  inter: 'Inter',
  manrope: 'Manrope',
  jakarta: 'Plus Jakarta Sans',
  figtree: 'Figtree',
  lexend: 'Lexend',
  plex: 'IBM Plex Sans',
  source: 'Source Sans 3',
  public: 'Public Sans',
  outfit: 'Outfit',
  dmsans: 'DM Sans',
  grotesk: 'Space Grotesk',
};

export const FONT_HINT: Record<FontChoice, string> = {
  geist: 'The default. Neutral grotesque with tabular figures — built for interfaces.',
  inter: 'The most-tested UI face there is. Very high legibility at small sizes.',
  manrope: 'Semi-rounded and a little warmer. Reads well in headings.',
  jakarta: 'Geometric with tall lowercase. Distinctive without being loud.',
  figtree: 'Friendly geometric sans. Soft, but keeps its shape when dense.',
  lexend: 'Engineered for reading speed. The easiest of the twelve to scan quickly.',
  plex: 'IBM’s corporate face. Slightly technical; excellent numerals.',
  source: 'Adobe’s UI workhorse. Compact, so more fits on a row.',
  public: 'Plain, sturdy, and neutral. Nothing about it draws attention.',
  outfit: 'Pure geometric. Strong at large sizes, best paired with a large text size.',
  dmsans: 'Low-contrast geometric with a short x-height. Calm in long columns of figures.',
  grotesk: 'Technical and slightly squared. The most distinctive face here; strong numerals.',
};

/**
 * A different specimen per face, rather than one string repeated twelve times.
 *
 * A sampler that shows the same words in every font is a test of the reader's memory — by the
 * fourth card you are comparing a typeface to your recollection of the first. Different strings
 * make the comparison worse in theory and far better in practice, because each line is chosen to
 * exercise the thing that face is being judged on: tabular figures, a rupee sign, a time range,
 * a minus sign, an all-caps run, a batch code with letters and digits adjacent.
 *
 * All twelve are drawn from what this portal actually renders. None is lorem ipsum.
 */
export const FONT_SAMPLE: Record<FontChoice, string> = {
  geist: '₹1,24,650.00 · 09:45 · 128 kg',
  inter: 'Invoice INV-2026-0847 · ₹98,320',
  manrope: 'Masala Dosa × 24 — Counter 3',
  jakarta: 'GRN 5512 · 18 crates · 06:30',
  figtree: 'Paneer Butter Masala ₹280.00',
  lexend: 'Stock variance −4.5% this week',
  plex: 'SKU 8842-A · 1,000 g · Batch 07',
  source: 'Shift B · 14:00–22:00 · 9 staff',
  public: 'Purchase order ₹3,45,900 cleared',
  outfit: 'TODAY — 2,481 COVERS',
  dmsans: 'Wastage 12.75 kg · ₹1,890 lost',
  grotesk: 'KDS #7 — 03:12 elapsed',
};

export const DESKTOP_SKIN_LABEL: Record<DesktopSkin, string> = {
  sandalwood: 'Sandalwood',
  graphite: 'Graphite',
  azure: 'Azure',
  meridian: 'Meridian',
};

/** The two colours each skin is recognisable by, for the swatch in the compact picker. */
export const DESKTOP_SKIN_SWATCH: Record<DesktopSkin, [string, string]> = {
  sandalwood: ['#fdf9f4', '#c1440e'],
  graphite: ['#23252b', '#6ea8fe'],
  azure: ['#eef2f7', '#0f6cbd'],
  meridian: ['#121821', '#4fd6b8'],
};

export const DESKTOP_SKIN_HINT: Record<DesktopSkin, string> = {
  sandalwood: 'Warm ivory and terracotta. Easy on the eye over a long shift.',
  graphite: 'Low-light slate. For dim rooms and screens viewed after dark.',
  azure: 'Cool steel. The highest contrast of the three in daylight.',
  meridian:
    'Ink-navy lit by a single mint accent. High-contrast text on low-contrast surfaces, so it stays readable late in a shift without any of it shouting. The focused window is the only lit thing on screen. Pair it with the Dark window content theme.',
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
  meridian: {
    bg: '#090d13',
    chromeFrom: '#1a212b',
    chromeTo: '#151b24',
    body: '#10151d',
    bar: '#0f141c',
    border: '#2b3543',
    accent: '#4fd6b8',
  },
};
