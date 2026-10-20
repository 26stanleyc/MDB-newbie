import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { Card, Icon, Screen, Text } from '@/components/ui';
import type { ScanMode } from '@/api';
import { useScanDraft } from '@/store/use-scan-draft';
import { Spacing, useThemeColors } from '@/theme';

const OPTIONS: {
  mode: ScanMode;
  icon: Parameters<typeof Icon>[0]['name'];
  title: string;
  blurb: string;
}[] = [
  {
    mode: 'quick',
    icon: 'camera',
    title: 'Quick scan',
    blurb: 'One photo. Instant results — holds, routes, and an approximate path.',
  },
  {
    mode: 'precise',
    icon: 'cube.transparent',
    title: 'Precise scan · beta',
    blurb: '3–5 photos from different angles. Slower, but reconstructs the wall in 3D for accurate angles and reach.',
  },
];

export default function ScanModeScreen() {
  const c = useThemeColors();
  const startScan = useScanDraft((s) => s.startScan);

  const choose = (mode: ScanMode) => {
    startScan(mode);
    router.push('/scan/camera');
  };

  return (
    <Screen>
      <AppHeader title="New scan" />
      <Text tone="secondary" style={styles.intro}>
        How do you want to capture this wall?
      </Text>
      <View style={styles.list}>
        {OPTIONS.map((o) => (
          <Card key={o.mode} onPress={() => choose(o.mode)} accessibilityLabel={o.title} style={styles.card}>
            <View style={styles.row}>
              <Icon name={o.icon} size={28} color={c.accent} />
              <Text variant="heading" style={styles.flex}>
                {o.title}
              </Text>
              <Icon name="chevron.right" size={16} color={c.textSecondary} />
            </View>
            <Text tone="secondary" variant="caption">
              {o.blurb}
            </Text>
          </Card>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: { marginBottom: Spacing.lg },
  list: { gap: Spacing.md },
  card: { gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
});
