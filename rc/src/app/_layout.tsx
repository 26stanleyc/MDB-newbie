import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useSession } from '@/store/use-session';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const hasHydrated = useSession((s) => s.hasHydrated);

  useEffect(() => {
    if (hasHydrated) SplashScreen.hideAsync();
  }, [hasHydrated]);

  // Fallback: never leave the splash up indefinitely if hydration stalls.
  useEffect(() => {
    const t = setTimeout(() => SplashScreen.hideAsync(), 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="scan/camera" options={{ presentation: 'fullScreenModal' }} />
        </Stack>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
