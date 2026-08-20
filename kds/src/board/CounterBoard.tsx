import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LockKeyhole, PersonStanding, SettingsIcon } from 'lucide-react';
import type { KdsOrderDto } from '@menuboard/shared';
import {
  acknowledgeLine,
  exchangeOrder,
  fetchCounterMetrics,
  fetchKdsConfig,
  revertLine,
  serveAll,
  serveLine,
} from '../api/kds';
import { readErrorMessage } from '../api/client';
import { readAway, saveAway, type AwayState, type StationSelection } from '../config/station';
import { useDisplaySettings } from '../config/displaySettings';
import type { useQueue } from '../pages/BoardPage';
import { useAlarms } from './useAlarms';
import { useNow } from './useNow';
import { OrderCard } from './OrderCard';
import { MetricChips, QueueGrid } from './Rail';
import { ExchangeModal } from './ExchangeModal';
import { Celebration } from './Celebration';
import { useFlipGrid } from './useFlipGrid';
import { BottomNav, type BoardTab } from './BottomNav';
import { useT } from '../i18n';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ChatDock } from '../chat/ChatDock';
import { useCounterChat } from '../chat/useCounterChat';
import { SettingsModal } from './SettingsModal';
import { MenuItemsView } from './MenuItemsView';
import { CompletedView } from './CompletedView';

interface Props {
  station: StationSelection;
  queue: ReturnType<typeof useQueue>;
  onChangeStation: () => void;
  onSignOut: () => void;
  onLock: () => void;
}

