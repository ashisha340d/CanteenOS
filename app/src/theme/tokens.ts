/**
 * MenuBoard design tokens — the Logistics Utility System.
 *
 * Values come verbatim from `.claude/appscreen/logistics_utility_system/DESIGN.md`. The
 * brand is deep indigo: authoritative, calm under pressure, utility over decoration. Depth
 * comes from tonal layers and hairline outlines rather than heavy shadow, so the interface
 * reads as flat and fast.
 *
 * Every screen pulls from here; no hardcoded colour or spacing anywhere else.
 */

import { Dimensions } from 'react-native';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

export const colors = {
  /* ------------------------------------------------------------ brand */
  primary: '#102b88',
  onPrimary: '#ffffff',
  primaryContainer: '#2e44a0',
  onPrimaryContainer: '#acb9ff',
  primaryFixed: '#dde1ff',
  primaryFixedDim: '#b9c3ff',
  onPrimaryFixed: '#001356',
  onPrimaryFixedVariant: '#283e9a',
  inversePrimary: '#b9c3ff',
  surfaceTint: '#4257b3',

  /** Emerald. Reserved for Delivered / Confirmed / Completed — never decorative. */
  secondary: '#006c49',
  onSecondary: '#ffffff',
  secondaryContainer: '#6cf8bb',
  onSecondaryContainer: '#00714d',
  secondaryFixed: '#6ffbbe',
  secondaryFixedDim: '#4edea3',

  /** Amber. Delay and "needs attention", nothing else. */
  tertiary: '#4e2f00',
  onTertiary: '#ffffff',
  tertiaryContainer: '#6d4300',
  onTertiaryContainer: '#ffac34',
  tertiaryFixed: '#ffddb8',
  tertiaryFixedDim: '#ffb95f',
  onTertiaryFixed: '#2a1700',
  onTertiaryFixedVariant: '#653e00',

  error: '#ba1a1a',
  onError: '#ffffff',
  errorContainer: '#ffdad6',
  onErrorContainer: '#93000a',

  /* --------------------------------------------------------- surfaces */
  /** Multi-layered light greys separate the feed from the page behind it. */
  background: '#f8f9ff',
  onBackground: '#121c2a',
  surface: '#f8f9ff',
  surfaceDim: '#d0dbed',
  surfaceBright: '#f8f9ff',
  surfaceContainerLowest: '#ffffff',
  surfaceContainerLow: '#eff4ff',
  surfaceContainer: '#e6eeff',
  surfaceContainerHigh: '#dee9fc',
  surfaceContainerHighest: '#d9e3f6',
  surfaceVariant: '#d9e3f6',
  inverseSurface: '#27313f',
  inverseOnSurface: '#eaf1ff',
  /** Scrim behind sheets and modals. */
  scrim: 'rgba(18, 28, 42, 0.48)',

  /* ------------------------------------------------------------- text */
  onSurface: '#121c2a',
  onSurfaceVariant: '#454652',
  outline: '#757683',
  outlineVariant: '#c5c5d4',

  /** Tinted panel behind structured order data, distinguishing system data from chat. */
  dataPanel: '#eff6ff',
  dataPanelBorder: '#dbeafe',

  /** The signed-in user's own chat bubble — the one warm tint on the feed. */
  bubbleMine: '#d7f27a',
  bubbleMineBorder: '#c8e967',

  /* -------------------------------------------------- semantic aliases */
  textPrimary: '#121c2a',
  textSecondary: '#454652',
  textMuted: '#757683',
  textInverse: '#ffffff',
  white: '#ffffff',

  success: '#006c49',
  successBg: '#d1fae5',
  warning: '#b45309',
  warningBg: '#fef3c7',
  danger: '#ba1a1a',
  dangerBg: '#ffdad6',
  info: '#155e75',
  infoBg: '#cffafe',

  /**
   * Order status palette, keyed by `OrderDisplayStatus`. Warm hues track work moving
   * forward, emerald marks arrival, grey and red end it. See `StatusBadge`.
   */
  statusPending: { bg: '#f3f4f6', fg: '#4b5563' },
  statusAcknowledged: { bg: '#dde1ff', fg: '#283e9a' },
  statusPreparation: { bg: '#ffddb8', fg: '#653e00' },
  statusWorkInProgress: { bg: '#fef3c7', fg: '#92400e' },
  statusDelivered: { bg: '#6cf8bb', fg: '#00513a' },
  statusDone: { bg: '#d9e3f6', fg: '#454652' },
  statusCancelled: { bg: '#ffdad6', fg: '#93000a' },
  statusOnShopping: { bg: '#cffafe', fg: '#155e75' },
  statusBilled: { bg: '#ede9fe', fg: '#5b21b6' },

  /**
   * Board-status chips, from the `my_boards_multi_board_home` mockup.
   *
   * These are the one place the designs reach outside the Material palette above — the
   * emerald-50/200/800 triple gives a chip that reads as "fine, carry on" without the weight
   * of `secondaryContainer`, which is reserved for the active nav pill. Carried as tokens so
   * the hex never appears in a screen.
   */
  boardActive: { bg: '#ecfdf5', fg: '#065f46', border: '#a7f3d0' },
  boardOnHold: { bg: '#d9e3f6', fg: '#454652', border: '#c5c5d4' },
  boardArchived: { bg: '#e6eeff', fg: '#757683', border: '#c5c5d4' },

  /* ------------------------------------------------------------- legacy */
  /**
   * Numbered-scale names from the previous palette, remapped onto this one.
   *
   * They exist so screens that have not been restyled yet keep compiling *and* keep looking
   * coherent — a half-migrated app with two competing blues would be worse than either
   * palette alone. Each alias is deleted as its last screen is rewritten; when this block is
   * empty the migration is finished.
   */
  primary50: '#eff4ff',
  primary100: '#dde1ff',
  primary200: '#b9c3ff',
  primary400: '#4257b3',
  primary500: '#2e44a0',
  primary600: '#102b88',
  primary700: '#0b2170',
  primary900: '#001356',

  gray50: '#f8f9ff',
  gray75: '#f4f6ff',
  gray100: '#eff4ff',
  gray200: '#d9e3f6',
  gray300: '#c5c5d4',
  gray400: '#9a9bab',
  gray500: '#757683',
  gray600: '#5c5d6b',
  gray700: '#454652',
  gray800: '#27313f',
  gray900: '#121c2a',

  success50: '#d1fae5',
  success100: '#6cf8bb',
  success500: '#006c49',
  success700: '#00513a',
  warning50: '#fef3c7',
  warning100: '#ffddb8',
  warning500: '#b45309',
  warning700: '#653e00',
  danger50: '#ffdad6',
  danger100: '#ffdad6',
  danger500: '#ba1a1a',
  danger700: '#93000a',
  info50: '#cffafe',
  info500: '#155e75',
  info700: '#0e4a5e',

  surfaceElevated: '#ffffff',
  surfaceOverlay: 'rgba(18, 28, 42, 0.48)',
  /** Superseded by statusDelivered; kept until the last caller is restyled. */
  statusCompleted: { bg: '#6cf8bb', fg: '#00513a' },
} as const;

