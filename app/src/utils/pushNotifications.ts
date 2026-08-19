import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { MESSAGE_CHANNEL_ID, ORDER_CHANNEL_ID } from '@menuboard/shared';
import { authApi } from '../api/auth';
import { getOrCreateDeviceId } from './deviceId';
import { playNewMessageAlert, playNewOrderAlert } from '../alerts/newOrderAlert';

interface ExpoExtra {
  projectId?: string;
  apiBaseUrl?: string;
}

/**
 * The Android channel every order alert is delivered on — the id is shared with the server,
 * which stamps it onto each push, because Android matches them by exact string.
 *
 * Android 8 and later ignore per-notification importance and sound entirely; those are
 * properties of the *channel*, fixed when it is created. The app previously had no channel of
 * its own, so a new-order push landed on the system default: no heads-up, and on many devices
 * no sound at all. That is the whole reason orders were arriving silently.
 */
export { ORDER_CHANNEL_ID, MESSAGE_CHANNEL_ID };

/**
 * How a notification behaves while the app is open.
 *
 * expo-notifications suppresses presentation in the foreground unless a handler opts in, so
 * without this a new order that arrived while someone was on another screen was neither shown
 * nor heard. Sound is left to the app rather than the OS: the buzzer an admin uploaded is
 * played by `playNewOrderAlert` from the listener below, and letting the OS chime as well
 * would double up on every order.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

/** Creates the order channel. Idempotent — Android updates the existing channel in place. */
export async function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(ORDER_CHANNEL_ID, {
      name: 'Orders',
      description: 'New orders and delivery alarms',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 300, 150, 300],
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: false,
    });
    await Notifications.setNotificationChannelAsync(MESSAGE_CHANNEL_ID, {
      name: 'Messages',
      description: 'Replies and mentions on a board',
      // A rung below orders: still audible and still a heads-up, but it loses the contest
      // when both arrive together, and it can be muted on its own.
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 120],
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      bypassDnd: false,
    });
  } catch (error) {
    console.warn('Failed to create the notification channels', error);
  }
}

/**
 * Plays the admin-configured buzzer when an order push arrives with the app open.
 *
 * Returns the unsubscribe function; the root layout owns the subscription's lifetime.
 */
export function subscribeToOrderAlerts(): () => void {
  const subscription = Notifications.addNotificationReceivedListener((notification) => {
    const data = notification.request.content.data as
      | { type?: string; orderId?: string | null; notificationId?: string }
      | undefined;
    if (data === undefined) return;

    // Deduped inside: the sync pull usually beats the push to the same row, and only the
    // first of the two is allowed to buzz.
    if (data.type === 'NEW_ORDER') {
      void playNewOrderAlert(typeof data.orderId === 'string' ? [data.orderId] : []);
      return;
    }
    if (data.type === 'THREAD_REPLY' || data.type === 'MENTION') {
      void playNewMessageAlert(
        typeof data.notificationId === 'string' ? [data.notificationId] : [],
      );
    }
  });
  return () => subscription.remove();
}

/**
 * Registers this device's Expo push token with the backend. Called after a successful
 * sign-in (or bootstrap) so the server can dispatch push notifications.
 *
 * If no EAS project id is configured (common in local development) the function exits
 * gracefully without throwing — but the channel is created first either way, so a build that
 * receives pushes through some other path still has somewhere audible to put them.
 */
export async function registerPushToken(): Promise<void> {
  await ensureNotificationChannels();

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
