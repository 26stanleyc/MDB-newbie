import { Redirect } from 'expo-router';

import { useSession } from '@/store/use-session';

/** Entry gate: routes to onboarding, auth, or the app based on persisted state. */
export default function Index() {
  const { hasHydrated, hasSeenOnboarding, user } = useSession();

  if (!hasHydrated) return null; // keep the splash up until storage rehydrates
  if (!hasSeenOnboarding) return <Redirect href="/onboarding" />;
  if (!user) return <Redirect href="/sign-in" />;
  return <Redirect href="/home" />;
}
