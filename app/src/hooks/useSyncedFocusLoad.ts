import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSyncStatusStore } from '../state/syncStatusStore';

/**
 * Runs `load` when the screen gains focus — the behaviour every list screen already had —
 * and again whenever a sync pull writes new server data into SQLite (`dataVersion`), so an
 * order created on another device appears here live instead of waiting for a refocus or a
 * pull-to-refresh. An unfocused screen skips the mid-session reloads and simply re-reads on
 * its next focus, which `useFocusEffect` already guarantees.
 */
export function useSyncedFocusLoad(load: () => void | Promise<void>): void {
  const dataVersion = useSyncStatusStore((s) => s.dataVersion);
  useFocusEffect(
    useCallback(() => {
      void load();
      // `dataVersion` is intentionally a dependency: its change is the reload trigger.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, dataVersion]),
  );
}
