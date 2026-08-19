import { io, type Socket } from 'socket.io-client';
import { KDS_SOCKET_EVENTS, type Uuid } from '@menuboard/shared';
import { API_BASE_URL, restoreSession } from './api/client';
import { getAccessToken } from './api/session';

export const SOCKET_ORIGIN = API_BASE_URL.replace(/\/api\/v1\/?$/, '');

type Subscription =
  | { kind: 'counter'; counterId: Uuid }
  | { kind: 'kitchen'; printingGroupId: Uuid }
  | { kind: 'cds'; counterId: Uuid };

let socket: Socket | null = null;
let subscription: Subscription | null = null;

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

  socket.on('connect', () => {
    if (socket !== null && subscription !== null) emitSubscription(socket, subscription);
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
  if (socket !== null) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
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

export function onSocketEvent(event: string, cb: (...args: unknown[]) => void): () => void {
  socket?.on(event, cb);
  return () => offSocketEvent(event, cb);
}

export function offSocketEvent(event: string, cb: (...args: unknown[]) => void): void {
  socket?.off(event, cb);
}
