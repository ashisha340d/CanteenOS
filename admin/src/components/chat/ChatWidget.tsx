import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  BellRingIcon,
  PhoneOffIcon,
  MinusIcon,
  ExternalLinkIcon,
  ReceiptTextIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import {
  CounterMessageDirection,
  CounterMessageKind,
  type CounterMessageDto,
  type Uuid,
} from '@menuboard/shared';
import { kdsApi } from '@/api/kds';
import { useCounterChat } from '@/services/CounterChatContext';
import './ChatWidget.css';

/** Typing this in the composer opens the order picker — the shorthand the front desk asked for. */
const ORDER_TRIGGER = /\/ro\s*$/i;

const MIN_W = 300;
const MIN_H = 380;
const GEOMETRY_KEY = 'menuboard.admin.chat.geometry';

interface Geometry {
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const DEFAULT_GEOMETRY: Geometry = { right: 14, bottom: 40, width: 344, height: 500 };

function readGeometry(): Geometry {
  try {
    const raw = localStorage.getItem(GEOMETRY_KEY);
    if (raw === null) return DEFAULT_GEOMETRY;
    const parsed = JSON.parse(raw) as Partial<Geometry>;
    return {
      right: typeof parsed.right === 'number' ? parsed.right : DEFAULT_GEOMETRY.right,
      bottom: typeof parsed.bottom === 'number' ? parsed.bottom : DEFAULT_GEOMETRY.bottom,
      width: Math.max(MIN_W, parsed.width ?? DEFAULT_GEOMETRY.width),
      height: Math.max(MIN_H, parsed.height ?? DEFAULT_GEOMETRY.height),
    };
  } catch {
    return DEFAULT_GEOMETRY;
  }
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** "now / 14:05 / Tue / 12 Aug" — the ladder every messenger uses for a list of conversations. */
function whenOf(iso: string): string {
  const then = new Date(iso);
  const ageMs = Date.now() - then.getTime();
  if (ageMs < 60_000) return 'now';
  if (ageMs < 24 * 3600_000) return timeOf(iso);
  if (ageMs < 7 * 24 * 3600_000) return then.toLocaleDateString([], { weekday: 'short' });
  return then.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** Initials for the avatar disc — "Counter 3" becomes "C3", which is what people call it. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return ((words[0]![0] ?? '') + (words[words.length - 1]![0] ?? '')).toUpperCase();
}

/* --------------------------------------------------------------------- order picker */

function OrderPicker({
  counterId,
  onPick,
  onClose,
}: {
  counterId: Uuid;
  onPick: (order: { id: Uuid; orderNumber: string }) => void;
  onClose: () => void;
}): JSX.Element {
  const queue = useQuery({
    queryKey: ['counter-chat', 'queue', counterId],
    queryFn: () => kdsApi.counterQueue(counterId),
    staleTime: 5_000,
  });

  const orders = queue.data?.orders ?? [];

  return (
    <div className="cw-picker">
      <div className="cw-picker__head">
        <span>Attach an order</span>
        <button type="button" onClick={onClose} aria-label="Close">
          <XIcon className="cw-i" />
        </button>
      </div>
      <div className="cw-picker__list">
        {queue.isPending && <p className="cw-note">Loading the board…</p>}
        {!queue.isPending && orders.length === 0 && (
          <p className="cw-note">Nothing open on this counter.</p>
        )}
        {orders.map((order) => (
          <button
            key={order.id}
            type="button"
            className="cw-picker__row"
            onClick={() => onPick({ id: order.id, orderNumber: order.orderNumber })}
          >
            <span className="cw-picker__no">#{order.orderNumber}</span>
            <span className="cw-picker__items">
              {order.lines
                .filter((line) => line.kdsStatus !== 'SERVED')
                .map((line) => `${line.quantity}× ${line.customItemName ?? line.itemName}`)
                .join(', ')}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- bubbles */

function Bubble({
  message,
  onOpenOrder,
}: {
  message: CounterMessageDto;
  onOpenOrder: (orderId: Uuid) => void;
}): JSX.Element {
  const fromOffice = message.direction === CounterMessageDirection.TO_COUNTER;

  if (message.kind === CounterMessageKind.BELL) {
    return (
      <div className="cw-event">
        <BellRingIcon className="cw-i" />
        Bell rung · {timeOf(message.createdAt)}
      </div>
    );
  }

  return (
    <div className={`cw-row ${fromOffice ? 'cw-row--mine' : ''}`}>
      <div className={`cw-bubble ${fromOffice ? 'cw-bubble--mine' : ''}`}>
        {/* The whole point of a counter attaching an order: one click and the till is open on
            it. A tag you can read but not act on would make the attachment decorative. */}
        {message.orderNumber !== null && (
          <button
            type="button"
            className="cw-tag cw-tag--go"
            onClick={() => message.orderId !== null && onOpenOrder(message.orderId)}
            title="Open this order in POS"
          >
            <ReceiptTextIcon className="cw-i" />
            Order #{message.orderNumber}
            <ExternalLinkIcon className="cw-i cw-tag__go" />
          </button>
        )}
        <p className="cw-text">{message.body}</p>
        <span className="cw-time">
          {/* The Hindi the counter is actually reading — so the office knows its English was
              not what landed on the wall. */}
          {message.bodyHi !== null && (
            <span className="cw-hi" title={message.bodyHi}>
              हिन्दी
            </span>
          )}
          {timeOf(message.createdAt)}
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- widget */

/**
 * The office's messenger, floating above whatever module is open.
 *
 * Deliberately *not* a managed window: it has to stay reachable while somebody works inside
 * Menu Master or the POS dashboard, and a window in the stack would be buried by the next thing
 * they opened. It minimises to the task bar tray button instead.
 *
 * One pane at a time — conversations, then a thread — rather than a list beside a thread. The
 * side-by-side version needed 720px of a screen somebody is trying to work in; this is a phone
 * messenger's shape, and it fits in 344px because that is all a chat has ever needed. It carries
 * its own dark palette on purpose: Canteen OS is a light desktop, and a chat that borrowed that
 * chrome read as another module rather than as a conversation floating over one.
 */
export function ChatWidget(): JSX.Element {
  const chat = useCounterChat();
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const [tagged, setTagged] = useState<{ id: Uuid; orderNumber: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [geometry, setGeometry] = useState<Geometry>(readGeometry);
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; geo: Geometry; mode: 'move' | 'resize' } | null>(
    null,
  );

  const active = useMemo(
    () => chat.summaries.find((row) => row.counterId === chat.activeCounterId) ?? null,
    [chat.summaries, chat.activeCounterId],
  );

  useEffect(() => {
    const list = listRef.current;
    if (list !== null) list.scrollTop = list.scrollHeight;
  }, [chat.thread?.messages.length, chat.counterTyping, chat.open, chat.activeCounterId]);

  useEffect(() => {
    setTagged(null);
    setPickerOpen(false);
    setConfirmClear(false);
  }, [chat.activeCounterId]);

  /* Drag and resize share one pointer session: both are "the pointer moved, apply the delta to
     the geometry", and splitting them into two listeners only means two places to clamp. The
     panel is anchored bottom-right, so a rightward drag *decreases* `right`. */
  const onPointerDown = useCallback(
    (event: React.PointerEvent, mode: 'move' | 'resize') => {
      event.preventDefault();
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
      dragRef.current = { x: event.clientX, y: event.clientY, geo: geometry, mode };
    },
    [geometry],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const drag = dragRef.current;
      if (drag === null) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;

      setGeometry(() => {
        if (drag.mode === 'move') {
          return {
            ...drag.geo,
            right: Math.max(0, Math.min(window.innerWidth - 80, drag.geo.right - dx)),
            bottom: Math.max(0, Math.min(window.innerHeight - 60, drag.geo.bottom - dy)),
          };
        }
        // Resizing pulls the top-left corner, so the anchored bottom-right stays put.
        return {
          ...drag.geo,
          width: Math.max(MIN_W, Math.min(window.innerWidth - 40, drag.geo.width - dx)),
          height: Math.max(MIN_H, Math.min(window.innerHeight - 60, drag.geo.height - dy)),
        };
      });
    };
    const onUp = (): void => {
      if (dragRef.current === null) return;
      dragRef.current = null;
      setGeometry((current) => {
        localStorage.setItem(GEOMETRY_KEY, JSON.stringify(current));
        return current;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  if (!chat.open) return <></>;

  const submit = (): void => {
    const body = draft.trim();
    if (body === '' || chat.activeCounterId === null || chat.isSending) return;
    chat.send(body, tagged?.id ?? null);
    setDraft('');
    setTagged(null);
  };

  const inThread = chat.activeCounterId !== null;

  /* Portalled to <body>, not left in the shell.

     A z-index only ranks siblings inside the same stacking context, and this panel lives deep
     inside the app shell while every dialog, sheet and popover is portalled to the document
     body by Radix. Ranked from inside the shell it could never win against them, whatever
     number it carried — so it moves to the level they are on, and then outranks them. */
  return createPortal(
    <section
      className="cw"
      aria-label="Counter messaging"
      style={{
        right: geometry.right,
        bottom: geometry.bottom,
        width: geometry.width,
        height: geometry.height,
      }}
    >
      {/* Grab anywhere on the header bar that is not a button. */}
      <header className="cw-head" onPointerDown={(event) => onPointerDown(event, 'move')}>
        {inThread ? (
          <>
            <button
              type="button"
              className="cw-icon-btn"
              onClick={() => chat.openCounter(null)}
              onPointerDown={(event) => event.stopPropagation()}
              aria-label="Back to conversations"
            >
              <ArrowLeftIcon className="cw-i" />
            </button>
            <span className="cw-avatar cw-avatar--sm">
              {initialsOf(active?.counterName ?? '?')}
            </span>
            <span className="cw-head__title">
              <strong>{active?.counterName ?? 'Counter'}</strong>
              <small>{chat.counterTyping ? 'typing…' : 'Counter'}</small>
            </span>
          </>
        ) : (
          <span className="cw-head__title cw-head__title--main">
            <strong>Messages</strong>
            <small>
              {chat.totalUnread > 0 ? `${chat.totalUnread} new` : 'All counters'}
            </small>
          </span>
        )}

        <span className="cw-head__actions" onPointerDown={(event) => event.stopPropagation()}>
          {inThread && (
            <>
              {/* One button, two states, exactly like a phone: it places the call, then it
                  ends it. Hanging up cuts the counter's ringing at once rather than letting
                  the remaining rings play out. */}
              {chat.onCall ? (
                <button
                  type="button"
                  className="cw-icon-btn cw-hangup"
                  onClick={chat.hangUp}
                  title="Hang up — stops the ringing at the counter"
                  aria-label="Hang up"
                >
                  <PhoneOffIcon className="cw-i" />
                </button>
              ) : (
                <button
                  type="button"
                  className="cw-icon-btn cw-call"
                  onClick={chat.ringBell}
                  disabled={chat.isRinging}
                  title="Ring this counter's bell"
                  aria-label="Ring bell"
                >
                  <BellRingIcon className="cw-i" />
                </button>
              )}
              <button
                type="button"
                className="cw-icon-btn"
                onClick={() => setConfirmClear(true)}
                title="Clear this conversation"
                aria-label="Clear conversation"
              >
                <Trash2Icon className="cw-i" />
              </button>
            </>
          )}
          <button
            type="button"
            className="cw-icon-btn"
            onClick={() => chat.setOpen(false)}
            title="Minimise to the task bar"
            aria-label="Minimise"
          >
            <MinusIcon className="cw-i" />
          </button>
        </span>
      </header>

      {confirmClear && (
        <div className="cw-confirm" role="alertdialog">
          <p>Clear this conversation for both sides? It cannot be undone.</p>
          <span>
            <button type="button" className="cw-btn cw-btn--ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="cw-btn cw-btn--danger"
              disabled={chat.isClearing}
              onClick={() => {
                chat.clearThread();
                setConfirmClear(false);
              }}
            >
              {chat.isClearing ? 'Clearing…' : 'Clear'}
            </button>
          </span>
        </div>
      )}

      {!inThread ? (
        <div className="cw-list">
          {chat.summaries.length === 0 && <p className="cw-note">No counters are set up.</p>}
          {chat.summaries.map((row) => {
            const unread = row.unreadCount > 0;
            return (
              <button
                key={row.counterId}
                type="button"
                className={`cw-conv ${unread ? 'cw-conv--unread' : ''}`}
                onClick={() => chat.openCounter(row.counterId)}
              >
                <span className="cw-avatar">{initialsOf(row.counterName)}</span>
                <span className="cw-conv__body">
                  <span className="cw-conv__top">
                    <span className="cw-conv__name">
                      {row.counterName}
                      {unread && <em className="cw-conv__new">New messages</em>}
                    </span>
                    {row.lastMessage !== null && (
                      <span className="cw-conv__when">{whenOf(row.lastMessage.createdAt)}</span>
                    )}
                  </span>
                  <span className="cw-conv__preview">
                    {row.lastMessage === null
                      ? 'No messages yet'
                      : row.lastMessage.kind === CounterMessageKind.BELL
                        ? '🔔 Bell rung'
                        : `${row.lastMessage.direction === CounterMessageDirection.TO_COUNTER ? 'You: ' : ''}${row.lastMessage.body}`}
                  </span>
                </span>
                {unread && <span className="cw-conv__badge">{row.unreadCount}</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <div className="cw-thread" ref={listRef}>
            {chat.threadPending && <p className="cw-note">Loading…</p>}
            {!chat.threadPending && (chat.thread?.messages.length ?? 0) === 0 && (
              <p className="cw-note">No messages yet. Say something.</p>
            )}
            {(chat.thread?.messages ?? []).map((message) => (
              <Bubble
                key={message.id}
                message={message}
                /* The same URL the POS dashboard uses to reopen a ticket, so the till lands in
                   exactly the state double-clicking that order on the board would give. */
                onOpenOrder={(orderId) => navigate(`/pos/entry?orderId=${orderId}`)}
              />
            ))}
            {chat.counterTyping && (
              <div className="cw-typing" aria-live="polite">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>

          {pickerOpen && chat.activeCounterId !== null && (
            <OrderPicker
              counterId={chat.activeCounterId}
              onPick={(order) => {
                setTagged(order);
                setPickerOpen(false);
                setDraft((prev) => prev.replace(ORDER_TRIGGER, ''));
              }}
              onClose={() => setPickerOpen(false)}
            />
          )}

          {tagged !== null && (
            <div className="cw-tagged">
              <ReceiptTextIcon className="cw-i" />
              Order #{tagged.orderNumber}
              <button type="button" onClick={() => setTagged(null)} aria-label="Remove">
                <XIcon className="cw-i" />
              </button>
            </div>
          )}

          <form
            className="cw-composer"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <button
              type="button"
              className={`cw-icon-btn cw-attach ${tagged !== null ? 'cw-attach--on' : ''}`}
              onClick={() => setPickerOpen((prev) => !prev)}
              title="Attach an order (or type /ro)"
              aria-label="Attach an order"
            >
              <ReceiptTextIcon className="cw-i" />
            </button>
            <textarea
              value={draft}
              rows={1}
              maxLength={2000}
              placeholder="Message…"
              aria-label="Message this counter"
              onChange={(event) => {
                const next = event.target.value;
                setDraft(next);
                if (ORDER_TRIGGER.test(next)) setPickerOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <button
              type="submit"
              className="cw-send"
              disabled={draft.trim() === '' || chat.isSending}
              aria-label="Send"
              title="Send"
            >
              <SendIcon className="cw-i" />
            </button>
          </form>
        </>
      )}

      {/* Top-left, because the panel is anchored to the bottom-right corner. */}
      <span
        className="cw-resize"
        role="presentation"
        title="Resize"
        onPointerDown={(event) => onPointerDown(event, 'resize')}
      />
    </section>,
    document.body,
  );
}

/**
 * The arrival notice, shown when a counter answers while the office is looking at something
 * else. Clicking it opens that counter's thread.
 */
export function ChatToast(): JSX.Element {
  const chat = useCounterChat();
  const message = chat.toast;

  useEffect(() => {
    if (message === null) return;
    const timer = window.setTimeout(() => chat.dismissToast(), 7_000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  if (message === null) return <></>;
  const counter = chat.summaries.find((row) => row.counterId === message.counterId);

  // Same reasoning as the panel: a notice nobody can see over a dialog is not a notice.
  return createPortal(
    <button
      type="button"
      className="cw-toast"
      onClick={() => {
        chat.openCounter(message.counterId);
        chat.dismissToast();
      }}
    >
      <span className="cw-avatar">{initialsOf(counter?.counterName ?? '?')}</span>
      <span className="cw-toast__text">
        <strong>{counter?.counterName ?? 'Counter'}</strong>
        <span>{message.kind === CounterMessageKind.BELL ? 'Bell rung' : message.body}</span>
      </span>
      <span
        className="cw-toast__x"
        role="presentation"
        onClick={(event) => {
          event.stopPropagation();
          chat.dismissToast();
        }}
      >
        <XIcon className="cw-i" />
      </span>
    </button>,
    document.body,
  );
}
