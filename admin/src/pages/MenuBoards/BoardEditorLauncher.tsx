import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PencilRulerIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { menuBoardUrl } from '@/lib/menuBoardUrl';
import { getAccessToken } from '../../services/session';
import { notify } from '@/lib/notify';

/**
 * Opens the board's own page as a live editor, in a window of its own.
 *
 * This replaced an iframe of the board with drag boxes laid over it. The iframe was honest about
 * position but nothing else: it is a different origin, so the editor could never reach inside to
 * open the thing that was clicked, and a board written for a 1920px wall had to be scaled into a
 * panel to be seen at all. Handing the whole window to the board removes both — what is dragged
 * is the real Today panel over the real menu at the size it will actually run, and clicking the
 * header opens the header's settings because it is all one document.
 *
 * The editor stays inert until this hands it a token: it asks for one when it has finished
 * loading, and gets it only from the window that opened it. A screen on a wall has no opener, so
 * `?edit=1` on its URL is an ordinary read-only board.
 */
export function BoardEditorLauncher({
  screenId,
  code,
}: {
  screenId: string;
  code: string;
}): JSX.Element {
  const queryClient = useQueryClient();
  const child = useRef<Window | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent): void {
      const data = event.data as { source?: string; type?: string } | null;
      if (!data || data.source !== 'menu-board' || data.type !== 'ready') return;
      if (child.current === null || event.source !== child.current) return;

      const token = getAccessToken();
      if (token === null || token === '') {
        notify.error('Your session has expired — sign in again, then reopen the editor.');
        return;
      }
      // Addressed at the board's own origin rather than '*', so the token is never delivered
      // anywhere else if the window has navigated somewhere in between.
      child.current.postMessage(
        { source: 'menu-board-editor', type: 'token', token },
        new URL(menuBoardUrl(code)).origin,
      );
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [code, queryClient]);

  function open(): void {
    const url = `${menuBoardUrl(code)}&edit=1&id=${encodeURIComponent(screenId)}`;
    const win = window.open(url, `menu-board-editor-${code}`);
    if (win === null) {
      notify.error('The browser blocked the editor window — allow pop-ups for this site.');
      return;
    }
    child.current = win;
    win.focus();
  }

  return (
    <div className="bg-card rounded-xl border p-4">
      <h2 className="font-heading mb-1 text-base font-semibold">Board layout</h2>
      <p className="text-muted-foreground mb-3 text-sm">
        The header, the Today panel, the weather card, the celebrations, the festival calendar
        and every ad are arranged on the board itself. It opens in its own window at the size the
        wall runs at — click a thing to change it, drag it to place it, then publish.
      </p>
      <Button onClick={open}>
        <PencilRulerIcon data-icon="inline-start" />
        Open the board editor
      </Button>
      <p className="text-muted-foreground mt-2 text-xs">
        Publishing from there reaches every screen on this board immediately. Nothing is saved
        until you press Save &amp; publish, and the window warns before closing on unsaved work.
      </p>
    </div>
  );
}
