import { Redirect, Tabs } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';

import { useSession } from '@/store/use-session';
import { useThemeColors } from '@/theme';

export default function TabsLayout() {
  const c = useThemeColors();
  const { hasHydrated, hasSeenOnboarding, user } = useSession();

  if (!hasHydrated) return null;
  if (!hasSeenOnboarding) return <Redirect href="/onboarding" />;
  if (!user) return <Redirect href="/sign-in" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textSecondary,
        tabBarStyle: { backgroundColor: c.background, borderTopColor: c.border },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <TabIcon name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Saved Walls',
          tabBarIcon: ({ color }) => <TabIcon name="bookmark.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}

function TabIcon({
  name,
  color,
}: {
  name: SymbolViewProps['name'];
  color: SymbolViewProps['tintColor'];
}) {
  return <SymbolView name={name} size={24} tintColor={color} resizeMode="scaleAspectFit" />;
}
