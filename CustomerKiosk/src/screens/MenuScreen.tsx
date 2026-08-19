import { useMemo, useState } from 'react';
import {
  AvailabilityStatus,
  type KioskProfileDto,
  type MenuTreeDto,
  type ResolvedMenuItemDto,
  type ResolvedMenuVariantDto,
} from '@menuboard/shared';
import { useLanguage } from '../i18n';
import { useCart } from '../state/cart';
import { formatMoney } from '../lib/format';
import { lineKeyFor, priceOf, sellableVariants, toCartLine, visibleGroups } from '../lib/menu';
import { Bilingual, Dual } from '../components/Bilingual';
import { CartBar } from '../components/CartBar';
import { CategoryRail } from '../components/CategoryRail';
import { DishCard } from '../components/DishCard';
import { useFlyToCart } from '../components/FlyToCart';
import { Greeting } from '../components/Greeting';
import { Notice } from '../components/States';
import { Sheet } from '../components/Sheet';

interface MenuScreenProps {
  tree: MenuTreeDto;
  /** This stand's own category arrangement, dragged in the Admin Portal. */
  categoryOrder: readonly string[];
  /** Read for the hall's greeting; the rest of the profile is not this screen's business. */
  greeting: Pick<KioskProfileDto, 'greeting' | 'greetingHi'>;
  onOpenCart: () => void;
}

interface PendingChoice {
  item: ResolvedMenuItemDto;
  categoryKey: string;
  /** Adding a size, or picking which of several already in the cart to take one off. */
  mode: 'add' | 'remove';
  /** Where the tap happened, so an added dish can fly from the card the guest pressed. */
  origin: Element | null;
}

/**
 * The whole canteen, on one screen.
 *
 * The menu stays one continuous scroll with categories as headings inside it — a guest standing
 * at a kiosk has not memorised which section a dish lives in, and a set of tabs that hides four
 * fifths of the board is four wrong guesses waiting to happen. What the rail at the top adds is
 * orientation rather than navigation: a queue can see at a glance what this counter sells, and
 * somebody who only wants a drink has one tap to get there.
 *
 * The filter is held in component state and nowhere else. It resets when the kiosk returns to
 * the menu, because the alternative — a stand that opens on the last guest's filter — shows the
 * next person a menu with most of it missing and no way of knowing that is what they are
 * looking at.
 */
