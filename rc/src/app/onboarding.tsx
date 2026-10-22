import { router } from 'expo-router';
import type { SymbolViewProps } from 'expo-symbols';
import { useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { Button, Icon, Screen, Text } from '@/components/ui';
import { APP_NAME } from '@/config/app';
import { useSession } from '@/store/use-session';
import { Spacing, useThemeColors } from '@/theme';

type Card = {
  icon: SymbolViewProps['name'];
  title: string;
  body: string;
};

const CARDS: Card[] = [
  {
    icon: 'camera.viewfinder',
    title: `Welcome to ${APP_NAME}`,
    body: 'Snap one photo of a climbing wall and get the holds, routes, and the best way up.',
  },
  {
    icon: 'figure.climbing',
    title: 'Routes, personalized',
    body: 'Pick a route and see a hand-and-foot sequence computed for your height and wingspan.',
  },
  {
    icon: 'photo.on.rectangle.angled',
    title: 'Take a good photo',
    body: 'Stand square to the wall, fit the whole route in frame, and keep the shot steady and well-lit.',
  },
];

export default function Onboarding() {
  const { width } = useWindowDimensions();
  const c = useThemeColors();
  const completeOnboarding = useSession((s) => s.completeOnboarding);
  const [index, setIndex] = useState(0);
  const isLast = index === CARDS.length - 1;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  const finish = () => {
    completeOnboarding();
    router.replace('/sign-in');
  };

  return (
    <Screen padded={false}>
      <View style={styles.top}>
        <Button title="Skip" variant="ghost" fullWidth={false} onPress={finish} />
      </View>

      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        style={styles.flex}
      >
        {CARDS.map((card) => (
          <View key={card.title} style={[styles.page, { width }]}>
            <Icon name={card.icon} size={64} color={c.accent} />
            <Text variant="title" style={styles.title}>
              {card.title}
            </Text>
            <Text tone="secondary" style={styles.body}>
              {card.body}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dots}>
        {CARDS.map((card, i) => (
          <View
            key={card.title}
            style={[
              styles.dot,
              { backgroundColor: i === index ? c.accent : c.border },
            ]}
          />
        ))}
      </View>

      <View style={styles.footer}>
        <Button
          title={isLast ? 'Get started' : 'Next'}
          onPress={() => {
            if (isLast) finish();
            else setIndex((i) => Math.min(i + 1, CARDS.length - 1));
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { alignItems: 'flex-end', paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
    paddingHorizontal: Spacing.xl,
  },
  title: { textAlign: 'center' },
  body: { textAlign: 'center', lineHeight: 24 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.lg },
  dot: { width: 8, height: 8, borderRadius: 4 },
  footer: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg },
});
