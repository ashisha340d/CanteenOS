import { useEffect, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { RefreshCwIcon, WifiIcon, WifiOffIcon } from 'lucide-react';
import { useAuth } from '@/services/AuthContext';
import { useWindowManager } from '@/services/WindowManager';
import { StartMenu } from './StartMenu';
import './StatusBar.css';

const CLOCK = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

const CLOCK_DATE = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/**
 * The taskbar: Start, a button per open window, and a system tray. Persistent chrome, so it is
 * the one part of Canteen OS that is always on screen.
 */
export function StatusBar(): JSX.Element {
  const { windows, focusedId, focus, minimize, close } = useWindowManager();

  return (
    <div className="os-status">
      <StartMenu />

      <span className="os-status__cell os-status__cell--grow">
        {windows.length === 0 ? (
          <span className="os-status__idle">No open windows</span>
        ) : (
          windows.map((win) => {
            const active = win.id === focusedId && !win.minimized;
            return (
              <button
                key={win.id}
                type="button"
                className={`os-status__task ${active ? 'os-status__task--active' : ''} ${win.minimized ? 'os-status__task--minimised' : ''
                  }`}
                title={`${win.title} — click to ${active ? 'minimise' : 'show'}, middle-click to close`}
                // Clicking the active window's button minimises it, as every task bar does.
                onClick={() => (active ? minimize(win.id) : focus(win.id))}
                onMouseDown={(e) => {
                  if (e.button === 1) e.preventDefault();
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) close(win.id);
                }}
              >
                {win.Icon ? (
                  <span className="os-status__icon" style={{ background: win.accent }}>
                    <win.Icon className="os-status__icon-glyph" />
                  </span>
                ) : (
                  <span className="os-status__dot" style={{ background: win.accent }} />
                )}
                <span className="os-status__task-label">{win.title}</span>
              </button>
            );
          })
        )}
      </span>

      <SystemTray />
    </div>
  );
}

/** Network, background sync, signed-in user and the clock. */
function SystemTray(): JSX.Element {
  const { user } = useAuth();
  const fetching = useIsFetching();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Ticks on the minute rather than every second: the clock shows minutes, so a per-second
  // interval would be 59 wasted renders of the whole task bar.
  useEffect(() => {
    const tick = (): void => setNow(new Date());
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    let interval: ReturnType<typeof setInterval>;
    const timeout = setTimeout(() => {
      tick();
      interval = setInterval(tick, 60_000);
    }, msToNextMinute);
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);

  return (
    <span className="os-status__tray">
      <span
        className="os-status__tray-item"
        title={fetching > 0 ? `Syncing — ${fetching} request(s) in flight` : 'Up to date'}
      >
        <RefreshCwIcon
          className={`os-status__tray-glyph ${fetching > 0 ? 'os-status__tray-glyph--spin' : ''}`}
        />
      </span>

      <span
        className={`os-status__tray-item ${online ? '' : 'os-status__tray-item--alert'}`}
        title={online ? 'Network connected' : 'Offline — changes cannot be saved'}
      >
        {online ? (
          <WifiIcon className="os-status__tray-glyph" />
        ) : (
          <WifiOffIcon className="os-status__tray-glyph" />
        )}
      </span>

      <span className="os-status__tray-user" title={user?.username ? `@${user.username}` : ''}>
        {user?.name ?? '—'}
      </span>

      <span className="os-status__clock" title={CLOCK_DATE.format(now)}>
        <span className="os-status__clock-time">{CLOCK.format(now)}</span>
        <span className="os-status__clock-date">{CLOCK_DATE.format(now)}</span>
      </span>
    </span>
  );
}