export function MenuScreen({
  tree,
  categoryOrder,
  greeting,
  onOpenCart,
}: MenuScreenProps): JSX.Element {
  const { t, pick, locale } = useLanguage();
  const { dispatch, count, subtotal, lines } = useCart();
  const { launch } = useFlyToCart();
  const [choice, setChoice] = useState<PendingChoice | null>(null);
  const [section, setSection] = useState<string | null>(null);

  const groups = useMemo(() => visibleGroups(tree, categoryOrder), [tree, categoryOrder]);
  const shown = section === null ? groups : groups.filter((g) => g.category.id === section);

  const linesFor = (item: ResolvedMenuItemDto) =>
    lines.filter((line) => line.foodItemId === item.foodItemId);

  const quantityForItem = (item: ResolvedMenuItemDto): number =>
    linesFor(item).reduce((sum, line) => sum + line.quantity, 0);

  const add = (item: ResolvedMenuItemDto, categoryKey: string, origin: Element | null): void => {
    // `sellableVariants` is already only what is orderable — a sold-out size never reaches here.
    const variants = sellableVariants(item);
    // One way to order it: add it. Several: ask, but only once — the chosen size is then
    // remembered as its own cart line and steps up from the card like anything else.
    if (variants.length > 1) {
      setChoice({ item, categoryKey, mode: 'add', origin });
      return;
    }
    dispatch({ type: 'add', line: toCartLine(item, variants[0] ?? null, categoryKey) });
    launch(origin, { imageUrl: item.primaryMediaUrl, name: pick(item.name, item.nameHi) });
  };

  /**
   * Taking one off is only unambiguous while the dish is in the cart at one size. With two,
   * the card's minus used to silently decrement whichever had been added last — so a guest
   * removing a small thali could watch a large one disappear instead. It now asks, using the
   * same sheet that offered the sizes in the first place.
   */
  const removeOne = (item: ResolvedMenuItemDto, categoryKey: string): void => {
    const existing = linesFor(item);
    if (existing.length > 1) {
      setChoice({ item, categoryKey, mode: 'remove', origin: null });
      return;
    }
    const only = existing[0];
    if (only !== undefined) dispatch({ type: 'decrement', key: only.key });
  };

  const chooseVariant = (variant: ResolvedMenuVariantDto): void => {
    if (choice === null) return;
    if (choice.mode === 'add') {
      dispatch({ type: 'add', line: toCartLine(choice.item, variant, choice.categoryKey) });
      // From the card the guest originally pressed, not from the sheet — the sheet is about to
      // close, and a puck launched from a disappearing element flies from nowhere.
      launch(choice.origin, {
        imageUrl: variant.primaryMediaUrl ?? choice.item.primaryMediaUrl,
        name: pick(choice.item.name, choice.item.nameHi),
      });
    } else {
      dispatch({ type: 'decrement', key: lineKeyFor(choice.item, variant) });
    }
    setChoice(null);
  };

  if (groups.length === 0) {
    return <Notice title="menu.searchNothing" body="menu.searchNothingBody" />;
  }

  const chosenLines = choice === null ? [] : linesFor(choice.item);
  /* Adding offers only what is orderable. Taking one off works from the *cart*, including a size
     that sold out while the guest was standing here — otherwise a line could be added and then
     never removed. */
  const offered =
    choice === null
      ? []
      : choice.mode === 'add'
        ? sellableVariants(choice.item)
        : choice.item.variants.filter((variant) =>
          chosenLines.some((line) => line.key === lineKeyFor(choice.item, variant)),
        );

  return (
    <>
      <div className="animate-stage flex min-h-0 flex-1 flex-col">
        <CategoryRail groups={groups} active={section} onSelect={setSection} />

        <main className="flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto max-w-7xl px-7 pt-4 pb-44">
            <div className="flex flex-col items-center gap-2 pb-2">
              <Greeting
                greeting={greeting.greeting}
                greetingHi={greeting.greetingHi}
                mark={false}
              />
              <Bilingual
                k="menu.tapToAdd"
                as="p"
                className="text-2xs text-ink-faint uppercase"
                secondaryClassName="mt-1 block text-[0.95em] tracking-[0.14em]"
              />
            </div>

            {/* Keyed on the filter so the stagger replays when a section is picked: without it
                React reuses the grid's children and the new dishes appear without entering. */}
            <div key={section ?? 'all'}>
              {shown.map((group, groupIndex) => (
                <section key={group.category.id} aria-labelledby={`group-${group.category.id}`}>
                  <div
                    className={`flex items-end gap-5 pb-5 ${groupIndex === 0 ? 'pt-6' : 'pt-12'}`}
                  >
                    <Dual
                      english={group.category.name}
                      hindi={group.category.nameHi}
                      as="h2"
                      className="font-display text-2xl leading-none tracking-[-0.015em]"
                      secondaryClassName="mt-1 block text-[0.62em] leading-tight font-normal text-ink-soft"
                    />
                    <span className="hairline mb-2 h-px flex-1" aria-hidden />
                  </div>

                  <div className="stagger grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-4">
                    {group.items.map((item, index) => (
                      <div key={item.id} style={{ '--i': index } as React.CSSProperties}>
                        <DishCard
                          item={item}
                          quantity={quantityForItem(item)}
                          onAdd={(origin) => add(item, group.category.id, origin)}
                          onRemoveOne={() => removeOne(item, group.category.id)}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {/* A section can sell out during service. Showing an empty column under a chip the
                guest just pressed reads as a broken screen, so it says so and offers the way
                back. */}
            {shown.length === 0 && (
              <Notice title="menu.sectionEmpty" body="menu.sectionEmptyBody" />
            )}
          </div>
        </main>
      </div>

      <CartBar count={count} subtotal={subtotal} onOpen={onOpenCart} />

      <Sheet
        open={choice !== null}
        onClose={() => setChoice(null)}
        title={choice?.mode === 'remove' ? 'cart.remove' : 'menu.chooseSize'}
      >
        {choice !== null && (
          <Dual
            english={choice.item.name}
            hindi={choice.item.nameHi}
            as="p"
            className="-mt-3 mb-4 font-display text-lg text-ink-soft"
            secondaryClassName="mt-0.5 block text-[0.86em] font-normal text-ink-faint"
          />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {choice !== null &&
            offered.map((variant) => {
              const soldOut =
                choice.mode === 'add' && variant.availability === AvailabilityStatus.SOLD_OUT;
              const inCart =
                chosenLines.find((line) => line.key === lineKeyFor(choice.item, variant))
                  ?.quantity ?? 0;
              return (
                <button
                  key={variant.id}
                  type="button"
                  disabled={soldOut}
                  onClick={() => chooseVariant(variant)}
                  className="press flex min-h-16 items-center justify-between gap-4 rounded-md border border-line bg-surface px-5 py-4 text-left hover:border-accent/50 hover:bg-accent-tint disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-base">
                      {pick(variant.portionName ?? variant.name, variant.nameHi)}
                    </span>
                    {soldOut && (
                      <span className="text-xs text-ink-faint">{t('menu.unavailable')}</span>
                    )}
                    {inCart > 0 && <span className="numeric text-xs text-accent">× {inCart}</span>}
                  </span>
                  <span className="numeric font-display text-lg">
                    {formatMoney(priceOf(choice.item, variant), locale)}
                  </span>
                </button>
              );
            })}
        </div>
      </Sheet>
    </>
  );
}
