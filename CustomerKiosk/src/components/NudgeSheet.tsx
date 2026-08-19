import { useMemo } from 'react';
import { CheckIcon, PlusIcon } from 'lucide-react';
import type { MenuTreeDto, ResolvedMenuItemDto } from '@menuboard/shared';
import { useLanguage } from '../i18n';
import { useCart } from '../state/cart';
import { formatMoney } from '../lib/format';
import { cardPrice, isSoldOut, isVisible } from '../lib/menu';
import { categoriesFor, type NudgeKind } from '../lib/nudge';
import { quickAddLine } from '../lib/menu';
import { ActionLabel } from './Buttons';
import { Dual } from './Bilingual';
import { Sheet } from './Sheet';

interface NudgeSheetProps {
  kind: NudgeKind | null;
  tree: MenuTreeDto;
  onDismiss: () => void;
}

const MAX_SUGGESTIONS = 6;

/**
 * "Something to drink?"
 *
 * Asked once, at the moment it is still useful — after the guest has finished choosing and
 * before they pay — and never again for the same kind of thing. It suggests from the menu's
 * own drink and sweet categories, so a canteen changes what is offered by editing the menu,
 * not this file.
 *
 * The button at the bottom changes its mind when the guest does. Declining and having just
 * added a drink are different situations, and a sheet that still reads "No thanks" after
 * somebody tapped a lassi leaves them looking for the way forward.
 */
export function NudgeSheet({ kind, tree, onDismiss }: NudgeSheetProps): JSX.Element | null {
  const { pick, locale } = useLanguage();
  const { dispatch, quantityOf } = useCart();

  const suggestions = useMemo(() => {
    if (kind === null) return [];
    return categoriesFor(tree, kind)
      .flatMap((category) =>
        category.items
          .filter((item) => isVisible(item) && !isSoldOut(item))
          .map((item) => ({ item, categoryKey: category.id })),
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [kind, tree]);

  const acceptedAny = suggestions.some(
    ({ item, categoryKey }) => quantityOf(quickAddLine(item, categoryKey).key) > 0,
  );

  if (kind === null || suggestions.length === 0) return null;

  const add = (item: ResolvedMenuItemDto, categoryKey: string): void => {
    dispatch({ type: 'add', line: quickAddLine(item, categoryKey).line });
  };

  return (
    <Sheet
      open
      onClose={onDismiss}
      title={kind === 'drinks' ? 'nudge.drinksTitle' : 'nudge.sweetsTitle'}
      description={kind === 'drinks' ? 'nudge.drinksBody' : 'nudge.sweetsBody'}
    >
      <div className="-mx-1 flex gap-3.5 overflow-x-auto px-1 pb-2">
        {suggestions.map(({ item, categoryKey }) => {
          const price = cardPrice(item);
          const added = quantityOf(quickAddLine(item, categoryKey).key) > 0;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => add(item, categoryKey)}
              className={`press flex w-44 shrink-0 flex-col overflow-hidden rounded-md border bg-surface text-left ${
                added ? 'border-veg/50' : 'border-line hover:border-accent/45'
              }`}
            >
              <span className="block aspect-[5/4] w-full overflow-hidden bg-canvas-deep">
                {item.primaryMediaUrl !== null ? (
                  <img src={item.primaryMediaUrl} alt="" className="size-full object-cover" />
                ) : (
                  <span className="grid size-full place-items-center font-display text-3xl text-trim">
                    {pick(item.name, item.nameHi).trim().charAt(0)}
                  </span>
                )}
              </span>
              <span className="flex flex-1 flex-col gap-1 px-3.5 py-3">
                <Dual
                  english={item.name}
                  hindi={item.nameHi}
                  className="line-clamp-2 text-sm leading-snug"
                  secondaryClassName="mt-0.5 block text-[0.86em] text-ink-soft"
                />
                <span className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <span className="numeric font-display text-base">
                    {formatMoney(price.amount, locale)}
                  </span>
                  <span
                    className={`grid size-8 place-items-center rounded-full ${
                      added ? 'bg-veg-tint text-veg' : 'bg-accent-tint text-accent'
                    }`}
                  >
                    {added ? <CheckIcon className="size-4" /> : <PlusIcon className="size-4" />}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <ActionLabel
        k={acceptedAny ? 'nudge.continue' : 'nudge.skip'}
        variant={acceptedAny ? 'primary' : 'quiet'}
        size="lg"
        onClick={onDismiss}
        className="mt-5 w-full"
      />
    </Sheet>
  );
}