export function CounterBoard({ station, queue, onChangeStation, onSignOut, onLock }: Props): JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const now = useNow();
  const display = useDisplaySettings(station.id);
  const [tab, setTab] = useState<BoardTab>('orders');
  const [exchangeFor, setExchangeFor] = useState<KdsOrderDto | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [away, setAway] = useState<AwayState>(() => readAway(station.id));
  const [chatOpen, setChatOpen] = useState(false);
  /** The order whose message the counter tapped, so the thread can jump straight to it. */
  const [chatFocusOrderId, setChatFocusOrderId] = useState<string | null>(null);
  const chat = useCounterChat(station.id, chatOpen);
  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const hadOrdersRef = useRef(false);
  const cardsRef = useRef<HTMLElement>(null);

  // Tones, deadlines and volume change when an admin says so, not during service.
  const config = useQuery({
    queryKey: ['kds', 'config'],
    queryFn: fetchKdsConfig,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });
  const metrics = useQuery({
    queryKey: ['kds', 'metrics', station.id],
    queryFn: () => fetchCounterMetrics(station.id),
    // Chips, not alarms: the socket already refreshes them on every real change, so the timer
    // is only here to catch a missed event.
    refetchInterval: 60_000,
    staleTime: 15_000,
  });

  // Alarms are the admin's, not the board's: no mute, no tone choice, no volume here.
  const alarms = useAlarms(queue.data, config.data);

  /**
   * Only what a line-flow write can actually change. `['kds']` would also take the config with
   * it — and the config carries the alarm tone paths, so every serve re-downloaded the buzzers.
   */
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['kds', 'queue'] });
    void queryClient.invalidateQueries({ queryKey: ['kds', 'metrics'] });
    void queryClient.invalidateQueries({ queryKey: ['kds', 'recent'] });
  };

  const mutation = useMutation({
    mutationFn: async (job: () => Promise<void>) => job(),
    onSuccess: invalidate,
  });

  /* Orders whose flight is in the air. They leave the wall the instant serve is tapped — the
     flying clone carries the visual — and are held here so a refetch cannot re-add them
     mid-flight. */
  const [flying, setFlying] = useState<Set<string>>(new Set());

  const allOrders = useMemo(() => queue.data?.orders ?? [], [queue.data]);
  /** Cards still on the wall: at least one unserved line, and not already in flight. */
  const orders = useMemo(
    () =>
      allOrders.filter(
        (order) =>
          !flying.has(order.id) && order.lines.some((line) => line.kdsStatus !== 'SERVED'),
      ),
    [allOrders, flying],
  );

  /**
   * The served card flies into the Completed tab: a fixed-position clone lifts off the wall and
   * glides along an arc, shrinking and rounding into the tab, which then flashes to catch it.
   * The real card fades in place and the grid closes the gap through `useFlipGrid`.
   */
  const flyToCompleted = (orderId: string): void => {
    const card = document.querySelector<HTMLElement>(`[data-kds-order="${orderId}"]`);
    const tab = document.getElementById('kds-tab-completed');
    if (card === null || tab === null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const from = card.getBoundingClientRect();
    const to = tab.getBoundingClientRect();
    const zoom = Number(getComputedStyle(card).zoom) || 1;

    const ghost = card.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('data-kds-order');
    ghost.removeAttribute('data-flip-id');
    ghost.style.cssText =
      `position: fixed; left: ${from.left}px; top: ${from.top}px; margin: 0; z-index: 90;` +
      `pointer-events: none; will-change: transform, opacity; transform-origin: 50% 50%;` +
      `zoom: ${zoom}; width: ${from.width / zoom}px; height: ${from.height / zoom}px;`;
    document.body.appendChild(ghost);

    const dx = (to.left + to.width / 2 - (from.left + from.width / 2)) / zoom;
    const dy = (to.top + to.height / 2 - (from.top + from.height / 2)) / zoom;
    const end = Math.min(0.12, 70 / Math.max(from.width, 1));
    // Ease out of the wall, arc up, then accelerate into the tab — one continuous motion.
    const flight = ghost.animate(
      [
        { transform: 'translate(0px, 0px) scale(1) rotate(0deg)', opacity: 1, offset: 0, easing: 'cubic-bezier(0.32, 0.94, 0.6, 1)' },
        {
          transform: `translate(${dx * 0.34}px, ${dy * 0.3 - 44}px) scale(0.74) rotate(-1.6deg)`,
          opacity: 0.98,
          offset: 0.42,
          easing: 'cubic-bezier(0.5, 0, 0.75, 0.4)',
        },
        {
          transform: `translate(${dx * 0.82}px, ${dy * 0.82}px) scale(0.3) rotate(-0.6deg)`,
          opacity: 0.7,
          offset: 0.82,
          easing: 'cubic-bezier(0.4, 0, 1, 1)',
        },
        { transform: `translate(${dx}px, ${dy}px) scale(${end}) rotate(0deg)`, opacity: 0, offset: 1 },
      ],
      { duration: 820, fill: 'forwards' },
    );
    flight.onfinish = () => {
      ghost.remove();
      tab.classList.add('kds-tabs__tab--pulse');
      window.setTimeout(() => tab.classList.remove('kds-tabs__tab--pulse'), 620);
    };
  };

  /** Launch the flight, then hold the order off the wall until the refetch agrees it is done. */
  const launch = (orderId: string): void => {
    flyToCompleted(orderId);
    setFlying((prev) => new Set(prev).add(orderId));
    window.setTimeout(() => {
      setFlying((prev) => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }, 1_100);
  };

  const handleServeAll = (orderId: string): void => {
    launch(orderId);
    mutation.mutate(() => serveAll(orderId, station.id));
  };

  const handleServeLine = (lineId: string): void => {
    // Serving a card's last open line is the card's checkout — fly it out too.
    const order = allOrders.find((o) => o.lines.some((line) => line.id === lineId));
    if (order !== undefined && order.lines.filter((line) => line.kdsStatus !== 'SERVED').length === 1) {
      launch(order.id);
    }
    mutation.mutate(() => serveLine(lineId));
  };

  const queuedItems = useMemo(
    () => (queue.data?.summary ?? []).reduce((sum, row) => sum + row.quantity, 0),
    [queue.data],
  );
  const newIds = useMemo(() => {
    const fresh = new Set<string>();
    for (const order of orders) {
      if (!knownOrderIdsRef.current.has(order.id)) fresh.add(order.id);
    }
    return fresh;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  // Keyed on the ids, not the count: one card arriving as another leaves keeps the count
  // identical, and a card that never got recorded would keep claiming to be new.
  const orderIdKey = orders.map((order) => order.id).join('|');
  useEffect(() => {
    for (const order of orders) knownOrderIdsRef.current.add(order.id);
    if (orders.length > 0) {
      hadOrdersRef.current = true;
    } else if (hadOrdersRef.current && queue.isFetched && flying.size === 0) {
      // Wait for the last flight to land before the board celebrates being clear.
      hadOrdersRef.current = false;
      setCelebrating(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderIdKey, flying.size]);

  // The wall closes the gap left by a served card instead of snapping into the new layout.
  useFlipGrid(cardsRef, orders.map((order) => order.id).join('|'));

  useEffect(() => saveAway(station.id, away), [station.id, away]);

  /* Idle away-detection: untouched for the configured minutes and the screen announces itself
     unmanned. A touch brings an idle-set away back; a manually set away waits for the button. */
  const awayRef = useRef(away);
  awayRef.current = away;
  useEffect(() => {
    if (display.settings.idleAwayMinutes === 0) return;
    let timer = 0;
    const reset = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => setAway({ on: true, manual: false }),
        display.settings.idleAwayMinutes * 60_000,
      );
      if (awayRef.current.on && !awayRef.current.manual) setAway({ on: false, manual: false });
    };
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    reset();
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
    };
  }, [display.settings.idleAwayMinutes]);

  const busy = mutation.isPending;

  return (
    <div
      className="kds-board"
      data-skin={display.resolvedSkin}
      style={display.style}
      onPointerDown={() => {
        alarms.unlock();
        chat.unlockSound();
      }}
    >
      {/* One compact bar: identity, counts, the tabs and the controls. The tabs used to sit in
          their own row at the bottom, which cost a whole strip of wall for four words. */}
      <header className="kds-topbar">
        <div className="kds-topbar__station">
          <h1>{station.name}</h1>
          <p>{t.serviceKds}</p>
        </div>

        <BottomNav
          active={tab}
          onSelect={setTab}
          openOrders={orders.length}
          queuedItems={queuedItems}
          completedCount={0}
        />

        <MetricChips
          pendingOrders={metrics.data?.pendingOrders ?? orders.length}
          pendingLines={metrics.data?.pendingLines ?? 0}
          servedTodayOrders={metrics.data?.servedTodayOrders ?? 0}
          avgServeSeconds={metrics.data?.avgServeSeconds ?? null}
          overdueLines={metrics.data?.overdueLines ?? 0}
        />

        <LanguageSwitch compact />

        <button
          type="button"
          className={`kds-topbar__btn ${away.on ? 'kds-topbar__btn--away' : ''}`}
          onClick={() => setAway(away.on ? { on: false, manual: false } : { on: true, manual: true })}
          aria-pressed={away.on}
          title={away.on ? t.awayToggleOff : t.awayToggleOn}
        >
          <PersonStanding className="size-4" />
          {away.on ? t.away : t.atStation}
        </button>
        <button type="button" className="kds-topbar__btn" onClick={onLock} title={t.lockScreen}>
          <LockKeyhole className="size-4" />
        </button>
        <button
          type="button"
          className="kds-topbar__btn"
          onClick={() => setSettingsOpen(true)}
          aria-label={t.displaySettings}
        >
          <SettingsIcon className="size-4" />
        </button>
      </header>

      {away.on && (
        <div className="kds-away" role="status">
          <PersonStanding className="size-4" />
          {t.awayBanner}
          <button type="button" onClick={() => setAway({ on: false, manual: false })}>
            {t.imBack}
          </button>
        </div>
      )}

      {tab === 'orders' && (
        <div className="kds-board__body">
          <main className="kds-cards" ref={cardsRef}>
            {queue.isPending && <p style={{ color: 'var(--kds-soft)' }}>{t.loadingBoard}</p>}
            {queue.error !== null && (
              <p style={{ color: 'var(--kds-late)' }}>{readErrorMessage(queue.error, t.boardLoadFailed)}</p>
            )}
            {queue.isFetched && orders.length === 0 && !celebrating && (
              <p style={{ color: 'var(--kds-faint)', fontSize: 18 }}>{t.nothingQueued}</p>
            )}
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                config={config.data}
                now={now}
                isNew={newIds.has(order.id)}
                readOnly={false}
                busy={busy}
                onAcknowledge={(lineId) => mutation.mutate(() => acknowledgeLine(lineId))}
                onServe={handleServeLine}
                onUndo={(lineId) => mutation.mutate(() => revertLine(lineId))}
                onServeAll={handleServeAll}
                onExchange={setExchangeFor}
                chatUnread={chat.tagsByOrder.get(order.id)?.unreadCount ?? 0}
                chatCount={chat.tagsByOrder.get(order.id)?.messageCount ?? 0}
                onOpenChat={(orderId) => {
                  setChatOpen(true);
                  setChatFocusOrderId(orderId);
                }}
              />
            ))}
          </main>
        </div>
      )}

      {tab === 'queue' && (
        <div className="kds-board__body kds-board__body--queue">
          <QueueGrid
            summary={queue.data?.summary ?? []}
            scale={display.settings.queueScale}
            onScaleChange={(queueScale) => display.update({ queueScale })}
            size={
              display.settings.queueWidth === null || display.settings.queueHeight === null
                ? undefined
                : { width: display.settings.queueWidth, height: display.settings.queueHeight }
            }
            onSizeChange={({ width, height }) =>
              display.update({ queueWidth: width, queueHeight: height })
            }
          />
        </div>
      )}

      {tab === 'menu' && <MenuItemsView station={station} />}

      {tab === 'completed' && (
        <CompletedView
          station={station}
          busy={busy}
          onRevert={(lineId) => mutation.mutate(() => revertLine(lineId))}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          display={display}
          outOfStation={away.on}
          onToggleOutOfStation={() =>
            setAway(away.on ? { on: false, manual: false } : { on: true, manual: true })
          }
          onLock={() => {
            setSettingsOpen(false);
            onLock();
          }}
          onChangeStation={() => {
            setSettingsOpen(false);
            onChangeStation();
          }}
          onSignOut={() => {
            setSettingsOpen(false);
            onSignOut();
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {exchangeFor !== null && (
        <ExchangeModal
          order={exchangeFor}
          counterId={station.id}
          busy={busy}
          onClose={() => setExchangeFor(null)}
          onSubmit={(orderId, body) =>
            mutation.mutate(() => exchangeOrder(orderId, body), {
              onSuccess: () => setExchangeFor(null),
            })
          }
        />
      )}

      {/* Docked right, above everything, and collapsed until it has something to say. */}
      <ChatDock
        chat={chat}
        open={chatOpen}
        onOpenChange={setChatOpen}
        focusOrderId={chatFocusOrderId}
        onFocusHandled={() => setChatFocusOrderId(null)}
        onShowOrder={() => {
          setTab('orders');
          setChatOpen(true);
        }}
      />

      {/* An arriving order outranks the celebration: it clears instantly rather than covering
          a fresh ticket for the rest of its brief moment. */}
      {celebrating && (
        <Celebration onDone={() => setCelebrating(false)} interrupted={orders.length > 0} />
      )}
    </div>
  );
}
