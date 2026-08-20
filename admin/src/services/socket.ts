import { io, type Socket } from 'socket.io-client';
import { API_BASE_URL } from '../api/client';
import { getAccessToken } from './session';

export const SOCKET_ORIGIN = API_BASE_URL.replace(/\/api\/v1\/?$/, '');

/**
 * One socket for the whole admin desktop.
 *
 * The CDS relay and the counter chat both need a live connection, and opening one each would
 * mean two authenticated handshakes and two reconnect storms for a desktop that is already a
 * single page. Lazy, so nothing connects until something actually subscribes.
 */
let socket: Socket | null = null;

export function ensureSocket(): Socket | null {
  if (getAccessToken() === null) return null;
  if (socket !== null) return socket;

  socket = io(SOCKET_ORIGIN, {
    // The callback runs on every attempt, so a token refreshed mid-outage is picked up by the
    // next reconnect without rebuilding the socket.
    auth: (cb) => cb({ token: getAccessToken() }),
    reconnection: true,
    reconnectionDelay: 2_000,
    reconnectionDelayMax: 15_000,
  });
  return socket;
}

export function disconnectSocket(): void {
  if (socket === null) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}
