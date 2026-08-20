/**
 * Dragging an order onto the chat.
 *
 * The counter's way of saying "this one" without typing a ticket number: pick the card up off
 * the wall and drop it on the conversation. One MIME type, defined here rather than inline, so
 * the two drag sources and the one drop target cannot drift apart on a string literal.
 *
 * `text/plain` rides along as well: a drop that lands anywhere else (the composer itself, a
 * browser tab) then produces the order number as text rather than nothing at all.
 */
export const ORDER_DRAG_TYPE = 'application/x-menuboard-order';

export interface DraggedOrder {
  orderId: string;
  orderNumber: string;
}

/** Attaches an order to a drag that has just started. */
export function setDraggedOrder(event: React.DragEvent, order: DraggedOrder): void {
  event.dataTransfer.setData(ORDER_DRAG_TYPE, JSON.stringify(order));
  event.dataTransfer.setData('text/plain', `#${order.orderNumber}`);
  event.dataTransfer.effectAllowed = 'copy';
}

/** Reads an order back out of a drop, or null when the drop carried something else. */
export function readDraggedOrder(event: React.DragEvent): DraggedOrder | null {
  const raw = event.dataTransfer.getData(ORDER_DRAG_TYPE);
  if (raw === '') return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DraggedOrder>;
    if (typeof parsed.orderId !== 'string' || typeof parsed.orderNumber !== 'string') return null;
    return { orderId: parsed.orderId, orderNumber: parsed.orderNumber };
  } catch {
    return null;
  }
}

/**
 * Whether a drag in flight is one of ours.
 *
 * `dragover` cannot read data — the browser hides it until drop — so the *type* is all a drop
 * target gets to see while deciding whether to accept. That is exactly what the custom MIME
 * type is for.
 */
export function isOrderDrag(event: React.DragEvent): boolean {
  return event.dataTransfer.types.includes(ORDER_DRAG_TYPE);
}
