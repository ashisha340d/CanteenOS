import { useEffect } from 'react';

/**
 * Keeps the screen on.
 *
 * A tablet in a stand goes to sleep on its own after a minute or two of stillness, and a black
 * kiosk in a hall is indistinguishable from a broken one — guests walk past it. Locking the
 * device's own sleep timer in its settings is the other half of this and is a job for whoever
 * mounts the stand, but a page that asks for a wake lock survives an OS update resetting that.
 *
 * The lock is dropped by the browser whenever the page is hidden, so it is re-acquired when
 * the tab comes back rather than being taken once and assumed to hold.
 */
export function useWakeLock(): void {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const acquire = async (): Promise<void> => {
      if (released || document.visibilityState !== 'visible') return;
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        // Denied on a device with low battery, or unsupported behind a flag. Nothing to do:
        // the kiosk works either way, it just dims sooner.
      }
    };

    const onVisibility = (): void => void acquire();

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);
}
