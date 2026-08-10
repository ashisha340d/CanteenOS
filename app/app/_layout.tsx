import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing, typography } from '../src/theme/tokens';
import { useAuthStore } from '../src/state/authStore';
import { useUiStore } from '../src/state/uiStore';
import { getDb } from '../src/db/client';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { syncEngine } from '../src/sync/syncEngine';
import { useAppFonts } from '../src/theme/useAppFonts';
import { pingApi } from '../src/api/client';

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
    const inAuthGroup = top === 'login' || top === 'change-password';

    if (status !== 'signedIn' && !inAuthGroup) {
      router.replace('/login');
    } else if (status === 'signedIn' && mustChangePassword && top !== 'change-password') {
      router.replace('/change-password');
    } else if (status === 'signedIn' && !mustChangePassword && inAuthGroup) {
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

const errorStyles = StyleSheet.create({
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
    backgroundColor: colors.primary600,
  },
  buttonLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: typography.callout.size,
    color: colors.white,
  },
});

export default function RootLayout(): React.JSX.Element {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const loadPreferences = useUiStore((s) => s.loadPreferences);
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    (async () => {
      // Each step is isolated: an unreachable server or an unopenable database must not stop
      // `bootstrap()` from running, because until it does the splash screen never clears and
      // the user has no way to reach the login screen.
      await pingApi();
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

  const { ready } = useAuthGate();
  // Gate the first paint on the brand faces. Rendering a frame in Roboto and then reflowing
  // into Inter is more jarring than a beat longer on the splash.
  const fontsReady = useAppFonts();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {!ready || !fontsReady ? (
          <LoadingScreen label="Starting MenuBoard…" />
        ) : (
          <Stack screenOptions={{ headerTitleAlign: 'center' }}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="change-password" options={{ title: 'Change Password' }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="settings" options={{ headerShown: false }} />
            <Stack.Screen name="notifications" options={{ headerShown: false }} />
            <Stack.Screen name="boards/[boardId]/index" options={{ title: 'Board' }} />
            <Stack.Screen name="boards/[boardId]/create-order" options={{ title: 'Create Order' }} />
            <Stack.Screen name="orders/[orderId]/index" options={{ title: 'Order Details' }} />
            <Stack.Screen name="orders/[orderId]/edit" options={{ title: 'Edit Order' }} />
          </Stack>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
