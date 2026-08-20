import { KDS_SOCKET_EVENTS, type CdsLiveDto } from '@menuboard/shared';
import { disconnectSocket, ensureSocket } from './socket';

/**
 * The till's side of the customer display: the POS publishes its unsaved cart here and the
 * server relays it to the counter's CDS room. The payload is data (the cart), not a hint,
 * because an unsaved cart has no refetch path.
 *
 * The connection itself lives in `socket.ts` — the desktop keeps one for everything.
 */

export function publishCdsLive(snapshot: Omit<CdsLiveDto, 'upiLink'>): void {
  ensureSocket()?.emit(KDS_SOCKET_EVENTS.CDS_LIVE, snapshot);
}

export function clearCdsLive(counterId: string): void {
  ensureSocket()?.emit(KDS_SOCKET_EVENTS.CDS_LIVE, { counterId, clear: true });
}

export function disconnectCdsLive(): void {
  disconnectSocket();
}