/** 8px rhythm, with the named steps the design system calls out. */
export const spacing = {
  px: 1,
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  2.5: 10,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  9: 36,
  10: 40,
  11: 44,
  12: 48,
  14: 56,
  16: 64,
  20: 80,
  24: 96,

  /** Named tokens from DESIGN.md. */
  unit: 4,
  gutter: 16,
  marginMobile: 12,
  marginDesktop: 24,
  stackSm: 8,
  stackMd: 16,
  stackLg: 24,
} as const;

/**
 * Soft rounding — professional and rigid, not playful. Small controls 4px, containers 8px,
 * pills fully round.
 */
export const radii = {
  none: 0,
  xs: 2,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  '2xl': 16,
  full: 9999,
} as const;

/**
 * Dual-font system: Inter for anything read as language, JetBrains Mono for anything read
 * as data. Monospaced quantities and times align into columns so a discrepancy is visible
 * at a glance — which is the entire reason the split exists.
 */
/**
 * `fontFamily` values.
 *
 * React Native cannot synthesise a weight from a single font file the way a browser can, so
 * each weight is its own registered family. `app/_layout.tsx` loads these from
 * `@expo-google-fonts/*` under exactly these names; until that resolves, `useAppFonts`
 * reports `false` and the root renders a splash rather than a frame of Roboto.
 */
export const fonts = {
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemibold: 'Inter_600SemiBold',
  sansBold: 'Inter_700Bold',
  mono: 'JetBrainsMono_500Medium',
} as const;

