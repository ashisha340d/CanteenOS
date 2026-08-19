import { useEffect, useRef } from 'react';
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
import { KioskGlyph, glyphForCategory } from '@menuboard/shared';
import { useLanguage } from '../i18n';
import type { MenuGroup } from '../lib/menu';

/**
 * The category marks. The classification lives in `@menuboard/shared` so the Admin Portal's
 * ordering preview reads a category exactly the way the hall will; only the artwork is local.
 */
const GLYPHS: Record<KioskGlyph, LucideIcon> = {
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

interface CategoryRailProps {
  groups: MenuGroup[];
  /** `null` is "All", and is where every guest starts. */
  active: string | null;
  onSelect: (categoryId: string | null) => void;
}

/**
 * Naming the sections of the menu, at the top, with a mark for each.
 *
 * The menu below this stays one continuous scroll — the rail filters it rather than replacing
 * it — because a guest at a kiosk has not memorised which section a dish lives in, and a set of
 * tabs that hides four fifths of the board is four wrong guesses waiting to happen. What the
 * rail adds is orientation: a queue can see at a glance that this counter sells thalis, drinks
 * and sweets, and somebody who only wants a drink has one tap to get there.
 *
 * Two rules that are not negotiable:
 *
 * - "All" is always first and always the state a guest arrives in. The whole board is the
 *   default reading of a menu; a filter is a shortcut somebody chose.
 * - The choice is *never* persisted — not to storage, not across an order. A kiosk that opens
 *   on the last guest's filter is a kiosk showing the next guest a menu with most of it
 *   missing, and they have no way of knowing that is what they are looking at.
 */
export function CategoryRail({ groups, active, onSelect }: CategoryRailProps): JSX.Element | null {
  const { t, ts, pick, picks } = useLanguage();
  const scroller = useRef<HTMLDivElement>(null);

  // A rail that has been scrolled and then reset must come back to its start, or "All" is
  // selected and off-screen at the same time — which reads as nothing being selected.
  useEffect(() => {
    if (active === null) scroller.current?.scrollTo({ left: 0, behavior: 'smooth' });
  }, [active]);

  // One category is not a choice; the rail would be a label pretending to be a control.
  if (groups.length < 2) return null;

  const AllGlyph = GLYPHS[KioskGlyph.ALL];

  return (
    <div
      ref={scroller}
      className="flex gap-2.5 overflow-x-auto overscroll-x-contain px-7 pb-1 [scrollbar-width:none]"
      role="tablist"
      aria-label={t('menu.sections')}
    >
      <Chip
        icon={AllGlyph}
        label={t('menu.all')}
        secondary={ts('menu.all')}
        count={groups.reduce((sum, group) => sum + group.items.length, 0)}
        selected={active === null}
        onSelect={() => onSelect(null)}
      />

      {groups.map((group) => (
        <Chip
          key={group.category.id}
          icon={GLYPHS[glyphForCategory(group.category.name, group.category.nameHi)]}
          label={pick(group.category.name, group.category.nameHi)}
          secondary={picks(group.category.name, group.category.nameHi)}
          count={group.items.length}
          selected={active === group.category.id}
          onSelect={() => onSelect(group.category.id)}
        />
      ))}
    </div>
  );
}

function Chip({
  icon: Icon,
  label,
  secondary,
  count,
  selected,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  secondary: string | null;
  count: number;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      // `min-h-14` and the generous padding are not decoration: this is the one horizontal
      // control on the screen, and a chip a guest has to aim at is a chip they scroll past.
      className={`press flex min-h-14 shrink-0 items-center gap-2.5 rounded-pill border px-5 ${
        selected
          ? 'border-accent bg-accent text-on-accent shadow-[var(--shadow-card)]'
          : 'border-line bg-surface text-ink hover:border-accent/40 hover:bg-accent-tint'
      }`}
    >
      <Icon className={`size-5 shrink-0 ${selected ? '' : 'text-ink-faint'}`} />
      <span className="flex flex-col items-start leading-tight">
        <span className="text-base whitespace-nowrap">{label}</span>
        {secondary !== null && (
          <span className="text-2xs tracking-normal opacity-70">{secondary}</span>
        )}
      </span>
      <span
        className={`numeric text-xs ${selected ? 'opacity-75' : 'text-ink-faint'}`}
        aria-hidden
      >
        {count}
      </span>
    </button>
  );
}
