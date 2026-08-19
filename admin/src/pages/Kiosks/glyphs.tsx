import {
  AppleIcon,
  CookieIcon,
  CookingPotIcon,
  CupSodaIcon,
  LayoutGridIcon,
  SandwichIcon,
  SoupIcon,
  UtensilsCrossedIcon,
  UtensilsIcon,
  WheatIcon,
  type LucideIcon,
} from 'lucide-react';
import { KioskGlyph } from '@menuboard/shared';

/**
 * The kiosk's category marks, drawn here so the portal's preview is the same reading of a
 * category name that the hall will get. `glyphForCategory` in `@menuboard/shared` decides
 * *which* mark; this table is only how the Admin Portal draws it, and the kiosk keeps its own
 * copy of the same table — the shared half is the classification, not the artwork.
 */
export const GLYPH_ICONS: Record<KioskGlyph, LucideIcon> = {
  [KioskGlyph.ALL]: LayoutGridIcon,
  [KioskGlyph.DRINK]: CupSodaIcon,
  [KioskGlyph.SWEET]: CookieIcon,
  [KioskGlyph.RICE]: CookingPotIcon,
  [KioskGlyph.BREAD]: WheatIcon,
  [KioskGlyph.SOUP]: SoupIcon,
  [KioskGlyph.SNACK]: SandwichIcon,
  [KioskGlyph.THALI]: UtensilsIcon,
  [KioskGlyph.FRUIT]: AppleIcon,
  [KioskGlyph.DISH]: UtensilsCrossedIcon,
};
