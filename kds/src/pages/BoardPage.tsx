import { useEffect } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { KDS_SOCKET_EVENTS, type KdsQueueDto } from '@menuboard/shared';
import { fetchCounterQueue, fetchKitchenQueue } from '../api/kds';
import { getAccessToken } from '../api/session';
import type { StationSelection } from '../config/station';
import {
  connectSocket,
  disconnectSocket,
  onSocketEvent,
  subscribeCounter,
  subscribeKitchen,
} from '../socket';
import { CounterBoard } from '../board/CounterBoard';
import { KitchenBoard } from '../board/KitchenBoard';
import '../board/board.css';

/**
 * The socket pushes `kds:changed` on every write that touches this board, so the timer is a
 * safety net for a missed event rather than the way work arrives. It was five seconds, which on
 * top of the socket meant the board asked for the same queue twelve times a minute for nothing.
 */
const QUEUE_REFETCH_MS = 20_000;

export function useQueue(station: StationSelection): UseQueryResult<KdsQueueDto> {
  return useQuery({
    queryKey: ['kds', 'queue', station.mode, station.id],
    queryFn: () =>
      station.mode === 'kitchen' ? fetchKitchenQueue(station.id) : fetchCounterQueue(station.id),
    refetchInterval: QUEUE_REFETCH_MS,
  });
}

interface Props {
  station: StationSelection;
  onChangeStation: () => void;
  onSignOut: () => void;
  onLock: () => void;
}

export function BoardPage({ station, onChangeStation, onSignOut, onLock }: Props): JSX.Element {
  const queryClient = useQueryClient();
  const queue = useQueue(station);

  useEffect(() => {
    const token = getAccessToken();
    if (token === null) return;

    connectSocket(token);
    if (station.mode === 'kitchen') {
      subscribeKitchen(station.id);
    } else {
      subscribeCounter(station.id);
    }

    const off = onSocketEvent(KDS_SOCKET_EVENTS.KDS_CHANGED, () => {
      void queryClient.invalidateQueries({ queryKey: ['kds', 'queue'] });
    });

    return () => {
      off();
      disconnectSocket();
    };
  }, [queryClient, station.mode, station.id]);

  return station.mode === 'kitchen' ? (
    <KitchenBoard station={station} queue={queue} onChangeStation={onChangeStation} onSignOut={onSignOut} onLock={onLock} />
  ) : (
    <CounterBoard station={station} queue={queue} onChangeStation={onChangeStation} onSignOut={onSignOut} onLock={onLock} />
  );
}
