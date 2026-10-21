import { Redirect } from 'expo-router';
import { TopTabs } from 'expo-router/js-top-tabs';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/store/use-session';
import { useThemeColors } from '@/theme';

export default function TabsLayout() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const { hasHydrated, hasSeenOnboarding, user } = useSession();

  if (!hasHydrated) return null;
  if (!hasSeenOnboarding) return <Redirect href="/onboarding" />;
  if (!user) return <Redirect href="/sign-in" />;

  // Swipeable tabs (swipe left/right between Home and Saved walls), bar kept at the bottom.
  return (
    <TopTabs
      tabBarPosition="bottom"
      screenOptions={{
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textSecondary,
        tabBarShowIcon: true,
        tabBarIndicatorStyle: { backgroundColor: c.accent, top: 0, height: 2 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500', textTransform: 'none', margin: 0 },
        tabBarStyle: {
          backgroundColor: c.background,
          borderTopColor: c.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          paddingBottom: insets.bottom,
          elevation: 0,
          shadowOpacity: 0,
        },
        sceneStyle: { backgroundColor: c.background },
      }}
    >
      <TopTabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }: { color: string }) => <TabIcon name="house.fill" color={color} />,
        }}
      />
      <TopTabs.Screen
        name="saved"
        options={{
          title: 'Saved Walls',
          tabBarIcon: ({ color }: { color: string }) => <TabIcon name="bookmark.fill" color={color} />,
        }}
      />
    </TopTabs>
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
