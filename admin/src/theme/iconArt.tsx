import {
  AddressBook,
  Barcode,
  Buildings,
  ChefHat,
  ClipboardText,
  ClockCounterClockwise,
  DeviceTablet,
  FileText,
  ForkKnife,
  GearSix,
  Monitor,
  MonitorPlay,
  Package,
  Receipt,
  Sparkle,
  SquaresFour,
  Storefront,
  Users,
  Wallet,
  Warehouse,
  Wrench,
  type Icon as PhosphorIcon,
  type IconWeight,
} from '@phosphor-icons/react';
import type { DesktopApp } from '@/services/appRegistry';

/**
 * How a desktop icon is actually drawn.
 *
 * An icon set is not a shape around a fixed picture — the picture itself changes. Four
 * families, each producing genuinely different artwork for the same module:
 *
 *  - `phosphor`  a second, independently drawn icon family, in one of its six real weights.
 *                Thin and Fill are not the same drawing at different stroke widths; Phosphor
 *                redraws each weight, which is why this gives six distinct-looking sets from
 *                one dependency.
 *  - `lucide`    the house line glyph, the same drawing the Start menu and the task bar use.
 *  - `lettermark` no pictogram at all — a two-letter monogram, the way a filing system labels
 *                a drawer. Reads faster than a pictogram once an operator knows the modules.
 *  - `isometric` a projected 3D slab with the glyph on its top face, drawn with CSS transforms.
 *
 * A family is a *drawing*, never a finish. Relief and Canteen OS both use `lucide` and look
 * nothing alike, because carving versus laying flat is the tile's business, expressed in the
 * icon-set tokens — duplicating the family for it would be a second name for one picture.
 *
 * Phosphor lives in this module and nowhere else. `appRegistry` is imported by the task bar
 * and the Start menu, which are in the main bundle; putting a second icon library there would
 * drag it into every page load rather than into the desktop chunk that actually draws icons.
 */

export type IconArtFamily = 'phosphor' | 'lucide' | 'lettermark' | 'isometric';

export interface IconArt {
  family: IconArtFamily;
  /** Only meaningful for the `phosphor` family. */
  weight?: IconWeight;
}

/**
 * The Phosphor counterpart of each module's lucide glyph. Matched on meaning rather than on
 * name — Phosphor has no "warehouse pallet", so Stock keeps the warehouse building, and the
 * POS keeps a barcode because that is the object on the counter.
 */
const PHOSPHOR_GLYPH: Record<string, PhosphorIcon> = {
  'menu-master': ForkKnife,
  'menu-boards': Monitor,
  kiosks: DeviceTablet,
  organization: Buildings,
  pos: Barcode,
  kds: ChefHat,
  cds: MonitorPlay,
  entities: AddressBook,
  'purchase-masters': Package,
  'purchase-entry': Receipt,
  'purchase-register': ClockCounterClockwise,
  'vendor-accounting': Wallet,
  'purchase-documents': FileText,
  stock: Warehouse,
  'sop-formulation': ClipboardText,
  'equipment-maintenance': Wrench,
  cleaning: Sparkle,
  people: Users,
  'boards-hub': SquaresFour,
  settings: GearSix,
};

/**
 * Two letters for a module. An all-capital single word is an acronym and keeps both letters
 * capitalised (POS, KDS); anything else reads as a name and takes an initial capital.
 */
export function monogram(label: string): string {
  const words = label.split(/[\s&·/-]+/u).filter(Boolean);
  const first = words[0] ?? '?';

  if (words.length > 1) {
    return `${first.slice(0, 1)}${(words[1] ?? '').slice(0, 1)}`.toUpperCase();
  }
  if (first === first.toUpperCase()) return first.slice(0, 2).toUpperCase();
  return `${first.slice(0, 1).toUpperCase()}${first.slice(1, 2).toLowerCase()}`;
}

/**
 * The projected slab. Built from CSS 3D transforms rather than drawn as an SVG, so the glyph
 * on its face is the real module glyph rotated into the projection instead of a second,
 * hand-traced copy of it that would drift out of step with the registry.
 */
function IsometricMark({ app }: { app: DesktopApp }): JSX.Element {
  return (
    <span className="os-iso" aria-hidden>
      <span className="os-iso__slab" />
      <span className="os-iso__face">
        <app.Icon className="os-iso__glyph" />
      </span>
    </span>
  );
}

/** Draws one module's mark in whichever family the active icon set asks for. */
export function AppMark({ app, art }: { app: DesktopApp; art: IconArt }): JSX.Element {
  switch (art.family) {
    case 'phosphor': {
      // Storefront is the fallback for a module added to the registry without a Phosphor
      // counterpart — a generic shop front, never a blank square.
      const Glyph = PHOSPHOR_GLYPH[app.id] ?? Storefront;
      return <Glyph className="os-icon__glyph" weight={art.weight ?? 'regular'} />;
    }
    case 'lettermark':
      return <span className="os-icon__monogram">{monogram(app.label)}</span>;
    case 'isometric':
      return <IsometricMark app={app} />;
    case 'lucide':
      return <app.Icon className="os-icon__glyph" />;
  }
}
