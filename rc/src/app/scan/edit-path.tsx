import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { WallView } from '@/components/wall-view';
import { Button, Icon, Loading, MessageState, Screen, Swatch, Text } from '@/components/ui';
import { api, type Limb, type PathStep } from '@/api';
import { useAsyncData } from '@/lib/use-async-data';
import { useProfile } from '@/store/use-profile';
import { Radius, Spacing, useThemeColors } from '@/theme';

const DEFAULT_PROFILE = { heightCm: 170, wingspanCm: 170 };
const LIMB_CYCLE: Limb[] = ['LH', 'RH', 'LF', 'RF'];
const LIMB_NAME: Record<Limb, string> = {
  LH: 'Left hand',
  RH: 'Right hand',
  LF: 'Left foot',
  RF: 'Right foot',
};
const isHand = (l: Limb) => l === 'LH' || l === 'RH';
const renumber = (steps: PathStep[]): PathStep[] => steps.map((s, i) => ({ ...s, order: i + 1 }));

export default function EditPathScreen() {
  const { scanId, routeId } = useLocalSearchParams<{
    scanId: string;
    routeId: string;
  }>();
  const c = useThemeColors();
  const profile = useProfile((s) => s.profile) ?? DEFAULT_PROFILE;

  const { data, error, reload } = useAsyncData(
    useCallback(async () => {
      const scan = await api.getScan(scanId);
      const route = scan.routes.find((r) => r.id === routeId);
      if (!route) throw new Error('route not found');
      const steps = await api.getOptimalPath(scanId, routeId, profile);
      return { scan, route, steps };
    }, [scanId, routeId, profile]),
    [scanId, routeId, profile.heightCm, profile.wingspanCm],
  );

  const [steps, setSteps] = useState<PathStep[] | null>(null);
  const [seededKey, setSeededKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Seed the working copy from the computed path once it loads (React-sanctioned
  // "adjust state during render when a key changes" — no effect, no cascade).
  const seedKey = data ? `${routeId}:${profile.heightCm}:${profile.wingspanCm}` : null;
  if (seedKey && seedKey !== seededKey) {
    setSeededKey(seedKey);
    setSteps(renumber(data!.steps));
  }

  if (error) {
    return (
      <Screen>
        <AppHeader title="Edit path" />
        <MessageState
          icon="wifi.slash"
          title="Couldn’t load path"
          message="Please try again."
          actionLabel="Retry"
          onAction={reload}
        />
      </Screen>
    );
  }
  if (!data || steps === null) {
    return (
      <Screen>
        <AppHeader title="Edit path" />
        <Loading label="Loading path…" />
      </Screen>
    );
  }

  const { route, scan } = data;
  const dirty = JSON.stringify(steps) !== JSON.stringify(renumber(data.steps));

  const addMove = (holdId: string) =>
    setSteps((s) => {
      const prev = s ?? [];
      const limb: Limb = prev.length % 2 === 0 ? 'RH' : 'LH';
      return renumber([...prev, { order: prev.length + 1, holdId, limb }]);
    });
  const cycleLimb = (i: number) =>
    setSteps((s) =>
      (s ?? []).map((step, idx) =>
        idx === i
          ? { ...step, limb: LIMB_CYCLE[(LIMB_CYCLE.indexOf(step.limb) + 1) % LIMB_CYCLE.length] }
          : step,
      ),
    );
  const move = (i: number, dir: -1 | 1) =>
    setSteps((s) => {
      const arr = [...(s ?? [])];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return renumber(arr);
    });
  const remove = (i: number) => setSteps((s) => renumber((s ?? []).filter((_, idx) => idx !== i)));
  const resetPath = () => setSteps(renumber(data.steps));

  const save = async () => {
    setSubmitting(true);
    try {
      await api.submitPathCorrection(scanId, routeId, steps, profile);
      router.back();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen padded={false}>
      <View style={styles.headerWrap}>
        <AppHeader
          title="Edit path"
          right={
            <Pressable
              onPress={resetPath}
              disabled={!dirty}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Reset path"
            >
              <Text variant="label" tone={dirty ? 'accent' : 'secondary'}>
                Reset
              </Text>
            </Pressable>
          }
        />
      </View>

      <WallView
        uri={scan.imageUri}
        holds={scan.holds}
        selectedHoldIds={new Set(route.holdIds)}
        steps={steps}
        onHoldPress={addMove}
        style={styles.wall}
      />

      <View style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={styles.titleRow}>
          <Swatch color={route.color} />
          <Text variant="label" style={styles.flex}>
            {route.displayName} · {steps.length} {steps.length === 1 ? 'move' : 'moves'}
          </Text>
        </View>
        <Text variant="caption" tone="secondary">
          Tap a hold on the photo to add a move. Tap a move’s limb to change it.
        </Text>

        {steps.length === 0 ? (
          <Text variant="caption" tone="secondary" style={styles.empty}>
            No moves yet — tap holds to build the path.
          </Text>
        ) : (
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {steps.map((step, i) => (
              <View key={`${step.holdId}-${i}`} style={styles.moveRow}>
                <Text variant="label" tone="secondary" style={styles.order}>
                  {i + 1}
                </Text>
                <Pressable
                  onPress={() => cycleLimb(i)}
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${i + 1}, ${LIMB_NAME[step.limb]}. Tap to change limb.`}
                  style={[styles.limbChip, { backgroundColor: c.surfaceSelected }]}
                >
                  <View
                    style={[
                      styles.glyph,
                      { borderColor: c.text },
                      isHand(step.limb) ? styles.glyphRound : styles.glyphSquare,
                    ]}
                  />
                  <Text variant="label">{step.limb}</Text>
                </Pressable>
                <Swatch color={route.color} size={16} />
                <View style={styles.flex} />
                <IconBtn
                  name="arrow.up"
                  label={`Move ${i + 1} up`}
                  disabled={i === 0}
                  onPress={() => move(i, -1)}
                />
                <IconBtn
                  name="arrow.down"
                  label={`Move ${i + 1} down`}
                  disabled={i === steps.length - 1}
                  onPress={() => move(i, 1)}
                />
                <IconBtn
                  name="trash"
                  label={`Delete move ${i + 1}`}
                  color={c.destructive}
                  onPress={() => remove(i)}
                />
              </View>
            ))}
          </ScrollView>
        )}

        <Button title="Save path" onPress={save} loading={submitting} disabled={!dirty} />
      </View>
    </Screen>
  );
}

function IconBtn({
  name,
  label,
  onPress,
  disabled,
  color,
}: {
  name: Parameters<typeof Icon>[0]['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
}) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={styles.iconBtn}
    >
      <Icon name={name} size={20} color={disabled ? c.border : color ?? c.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerWrap: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  wall: { flex: 1 },
  sheet: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  empty: { paddingVertical: Spacing.md },
  list: { maxHeight: 220 },
  listContent: { gap: Spacing.xs, paddingVertical: Spacing.xs },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 40 },
  order: { width: 20, textAlign: 'center' },
  limbChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radius.sm,
  },
  glyph: { width: 12, height: 12, borderWidth: 2 },
  glyphRound: { borderRadius: 6 },
  glyphSquare: { borderRadius: 2 },
  iconBtn: { padding: 6 },
});
