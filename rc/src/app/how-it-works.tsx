import { Image } from 'expo-image';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { Screen, Text } from '@/components/ui';
import { Fonts, Radius, Spacing, useThemeColors } from '@/theme';

type Stage = {
  title: string;
  sub: string;
  image: number;
  caption: string;
};

const STAGES: Stage[] = [
  {
    title: 'Find the holds',
    sub: 'Every hold on the wall, outlined and separated.',
    image: require('../../assets/demo/holds.jpg') as number,
    caption: '52 holds detected',
  },
  {
    title: 'Group holds into routes',
    sub: 'The wall segmented by color — one color, one climb.',
    image: require('../../assets/demo/routes-by-color.jpg') as number,
    caption: '6 routes grouped by color',
  },
  {
    title: 'Rebuild the wall',
    sub: 'Depth and angle, reconstructed to real-world scale.',
    image: require('../../assets/demo/geometry.jpg') as number,
    caption: 'fold 18° · 3.4 m × 1.6 m',
  },
  {
    title: 'Solve the optimal path',
    sub: 'The lowest-effort move order — tuned to your reach.',
    image: require('../../assets/demo/optimal-path.jpg') as number,
    caption: 'short · 14 moves · balance 0.80',
  },
];

export default function HowItWorks() {
  const c = useThemeColors();
  return (
    <Screen padded={false}>
      <View style={styles.headerWrap}>
        <AppHeader title="How it works" />
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.lede, { color: c.textSecondary }]}>
          From a single photo, Capitan builds a climbable plan — four steps, each one real
          output from the engine.
        </Text>

        {STAGES.map((s, i) => (
          <View key={s.title} style={styles.step}>
            <View style={styles.stepHead}>
              <View style={[styles.num, { backgroundColor: c.accent }]}>
                <Text variant="label" color={c.onAccent} style={styles.numText}>
                  {i + 1}
                </Text>
              </View>
              <View style={styles.flex}>
                <Text style={[styles.stepTitle, { fontFamily: Fonts.serif, color: c.text }]}>
                  {s.title}
                </Text>
                <Text variant="caption" tone="secondary">
                  {s.sub}
                </Text>
              </View>
            </View>

            <View style={[styles.frame, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Image source={s.image} style={styles.image} contentFit="cover" />
              <View style={[styles.caption, { borderColor: c.border }]}>
                <Text variant="caption" tone="secondary">
                  {s.caption}
                </Text>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerWrap: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  scroll: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing['2xl'] },
  lede: { fontSize: 15, lineHeight: 22, marginBottom: Spacing.lg },
  step: { marginBottom: Spacing.xl },
  stepHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, marginBottom: Spacing.md },
  num: {
    width: 26,
    height: 26,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  numText: { fontSize: 14, fontWeight: '700' },
  stepTitle: { fontSize: 19, fontWeight: '600', marginBottom: 1 },
  frame: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  image: { width: '100%', aspectRatio: 1.5 },
  caption: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
