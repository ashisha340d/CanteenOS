import { Platform } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useSyncStatusStore } from '../state/syncStatusStore';

export type NetworkChangeHandler = (isConnected: boolean) => void;

/**
 * On web the browser's own `online`/`offline` events are the honest signal; NetInfo wraps
 * `navigator.onLine` but does not always re-fire, which left a tab stuck reporting offline.
 */
function startWebMonitoring(onChange: NetworkChangeHandler): () => void {
  const publish = (): void => {
    const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
    useSyncStatusStore.getState().setOnline(online);
    if (online) onChange(true);
  };

  publish();
  globalThis.addEventListener?.('online', publish);
  globalThis.addEventListener?.('offline', publish);
  return () => {
    globalThis.removeEventListener?.('online', publish);
    globalThis.removeEventListener?.('offline', publish);
  };
}

/**
 * Subscribes to NetInfo connectivity changes. On a transition from offline to online,
 * calls the supplied handler so the sync engine can bypass backoff and drain immediately.
 */
export function startNetworkMonitoring(onChange: NetworkChangeHandler): () => void {
  if (Platform.OS === 'web') return startWebMonitoring(onChange);

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
  if (Platform.OS === 'web') {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  }
  const state = await NetInfo.fetch();
  return state.isConnected ?? false;
}
