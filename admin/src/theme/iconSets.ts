import type { IconArt } from './iconArt';
// Type-only, so this does not close a cycle with ThemeProvider at runtime. Restating the skin
// union here instead would let a fifth skin be added without any set ever offering it.
import type { DesktopSkin } from './ThemeProvider';

/**
 * The icon sets, and which desktop skins each one belongs to.
 *
 * A set is not skin-agnostic decoration. Aurora's glossy accent tiles are drawn for a dark
 * slate wallpaper and look like a mistake on Sandalwood's warm ivory; Terracotta's clay
 * bevels look equally wrong on Graphite. So each set declares the skins it was drawn for,
 * and the picker only ever offers the ones that belong to the wallpaper in front of you.
 *
 * Every skin has four to choose from, so "at least six sets" holds across the product while
 * no single skin is ever offered a set that does not suit it.
 */

export interface IconSetDefinition {
  id: string;
  label: string;
  /** What the set is actually like to look at, not a restatement of its name. */
  hint: string;
  art: IconArt;
  skins: DesktopSkin[];
}

export const ICON_SET_DEFINITIONS: IconSetDefinition[] = [
  /* The house style, and the first entry deliberately: `defaultIconSetFor` takes the first set
     a skin offers, so this is what every wallpaper starts on. Same drawing and same accent
     tile as the Start menu and the task bar, scaled up — one product, one icon. */
  {
    id: 'canteen',
    label: 'Canteen OS',
    hint: 'The house icon. The same mark the Start menu and task bar use, at desktop size.',
    art: { family: 'lucide' },
    skins: ['sandalwood', 'graphite', 'azure', 'beta'],
  },
  {
    id: 'blossom',
    label: 'Blossom',
    hint: 'Two-tone glyphs over a gold-and-rose bloom. The most colourful set in the product.',
    art: { family: 'phosphor', weight: 'duotone' },
    skins: ['sandalwood'],
  },
  {
    id: 'sticker',
    label: 'Sticker',
    hint: 'Saturated pictograms cut out with a thick white border and a hard drop shadow.',
    art: { family: 'phosphor', weight: 'fill' },
    skins: ['sandalwood', 'azure'],
  },
  {
    id: 'relief',
    label: 'Relief',
    hint: 'Line glyphs carved into the tile rather than laid on it. Quiet, physical, matte.',
    art: { family: 'lucide' },
    skins: ['sandalwood', 'graphite'],
  },
  {
    id: 'aurora',
    label: 'Aurora',
    hint: 'Solid glyphs on a lit gradient tile. Built for a dark wallpaper to glow against.',
    art: { family: 'phosphor', weight: 'fill' },
    skins: ['graphite', 'beta'],
  },
  {
    id: 'nightfall',
    label: 'Nightfall',
    hint: 'Hairline glyphs on frosted glass. The lightest touch of the dark sets.',
    art: { family: 'phosphor', weight: 'thin' },
    skins: ['graphite'],
  },
  {
    id: 'halo',
    label: 'Halo',
    hint: 'Light glyphs with no tile behind them, ringed in the module colour.',
    art: { family: 'phosphor', weight: 'light' },
    skins: ['graphite', 'beta'],
  },
  {
    id: 'chrome',
    label: 'Chrome',
    hint: 'Heavy glyphs on a brushed steel plate. The most legible set in daylight.',
    art: { family: 'phosphor', weight: 'bold' },
    skins: ['azure'],
  },
  {
    id: 'blueprint',
    label: 'Blueprint',
    hint: 'Projected 3D slabs with the glyph on the top face. Reads as objects, not labels.',
    art: { family: 'isometric' },
    skins: ['azure', 'beta'],
  },
  {
    id: 'fluent',
    label: 'Fluent',
    hint: 'Even-weight glyphs on a flat hairline square. Nothing shines, nothing casts.',
    art: { family: 'phosphor', weight: 'regular' },
    skins: ['azure', 'beta'],
  },
  {
    id: 'marker',
    label: 'Marker',
    hint: 'No pictogram at all — a two-letter monogram, the way a drawer front is labelled.',
    art: { family: 'lettermark' },
    skins: ['azure', 'beta'],
  },
];

export const ICON_SET_IDS: string[] = ICON_SET_DEFINITIONS.map((set) => set.id);

export function findIconSet(id: string): IconSetDefinition | undefined {
  return ICON_SET_DEFINITIONS.find((set) => set.id === id);
}

/** The sets offered under a given wallpaper, in the order the picker shows them. */
export function iconSetsForSkin(skin: DesktopSkin): IconSetDefinition[] {
  return ICON_SET_DEFINITIONS.filter((set) => set.skins.includes(skin));
}

/** What a skin falls back to when it has never been given a choice, or was given a bad one. */
export function defaultIconSetFor(skin: DesktopSkin): string {
  return iconSetsForSkin(skin)[0]?.id ?? ICON_SET_DEFINITIONS[0]?.id ?? 'fluent';
}

export function iconSetSuits(id: string, skin: DesktopSkin): boolean {
  return findIconSet(id)?.skins.includes(skin) === true;
}
