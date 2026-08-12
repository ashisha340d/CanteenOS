import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { GripVerticalIcon, XIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';
import { cn } from '@/lib/utils';
import { useModalGeometry, type ModalGeometry } from './modalState';

export interface ModalProps {
  /** Stable identifier (slug the entity + purpose, e.g. "user-form", "board-members-add"). */
  id: string;
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  minWidth?: number;
  minHeight?: number;
  /** Optional one-line description, announced to screen readers with the title. */
  description?: string;
}

const MIN_W = 360;
const MIN_H = 260;
/** Two Escapes inside this window count as "I meant it". */
const DOUBLE_ESCAPE_MS = 600;

/**
 * The one shared modal component (docs/AGENTS.md Modal Standard).
 *
 * Two presentations, one behaviour contract. On a desktop pointer it is a floating window:
 * draggable by its title bar, resizable from the bottom-right, remembering position and size
 * per `id`. On a touch/narrow device that model is meaningless — there is nothing to drag it
 * away from and no room to shrink it — so it becomes a full-screen sheet with a sticky header
 * and a sticky action bar, which is what a form on a phone actually wants.
 *
 * Shared by both: a double-Escape to close (a single one is swallowed so an accidental tap
 * cannot lose a half-filled form), Enter advancing focus to the next field rather than
 * submitting, and focusing a field selecting its existing text.
 */
export function Modal({
  id,
  title,
  open,
  onClose,
  children,
  footer,
  minWidth = MIN_W,
  minHeight = MIN_H,
  description,
}: ModalProps): JSX.Element | null {
  const { isMobile, supportsPointerAffordances } = useDeviceProfile();
  const { geometry, setGeometry } = useModalGeometry(id);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastEscapeRef = useRef<number>(0);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);
  const geometryRef = useRef<ModalGeometry>(geometry);
  geometryRef.current = geometry;

  const clampToViewport = useCallback(
    (g: ModalGeometry): ModalGeometry => {
      const maxX = Math.max(0, window.innerWidth - 80);
      const maxY = Math.max(0, window.innerHeight - 40);
      return {
        x: Math.min(Math.max(0, g.x), maxX),
        y: Math.min(Math.max(0, g.y), maxY),
        width: Math.max(minWidth, Math.min(g.width, window.innerWidth - 16)),
        // A null height is "fit the content" and needs no clamping — the max-height below
        // keeps it inside the viewport.
        height:
          g.height === null
            ? null
            : Math.max(minHeight, Math.min(g.height, window.innerHeight - 16)),
      };
    },
    [minWidth, minHeight],
  );

  // A window restored from a previous session may no longer fit; pull it back on screen.
  useEffect(() => {
    if (!open || isMobile) return;
    setGeometry(clampToViewport(geometryRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isMobile]);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: geometryRef.current.x,
        origY: geometryRef.current.y,
      };
      const onMove = (ev: MouseEvent): void => {
        if (!dragRef.current) return;
        const dx = ev.clientX - dragRef.current.startX;
        const dy = ev.clientY - dragRef.current.startY;
        setGeometry({
          ...geometryRef.current,
          x: dragRef.current.origX + dx,
          y: dragRef.current.origY + dy,
        });
      };
      const onUp = (): void => {
        dragRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [setGeometry],
  );

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      resizeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origW: geometryRef.current.width,
        // Still content-sized: start from whatever it currently measures, so the first drag
        // continues from the height on screen rather than jumping to a default.
        origH: geometryRef.current.height ?? containerRef.current?.offsetHeight ?? minHeight,
      };
      const onMove = (ev: MouseEvent): void => {
        if (!resizeRef.current) return;
        const dw = ev.clientX - resizeRef.current.startX;
        const dh = ev.clientY - resizeRef.current.startY;
        setGeometry({
          ...geometryRef.current,
          width: Math.max(minWidth, resizeRef.current.origW + dw),
          height: Math.max(minHeight, resizeRef.current.origH + dh),
        });
      };
      const onUp = (): void => {
        resizeRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [minWidth, minHeight, setGeometry],
  );

  /**
   * Radix would close on the first Escape; swallow it unless a second arrives quickly. The
   * handler lives on the content so it only applies while this dialog holds focus.
   */
  const onEscapeKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      const now = Date.now();
      const isDouble = now - lastEscapeRef.current < DOUBLE_ESCAPE_MS;
      lastEscapeRef.current = now;
      if (!isDouble) event.preventDefault();
    },
    [],
  );

  // Enter advances focus to the next focusable field instead of submitting or doing nothing.
  const onKeyDownCapture = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'TEXTAREA') return;
    if (target.getAttribute('role') === 'combobox' || target.closest('[role="listbox"]')) return;
    if (!containerRef.current) return;
    const focusable = Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(
        'input, select, textarea, button:not([tabindex="-1"]), [tabindex="0"]',
      ),
    ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
    const index = focusable.indexOf(target);
    if (index === -1) return;
    e.preventDefault();
    const next = focusable[index + 1];
    if (next) next.focus();
  }, []);

  // Focus-selects-existing-text on any single-line input/textarea.
  const onFocusCapture = useCallback((e: React.FocusEvent) => {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    if (
      (target.tagName === 'INPUT' &&
        !['checkbox', 'radio', 'file'].includes((target as HTMLInputElement).type)) ||
      target.tagName === 'TEXTAREA'
    ) {
      target.select();
    }
  }, []);

  if (!open) return null;

  const a11yDescription = description ?? `${title} dialog`;

  /* ------------------------------------------------------------------ mobile sheet */

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          onEscapeKeyDown={onEscapeKeyDown}
          className="h-dvh max-h-dvh w-full gap-0 rounded-none border-0 p-0 sm:max-w-none"
        >
          <div
            ref={containerRef}
            onKeyDownCapture={onKeyDownCapture}
            onFocusCapture={onFocusCapture}
            className="flex h-full min-h-0 flex-col"
          >
            {/* Sticky header: an escape hatch on the left, the title in the middle. */}
            <div className="bg-background safe-top sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b px-2 py-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                aria-label="Cancel"
                className="touch-target"
              >
                <XIcon />
              </Button>
              <SheetTitle className="min-w-0 flex-1 truncate text-base">{title}</SheetTitle>
            </div>
            <SheetDescription className="sr-only">{a11yDescription}</SheetDescription>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>

            {footer && (
              <div className="bg-background safe-bottom sticky bottom-0 z-10 flex shrink-0 flex-col-reverse gap-2 border-t p-3 *:w-full">
                {footer}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  /* --------------------------------------------------------- desktop floating window */

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={onEscapeKeyDown}
        // Neutralise the centred-and-capped default so the persisted geometry can drive
        // position and size instead.
        className={cn(
          'top-auto left-auto flex max-w-none translate-x-0 translate-y-0 flex-col gap-0 p-0',
          'overflow-hidden rounded-2xl sm:max-w-none',
        )}
        style={{
          left: geometry.x,
          top: geometry.y,
          width: geometry.width,
          // Content-sized until the user resizes; either way it can never grow past the
          // viewport, so the footer stays reachable and the body scrolls instead.
          ...(geometry.height === null
            ? { minHeight, maxHeight: 'calc(100dvh - 2rem)' }
            : { height: geometry.height, maxHeight: 'calc(100dvh - 2rem)' }),
        }}
      >
        <div
          ref={containerRef}
          onKeyDownCapture={onKeyDownCapture}
          onFocusCapture={onFocusCapture}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* The whole bar is the drag handle; the grip only appears when the pointer is
              over it, so the chrome stays quiet while the form is being filled in. */}
          <div
            onMouseDown={onDragStart}
            className="group/bar flex shrink-0 cursor-move items-center gap-1 border-b px-4 py-3 select-none"
          >
            {supportsPointerAffordances && (
              <GripVerticalIcon
                aria-hidden
                className="text-muted-foreground -ml-1.5 size-4 opacity-0 transition-opacity group-hover/bar:opacity-40"
              />
            )}
            <DialogTitle className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold tracking-[-0.014em]">
              {title}
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close (press Escape twice)"
            >
              <XIcon />
            </Button>
          </div>
          <DialogDescription className="sr-only">{a11yDescription}</DialogDescription>

          <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>

          {footer && (
            <div className="bg-muted/50 flex shrink-0 items-center justify-end gap-2 border-t px-5 py-4">
              {footer}
            </div>
          )}
        </div>

        {supportsPointerAffordances && (
          <div
            onMouseDown={onResizeStart}
            aria-hidden
            className="text-muted-foreground absolute right-0 bottom-0 size-5 cursor-nwse-resize opacity-40 transition-opacity hover:opacity-100"
          >
            <span className="absolute right-[5px] bottom-[5px] size-[7px] rounded-br-[2px] border-r-[1.5px] border-b-[1.5px] border-current" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
