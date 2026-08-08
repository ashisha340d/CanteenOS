import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { authApi } from '../api/auth';
import { getOrCreateDeviceId } from './deviceId';

interface ExpoExtra {
  projectId?: string;
  apiBaseUrl?: string;
}

/**
 * Registers this device's Expo push token with the backend. Called after a successful
 * sign-in (or bootstrap) so the server can dispatch push notifications.
 *
 * If no EAS project id is configured (common in local development) the function exits
 * gracefully without throwing.
 */
export async function registerPushToken(): Promise<void> {
  const projectId =
    (Constants.expoConfig?.extra as ExpoExtra | undefined)?.projectId ??
    Constants.easConfig?.projectId;
  if (!projectId) {
    console.log('Push token registration skipped: no EAS project id configured');
    return;
  }

  const existing = await Notifications.getPermissionsAsync();
  if (!existing.granted) {
    const request = await Notifications.requestPermissionsAsync();
    if (!request.granted) return;
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const deviceId = await getOrCreateDeviceId();
    await authApi.registerPushToken({ deviceId, pushToken: tokenData.data });
  } catch (error) {
    console.warn('Failed to register push token', error);
  }
}
