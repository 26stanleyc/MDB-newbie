import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import Animated, { SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/app-header';
import { enter, Press, Springs } from '@/components/motion';
import { WallView } from '@/components/wall-view';
import { Button, Loading, MessageState, Screen, Swatch, Text } from '@/components/ui';
import { api, type Route } from '@/api';
import { useAsyncData } from '@/lib/use-async-data';
import { useRoutePicker } from '@/lib/use-route-picker';
import { Radius, Spacing, useThemeColors } from '@/theme';

export default function ResultsScreen() {
  const { scanId, placeName, step, finished } = useLocalSearchParams<{
    scanId: string;
    placeName: string;
    step?: 'verify';
    finished?: string; // route id the climber just finished (path screen → Finish route)
  }>();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const { data: scan, error, reload } = useAsyncData(
    useCallback(() => api.getScan(scanId), [scanId]),
    [scanId],
  );
  // A fresh scan starts by checking the holds; then the climber taps a start hold.
  const [phase, setPhase] = useState<'verify' | 'start'>(step === 'verify' ? 'verify' : 'start');
  // Holds the climber tapped off on the photo; saved as delete corrections.
  const [off, setOff] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const picker = useRoutePicker(scanId, scan?.holds ?? []);
  // Back from a finished route: clear the old pick so the next start hold is fresh.
  const { reset: resetPicker } = picker;
  useEffect(() => {
    if (finished) resetPicker();
  }, [finished, resetPicker]);

  const toggleHold = (id: string) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Saves turned-off outlines, then marks the scan reviewed: the holds left are now
  // trusted as training labels (backend scripts/export_feedback.py).
  const confirmHolds = async () => {
    setSaving(true);
    try {
      if (off.size > 0) {
        await api.submitCorrections(
          scanId,
          [...off].map((holdId) => ({ kind: 'delete' as const, holdId })),
        );
        setOff(new Set());
      }
      // Training data only: picking a route still works if this fails.
      await api.reviewScan(scanId).catch(() => {});
      if (off.size > 0) reload(); // routes are regrouped without the removed holds
    } finally {
      setSaving(false);
    }
    setPhase('start');
  };

  const takeRoute = async () => {
    const route = await picker.save();
    if (route) {
      router.push({ pathname: '/scan/path', params: { scanId, routeId: route.id, placeName } });
    }
  };

  const openRoute = (route: Route) =>
    router.push({ pathname: '/scan/path', params: { scanId, routeId: route.id, placeName } });

  if (error) {
    return (
      <Screen>
        <AppHeader title={placeName} />
        <MessageState
          icon="wifi.slash"
          title="Couldn’t load scan"
          message="Please try again."
          actionLabel="Retry"
          onAction={reload}
        />
      </Screen>
    );
  }

  if (!scan) {
    return (
      <Screen>
        <AppHeader title={placeName} />
        <Loading label="Loading scan…" />
      </Screen>
    );
  }

  const lowConfidence = scan.holds.some((h) => h.confidence < 0.6);
  const fresh = step === 'verify';

  return (
    // The sheet runs to the bottom edge itself (no light strip under it).
    <Screen padded={false} edges={['top', 'left', 'right']}>
      <View style={styles.headerWrap}>
        <AppHeader
          title={placeName}
          right={
            <Press
              onPress={() =>
                router.push({ pathname: '/scan/correct', params: { scanId, placeName } })
              }
              accessibilityLabel="Fix detection"
              hitSlop={8}
            >
              <Text variant="label" tone="accent">
                Fix
              </Text>
            </Press>
          }
        />
      </View>

      <WallView
        uri={scan.imageUri}
        holds={scan.holds}
        offHoldIds={off}
        selectedHoldIds={phase === 'start' && picker.startId ? picker.selected : undefined}
        onHoldPress={phase === 'verify' ? toggleHold : picker.tap}
        style={styles.wall}
      />

      <Animated.View
        entering={SlideInDown.springify()
          .damping(Springs.settle.damping)
          .stiffness(Springs.settle.stiffness)}
        style={[
          styles.sheet,
          {
            backgroundColor: c.surface,
            borderColor: c.border,
            paddingBottom: insets.bottom + Spacing.md,
          },
        ]}
      >
        {phase === 'verify' ? (
          <>
            <Text variant="caption" tone="secondary">
              Step 1 of 2
            </Text>
            <Text variant="heading">Check the holds</Text>
            <Text variant="caption" tone="secondary">
              Tap anything outlined that isn’t a hold (people, volumes, shadows) to turn it off.
              {lowConfidence ? ' Some detections are low-confidence.' : ''}
            </Text>
            {off.size > 0 ? (
              <View style={styles.inlineRow}>
                <Text variant="caption" tone="secondary" style={styles.flex}>
                  {off.size} {off.size === 1 ? 'outline' : 'outlines'} turned off
                </Text>
                <Press onPress={() => setOff(new Set())} hitSlop={8} accessibilityLabel="Undo">
                  <Text variant="label" tone="accent">
                    Undo
                  </Text>
                </Press>
              </View>
            ) : null}
            <Button
              title={off.size > 0 ? 'Save and pick a route' : 'Holds look right'}
              onPress={confirmHolds}
              loading={saving}
            />
          </>
        ) : picker.startId ? (
          <>
            <Text variant="heading">
              {picker.selected.size} {picker.selected.size === 1 ? 'hold' : 'holds'} in this route
            </Text>
            <Text variant="caption" tone={picker.error ? 'destructive' : 'secondary'}>
              {picker.error ?? 'Tap holds to add or remove them.'}
            </Text>
            <Button
              title="Use this route"
              onPress={takeRoute}
              loading={picker.busy}
              disabled={picker.selected.size === 0}
            />
            <Button title="Pick a different start" variant="ghost" onPress={picker.reset} />
          </>
        ) : (
          <>
            {fresh ? (
              <Text variant="caption" tone="secondary">
                Step 2 of 2
              </Text>
            ) : null}
            <View style={styles.inlineRow}>
              <Text variant="heading" style={styles.flex}>
                Tap the start hold
              </Text>
              <Press onPress={() => setPhase('verify')} hitSlop={8} accessibilityLabel="Check holds">
                <Text variant="label" tone="accent">
                  Check holds
                </Text>
              </Press>
            </View>
            <Text variant="caption" tone={picker.error ? 'destructive' : 'secondary'}>
              {picker.error ??
                (picker.busy ? 'Finding the route…' : 'The rest of the route lights up.')}
            </Text>
            {scan.routes.length > 0 ? (
              <>
                <Text variant="caption" tone="secondary" style={styles.orLabel}>
                  Or open a detected route
                </Text>
                <FlatList
                  horizontal
                  data={scan.routes}
                  keyExtractor={(r) => r.id}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chips}
                  renderItem={({ item, index }) => (
                    <Animated.View entering={enter(index + 2)}>
                      <RouteChip route={item} onPress={() => openRoute(item)} />
                    </Animated.View>
                  )}
                />
              </>
            ) : null}
          </>
        )}
      </Animated.View>
    </Screen>
  );
}

function RouteChip({ route, onPress }: { route: Route; onPress: () => void }) {
  const c = useThemeColors();
  const g = route.communityGrade;
  return (
    <Press
      onPress={onPress}
      accessibilityLabel={`${route.displayName} route, ${route.holdIds.length} holds`}
      style={[styles.chip, { backgroundColor: c.background, borderColor: c.border }]}
    >
      <Swatch color={route.color} size={18} />
      <View>
        <Text variant="label">{route.displayName}</Text>
        <Text variant="caption" tone="secondary">
          {route.holdIds.length} holds{g ? ` · ${g.grade}` : ''}
        </Text>
      </View>
    </Press>
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
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  orLabel: { marginTop: Spacing.xs },
  chips: { gap: Spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
