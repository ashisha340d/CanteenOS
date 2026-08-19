import { useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { KdsConfigDto, KdsLineDto, KdsOrderDto } from '@menuboard/shared';
import { formatElapsed } from './useNow';

interface Props {
  order: KdsOrderDto;
  config: KdsConfigDto | undefined;
  now: number;
  /** Arrival animation only plays for genuinely new cards. */
  isNew: boolean;
  readOnly: boolean;
  busy: boolean;
  onAcknowledge: (lineId: string) => void;
  onServe: (lineId: string) => void;
  onUndo: (lineId: string) => void;
  onServeAll: (orderId: string) => void;
  onExchange: (order: KdsOrderDto) => void;
}

function lineDeadline(order: KdsOrderDto, line: KdsLineDto, config: KdsConfigDto | undefined): number {
  const base = new Date(order.placedAt ?? order.createdAt).getTime();
  const prep = (line.prepSeconds ?? config?.defaultPrepSeconds ?? 900) * 1000;
  return base + prep;
}

/** #0003 is all a wall screen needs — the POS-20260819- prefix is bookkeeping, not kitchen info. */
export function shortOrderNumber(orderNumber: string): string {
  return orderNumber.split('-').pop() ?? orderNumber;
}

/**
 * A card of work, sized by what it holds — one compact row per line, each with its own
 * elapsed clock and its served/unserved state. Served lines stay visible until every line
 * on the card is done; then the card flies off to the Completed tab (see CounterBoard).
 */
export function OrderCard({
  order,
  config,
  now,
  isNew,
  readOnly,
  busy,
  onAcknowledge,
  onServe,
  onUndo,
  onServeAll,
  onExchange,
}: Props): JSX.Element {
  const base = new Date(order.placedAt ?? order.createdAt).getTime();
  const lines = order.lines;
  const unserved = useMemo(() => lines.filter((line) => line.kdsStatus !== 'SERVED'), [lines]);

  const { anyLate, allAcked } = useMemo(() => {
    return {
      anyLate: unserved.some((line) => lineDeadline(order, line, config) < now),
      allAcked: unserved.length > 0 && unserved.every((line) => line.kdsStatus === 'ACKNOWLEDGED'),
    };
  }, [order, unserved, config, now]);

  if (unserved.length === 0) return <></>;

  const elapsedSeconds = (now - base) / 1000;
  const timerTone = anyLate ? 'late' : elapsedSeconds > (config?.defaultPrepSeconds ?? 900) * 0.6 ? 'warn' : 'ok';

  const single = unserved.length === 1 && lines.length === 1 ? unserved[0] : undefined;

  return (
    <article
      data-kds-order={order.id}
      data-flip-id={order.id}
      className={[
        'kds-card',
        isNew ? 'kds-card--new' : '',
        anyLate ? 'kds-card--late' : allAcked ? 'kds-card--acknowledged' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <header className="kds-card__head">
        <span className="kds-card__number">#{shortOrderNumber(order.orderNumber)}</span>
        <span className="kds-card__who">
          {order.entityName ?? order.orderType.replace(/_/g, ' ').toLowerCase()}
          {order.counterName ? ` · ${order.counterName}` : ''}
        </span>
        {unserved.length > 0 && (
          <span className="kds-card__unserved">{unserved.length} unserved</span>
        )}
        <span className={`kds-card__timer kds-card__timer--${timerTone}`}>
          {formatElapsed(elapsedSeconds)}
        </span>
      </header>

      {single !== undefined ? (
        <>
          <div className="kds-card__single-item">
            <span className="kds-line__qty">{single.quantity}×</span>
            <span className="kds-line__name">
              <p>
                {single.customItemName ?? single.itemName}
                {single.variantName ? ` (${single.variantName})` : ''}
              </p>
              <small>
                {single.notes ? `${single.notes} · ` : ''}
                {single.printingGroupName ?? ''}
              </small>
            </span>
          </div>
          {!readOnly && (
            <button
              type="button"
              className="kds-card__big-serve"
              disabled={busy}
              onClick={() => onServe(single.id)}
            >
              Serve
            </button>
          )}
        </>
      ) : (
        <>
          <div className="kds-card__lines">
            {lines.map((line) => {
              const served = line.kdsStatus === 'SERVED';
              // A served line's clock froze when it went out — no ticking on finished work.
              const lineElapsed =
                served && line.servedAt !== null
                  ? (new Date(line.servedAt).getTime() - base) / 1000
                  : (now - base) / 1000;
              return (
                <div key={line.id} className={`kds-line ${served ? 'kds-line--served' : ''}`}>
                  <span className="kds-line__qty">{line.quantity}×</span>
                  <span className="kds-line__name">
                    <p>
                      {line.customItemName ?? line.itemName}
                      {line.variantName ? ` (${line.variantName})` : ''}
                    </p>
                    {line.notes !== null && line.notes !== '' && <small>{line.notes}</small>}
                  </span>
                  <span className="kds-line__elapsed">({formatElapsed(lineElapsed)})</span>
                  {served ? (
                    readOnly ? (
                      <span className="kds-line__status kds-line__status--served">
                        <CheckCircle2 className="size-3" /> Served
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="kds-line__btn kds-line__btn--unserved"
                        disabled={busy}
                        onClick={() => onUndo(line.id)}
                        title="Not served after all — call this line back"
                      >
                        Unserved
                      </button>
                    )
                  ) : readOnly ? (
                    <span
                      className={`kds-line__status kds-line__status--${line.kdsStatus === 'QUEUED' ? 'queued' : 'ack'}`}
                    >
                      Unserved
                    </span>
                  ) : (
                    <>
                      {line.kdsStatus === 'QUEUED' && (
                        <button
                          type="button"
                          className="kds-line__btn kds-line__btn--ack"
                          disabled={busy}
                          onClick={() => onAcknowledge(line.id)}
                        >
                          Got it
                        </button>
                      )}
                      <button
                        type="button"
                        className="kds-line__btn kds-line__btn--serve"
                        disabled={busy}
                        onClick={() => onServe(line.id)}
                      >
                        Served
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {!readOnly && unserved.length > 0 && (
            <footer className="kds-card__foot">
              <button
                type="button"
                className="kds-card__action kds-card__action--serve-all"
                disabled={busy}
                onClick={() => onServeAll(order.id)}
              >
                Serve all ({unserved.length})
              </button>
              <button
                type="button"
                className="kds-card__action kds-card__action--exchange"
                disabled={busy}
                onClick={() => onExchange(order)}
              >
                Exchange…
              </button>
            </footer>
          )}
        </>
      )}
    </article>
  );
}

