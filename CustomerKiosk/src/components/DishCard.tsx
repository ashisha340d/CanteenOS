import { useRef } from 'react';
import { MinusIcon, PlusIcon } from 'lucide-react';
import type { ResolvedMenuItemDto } from '@menuboard/shared';
import { useLanguage } from '../i18n';
import { cardPrice, isSoldOut, sellableVariants } from '../lib/menu';
import { formatMoney } from '../lib/format';
import { Dual } from './Bilingual';

interface DishCardProps {
  item: ResolvedMenuItemDto;
  /** Everything of this dish in the cart, across sizes. */
  quantity: number;
  /**
   * @param origin the card's own image, so the dish can be seen travelling from where it was
   *               tapped to the basket. The card passes it rather than the screen reading the
   *               event target, because the tap may land on the price, the name or the plus.
   */
  onAdd: (origin: Element | null) => void;
  onRemoveOne: () => void;
}

/**
 * One dish.
 *
 * The whole card is the add target — a guest reaching across a tablet should not have to hit a
 * 44-pixel button — and the card only becomes a stepper once something is in the cart, so the
 * common case (add one thing, move on) is a single tap anywhere.
 */
export function DishCard({ item, quantity, onAdd, onRemoveOne }: DishCardProps): JSX.Element {
  const { t, pick, locale } = useLanguage();
  const thumbnail = useRef<HTMLDivElement>(null);
  const soldOut = isSoldOut(item);
  const price = cardPrice(item);
  const variants = sellableVariants(item);
  const inCart = quantity > 0;

  return (
    <article
      className={`group press relative flex flex-col overflow-hidden rounded-lg border bg-surface text-left shadow-[var(--shadow-card)] ${
        inCart ? 'border-accent/45' : 'border-line'
      } ${soldOut ? 'opacity-55' : 'hover:shadow-[var(--shadow-lift)]'}`}
    >
      <button
        type="button"
        disabled={soldOut}
        onClick={() => onAdd(thumbnail.current)}
        aria-label={`${pick(item.name, item.nameHi)} · ${formatMoney(price.amount, locale)}`}
        className="flex flex-1 flex-col text-left disabled:cursor-not-allowed"
      >
        <div ref={thumbnail} className="relative aspect-[4/3] w-full overflow-hidden bg-canvas-deep">
          {item.primaryMediaUrl !== null ? (
            <img
              src={item.primaryMediaUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="size-full object-cover transition-transform duration-[var(--duration-slow)] ease-[var(--ease-emerge)] group-hover:scale-[1.04]"
            />
          ) : (
            // No photograph: the dish's initial set in the display serif reads as intent
            // rather than as a missing image.
            <span className="grid size-full place-items-center bg-gradient-to-br from-canvas-deep to-accent-tint font-display text-4xl text-trim">
              {pick(item.name, item.nameHi).trim().charAt(0)}
            </span>
          )}

          {soldOut && (
            <span className="absolute inset-x-0 bottom-0 bg-ink/72 py-1.5 text-center text-2xs text-canvas uppercase">
              {t('menu.unavailable')}
            </span>
          )}

          {inCart && !soldOut && (
            <span className="numeric animate-pop absolute top-2.5 right-2.5 grid size-9 place-items-center rounded-full bg-accent text-base font-semibold text-on-accent shadow-[var(--shadow-card)]">
              {quantity}
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-1 px-4 pt-3.5 pb-2">
          <Dual
            english={item.name}
            hindi={item.nameHi}
            as="h3"
            className="font-display text-lg leading-snug tracking-[-0.01em] text-balance"
            secondaryClassName="mt-0.5 block text-[0.82em] font-normal text-ink-soft"
          />
          {item.description !== null && item.description.trim() !== '' && (
            <p className="line-clamp-2 text-xs leading-relaxed text-ink-faint text-pretty">
              {item.description}
            </p>
          )}
        </div>
      </button>

      <div className="flex items-center justify-between gap-3 px-4 pb-4">
        <p className="numeric font-display text-xl">
          {price.from && (
            <span className="mr-1 font-sans text-2xs text-ink-faint uppercase">
              {t('menu.from')}
            </span>
          )}
          {formatMoney(price.amount, locale)}
        </p>

        {!soldOut &&
          (inCart ? (
            <div className="animate-fade flex items-center gap-1 rounded-pill bg-accent p-1 text-on-accent">
              <button
                type="button"
                aria-label={t('cart.remove')}
                onClick={onRemoveOne}
                className="press grid size-10 place-items-center rounded-full hover:bg-accent-deep"
              >
                <MinusIcon className="size-4" />
              </button>
              <span className="numeric min-w-6 text-center text-base font-semibold">{quantity}</span>
              <button
                type="button"
                aria-label={variants.length > 1 ? t('menu.chooseSize') : t('menu.tapToAdd')}
                onClick={() => onAdd(thumbnail.current)}
                className="press grid size-10 place-items-center rounded-full hover:bg-accent-deep"
              >
                <PlusIcon className="size-4" />
              </button>
            </div>
          ) : (
            // Decorative: the whole card above is already the add target with a real label,
            // and a second focusable control announcing the same action reads as a duplicate.
            <span
              aria-hidden
              className="press grid size-12 place-items-center rounded-full border border-accent/35 bg-accent-tint text-accent group-hover:bg-accent group-hover:text-on-accent"
            >
              <PlusIcon className="size-5" />
            </span>
          ))}
      </div>
    </article>
  );
}
