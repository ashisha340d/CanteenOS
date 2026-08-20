import { io, type Socket } from 'socket.io-client';
import { CHAT_SOCKET_EVENTS, KDS_SOCKET_EVENTS, type Uuid } from '@menuboard/shared';
import { API_BASE_URL, restoreSession } from './api/client';
import { getAccessToken } from './api/session';

export const SOCKET_ORIGIN = API_BASE_URL.replace(/\/api\/v1\/?$/, '');

type Subscription =
  | { kind: 'counter'; counterId: Uuid }
  | { kind: 'kitchen'; printingGroupId: Uuid }
  | { kind: 'cds'; counterId: Uuid };

let socket: Socket | null = null;
let subscription: Subscription | null = null;
/**
 * The chat channel, tracked beside the display scope rather than replacing it: a counter screen
 * watches its board *and* its conversation at once, so these are two live subscriptions, not a
 * choice between them. Both are re-announced on every reconnect.
 */
let chatCounterId: Uuid | null = null;

/**
 * Every listener anyone has asked for, kept here rather than only on the socket.
 *
 * `socket?.on(...)` silently does nothing when there is no socket yet — and there frequently is
 * not: React runs a child's effects before its parent's, so the board's chat panel registers its
 * handlers before `BoardPage` has called `connectSocket`. Those registrations vanished, the
 * dependencies never changed, so nothing ever re-registered them, and the counter's chat sat
 * mute for the life of the page while the two-minute refetch quietly papered over it.
 *
 * Holding them here means a listener is attached to whatever socket exists now, and re-attached
 * to the next one.
 */
const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

function attachAll(target: Socket): void {
  for (const [event, callbacks] of listeners) {
    for (const cb of callbacks) target.on(event, cb);
  }
}

function emitSubscription(target: Socket, sub: Subscription): void {
  if (sub.kind === 'cds') {
    target.emit(KDS_SOCKET_EVENTS.CDS_SUBSCRIBE, { counterId: sub.counterId });
  } else if (sub.kind === 'kitchen') {
    target.emit(KDS_SOCKET_EVENTS.KDS_SUBSCRIBE, { printingGroupId: sub.printingGroupId });
  } else {
    target.emit(KDS_SOCKET_EVENTS.KDS_SUBSCRIBE, { counterId: sub.counterId });
  }
}

export function connectSocket(token: string): Socket {
  if (socket !== null) return socket;

  socket = io(SOCKET_ORIGIN, {
    // The auth callback runs on every attempt, so a token refreshed mid-outage is picked up
    // by the next reconnect without rebuilding the socket.
    auth: (cb) => cb({ token: getAccessToken() ?? token }),
    reconnection: true,
    reconnectionDelay: 2_000,
    reconnectionDelayMax: 15_000,
  });

  // Anything registered before this socket existed is attached to it now.
  attachAll(socket);

  socket.on('connect', () => {
    if (socket === null) return;
    if (subscription !== null) emitSubscription(socket, subscription);
    if (chatCounterId !== null) {
      socket.emit(CHAT_SOCKET_EVENTS.CHAT_SUBSCRIBE, { counterId: chatCounterId });
    }
  });

  socket.on('connect_error', (error) => {
    if (error.message === 'UNAUTHENTICATED' || error.message === 'ACCOUNT_INACTIVE') {
      void restoreSession();
    }
  });

  return socket;
}

export function disconnectSocket(): void {
  subscription = null;
  chatCounterId = null;
  if (socket !== null) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  // The registry deliberately survives: components still mounted keep their handlers, and a
  // reconnect re-attaches them. `offSocketEvent` is what actually forgets one.
}

function resubscribe(next: Subscription): void {
  subscription = next;
  if (socket?.connected) emitSubscription(socket, next);
}

export function subscribeCounter(counterId: Uuid): void {
  resubscribe({ kind: 'counter', counterId });
}

export function subscribeKitchen(printingGroupId: Uuid): void {
  resubscribe({ kind: 'kitchen', printingGroupId });
}

export function subscribeCds(counterId: Uuid): void {
  resubscribe({ kind: 'cds', counterId });
}

/** Join this counter's chat channel — a different room from its board, deliberately. */
export function subscribeChat(counterId: Uuid): void {
  chatCounterId = counterId;
  if (socket?.connected) socket.emit(CHAT_SOCKET_EVENTS.CHAT_SUBSCRIBE, { counterId });
}

export function unsubscribeChat(): void {
  const previous = chatCounterId;
  chatCounterId = null;
  if (previous !== null && socket?.connected) {
    socket.emit(CHAT_SOCKET_EVENTS.CHAT_UNSUBSCRIBE, { counterId: previous });
  }
}

/** Announce that this side is typing. Presence only — the server relays it and stores nothing. */
export function emitChatTyping(counterId: Uuid, typing: boolean): void {
  if (socket?.connected) socket.emit(CHAT_SOCKET_EVENTS.CHAT_TYPING_SET, { counterId, typing });
}

export function onSocketEvent(event: string, cb: (...args: unknown[]) => void): () => void {
  let forEvent = listeners.get(event);
  if (forEvent === undefined) {
    forEvent = new Set();
    listeners.set(event, forEvent);
  }
  forEvent.add(cb);
  socket?.on(event, cb);
  return () => offSocketEvent(event, cb);
}

export function offSocketEvent(event: string, cb: (...args: unknown[]) => void): void {
  listeners.get(event)?.delete(cb);
  socket?.off(event, cb);
}
