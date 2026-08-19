import { io, type Socket } from 'socket.io-client';
import { KDS_SOCKET_EVENTS, type CdsLiveDto } from '@menuboard/shared';
import { API_BASE_URL } from '../api/client';
import { getAccessToken } from './session';

const SOCKET_ORIGIN = API_BASE_URL.replace(/\/api\/v1\/?$/, '');

/**
 * The till's side of the customer display: the POS publishes its unsaved cart here and the
 * server relays it to the counter's CDS room. One lazy socket for the whole page — the
 * payload is data (the cart), not a hint, because an unsaved cart has no refetch path.
 */
let socket: Socket | null = null;

function ensureSocket(): Socket | null {
  if (getAccessToken() === null) return null;
  if (socket !== null) return socket;

  socket = io(SOCKET_ORIGIN, {
    auth: (cb) => cb({ token: getAccessToken() }),
    reconnection: true,
    reconnectionDelay: 2_000,
    reconnectionDelayMax: 15_000,
  });
  return socket;
}

export function publishCdsLive(snapshot: Omit<CdsLiveDto, 'upiLink'>): void {
  ensureSocket()?.emit(KDS_SOCKET_EVENTS.CDS_LIVE, snapshot);
}

export function clearCdsLive(counterId: string): void {
  ensureSocket()?.emit(KDS_SOCKET_EVENTS.CDS_LIVE, { counterId, clear: true });
}

export function disconnectCdsLive(): void {
  if (socket === null) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}
