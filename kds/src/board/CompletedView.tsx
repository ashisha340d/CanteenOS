import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import type { KdsRecentActionDto } from '@menuboard/shared';
import { fetchRecentActions } from '../api/kds';
import { readErrorMessage } from '../api/client';
import { setDraggedOrder } from '../chat/orderDrag';
import type { StationSelection } from '../config/station';
import { shortOrderNumber } from './OrderCard';
import { pickName, useLang, useT } from '../i18n';

interface Props {
  station: StationSelection;
  busy: boolean;
  onRevert: (lineId: string) => void;
}

interface ServedGroup {
  orderId: string;
  orderNumber: string;
  latestAt: string;
  lines: KdsRecentActionDto[];
}

/**
 * What this counter has served lately, one compact card per order, newest first. Every line
 * carries a Revert — the server still guards the window, an old card simply refuses.
 */
export function CompletedView({ station, busy, onRevert }: Props): JSX.Element {
  const t = useT();
  const { lang } = useLang();
  const recent = useQuery({
    queryKey: ['kds', 'recent', station.id],
    queryFn: () => fetchRecentActions(station.id),
    // Serving from this board invalidates the list directly; the timer only catches another
    // screen's serve, which does not need to appear inside ten seconds.
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const groups = useMemo<ServedGroup[]>(() => {
    const byOrder = new Map<string, ServedGroup>();
    for (const action of recent.data ?? []) {
      const group = byOrder.get(action.orderId);
      if (group === undefined) {
        byOrder.set(action.orderId, {
          orderId: action.orderId,
          orderNumber: action.orderNumber,
          latestAt: action.servedAt,
          lines: [action],
        });
      } else {
        group.lines.push(action);
      }
    }
    return [...byOrder.values()];
  }, [recent.data]);

  return (
    <div className="kds-done">
      {recent.isPending && <p style={{ color: 'var(--kds-soft)' }}>{t.loadingServed}</p>}
      {recent.error !== null && (
        <p style={{ color: 'var(--kds-late)' }}>{readErrorMessage(recent.error, t.servedLoadFailed)}</p>
      )}
      {recent.isFetched && groups.length === 0 && (
        <p style={{ color: 'var(--kds-faint)', fontSize: 15 }}>{t.nothingServedYet}</p>
      )}
      {groups.map((group) => (
        <div
          key={group.orderId}
          className="kds-done__group"
          /* A served order is exactly what a counter most often needs to ask about — "the one
             I just handed over" — so these drag onto the chat like live cards do. */
          draggable
          onDragStart={(event) =>
            setDraggedOrder(event, { orderId: group.orderId, orderNumber: group.orderNumber })
          }
        >
          <div className="kds-done__group-head">
            <strong>#{shortOrderNumber(group.orderNumber)}</strong>
            <small>
              {t.itemsServed(group.lines.length)} · {new Date(group.latestAt).toLocaleTimeString()}
            </small>
          </div>
          {group.lines.map((action) => (
            <div key={action.lineId} className="kds-done__line">
              <span className="kds-done__line-name">
                {action.quantity}× {pickName(lang, action.itemName, action.itemNameHi)}
                {action.variantName ? ` (${action.variantName})` : ''}
              </span>
              <small>{action.servedByName ?? ''}</small>
              <button
                type="button"
                className="kds-done__revert"
                disabled={busy}
                onClick={() => onRevert(action.lineId)}
              >
                <Undo2 className="size-3.5" style={{ verticalAlign: '-2px', marginRight: 4 }} />
                {t.revert}
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
