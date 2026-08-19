import { ArrowLeftIcon, ClockIcon, MinusIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useLanguage } from '../i18n';
import { useCart } from '../state/cart';
import { estimateMinutes, readyBy } from '../lib/eta';
import { formatClock, formatMoney } from '../lib/format';
import { ActionLabel } from '../components/Buttons';
import { Bilingual, Dual } from '../components/Bilingual';
import { Divider } from '../components/Marks';
import { Notice } from '../components/States';

interface CartScreenProps {
  onBack: () => void;
  onPay: () => void;
}

/**
 * Review before paying.
 *
 * The one screen where the guest is allowed to slow down: quantities are editable in place,
 * the estimate is stated in both minutes and clock time (a queue is easier to judge against a
 * wall clock than against a countdown), and the total is the last thing read before the
 * payment button — which is on this screen, and not on the bar that led here, because this is
 * where pressing it actually takes money.
 */
export function CartScreen({ onBack, onPay }: CartScreenProps): JSX.Element {
  const { t, ts, pick, locale, primaryLang, secondaryLang } = useLanguage();
  const { lines, dispatch, count, subtotal } = useCart();

  if (lines.length === 0) {
    return (
      <main className="flex flex-1 flex-col">
        <Notice title="cart.empty" body="cart.emptyBody" />
        <div className="safe-bottom px-7">
          <ActionLabel
            k="cart.addMore"
            variant="quiet"
            size="lg"
            onClick={onBack}
            icon={<ArrowLeftIcon className="size-4" />}
            className="mx-auto"
          />
        </div>
      </main>
    );
  }

  const minutes = estimateMinutes(lines);
  const etaSecond =
    minutes === null ? ts('eta.unknown') : ts('eta.ready', { minutes });

  return (
    <main className="animate-stage flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="animate-emerge mx-auto max-w-3xl px-7 pt-7 pb-8">
          <header className="flex items-end justify-between gap-4">
            <div>
              <Bilingual
                k="cart.title"
                as="h2"
                className="font-display text-3xl tracking-[-0.02em]"
                secondaryClassName="mt-1 block text-[0.55em] font-normal text-ink-soft"
              />
              <Bilingual
                k="cart.subtitle"
                as="p"
                className="mt-2 text-base text-ink-soft"
                secondaryClassName="mt-0.5 block text-[0.9em] text-ink-faint"
              />
            </div>
            <p className="numeric shrink-0 pb-1 text-sm text-ink-faint">
              {t(count === 1 ? 'cart.itemCount_one' : 'cart.itemCount_other', { count })}
            </p>
          </header>

          <Divider className="mt-6" />

          <ul className="mt-2 divide-y divide-line">
            {lines.map((line) => (
              <li key={line.key} className="flex items-center gap-4 py-4">
                <span className="size-16 shrink-0 overflow-hidden rounded-sm bg-canvas-deep">
                  {line.imageUrl !== null ? (
                    <img src={line.imageUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="grid size-full place-items-center font-display text-2xl text-trim">
                      {pick(line.name, line.nameHi).trim().charAt(0)}
                    </span>
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <Dual
                    english={line.name}
                    hindi={line.nameHi}
                    className="block truncate font-display text-lg"
                    secondaryClassName="mt-0.5 block truncate text-[0.8em] font-normal text-ink-soft"
                  />
                  <span className="mt-0.5 block text-xs text-ink-faint">
                    {line.variantName !== null && `${pick(line.variantName, line.variantNameHi)} · `}
                    {formatMoney(line.unitPrice, locale)}
                  </span>
                </span>

                <span className="flex items-center gap-1 rounded-pill border border-line bg-surface p-1">
                  <button
                    type="button"
                    aria-label={t('cart.remove')}
                    onClick={() => dispatch({ type: 'decrement', key: line.key })}
                    className="press grid size-11 place-items-center rounded-full text-ink-soft hover:bg-canvas-deep"
                  >
                    {line.quantity === 1 ? (
                      <Trash2Icon className="size-4" />
                    ) : (
                      <MinusIcon className="size-4" />
                    )}
                  </button>
                  <span className="numeric min-w-7 text-center text-base font-semibold">
                    {line.quantity}
                  </span>
                  <button
                    type="button"
                    aria-label={t('menu.tapToAdd')}
                    onClick={() => dispatch({ type: 'increment', key: line.key })}
                    className="press grid size-11 place-items-center rounded-full text-accent hover:bg-accent-tint"
                  >
                    <PlusIcon className="size-4" />
                  </button>
                </span>

                <span className="numeric w-20 shrink-0 text-right font-display text-lg">
                  {formatMoney(line.unitPrice * line.quantity, locale)}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex items-start gap-3 rounded-md border border-trim-soft bg-accent-tint/50 px-5 py-4">
            <ClockIcon className="mt-0.5 size-5 shrink-0 text-accent" />
            <p className="text-base">
              <span lang={primaryLang}>
                {minutes === null ? (
                  t('eta.unknown')
                ) : (
                  <>
                    <span className="font-medium">{t('eta.ready', { minutes })}</span>
                    <span className="text-ink-soft">
                      {' · '}
                      {t('eta.by', { clock: formatClock(readyBy(minutes), locale) })}
                    </span>
                  </>
                )}
              </span>
              {etaSecond !== null && (
                <span className="mt-0.5 block text-sm text-ink-soft" lang={secondaryLang}>
                  {etaSecond}
                </span>
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={onBack}
            className="press mt-5 inline-flex min-h-12 items-center gap-2 text-base text-ink-soft underline-offset-4 hover:text-accent hover:underline"
          >
            <ArrowLeftIcon className="size-4" />
            <span className="inline-flex flex-col items-start leading-tight">
              <span lang={primaryLang}>{t('cart.addMore')}</span>
              {ts('cart.addMore') !== null && (
                <span className="text-[0.82em] text-ink-faint" lang={secondaryLang}>
                  {ts('cart.addMore')}
                </span>
              )}
            </span>
          </button>
        </div>
      </div>

      <footer className="safe-bottom shrink-0 border-t border-line bg-surface/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-5 px-7 pt-5">
          <div className="min-w-0 flex-1">
            <p className="text-2xs text-ink-faint uppercase" lang={primaryLang}>
              {t('cart.total')}
              {ts('cart.total') !== null && <span lang={secondaryLang}> · {ts('cart.total')}</span>}
            </p>
            <p className="numeric font-display text-3xl tracking-[-0.02em]">
              {formatMoney(subtotal, locale)}
            </p>
            <Bilingual
              k="cart.taxNote"
              as="p"
              className="mt-0.5 text-xs text-ink-faint"
              secondaryClassName="block text-[0.95em]"
            />
          </div>
          <ActionLabel k="cart.payNow" size="xl" onClick={onPay} className="shrink-0" />
        </div>
      </footer>
    </main>
  );
}
