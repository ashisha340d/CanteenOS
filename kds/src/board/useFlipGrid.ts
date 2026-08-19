import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * FLIP for the card wall: when a card leaves (or arrives) the grid reflows, and without this
 * every surviving card jumps to its new slot in a single frame. Positions are measured before
 * the paint that follows a change, then each moved card is animated from where it *was* to
 * where it now is — so the wall settles instead of snapping.
 *
 * `key` is whatever identifies the current layout (e.g. the joined order ids).
 */
export function useFlipGrid(containerRef: RefObject<HTMLElement>, key: string): void {
  const positionsRef = useRef<Map<string, DOMRect>>(new Map());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const cards = [...container.querySelectorAll<HTMLElement>('[data-flip-id]')];
    const next = new Map<string, DOMRect>();

    for (const card of cards) {
      const id = card.dataset.flipId as string;
      const box = card.getBoundingClientRect();
      next.set(id, box);

      const previous = positionsRef.current.get(id);
      if (previous === undefined) continue;
      const dx = previous.left - box.left;
      const dy = previous.top - box.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

      card.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    }

    positionsRef.current = next;
  }, [containerRef, key]);
}
