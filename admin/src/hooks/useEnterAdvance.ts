import { useCallback, type KeyboardEvent, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'button',
  '[role="combobox"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function isVisible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el === document.activeElement;
}

/**
 * Keyboard-first data entry: Enter moves focus to the next field in DOM order instead of
 * submitting or opening whatever the focused control's own Enter behaviour would otherwise do
 * (a Select/Command combobox opening its dropdown, a button activating). The only field where
 * Enter keeps its native meaning is the Save button itself, identified by `submitId` — pressing
 * Enter there submits the form. Shift+Enter is left alone everywhere, so a multiline textarea
 * can still take a literal newline.
 *
 * Attach via `onKeyDownCapture` on the outermost form element so this runs before the target's
 * own handlers (Radix's Select/Command own Enter-to-open logic included).
 */
export function useEnterAdvance(
  containerRef: RefObject<HTMLElement>,
  submitId: string,
): (event: KeyboardEvent) => void {
  return useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      const container = containerRef.current;
      if (!container) return;
      const target = event.target as HTMLElement;

      // Let a multiline textarea's own newline-insertion stay untouched when it explicitly asks
      // for it via data-allow-enter (none currently do, but keeps the door open).
      if (target.dataset.allowEnter === 'true') return;

      event.preventDefault();
      event.stopPropagation();

      if (target.id === submitId) {
        const form = target.closest('form') ?? container.closest('form');
        (form as HTMLFormElement | null)?.requestSubmit();
        return;
      }

      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute('disabled') && isVisible(el));
      const index = focusables.indexOf(target);
      if (index === -1) return;
      const next = focusables[index + 1];
      next?.focus();
    },
    [containerRef, submitId],
  );
}
