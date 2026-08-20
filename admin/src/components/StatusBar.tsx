import { useEffect, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  ALargeSmallIcon,
  ContrastIcon,
  HomeIcon,
  LogOutIcon,
  MessageSquareIcon,
  MonitorCogIcon,
  MoonIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldIcon,
  SunIcon,
  WifiIcon,
  WifiOffIcon,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/services/AuthContext';
import { useWindowManager } from '@/services/WindowManager';
import { useCounterChat } from '@/services/CounterChatContext';
import {
  DESKTOP_SKIN_LABEL,
  DESKTOP_SKIN_SWATCH,
  DESKTOP_SKINS,
  SKIN_LABEL,
  TEXT_SIZE_LABEL,
  useTheme,
  type DesktopSkin,
  type TextSize,
  type ThemeSkin,
} from '@/theme/ThemeProvider';
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

const SKIN_ICON: Record<ThemeSkin, typeof SunIcon> = {
  light: SunIcon,
  dark: MoonIcon,
  brand: ContrastIcon,
};

/**
 * The taskbar: Start, the desktop, a button per open window, and a system tray.
 *
 * This is now the *only* persistent chrome in Canteen OS. The top application bar is gone —
 * it cost a row on every screen to show a breadcrumb trail and four controls that a taskbar
 * already has somewhere to put, and a maximised window had to surrender its caption into it.
 * Everything it carried lives down here, where an operating system keeps it.
 */
export function StatusBar({ onOpenPalette }: { onOpenPalette?: () => void }): JSX.Element {
  const { windows, focusedId, focus, minimize, close } = useWindowManager();

  return (
    <div className="os-status">
      <StartMenu />

      <NavLink to="/" className="os-status__chip" title="Show the desktop" aria-label="Desktop">
        <HomeIcon className="os-status__chip-glyph" />
      </NavLink>

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

      <SystemTray onOpenPalette={onOpenPalette} />
    </div>
  );
}

/**
 * The chat's task bar button — where a minimised chat lives, and where an unread count is
 * visible from every module without the panel being open.
 */
function ChatTrayButton(): JSX.Element {
  const chat = useCounterChat();
  const waiting = chat.totalUnread;

  return (
    <button
      type="button"
      className={`os-status__tray-item os-status__tray-btn ${waiting > 0 ? 'os-status__tray-item--alert' : ''}`}
      onClick={() => chat.setOpen(!chat.open)}
      title={
        waiting > 0
          ? `${waiting} unread message(s) from the counters`
          : 'Counter messaging'
      }
      aria-label="Counter messaging"
    >
      <MessageSquareIcon className="os-status__tray-glyph" />
      {waiting > 0 && <span className="os-status__tray-badge">{waiting}</span>}
    </button>
  );
}

/** Search, chat, network, background sync, appearance, identity and the clock. */
function SystemTray({ onOpenPalette }: { onOpenPalette?: () => void }): JSX.Element {
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
      {onOpenPalette && (
        <button
          type="button"
          className="os-status__tray-item os-status__tray-btn"
          onClick={onOpenPalette}
          title="Search (Ctrl/Cmd K)"
          aria-label="Search"
        >
          <SearchIcon className="os-status__tray-glyph" />
        </button>
      )}

      <ChatTrayButton />

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

      <AppearanceMenu />
      <UserMenu />

      <span className="os-status__clock" title={CLOCK_DATE.format(now)}>
        <span className="os-status__clock-time">{CLOCK.format(now)}</span>
        <span className="os-status__clock-date">{CLOCK_DATE.format(now)}</span>
      </span>
    </span>
  );
}

/* The two menus below moved down from the old top bar. They open upward — a menu anchored to
   the bottom edge of the screen has nowhere else to go. */

function AppearanceMenu(): JSX.Element {
  const { skin, setSkin, textSize, setTextSize, desktopSkin, setDesktopSkin } = useTheme();
  const Icon = SKIN_ICON[skin];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="os-status__tray-item os-status__tray-btn"
          aria-label="Appearance"
          title="Appearance"
        >
          <Icon className="os-status__tray-glyph" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" sideOffset={6} className="w-60">
        <DropdownMenuLabel className="flex items-center gap-2">
          <MonitorCogIcon className="size-4" />
          Desktop skin
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={desktopSkin}
          onValueChange={(next) => setDesktopSkin(next as DesktopSkin)}
        >
          {DESKTOP_SKINS.map((option) => {
            const [surface, accent] = DESKTOP_SKIN_SWATCH[option];
            return (
              <DropdownMenuRadioItem key={option} value={option}>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="ring-foreground/15 size-3.5 shrink-0 rounded-full ring-1"
                    style={{ background: `linear-gradient(135deg, ${surface} 50%, ${accent} 50%)` }}
                  />
                  {DESKTOP_SKIN_LABEL[option]}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Window content</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={skin} onValueChange={(next) => setSkin(next as ThemeSkin)}>
          {(['light', 'dark', 'brand'] as ThemeSkin[]).map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {SKIN_LABEL[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2">
          <ALargeSmallIcon className="size-4" />
          Text size
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={textSize}
          onValueChange={(next) => setTextSize(next as TextSize)}
        >
          {(['compact', 'default', 'large'] as TextSize[]).map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {TEXT_SIZE_LABEL[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu(): JSX.Element {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const initial = (user?.name ?? '?').slice(0, 1).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="os-status__user"
          title={user?.username ? `@${user.username}` : 'Account'}
        >
          <span className="os-status__user-badge">{initial}</span>
          <span className="os-status__user-name">{user?.name ?? '—'}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" sideOffset={6} className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">{user?.name}</span>
          <span className="text-muted-foreground truncate text-xs font-normal">
            @{user?.username}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => navigate('/account/security')}>
            <ShieldIcon data-icon="inline-start" />
            Security
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void logout().then(() => navigate('/login', { replace: true }));
            }}
          >
            <LogOutIcon data-icon="inline-start" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
