import { AppState } from 'react-native';
import { useSyncStatusStore } from '../state/syncStatusStore';
import { isNetworkConnected, startNetworkMonitoring } from './networkMonitor';
import { runMediaUpload } from './mediaUploader';
import { runPull } from './pullWorker';
import { runPushDrain } from './pushWorker';
import { connectSocket, disconnectSocket, setSocketPullHandler } from './socketClient';
import { setSyncNudgeHandler } from './syncNudge';

const PERIODIC_INTERVAL_MS = 30_000;

class SyncEngine {
  private running = false;
  private active = false;
  /** A nudge that arrived while a cycle was in flight — run one more cycle after it ends. */
  private rerunRequested = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeNetwork: (() => void) | null = null;
  private appStateSubscription: { remove: () => void } | null = null;
  private appState: string = AppState.currentState;

  start(): void {
    if (this.running) return;
    this.running = true;

    setSocketPullHandler(() => {
      void this.runCycle();
    });
    setSyncNudgeHandler(() => {
      void this.runCycle();
    });
    connectSocket();

    void isNetworkConnected().then((online) => {
      useSyncStatusStore.getState().setOnline(online);
      if (online) {
        void this.runCycle();
      }
    });

    this.unsubscribeNetwork = startNetworkMonitoring((online) => {
      if (online && this.running) {
        void this.runCycle();
      }
    });

    this.appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      const becameActive = nextAppState === 'active' && this.appState !== 'active';
      this.appState = nextAppState;
      if (becameActive && this.running) {
        void this.runCycle();
        this.schedule();
      } else if (nextAppState !== 'active') {
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }
      }
    });

    this.schedule();
  }

  stop(): void {
    this.running = false;
    setSyncNudgeHandler(null);
    disconnectSocket();
    this.unsubscribeNetwork?.();
    this.unsubscribeNetwork = null;
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async runFullSync(): Promise<void> {
    if (!this.running) return;
    await this.runCycle();
  }

  private schedule(): void {
    if (!this.running || this.appState !== 'active') return;
    this.timer = setTimeout(() => {
      void this.runCycle();
      this.schedule();
    }, PERIODIC_INTERVAL_MS);
  }

  private async runCycle(): Promise<void> {
    if (this.active) {
      // A mutation was enqueued while this cycle was mid-flight; without this flag it would
      // sit in the outbox until the next periodic tick.
      this.rerunRequested = true;
      return;
    }
    const { isOnline } = useSyncStatusStore.getState();
    if (!isOnline) return;

    this.active = true;
    useSyncStatusStore.getState().setSyncing(true);
    useSyncStatusStore.getState().setError(null);

    try {
      // Order matters: push local changes, upload bytes, then pull server deltas.
      await runPushDrain();
      await runMediaUpload();
      await runPull();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed';
      useSyncStatusStore.getState().setError(message);
    } finally {
      useSyncStatusStore.getState().setSyncing(false);
      useSyncStatusStore.getState().refresh();
      this.active = false;
      if (this.rerunRequested && this.running) {
        this.rerunRequested = false;
        void this.runCycle();
      }
    }
  }
}

export const syncEngine = new SyncEngine();
