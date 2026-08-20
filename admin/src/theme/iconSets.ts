import type { IconArt } from './iconArt';
// Type-only, so this does not close a cycle with ThemeProvider at runtime. Restating the skin
// union here instead would let a fifth skin be added without any set ever offering it.
import type { DesktopSkin } from './ThemeProvider';

/**
 * The icon sets, and which desktop skins each one belongs to.
 *
 * A set is not skin-agnostic decoration. Aurora's lit tiles are drawn to glow against a dark
 * wallpaper and look like a mistake on Sandalwood's warm ivory; Chrome's steel plate looks
 * equally wrong on a near-black desktop. So each set declares the skins it was drawn for, and
 * the picker only ever offers the ones that belong to the wallpaper in front of you.
 *
 * Three of the eight draw genuinely different *pictures* rather than different finishes:
 * `fluent` and `vivid` use Microsoft's system icons (the same registry the toolbars read from),
 * `chrome` and `aurora` use Phosphor at two very different weights, and `marker` draws no
 * pictogram at all. Every skin is offered six.
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
     a skin offers, so this is what every wallpaper starts on. Same drawing and same accent tile
     as the Start menu and the task bar, scaled up — one product, one icon. */
  {
    id: 'canteen',
    label: 'Canteen OS',
    hint: 'The house icon. A white glyph on the module’s own colour — the mark the Start menu and task bar use.',
    art: { family: 'lucide' },
    skins: ['sandalwood', 'graphite', 'azure', 'meridian'],
  },
  {
    id: 'vivid',
    label: 'Vivid',
    hint: 'The most colourful set. A lit wash of the module’s colour, a solid Fluent glyph, and a shadow in the same hue.',
    art: { family: 'fluent', variant: 'filled' },
    skins: ['sandalwood', 'graphite', 'azure', 'meridian'],
  },
  {
    id: 'crystal',
    label: 'Crystal',
    hint: 'Glossy 3D tiles — a lit dome, a bright rim and a shadow in the module’s own colour.',
    art: { family: 'fluent', variant: 'filled' },
    skins: ['sandalwood', 'graphite', 'azure', 'meridian'],
  },
  {
    id: 'fluent',
    label: 'Fluent',
    hint: 'Microsoft’s system icons on a softly tinted plate. The colour is in the glyph, not the tile — the quietest set here.',
    art: { family: 'fluent', variant: 'regular' },
    skins: ['sandalwood', 'graphite', 'azure', 'meridian'],
  },
  {
    id: 'marker',
    label: 'Marker',
    hint: 'No pictogram at all — a two-letter monogram, the way a drawer front is labelled.',
    art: { family: 'lettermark' },
    skins: ['sandalwood', 'graphite', 'azure', 'meridian'],
  },
  {
    id: 'chrome',
    label: 'Chrome',
    hint: 'Heavy glyphs on a brushed steel plate. The most legible set in daylight.',
    art: { family: 'phosphor', weight: 'bold' },
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
    skins: ['graphite', 'meridian'],
  },
  {
    id: 'blueprint',
    label: 'Blueprint',
    hint: 'Projected 3D slabs with the glyph on the top face. Reads as objects, not labels.',
    art: { family: 'isometric' },
    skins: ['azure', 'meridian'],
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
