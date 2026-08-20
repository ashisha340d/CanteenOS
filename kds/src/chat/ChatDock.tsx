import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, MinusIcon, Phone, ReceiptText, Send, X } from 'lucide-react';
import { CounterMessageDirection, type CounterMessageDto } from '@menuboard/shared';
import { useLang, useT } from '../i18n';
import { IndiaFlag } from '../components/Flags';
import { isOrderDrag, readDraggedOrder, type DraggedOrder } from './orderDrag';
import type { CounterChatApi } from './useCounterChat';
import { isBell } from './useCounterChat';
import './chat.css';

/** Stops the typing ping firing on every keystroke while still feeling immediate. */
const TYPING_PING_MS = 1_800;

/* Geometry, on the same terms as the admin widget — anchored bottom-right, dragged by the
   header, resized from the top-left corner, remembered on the device. A little larger than the
   desktop's because this is read standing up and tapped with a thumb. */
const MIN_W = 320;
const MIN_H = 420;
const GEOMETRY_KEY = 'menuboard.kds.chat.geometry';

interface Geometry {
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const DEFAULT_GEOMETRY: Geometry = { right: 16, bottom: 16, width: 384, height: 560 };

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

/**
 * One message. The office's words sit left, the counter's right — the arrangement every phone
 * has taught this room to read without a legend.
 */
function Bubble({
  message,
  hindi,
  translating,
  flash,
  onShowOrder,
}: {
  message: CounterMessageDto;
  /** Prefer the Hindi rendering where one exists. */
  hindi: boolean;
  /** Its Hindi is being fetched right now. */
  translating: boolean;
  /** Briefly lit because the counter jumped here from an order card. */
  flash: boolean;
  onShowOrder: (orderId: string) => void;
}): JSX.Element {
  const t = useT();
  const fromOffice = message.direction === CounterMessageDirection.TO_COUNTER;
  const translated = hindi && message.bodyHi !== null;
  const body = translated ? (message.bodyHi as string) : message.body;

  // An answered bell stays in the thread as what it was: an event, not a line of conversation.
  if (isBell(message)) {
    return (
      <div className="kc-event">
        <Phone className="kc-i" />
        {t.chatBellRang} · {timeOf(message.createdAt)}
      </div>
    );
  }

  return (
    <div className={`kc-row ${fromOffice ? '' : 'kc-row--mine'}`} data-kc-message={message.id}>
      <div
        className={[
          'kc-bubble',
          fromOffice ? '' : 'kc-bubble--mine',
          flash ? 'kc-bubble--flash' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {message.orderNumber !== null && (
          <button
            type="button"
            className="kc-tag"
            onClick={() => message.orderId !== null && onShowOrder(message.orderId)}
          >
            <ReceiptText className="kc-i" />
            {t.chatAboutOrder(message.orderNumber)}
          </button>
        )}
        <p className="kc-text">{body}</p>
        <span className="kc-time">
          {translated && <span className="kc-badge">{t.chatTranslated}</span>}
          {translating && <span className="kc-badge">{t.chatTranslating}</span>}
          {timeOf(message.createdAt)}
        </span>
      </div>
    </div>
  );
}

/**
 * The counter's end of the office conversation.
 *
 * The same floating messenger the admin desktop carries — dragged by its header, resized from
 * its corner, remembered where it was left — rather than a panel welded to the edge of the
 * screen. A wall board is not one layout: the cards that matter sit in different places at
 * different counters, and the person standing there is the only one who knows where a chat
 * window is in the way. So they move it.
 *
 * One thread, no conversation list: a counter talks to exactly one party, the office.
 */
export function ChatDock({
  chat,
  open,
  onOpenChange,
  onShowOrder,
  focusOrderId = null,
  onFocusHandled,
}: {
  chat: CounterChatApi;
  /* Owned by the board, not by this component: the same flag tells `useCounterChat` whether an
     arriving message should count as unread, and two copies of it would disagree the moment a
     tagged order card opened the panel from outside. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Jump the board to an order a message is about. */
  onShowOrder: (orderId: string) => void;
  /**
   * An order whose message the counter asked to see — set by tapping the marker on its card.
   * The thread scrolls to that message and flashes it, rather than merely opening at the
   * bottom and leaving somebody to hunt for what they clicked.
   */
  focusOrderId?: string | null;
  /** Cleared once the scroll has happened, so the same card can be tapped again. */
  onFocusHandled?: () => void;
}): JSX.Element {
  const t = useT();
  const { lang } = useLang();
  const [draft, setDraft] = useState('');
  const [attached, setAttached] = useState<DraggedOrder | null>(null);
  /* Depth, not a boolean: dragging across a child fires `dragleave` on the parent, so a plain
     flag would flicker the highlight off every time the pointer crossed a bubble. */
  const dragDepth = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  const [geometry, setGeometry] = useState<Geometry>(readGeometry);
  const listRef = useRef<HTMLDivElement>(null);
  const lastTypingPing = useRef(0);
  const dragRef = useRef<{ x: number; y: number; geo: Geometry; mode: 'move' | 'resize' } | null>(
    null,
  );

  // Follow the conversation down as it grows, and on opening.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (list !== null) list.scrollTop = list.scrollHeight;
  }, [open, chat.messages.length, chat.officeTyping]);

  // A bell opens the panel by itself: being rung and not shown what for is worse than an
  // interruption, and the counter answers it either way.
  useEffect(() => {
    if (chat.ringing !== null) onOpenChange(true);
  }, [chat.ringing, onOpenChange]);

  /* Scroll to the message the tapped card is about — its most recent one, since that is what
     "what did they say about this order" means — and flash it so the eye lands on the right
     bubble in a thread that may be long. Runs after paint, because the element only exists
     once the panel has rendered. */
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    if (focusOrderId === null || !open) return;
    const match = [...chat.messages].reverse().find((entry) => entry.orderId === focusOrderId);
    onFocusHandled?.();
    if (match === undefined) return;

    const frame = window.requestAnimationFrame(() => {
      const node = listRef.current?.querySelector<HTMLElement>(`[data-kc-message="${match.id}"]`);
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFlashId(match.id);
    });
    const clear = window.setTimeout(() => setFlashId(null), 2_200);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(clear);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusOrderId, open, chat.messages]);

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
            right: Math.max(0, Math.min(window.innerWidth - 90, drag.geo.right - dx)),
            bottom: Math.max(0, Math.min(window.innerHeight - 70, drag.geo.bottom - dy)),
          };
        }
        // Resizing pulls the top-left corner, so the anchored bottom-right stays put.
        return {
          ...drag.geo,
          width: Math.max(MIN_W, Math.min(window.innerWidth - 40, drag.geo.width - dx)),
          height: Math.max(MIN_H, Math.min(window.innerHeight - 40, drag.geo.height - dy)),
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

  const submit = (): void => {
    const body = draft.trim();
    if (body === '' || chat.isSending) return;
    chat.send(body, attached?.orderId ?? null);
    setDraft('');
    setAttached(null);
    chat.setTyping(false);
  };

  const onDrop = (event: React.DragEvent): void => {
    dragDepth.current = 0;
    setDragOver(false);
    const order = readDraggedOrder(event);
    if (order === null) return;
    event.preventDefault();
    setAttached(order);
  };

  const onDraftChange = (value: string): void => {
    setDraft(value);
    const now = Date.now();
    if (now - lastTypingPing.current > TYPING_PING_MS) {
      lastTypingPing.current = now;
      chat.setTyping(value.trim() !== '');
    }
  };

  /* Minimised, this is a floating button rather than the desktop's task bar entry — a board has
     no task bar, and an edge the counter can always find is the nearest equivalent. */
  if (!open) {
    return (
      <button
        type="button"
        className={[
          'kc-tab',
          chat.ringing !== null ? 'kc-tab--ringing' : '',
          chat.ringing === null && chat.unreadCount > 0 ? 'kc-tab--unread' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => {
          chat.unlockSound();
          onOpenChange(true);
        }}
        aria-label={t.chatOpen}
        title={t.chatOpen}
      >
        {chat.ringing !== null ? <Phone className="kc-i-lg" /> : <MessageSquare className="kc-i-lg" />}
        {chat.unreadCount > 0 && <span className="kc-tab__count">{chat.unreadCount}</span>}
      </button>
    );
  }

  return (
    <section
      className={`kc ${dragOver ? 'kc--drop' : ''}`}
      aria-label={t.chatTitle}
      /* The whole window takes the drop, not just the composer: a counter dragging a ticket
         across the room aims at the conversation, not at a 40px input. */
      onDragEnter={(event) => {
        if (!isOrderDrag(event)) return;
        dragDepth.current += 1;
        setDragOver(true);
      }}
      onDragOver={(event) => {
        if (!isOrderDrag(event)) return;
        // Without this the browser refuses the drop entirely.
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        if (!isOrderDrag(event)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragOver(false);
      }}
      onDrop={onDrop}
      style={{
        right: geometry.right,
        bottom: geometry.bottom,
        width: geometry.width,
        height: geometry.height,
      }}
    >
      {/* Grab anywhere on the header bar that is not a button. */}
      <header className="kc-head" onPointerDown={(event) => onPointerDown(event, 'move')}>
        <span className="kc-avatar" aria-hidden="true">
          <MessageSquare className="kc-i" />
        </span>
        <span className="kc-head__title">
          <strong>{t.chatTitle}</strong>
          <small>{chat.officeTyping ? t.chatTyping : t.chatSubtitle}</small>
        </span>

        <span className="kc-head__actions" onPointerDown={(event) => event.stopPropagation()}>
          <button
            type="button"
            className={`kc-translate ${chat.autoTranslate ? 'kc-translate--on' : ''}`}
            onClick={() => chat.setAutoTranslate(!chat.autoTranslate)}
            aria-pressed={chat.autoTranslate}
            title={chat.autoTranslate ? t.chatAutoTranslateOn : t.chatAutoTranslateOff}
          >
            <IndiaFlag className="kc-flag" />
            <span>{t.chatAutoTranslate}</span>
          </button>
          <button
            type="button"
            className="kc-icon-btn"
            onClick={() => onOpenChange(false)}
            aria-label={t.chatMinimize}
            title={t.chatMinimize}
          >
            <MinusIcon className="kc-i" />
          </button>
        </span>
      </header>

      {/* The office is ringing and nobody has picked up. The green handset is the only thing
          that stops it — see the ring sequence in `useCounterChat`. */}
      {chat.ringing !== null && (
        <div className="kc-ring" role="alert">
          <span className="kc-ring__text">
            <strong>{t.chatBellRang}</strong>
            <span>{t.chatAnswerHint}</span>
          </span>
          <button type="button" className="kc-answer" onClick={chat.dismissRing}>
            <Phone className="kc-i-lg" />
            {t.chatAnswer}
          </button>
        </div>
      )}

      <div className="kc-thread" ref={listRef}>
        {chat.isPending && <p className="kc-note">{t.chatLoading}</p>}
        {chat.error !== null && chat.error !== undefined && (
          <p className="kc-note kc-note--bad">{t.chatLoadFailed}</p>
        )}
        {!chat.isPending && chat.messages.length === 0 && (
          <p className="kc-note">{t.chatEmpty}</p>
        )}
        {chat.messages.map((message) => (
          <Bubble
            key={message.id}
            message={message}
            /* Hindi shows when the board is in Hindi, and always when the counter has asked
               for auto-translate — the point of that switch is to read the office in Hindi
               even on a board someone left in English. */
            hindi={lang === 'hi' || chat.autoTranslate}
            translating={chat.translating.has(message.id)}
            flash={flashId === message.id}
            onShowOrder={onShowOrder}
          />
        ))}
        {chat.officeTyping && (
          <div className="kc-typing" aria-live="polite">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      {chat.sendFailed && <p className="kc-note kc-note--bad">{t.chatSendFailed}</p>}

      {attached !== null && (
        <div className="kc-attached">
          <ReceiptText className="kc-i" />
          {t.chatAboutOrder(attached.orderNumber)}
          <button type="button" onClick={() => setAttached(null)} aria-label={t.chatRemoveOrder}>
            <X className="kc-i" />
          </button>
        </div>
      )}

      {dragOver && (
        <div className="kc-dropzone" aria-hidden="true">
          <ReceiptText className="kc-i-lg" />
          {t.chatDropOrder}
        </div>
      )}

      <form
        className="kc-composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line — a counter types one sentence, not prose.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={t.chatPlaceholder}
          rows={1}
          maxLength={2000}
          aria-label={t.chatPlaceholder}
        />
        <button
          type="submit"
          className="kc-send"
          disabled={draft.trim() === '' || chat.isSending}
          aria-label={t.chatSend}
          title={t.chatSend}
        >
          <Send className="kc-i" />
        </button>
      </form>

      {/* Top-left, because the panel is anchored to its bottom-right corner. */}
      <span
        className="kc-resize"
        role="presentation"
        title={t.chatResize}
        onPointerDown={(event) => onPointerDown(event, 'resize')}
      />
    </section>
  );
}
