import { router, Stack, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { LabPrototype } from '@/features/lab/prototype';
import { variantById } from '@/features/lab/variants';

/** One design-lab variant, full screen. Tap the avatar to go back. */
export default function LabVariant() {
  const { variant } = useLocalSearchParams<{ variant: string }>();
  const t = variantById(variant);
  return (
    <>
      <Stack.Screen options={{ animation: 'fade' }} />
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <LabPrototype key={t.id} t={t} onExit={() => (router.canGoBack() ? router.back() : router.replace('/lab'))} />
    </>
  );
}
