import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { PageSkeleton } from '@/components/ui/Skeletons';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { WindowManagerProvider } from '@/services/WindowManager';
import { WindowsLayer } from '@/components/WindowsLayer';
import { StatusBar } from '@/components/StatusBar';
import { ChatToast, ChatWidget } from '@/components/chat/ChatWidget';
import { CounterChatProvider } from '@/services/CounterChatContext';
import { CommandPalette } from './CommandPalette';
import { titleFor } from './navigation';

/**
 * The desktop shell. There is no small-screen variant: this is a windowing environment with
 * draggable, resizable MDI children and a task bar, which has no meaning on a phone.
 *
 * One bar, at the bottom. The top application bar is gone: it spent a row of every screen on a
 * breadcrumb trail and four controls, and it was also where a maximised window had to dock its
 * caption — so removing it is what lets a maximised window keep its own title bar, the way
 * Windows has always drawn one.
 */
export function AppShell(): JSX.Element {
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    document.title = `${titleFor(location.pathname)} · Canteen OS`;
  }, [location.pathname]);

  return (
    // The provider wraps the whole shell, not just the content area: the task bar draws a
    // button per open window, so the bar has to be able to read the window stack.
    <WindowManagerProvider>
      {/* Chat sits outside the window stack but inside the shell: every module is rendered
          under here, so a message can raise a notice from any screen in the product. */}
      <CounterChatProvider>
        <Shell onOpenPalette={() => setPaletteOpen(true)} />
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </CounterChatProvider>
    </WindowManagerProvider>
  );
}

function Shell({ onOpenPalette }: { onOpenPalette: () => void }): JSX.Element {
  const location = useLocation();
  /**
   * `/` is the desktop itself, which belongs *under* the windows — icons behind, windows in
   * front. Every other route is a page somebody asked for, and it belongs on top of them:
   * digging into a record from inside a module window navigates, and while this layer sat
   * below `WindowsLayer` (z-40) the page it opened was painted behind the window that asked
   * for it, so the click looked like it had done nothing at all.
   */
  const onDesktop = location.pathname === '/';

  return (
    <div className="flex h-dvh flex-col">
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="relative min-h-0 flex-1">
          {/* Absolute so the desktop gets a definite box to fill; ordinary routes opened by
              URL still scroll inside it. */}
          <div
            className={
              onDesktop
                ? 'absolute inset-0 overflow-auto'
                : 'bg-background absolute inset-0 z-50 overflow-auto'
            }
          >
            <ErrorBoundary resetKey={location.pathname}>
              <Suspense fallback={<PageSkeleton />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
          <WindowsLayer />

          {/* Above the window layer, not inside it: the point of the chat is that it stays
              reachable whatever module is open, so it must not be something the next window
              buries. It minimises to the task bar tray instead. */}
          <ChatWidget />
          <ChatToast />
        </div>
        <StatusBar onOpenPalette={onOpenPalette} />
      </main>
    </div>
  );
}
