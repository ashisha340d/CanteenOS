import { create } from 'zustand';
import { syncQueueRepository, settingsRepository, SETTINGS_KEYS } from '../db/repositories';

interface SyncStatusState {
  pendingCount: number;
  lastSyncAt: string | null;
  isOnline: boolean;
  isSocketConnected: boolean;
  isSyncing: boolean;
  error: string | null;
  /**
   * Monotonic counter bumped whenever a pull writes server changes into SQLite. Screens that
   * render domain data subscribe to it and re-read the database, which is how an order created
   * on another device appears here without a manual refresh.
   */
  dataVersion: number;
  refresh: () => Promise<void>;
  setOnline: (online: boolean) => void;
  setSocketConnected: (connected: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setError: (error: string | null) => void;
  bumpDataVersion: () => void;
}

/**
 * Read-only view of local sync state for the Home/Settings screens.
 * pendingCount reflects the real sync_queue depth (PENDING + FAILED).
 */
export const useSyncStatusStore = create<SyncStatusState>((set) => ({
  pendingCount: 0,
  lastSyncAt: null,
  isOnline: false,
  isSocketConnected: false,
  isSyncing: false,
  error: null,
  dataVersion: 0,
  refresh: async () => {
    const [pendingCount, lastSyncAt] = await Promise.all([
      syncQueueRepository.countPending(),
      settingsRepository.get<string>(SETTINGS_KEYS.LAST_SYNC_AT),
    ]);
    set({ pendingCount, lastSyncAt });
  },
  setOnline: (isOnline) => set({ isOnline }),
  setSocketConnected: (isSocketConnected) => set({ isSocketConnected }),
  setSyncing: (isSyncing) => set({ isSyncing }),
  setError: (error) => set({ error }),
  bumpDataVersion: () => set((state) => ({ dataVersion: state.dataVersion + 1 })),
}));
