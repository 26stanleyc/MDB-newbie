import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { Card, Screen, Text } from '@/components/ui';
import { VARIANTS } from '@/features/lab/variants';
import { Spacing } from '@/theme';

/** Design lab: pick a variant to try. Same flow and motion, different skin. */
export default function Lab() {
  return (
    <Screen>
      <AppHeader title="Design lab" />
      <Text tone="secondary" style={styles.intro}>
        Each version runs the same flow on mock data. Tap +, then Log a send. Tap the avatar to come
        back here.
      </Text>
      <View style={styles.list}>
        {VARIANTS.map((v) => (
          <Card
            key={v.id}
            onPress={() => router.push({ pathname: '/lab/[variant]', params: { variant: v.id } })}
            style={styles.row}
          >
            <View style={styles.swatches}>
              {[v.c.bg, v.c.surface, v.c.primary].map((hex, i) => (
                <View key={i} style={[styles.chip, { backgroundColor: hex }]} />
              ))}
            </View>
            <View style={styles.flex}>
              <Text variant="label">{v.name}</Text>
              <Text variant="caption" tone="secondary">
                {v.blurb}
              </Text>
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { marginBottom: Spacing.md },
  list: { gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  flex: { flex: 1 },
  swatches: { flexDirection: 'row' },
  chip: {
    width: 22,
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.2)',
  },
});
