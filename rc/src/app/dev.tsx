import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { Card, Screen, Text } from '@/components/ui';
import { devFlags, type DevFlag } from '@/api/dev-flags';
import { useScanDraft } from '@/store/use-scan-draft';
import { Spacing, useThemeColors } from '@/theme';

const ROWS: { flag: DevFlag; label: string; hint: string }[] = [
  { flag: 'forceQualityFailure', label: 'Force quality failure', hint: 'checkImageQuality returns blurry' },
  { flag: 'forceProcessingFailure', label: 'Force processing failure', hint: 'scan resolves to "failed"' },
  { flag: 'forceNoRoutesFound', label: 'Force no routes found', hint: 'scan returns zero routes' },
];

export default function DevMenu() {
  const c = useThemeColors();
  const lastMeta = useScanDraft((s) => s.lastMeta);
  // Mirror the module flags in local state so toggles re-render.
  const [, force] = useState(0);

  const g = lastMeta?.gravity;

  return (
    <Screen>
      <AppHeader title="Dev menu" />
      <Text tone="secondary" style={styles.intro}>
        Force backend outcomes to test error paths (Phase 1 only).
      </Text>
      <View style={styles.list}>
        {ROWS.map((row) => (
          <Card key={row.flag} style={styles.row}>
            <View style={styles.flex}>
              <Text variant="label">{row.label}</Text>
              <Text variant="caption" tone="secondary">
                {row.hint}
              </Text>
            </View>
            <Switch
              value={devFlags[row.flag]}
              onValueChange={(v) => {
                devFlags[row.flag] = v;
                force((n) => n + 1);
              }}
              trackColor={{ true: c.accent }}
            />
          </Card>
        ))}
      </View>

      <Text variant="heading" style={styles.sectionTitle}>
        Last capture metadata
      </Text>
      <Card>
        {lastMeta ? (
          <View style={styles.metaCol}>
            <Text variant="caption" tone="secondary">
              Original: {lastMeta.originalWidth}×{lastMeta.originalHeight} · Upload:{' '}
              {lastMeta.uploadWidth}×{lastMeta.uploadHeight}
            </Text>
            <Text variant="caption" tone="secondary">
              Focal: {lastMeta.focalLengthMm ?? '—'} mm · 35mm eq:{' '}
              {lastMeta.focalLength35mm ?? '—'} mm
            </Text>
            <Text variant="caption" tone="secondary">
              Gravity:{' '}
              {g ? `(${g.x.toFixed(2)}, ${g.y.toFixed(2)}, ${g.z.toFixed(2)})` : '—'}
            </Text>
          </View>
        ) : (
          <Text variant="caption" tone="secondary">
            Take a photo to see captured focal length + gravity here.
          </Text>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { marginBottom: Spacing.md },
  list: { gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  flex: { flex: 1 },
  sectionTitle: { marginTop: Spacing.lg, marginBottom: Spacing.sm },
  metaCol: { gap: Spacing.xs },
});