/**
 * The dual-font scale. Inter for anything read as language, JetBrains Mono for anything read
 * as data — monospaced quantities and times align into columns, so a discrepancy is visible
 * at a glance. That alignment is the entire reason the split exists.
 *
 * Each step carries its own `fontFamily`, because the weight *is* the family here. Spread the
 * whole step (`...typography.bodyMd`) rather than picking fields off it: taking `size` and
 * `weight` alone silently drops the family and the text falls back to the system face.
 */
export const typography = {
  headlineLg: { fontFamily: fonts.sansBold, size: 24, lineHeight: 32, letterSpacing: 0, weight: '700' as const },
  headlineMd: { fontFamily: fonts.sansSemibold, size: 18, lineHeight: 24, letterSpacing: 0, weight: '600' as const },
  bodyMd: { fontFamily: fonts.sans, size: 14, lineHeight: 20, letterSpacing: 0, weight: '400' as const },
  bodySm: { fontFamily: fonts.sans, size: 12, lineHeight: 16, letterSpacing: 0, weight: '400' as const },
  dataMono: { fontFamily: fonts.mono, size: 13, lineHeight: 18, letterSpacing: -0.26, weight: '500' as const },
  labelCaps: { fontFamily: fonts.sansBold, size: 11, lineHeight: 16, letterSpacing: 0.55, weight: '700' as const },

  /* Legacy aliases, so screens not yet restyled keep compiling and rendering sensibly. */
  display: { fontFamily: fonts.sansBold, size: 24, lineHeight: 32, letterSpacing: 0, weight: '700' as const },
  title1: { fontFamily: fonts.sansBold, size: 24, lineHeight: 32, letterSpacing: 0, weight: '700' as const },
  title2: { fontFamily: fonts.sansBold, size: 20, lineHeight: 26, letterSpacing: 0, weight: '700' as const },
  title3: { fontFamily: fonts.sansSemibold, size: 18, lineHeight: 24, letterSpacing: 0, weight: '600' as const },
  body: { fontFamily: fonts.sans, size: 14, lineHeight: 20, letterSpacing: 0, weight: '400' as const },
  callout: { fontFamily: fonts.sansMedium, size: 13, lineHeight: 18, letterSpacing: 0, weight: '500' as const },
  caption: { fontFamily: fonts.sansBold, size: 11, lineHeight: 16, letterSpacing: 0.55, weight: '700' as const },
  footnote: { fontFamily: fonts.sansBold, size: 10, lineHeight: 14, letterSpacing: 0.3, weight: '700' as const },
} as const;

/**
 * Resolves the Inter family that actually carries a given weight.
 *
 * Existing styles set `fontWeight` directly; on Android that is ignored for a custom family,
 * so a "700" that stays on `Inter_400Regular` renders regular. Call this wherever a weight is
 * chosen dynamically.
 */
export function interFamilyForWeight(weight: string | number | undefined): string {
  switch (String(weight)) {
    case '500':
      return fonts.sansMedium;
    case '600':
      return fonts.sansSemibold;
    case '700':
    case '800':
    case '900':
    case 'bold':
      return fonts.sansBold;
    default:
      return fonts.sans;
  }
}

/**
 * Tonal layers do most of the work; shadow is a whisper, used only to lift an active card
 * off the page.
 */
export const shadows = {
  sm: {
    shadowColor: '#121c2a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#121c2a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 3,
  },
  lg: {
    shadowColor: '#121c2a',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 28,
    elevation: 10,
  },
} as const;

export const motion = {
  fast: { duration: 150 },
  normal: { duration: 250 },
  slow: { duration: 400 },
  spring: {
    gentle: { damping: 20, stiffness: 120, mass: 0.8, overshootClamping: false },
    snappy: { damping: 14, stiffness: 180, mass: 0.6, overshootClamping: false },
    bouncy: { damping: 12, stiffness: 200, mass: 0.7, overshootClamping: false },
  },
  easing: {
    easeOut: [0, 0, 0.2, 1] as [number, number, number, number],
    easeInOut: [0.4, 0, 0.2, 1] as [number, number, number, number],
    springLike: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
  },
} as const;

export const layout = {
  screenW: SCREEN_W,
  screenH: SCREEN_H,
  contentMaxWidth: 600,
  horizontalPadding: spacing.marginMobile,
  cardGap: spacing[3],
  sectionGap: spacing[5],
  /** Structured data blocks take 85% of the width, per DESIGN.md. */
  blockWidthRatio: 0.85,
} as const;
