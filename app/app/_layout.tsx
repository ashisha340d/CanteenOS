import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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

export default function RootLayout(): React.JSX.Element {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const loadPreferences = useUiStore((s) => s.loadPreferences);
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    (async () => {
      await pingApi();
      await getDb();
      await Promise.all([bootstrap(), loadPreferences()]);
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
