import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useSyncStatusStore } from '../state/syncStatusStore';

export type NetworkChangeHandler = (isConnected: boolean) => void;

/**
 * Subscribes to NetInfo connectivity changes. On a transition from offline to online,
 * calls the supplied handler so the sync engine can bypass backoff and drain immediately.
 */
export function startNetworkMonitoring(onChange: NetworkChangeHandler): () => void {
  let wasConnected = false;

  const update = (state: NetInfoState): void => {
    const isConnected = state.isConnected ?? false;
    useSyncStatusStore.getState().setOnline(isConnected);
    if (isConnected && !wasConnected) {
      onChange(true);
    }
    wasConnected = isConnected;
  };

  const unsubscribe = NetInfo.addEventListener(update);

  // Capture the initial state without waiting for an event.
  void NetInfo.fetch().then(update);

  return () => {
    unsubscribe();
  };
}

export async function isNetworkConnected(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected ?? false;
}
