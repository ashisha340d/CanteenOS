import { useEffect, useRef } from 'react';
import { ArrowRightIcon } from 'lucide-react';
import { useLanguage } from '../i18n';
import { formatMoney } from '../lib/format';
import { useFlyToCart } from './FlyToCart';

interface CartBarProps {
  count: number;
  subtotal: number;
  onOpen: () => void;
}

/**
 * The bar only exists once something is in the cart, and it says the same three things the
 * whole way: how many, how much, and what happens next.
 *
 * "Review order", not "Pay by UPI" — this control opens the review screen, and a button that
 * names a step it does not take is the kind of small lie that makes a guest hesitate at every
 * subsequent one. The payment button is on the review screen, where it actually pays.
 *
 * Floats clear of the screen edge, and of the home indicator below it, so the bottom row of
 * dishes stays reachable on the hardware this app is built for.
 *
 * It is also where a tapped dish flies to. The count badge is registered as the destination and
 * takes the delivery with a scale — never a translation, because a bar that moves is a bar the
 * guest's next tap misses.
 */
export function CartBar({ count, subtotal, onOpen }: CartBarProps): JSX.Element | null {
  const { t, ts, locale, primaryLang, secondaryLang } = useLanguage();
  const { setTarget, arrivals } = useFlyToCart();
  const badge = useRef<HTMLSpanElement>(null);

  // Re-registered on every render of the bar, and cleared when it unmounts — the flight reads
  // the target's rectangle at launch, and a stale node would send the puck off-screen.
  useEffect(() => {
    setTarget(badge.current);
    return () => setTarget(null);
  });

  if (count === 0) return null;

  const secondTitle = ts('cart.title');
  const secondCta = ts('cart.review');

  return (
    <div className="safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-30 px-5">
      <div className="animate-rise pointer-events-auto mx-auto max-w-3xl">
        <button
          type="button"
          onClick={onOpen}
          className="press relative flex w-full items-center gap-4 overflow-hidden rounded-pill bg-accent py-3.5 pr-4 pl-3.5 text-on-accent shadow-[var(--shadow-lift)] hover:bg-accent-deep"
        >
          <span
            aria-hidden
            className="animate-sheen absolute inset-y-0 w-1/3 bg-white/12 blur-md"
          />
          {/* Keyed on the arrival count so the receive animation restarts on each delivery;
              without the key React keeps the element and the animation only ever plays once. */}
          <span
            key={arrivals}
            ref={badge}
            className="numeric animate-receive grid size-12 shrink-0 place-items-center rounded-full bg-white/18 text-lg font-semibold"
          >
            {count}
          </span>
          <span className="min-w-0 flex-1 text-left leading-tight">
            <span className="block text-2xs opacity-80 uppercase" lang={primaryLang}>
              {t('cart.title')}
              {secondTitle !== null && <span lang={secondaryLang}> · {secondTitle}</span>}
            </span>
            <span className="numeric font-display text-xl">{formatMoney(subtotal, locale)}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2 rounded-pill bg-surface px-6 py-3 text-base font-medium text-accent">
            <span className="inline-flex flex-col items-center leading-tight">
              <span lang={primaryLang}>{t('cart.review')}</span>
              {secondCta !== null && (
                <span className="text-[0.78em] font-normal opacity-85" lang={secondaryLang}>
                  {secondCta}
                </span>
              )}
            </span>
            <ArrowRightIcon className="size-4" />
          </span>
        </button>
      </div>
    </div>
  );
}
