import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { fonts, radii, spacing, typography } from '../src/theme/tokens';
import { useThemeColors } from '../src/theme/useThemeColors';
import { useAuthStore } from '../src/state/authStore';
import { useUiStore } from '../src/state/uiStore';
import { getDb } from '../src/db/client';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { syncEngine } from '../src/sync/syncEngine';
import { useAppFonts } from '../src/theme/useAppFonts';
import { discoverApiBaseUrl } from '../src/api/client';
import { subscribeToOrderAlerts } from '../src/utils/pushNotifications';

/**
 * Guards navigation by auth status. `(tabs)`, `boards` and `orders` are protected; `login`
 * and `change-password` are the only public/gate screens. This is the single place route
 * protection is decided — screens themselves do not each re-implement a redirect.
 */
function useAuthGate(): { ready: boolean } {
  const router = useRouter();
  const segments = useSegments();
  const status = useAuthStore((s) => s.status);
  const mustChangePassword = useAuthStore((s) => s.mustChangePassword);
  const isBootstrapping = useAuthStore((s) => s.isBootstrapping);

  useEffect(() => {
    if (isBootstrapping) return;
    const top = segments[0];
    const publicRoute = top === 'login' || top === 'pin-login';

    if (status === 'pinRequired') {
      if (top !== 'pin-login') router.replace('/pin-login');
    } else if (status !== 'signedIn') {
      if (top !== 'login') router.replace('/login');
    } else if (mustChangePassword && top !== 'change-password') {
      router.replace('/change-password');
    } else if (!mustChangePassword && publicRoute) {
      router.replace('/(tabs)/boards');
    }
  }, [status, mustChangePassword, isBootstrapping, segments, router]);

  return { ready: !isBootstrapping };
}

/**
 * Picked up by expo-router and used as the boundary for the whole route tree. Without it a
 * render error anywhere shows the raw redbox in development and an unrecoverable blank screen
 * in a release build; `retry` re-renders the failed subtree, which is enough to recover from a
 * transient render error without restarting the app.
 */
export function ErrorBoundary({
  error,
  retry,
}: {
  error: Error;
  retry: () => Promise<void>;
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const errorStyles = React.useMemo(() => createErrorStyles(colors), [colors]);
  return (
    <View style={errorStyles.container}>
      <Ionicons name="warning-outline" size={44} color={colors.gray300} />
      <Text style={errorStyles.title}>Something went wrong</Text>
      <Text style={errorStyles.subtitle}>{error.message || 'This screen could not be shown.'}</Text>
      <Pressable style={errorStyles.button} onPress={() => void retry()}>
        <Text style={errorStyles.buttonLabel}>Try again</Text>
      </Pressable>
    </View>
  );
}

function createErrorStyles(colors: ReturnType<typeof useThemeColors>['colors']) {
  return StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing[8],
      backgroundColor: colors.background,
    },
    title: {
      fontFamily: fonts.sansSemibold,
      fontSize: typography.title3.size,
      fontWeight: typography.title3.weight,
      color: colors.textPrimary,
      marginTop: spacing[3],
      textAlign: 'center',
    },
    subtitle: {
      fontFamily: fonts.sans,
      fontSize: typography.callout.size,
      color: colors.textSecondary,
      marginTop: spacing[2],
      textAlign: 'center',
    },
    button: {
      marginTop: spacing[6],
      paddingVertical: spacing[3],
      paddingHorizontal: spacing[6],
      borderRadius: radii.lg,
      backgroundColor: colors.taskBar,
    },
    buttonLabel: {
      fontFamily: fonts.sansSemibold,
      fontSize: typography.callout.size,
      color: colors.white,
    },
  });
}

export default function RootLayout(): React.JSX.Element {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const loadPreferences = useUiStore((s) => s.loadPreferences);
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    (async () => {
      // Each step is isolated: an unreachable server or an unopenable database must not stop
      // `bootstrap()` from running, because until it does the splash screen never clears and
      // the user has no way to reach the login screen.
      // Must run before anything authenticates: it picks the backend host this device can
      // actually reach, and `bootstrap` immediately calls the API.
      await discoverApiBaseUrl();
      try {
        await getDb();
      } catch (error) {
        console.error('[DB] Could not open the local database', error);
      }
      const results = await Promise.allSettled([bootstrap(), loadPreferences()]);
      for (const result of results) {
        if (result.status === 'rejected') console.error('[BOOT] Startup step failed', result.reason);
      }
      // `bootstrap` clears this itself on every path it handles; this covers the one it cannot
      // (a throw before it sets any state), so the app still reaches a usable screen.
      if (useAuthStore.getState().isBootstrapping) {
        useAuthStore.setState({ status: 'signedOut', isBootstrapping: false });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status === 'signedIn') {
      syncEngine.start();
    } else if (status === 'signedOut') {
      syncEngine.stop();
    }
  }, [status]);

  // A new-order push arriving with the app open plays the admin-configured buzzer. Mounted at
  // the root so it fires wherever the user happens to be, not only on a board feed.
  useEffect(() => subscribeToOrderAlerts(), []);

  const { ready } = useAuthGate();
  // Gate the first paint on the brand faces. Rendering a frame in Roboto and then reflowing
  // into Inter is more jarring than a beat longer on the splash.
  const fontsReady = useAppFonts();
  const { mode } = useThemeColors();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
        {!ready || !fontsReady ? (
          <LoadingScreen label="Starting MenuBoard…" />
        ) : (
          <Stack screenOptions={{ headerTitleAlign: 'center' }}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="pin-login" options={{ headerShown: false }} />
            <Stack.Screen name="change-password" options={{ title: 'Change Password' }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="settings" options={{ headerShown: false }} />
            <Stack.Screen name="notifications" options={{ headerShown: false }} />
            <Stack.Screen name="boards/[boardId]/index" options={{ title: 'Board' }} />
            {/* Draws its own bar with the Cancel affordance, so the navigator's would double up. */}
            <Stack.Screen name="boards/[boardId]/create-order" options={{ headerShown: false }} />
            <Stack.Screen name="orders/[orderId]/index" options={{ title: 'Order Details' }} />
            <Stack.Screen name="orders/[orderId]/edit" options={{ title: 'Edit Order' }} />
            {/* Equipment draws its own TopAppBar, and `equipment/[equipmentId]` is the target of
                the `menuboard://equipment/<ASSET-ID>` deep link a printed QR label carries. */}
            <Stack.Screen name="equipment/index" options={{ headerShown: false }} />
            <Stack.Screen name="equipment/assets" options={{ headerShown: false }} />
            <Stack.Screen name="equipment/[equipmentId]" options={{ headerShown: false }} />
            <Stack.Screen name="equipment/register" options={{ headerShown: false }} />
            <Stack.Screen name="equipment/report" options={{ headerShown: false }} />
            <Stack.Screen name="equipment/my-maintenance" options={{ headerShown: false }} />
            <Stack.Screen name="equipment/scan" options={{ headerShown: false }} />
            <Stack.Screen name="equipment/floor-plan" options={{ headerShown: false }} />
            <Stack.Screen name="equipment/locations" options={{ headerShown: false }} />
            <Stack.Screen name="equipment/schedules" options={{ headerShown: false }} />
            <Stack.Screen name="equipment/tickets/index" options={{ headerShown: false }} />
            <Stack.Screen name="equipment/tickets/[ticketId]" options={{ headerShown: false }} />
            <Stack.Screen name="equipment/suppliers/index" options={{ headerShown: false }} />
            <Stack.Screen name="equipment/suppliers/[supplierId]" options={{ headerShown: false }} />
          </Stack>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
