import type { Uuid, IsoDateTime } from './common';

/* ------------------------------------------------------------------ counter chat */

/**
 * Admin ↔ counter messaging.
 *
 * The channel belongs to the **counter**, not to a person: whoever is standing at the KDS this
 * shift is who the office is talking to, and a note about a counter outlives the shift of the
 * person who read it.
 */

export const CounterMessageDirection = {
  /** The office speaking to a counter screen. */
  TO_COUNTER: 'TO_COUNTER',
  /** The counter answering back. */
  TO_ADMIN: 'TO_ADMIN',
} as const;
export type CounterMessageDirection =
  (typeof CounterMessageDirection)[keyof typeof CounterMessageDirection];

export const CounterMessageKind = {
  TEXT: 'TEXT',
  /**
   * The office ringing the counter's bell. Carries no body — it is a summons, not a message —
   * but is stored like one so a counter that was away still sees that it was rung.
   */
  BELL: 'BELL',
} as const;
export type CounterMessageKind = (typeof CounterMessageKind)[keyof typeof CounterMessageKind];

export interface CounterMessageDto {
  id: Uuid;
  counterId: Uuid;
  direction: CounterMessageDirection;
  kind: CounterMessageKind;
  body: string;
  /**
   * Best-effort Hindi rendering for a board switched to Hindi. Null while the translation has
   * not landed, or when it could not be produced at all — the display falls back to `body`,
   * because a late translation is a nicety and an undelivered message is a fault.
   */
  bodyHi: string | null;
  /** The order this message is about, when the sender tagged one. */
  orderId: Uuid | null;
  /** Snapshotted so a thread still reads correctly after the order leaves the board. */
  orderNumber: string | null;
  senderId: Uuid | null;
  senderName: string | null;
  readAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface CounterChatThreadDto {
  counterId: Uuid;
  counterName: string | null;
  /** Oldest first — the order a conversation is read in. */
  messages: CounterMessageDto[];
  /** Messages the *caller* has not read yet. */
  unreadCount: number;
}

/** One counter as the admin's chat list shows it, without pulling every thread's history. */
export interface CounterChatSummaryDto {
  counterId: Uuid;
  counterName: string;
  lastMessage: CounterMessageDto | null;
  /** Unread messages from this counter, waiting on the office. */
  unreadCount: number;
}

export interface SendCounterMessageRequest {
  body: string;
  /** Tag an order the message is about. The server snapshots its number. */
  orderId?: Uuid | null;
}

/**
 * Which order cards on a counter's board carry a message. Kept separate from the queue so the
 * board's hot path is untouched — a chat feature must not widen the query a wall screen
 * re-reads every few seconds.
 */
export interface CounterOrderTagDto {
  orderId: Uuid;
  /** Messages tagged to this order that the counter has not read. */
  unreadCount: number;
  messageCount: number;
}

/* ------------------------------------------------------------------ socket events */

export const CHAT_SOCKET_EVENTS = {
  /**
   * Client → server: watch one counter's channel. Deliberately its own room rather than the
   * existing `kds:counter:*` — a chat message must not wake every board listener into a
   * queue refetch.
   */
  CHAT_SUBSCRIBE: 'chat:subscribe',
  CHAT_UNSUBSCRIBE: 'chat:unsubscribe',
  /** Client → server: this side is typing. Relayed, never stored. */
  CHAT_TYPING_SET: 'chat:typing:set',

  /**
   * Server → room: a message was sent. The payload **is** the message.
   *
   * This breaks the gateway's usual "hints, not data" discipline on purpose, following the
   * `CDS_BILL` precedent: a chat has no cursor to sync against and no other path to the
   * content, so a hint would just mean every client immediately refetching the thing the
   * server already had in hand.
   */
  CHAT_MESSAGE: 'chat:message',
  /** Server → room: the office rang. Payload: CounterMessageDto of kind BELL. */
  CHAT_BELL: 'chat:bell',
  /**
   * Server → room: the office hung up. Payload: { counterId }.
   *
   * A ring is a call, not a notification, so it has an end as well as a start — the office
   * putting the handset down has to reach the counter before the ring has run its course,
   * exactly as a phone that stops mid-ring when the caller gives up.
   */
  CHAT_BELL_END: 'chat:bell:end',
  /** Server → room: the other side read up to now. Payload: { counterId, direction }. */
  CHAT_READ: 'chat:read',
  /** Server → room: relayed typing presence. Payload: { counterId, direction, typing }. */
  CHAT_TYPING: 'chat:typing',
  /**
   * Server → room: the office cleared this counter's thread. Payload: { counterId }. Both
   * sides empty their view — a conversation cleared on one screen and still showing on the
   * wall would be worse than not offering the button at all.
   */
  CHAT_CLEARED: 'chat:cleared',
} as const;
