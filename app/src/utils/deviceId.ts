import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { settingsRepository, SETTINGS_KEYS } from '../db/repositories/settingsRepository';
import { newId } from './uuid';

/** Stable per-install device id, persisted locally and sent as `deviceId` / `X-Device-Id`. */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await settingsRepository.get<string>(SETTINGS_KEYS.DEVICE_ID);
  if (existing) return existing;

  // `Application.getAndroidId` is exported on every platform but *throws*
  // `UnavailabilityError` when called outside Android — it doesn't return null — so the
  // platform must be checked before calling it, not just that the function reference exists.
  const androidId = Platform.OS === 'android' ? Application.getAndroidId() : null;
  const id = androidId ?? newId();
  await settingsRepository.set(SETTINGS_KEYS.DEVICE_ID, id);
  return id;
}
