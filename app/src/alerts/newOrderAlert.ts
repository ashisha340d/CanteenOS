import { Platform, Vibration } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';
import { AlertSoundSlot, AlertType, type OrderDto } from '@menuboard/shared';
import { API_BASE_URL, apiClient } from '../api/client';
import { alertSettingsRepository } from '../db/repositories';
import { secureTokenStore } from '../utils/secureTokenStore';
import { useUiStore } from '../state/uiStore';

/**
 * The NEW_INCOMING alarm runtime: when the pull worker lands an order this device has never
 * seen (created by someone else), this module makes it impossible to miss — it plays the
 * admin-uploaded buzzer for the configured slot and records the order ids so the board feed
 * can flash the new cards and scroll to them.
 */

interface NewOrderAlertState {
  /** Orders that just arrived from another device and have not been seen on a feed yet. */
  flashOrderIds: string[];
  addFlash: (ids: string[]) => void;
  clearFlash: (id: string) => void;
}

export const useNewOrderAlertStore = create<NewOrderAlertState>((set) => ({
  flashOrderIds: [],
  addFlash: (ids) =>
    set((state) => ({ flashOrderIds: [...new Set([...state.flashOrderIds, ...ids])] })),
  clearFlash: (id) =>
    set((state) => ({ flashOrderIds: state.flashOrderIds.filter((x) => x !== id) })),
}));

export async function notifyNewOrders(orders: OrderDto[]): Promise<void> {
  if (orders.length === 0) return;

  // The flash ids are set synchronously, before any await, so the pull worker can bump
  // dataVersion right after this call and the reloading feed already knows what to flash.
  useNewOrderAlertStore.getState().addFlash(orders.map((order) => order.id));

  const setting = await alertSettingsRepository.findByType(AlertType.NEW_INCOMING);
  if (setting !== null && !setting.enabled) return;
  if (!useUiStore.getState().notificationSoundEnabled) return;

  if (Platform.OS !== 'web') Vibration.vibrate([0, 300, 150, 300]);
  await playAlertSound(setting?.sound ?? AlertSoundSlot.NORMAL);
}

/** Resolved buzzer URIs, per slot, for this session. */
const soundUriBySlot = new Map<AlertSoundSlot, string>();

/**
 * The buzzer endpoint needs the Bearer token, which an `<audio>`/`AVPlayer` source cannot
 * send — so the bytes are fetched once through an authenticated call (a blob URL on web,
 * a cache file on Android) and playback uses the local copy.
 */
async function resolveSoundUri(slot: AlertSoundSlot): Promise<string | null> {
  const cached = soundUriBySlot.get(slot);
  if (cached !== undefined) return cached;

  try {
    if (Platform.OS === 'web') {
      const response = await apiClient.get<Blob>(`/alerts/sounds/${slot}/file`, {
        responseType: 'blob',
      });
      const uri = URL.createObjectURL(response.data);
      soundUriBySlot.set(slot, uri);
      return uri;
    }

    const token = secureTokenStore.getAccessToken();
    const result = await FileSystem.downloadAsync(
      `${API_BASE_URL}/alerts/sounds/${slot}/file`,
      `${FileSystem.cacheDirectory}alert-sound-${slot}`,
      token ? { headers: { Authorization: `Bearer ${token}` } } : {},
    );
    if (result.status !== 200) return null;
    soundUriBySlot.set(slot, result.uri);
    return result.uri;
  } catch {
    // 404 means no sound uploaded for the slot; anything else is a transient fetch failure.
    // Either way the caller falls back to the built-in buzz.
    return null;
  }
}

async function playAlertSound(slot: AlertSoundSlot): Promise<void> {
  try {
    const uri = await resolveSoundUri(slot);
    if (uri === null) {
      fallbackBuzz();
      return;
    }
    const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) void sound.unloadAsync();
    });
  } catch {
    fallbackBuzz();
  }
}

/** No uploaded sound (or playback failed): beep on web, vibrate again on a phone. */
function fallbackBuzz(): void {
  if (Platform.OS !== 'web') {
    Vibration.vibrate(500);
    return;
  }
  try {
    const Ctx = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (Ctx === undefined) return;
    const ctx = new Ctx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.7);
    oscillator.onended = (): void => {
      void ctx.close();
    };
  } catch {
    // Web audio unavailable (e.g. no user gesture yet) — nothing more to do.
  }
}
