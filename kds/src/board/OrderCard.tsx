import { useMemo } from 'react';
import { CheckCircle2, MessageSquare } from 'lucide-react';
import type { KdsConfigDto, KdsLineDto, KdsOrderDto } from '@menuboard/shared';
import { formatElapsed } from './useNow';
import { setDraggedOrder } from '../chat/orderDrag';
import { pickName, useLang, useT } from '../i18n';

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
  /** Messages the office tagged to this order, unread by this counter. */
  chatUnread?: number;
  /** All messages tagged to this order, read or not. Zero hides the marker entirely. */
  chatCount?: number;
  /** Present only when a chat channel exists — a kitchen screen has none. */
  onOpenChat?: (orderId: string) => void;
}

function lineDeadline(order: KdsOrderDto, line: KdsLineDto, config: KdsConfigDto | undefined): number {
  const base = new Date(order.placedAt ?? order.createdAt).getTime();
  const prep = (line.prepSeconds ?? config?.defaultPrepSeconds ?? 900) * 1000;
  return base + prep;
}

/**
 * How urgent this card is, from its most urgent unserved line. The whole card changes colour,
 * not just its outline — a border alone is invisible on a wall from across a kitchen.
 *
 *  normal    just arrived, plenty of time
 *  warning   inside the attention window (blue)
 *  critical  past its due time (pink)
 *  alarm     past due by a whole repeat interval — pink, red-edged and flashing
 */
type CardUrgency = 'normal' | 'warning' | 'critical' | 'alarm';

function urgencyOf(
  order: KdsOrderDto,
  lines: KdsLineDto[],
  config: KdsConfigDto | undefined,
  now: number,
): CardUrgency {
  const attentionMs = (config?.dueSoonSeconds ?? 300) * 1000;
  const repeatMs = (config?.overdueRepeatSeconds ?? 60) * 1000;
  let worst: CardUrgency = 'normal';

  for (const line of lines) {
    const due = lineDeadline(order, line, config);
    const state: CardUrgency =
      now >= due + repeatMs
        ? 'alarm'
        : now >= due
          ? 'critical'
          : now >= due - attentionMs
            ? 'warning'
            : 'normal';
    if (state === 'alarm') return 'alarm';
    if (state === 'critical') worst = 'critical';
    else if (state === 'warning' && worst === 'normal') worst = 'warning';
  }
  return worst;
}

/** #0003 is all a wall screen needs — the POS-20260819- prefix is bookkeeping, not kitchen info. */
export function shortOrderNumber(orderNumber: string): string {
  return orderNumber.split('-').pop() ?? orderNumber;
}

/**
 * A card of work — one compact row per line, each with its own clock and its served state.
 * The card is capped in height and its line list scrolls, so a twenty-item ticket takes the
 * same space on the wall as a two-item one instead of pushing everything else off screen.
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
  chatUnread = 0,
  chatCount = 0,
  onOpenChat,
}: Props): JSX.Element {
  const t = useT();
  const { lang } = useLang();
  const base = new Date(order.placedAt ?? order.createdAt).getTime();
  const lines = order.lines;
  const unserved = useMemo(() => lines.filter((line) => line.kdsStatus !== 'SERVED'), [lines]);

  const urgency = useMemo(() => urgencyOf(order, unserved, config, now), [order, unserved, config, now]);

  if (unserved.length === 0) return <></>;

  const elapsedSeconds = (now - base) / 1000;
  const timerTone =
    urgency === 'alarm' || urgency === 'critical' ? 'late' : urgency === 'warning' ? 'warn' : 'ok';

  const single = unserved.length === 1 && lines.length === 1 ? unserved[0] : undefined;

  return (
    <article
      data-kds-order={order.id}
      data-flip-id={order.id}
      /* Pick the ticket up and drop it on the chat to ask the office about it. Harmless
         anywhere else — nothing on this board accepts the type. */
      draggable
      onDragStart={(event) =>
        setDraggedOrder(event, { orderId: order.id, orderNumber: order.orderNumber })
      }
      className={[
        'kds-card',
        `kds-card--${urgency}`,
        isNew ? 'kds-card--new' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <header className="kds-card__head">
        <span className="kds-card__number">#{shortOrderNumber(order.orderNumber)}</span>
        <span className="kds-card__who">
          {order.entityName ?? order.orderType.replace(/_/g, ' ').toLowerCase()}
        </span>
        {unserved.length > 0 && (
          <span className="kds-card__unserved">{t.unservedCount(unserved.length)}</span>
        )}
        {/* The marker stays for as long as the order carries a message, not only while one is
            unread: "there is a note on this ticket" is a fact about the ticket, and a counter
            that read it in the morning still needs to find it at the hand-over. Unread simply
            makes it louder. */}
        {chatCount > 0 && onOpenChat !== undefined && (
          <button
            type="button"
            className={`kds-card__chat ${chatUnread > 0 ? 'kds-card__chat--unread' : ''}`}
            onClick={() => onOpenChat(order.id)}
            aria-label={t.chatOpenForOrder}
            title={t.chatOrderTagged}
          >
            <MessageSquare className="size-4" />
            <span>{chatUnread > 0 ? t.chatUnreadShort(chatUnread) : t.chatOnOrder}</span>
          </button>
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
                {single.customItemName ?? pickName(lang, single.itemName, single.itemNameHi)}
                {single.variantName ? ` (${single.variantName})` : ''}
              </p>
              {single.notes !== null && single.notes !== '' && <small>{single.notes}</small>}
            </span>
          </div>
          {!readOnly && (
            <button
              type="button"
              className="kds-card__big-serve"
              disabled={busy}
              onClick={() => onServe(single.id)}
            >
              {t.markServed}
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
                      {line.customItemName ?? pickName(lang, line.itemName, line.itemNameHi)}
                      {line.variantName ? ` (${line.variantName})` : ''}
                    </p>
                    {line.notes !== null && line.notes !== '' && <small>{line.notes}</small>}
                  </span>
                  <span className="kds-line__elapsed">({formatElapsed(lineElapsed)})</span>
                  {served ? (
                    readOnly ? (
                      <span className="kds-line__status kds-line__status--served">
                        <CheckCircle2 className="size-3" /> {t.served}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="kds-line__btn kds-line__btn--unserved"
                        disabled={busy}
                        onClick={() => onUndo(line.id)}
                        title={t.markUnserved}
                      >
                        {t.unserved}
                      </button>
                    )
                  ) : readOnly ? (
                    <span
                      className={`kds-line__status kds-line__status--${line.kdsStatus === 'QUEUED' ? 'queued' : 'ack'}`}
                    >
                      {t.unserved}
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
                          {t.gotIt}
                        </button>
                      )}
                      <button
                        type="button"
                        className="kds-line__btn kds-line__btn--serve"
                        disabled={busy}
                        onClick={() => onServe(line.id)}
                      >
                        {t.served}
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
                {t.serveAll} ({unserved.length})
              </button>
              <button
                type="button"
                className="kds-card__action kds-card__action--exchange"
                disabled={busy}
                onClick={() => onExchange(order)}
              >
                {t.exchange}
              </button>
            </footer>
          )}
        </>
      )}
    </article>
  );
}
