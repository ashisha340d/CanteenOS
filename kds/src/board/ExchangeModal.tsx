import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { KdsExchangeRequest, KdsOrderDto } from '@menuboard/shared';
import { fetchSellables } from '../api/kds';
import { readErrorMessage } from '../api/client';
import { shortOrderNumber } from './OrderCard';
import { useT } from '../i18n';

interface Addition {
  menuItemId: string;
  variantId: string | null;
  name: string;
  unitPrice: number;
  quantity: number;
}

interface Props {
  order: KdsOrderDto;
  counterId: string;
  busy: boolean;
  onSubmit: (orderId: string, body: KdsExchangeRequest) => void;
  onClose: () => void;
}

const MONEY = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/**
 * Value-for-value exchange: a paid order never re-opens the money, so the replacement lines
 * must total exactly what the exchanged ones were worth. The server re-checks the same sum.
 */
export function ExchangeModal({ order, counterId, busy, onSubmit, onClose }: Props): JSX.Element {
  const t = useT();
  const [pickedLines, setPickedLines] = useState<Set<string>>(new Set());
  const [additions, setAdditions] = useState<Addition[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sellables = useQuery({
    queryKey: ['kds', 'sellables', counterId],
    queryFn: () => fetchSellables(counterId),
  });

  const exchangeableLines = order.lines.filter((line) => line.kdsStatus !== 'SERVED');
  const exchangedValue = order.lines
    .filter((line) => pickedLines.has(line.id))
    .reduce((sum, line) => sum + line.lineTotal, 0);
  const additionsValue = additions.reduce((sum, a) => sum + a.unitPrice * a.quantity, 0);
  const balanced = Math.abs(exchangedValue - additionsValue) < 0.01 && pickedLines.size > 0;

  const flattened = useMemo(() => {
    const out: Addition[] = [];
    for (const category of sellables.data?.categories ?? []) {
      for (const item of category.items) {
        if (item.variants.length === 0) {
          // A variant-less item sells at its base price.
          if (item.basePrice !== null && item.basePrice > 0) {
            out.push({
              menuItemId: item.foodItemId,
              variantId: null,
              name: item.name,
              unitPrice: item.basePrice,
              quantity: 1,
            });
          }
          continue;
        }
        for (const variant of item.variants) {
          const price = variant.price;
          if (price === null || price <= 0) continue;
          const portion = variant.portionName ?? variant.name;
          out.push({
            menuItemId: item.foodItemId,
            variantId: variant.id,
            name: portion === item.name ? item.name : `${item.name} (${portion})`,
            unitPrice: price,
            quantity: 1,
          });
        }
      }
    }
    const term = search.trim().toLowerCase();
    return term ? out.filter((a) => a.name.toLowerCase().includes(term)) : out;
  }, [sellables.data, search]);

  function toggleLine(lineId: string): void {
    setPickedLines((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  function addSellable(sellable: Omit<Addition, 'quantity'>): void {
    setAdditions((prev) => {
      const existing = prev.find(
        (a) => a.menuItemId === sellable.menuItemId && a.variantId === sellable.variantId,
      );
      if (existing) {
        return prev.map((a) => (a === existing ? { ...a, quantity: a.quantity + 1 } : a));
      }
      return [...prev, { ...sellable, quantity: 1 }];
    });
  }

  function bump(addition: Addition, delta: number): void {
    setAdditions((prev) =>
      prev
        .map((a) => (a === addition ? { ...a, quantity: a.quantity + delta } : a))
        .filter((a) => a.quantity > 0),
    );
  }

  function submit(): void {
    if (!balanced || busy) return;
    setError(null);
    onSubmit(order.id, {
      lineIds: [...pickedLines],
      additions: additions.map((a) => ({
        menuItemId: a.menuItemId,
        variantId: a.variantId,
        quantity: a.quantity,
      })),
      expectedValue: exchangedValue,
    });
  }

  return (
    <div className="kds-exchange" role="dialog" aria-modal="true" aria-label={t.exchangeTitle}>
      <div className="kds-exchange__panel">
        <header className="kds-exchange__head">
          <h2>
            {t.exchangeTitle} · #{shortOrderNumber(order.orderNumber)}
          </h2>
          <button type="button" className="kds-served-row__undo" onClick={onClose} disabled={busy}>
            {t.close}
          </button>
        </header>

        <div className="kds-exchange__cols">
          <div className="kds-exchange__col">
            <h3>{t.exchangeLinesToReturn}</h3>
            <div className="kds-exchange__scroll">
              {exchangeableLines.map((line) => (
                <label key={line.id} className="kds-exchange__line" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={pickedLines.has(line.id)}
                    onChange={() => toggleLine(line.id)}
                  />
                  <span style={{ flex: 1 }}>
                    {line.quantity}× {line.customItemName ?? line.itemName}
                    {line.variantName ? ` (${line.variantName})` : ''}
                  </span>
                  <strong>{MONEY.format(line.lineTotal)}</strong>
                </label>
              ))}
              {exchangeableLines.length === 0 && (
                <p style={{ color: 'var(--kds-faint)', fontSize: 13 }}>{t.nothingOutstanding}</p>
              )}
            </div>
          </div>

          <div className="kds-exchange__col">
            <h3>{t.exchangeAdditions}</h3>
            <input
              className="kds-exchange__search"
              placeholder={t.exchangeSearch}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="kds-exchange__scroll">
              {additions.map((addition) => (
                <div key={`${addition.menuItemId}:${addition.variantId ?? ''}`} className="kds-exchange__line">
                  <span style={{ flex: 1 }}>{addition.name}</span>
                  <button type="button" className="kds-qty-btn" onClick={() => bump(addition, -1)}>-</button>
                  <strong>{addition.quantity}</strong>
                  <button type="button" className="kds-qty-btn" onClick={() => bump(addition, 1)}>+</button>
                  <strong>{MONEY.format(addition.unitPrice * addition.quantity)}</strong>
                </div>
              ))}
              {flattened.slice(0, 40).map((sellable) => (
                <button
                  key={`${sellable.menuItemId}:${sellable.variantId ?? ''}`}
                  type="button"
                  className="kds-sellable"
                  onClick={() => addSellable(sellable)}
                >
                  <span>{sellable.name}</span>
                  <strong>{MONEY.format(sellable.unitPrice)}</strong>
                </button>
              ))}
              {sellables.error !== null && (
                <p style={{ color: 'var(--kds-late)', fontSize: 13 }}>
                  {readErrorMessage(sellables.error, t.menuFileFailed)}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className={`kds-exchange__total ${balanced ? 'kds-exchange__total--match' : 'kds-exchange__total--off'}`}>
          <span>
            {t.exchangeValue}: {MONEY.format(exchangedValue)} · {MONEY.format(additionsValue)}
          </span>
          <span>{balanced ? t.exchangeMatch : t.exchangeOff}</span>
        </div>

        {error !== null && (
          <p style={{ color: 'var(--kds-late)', padding: '0 18px', fontSize: 13 }}>{error}</p>
        )}

        <footer className="kds-exchange__foot">
          <button
            type="button"
            className="kds-card__action kds-card__action--serve-all"
            disabled={!balanced || busy}
            onClick={submit}
          >
            {t.exchangeApply}
          </button>
          <button type="button" className="kds-card__action kds-card__action--exchange" onClick={onClose} disabled={busy}>
            {t.cancel}
          </button>
        </footer>
      </div>
    </div>
  );
}
