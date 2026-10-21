import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { WallView } from '@/components/wall-view';
import { Button, Loading, MessageState, Screen, Text } from '@/components/ui';
import { api } from '@/api';
import { useAsyncData } from '@/lib/use-async-data';
import { Radius, Spacing, useThemeColors } from '@/theme';

/**
 * Tap-to-pick a route: tap the start hold, the backend suggests the rest of the
 * route (same color, within reach, above the start), then tap holds to add or
 * remove before saving (Reset picks a new start). Works where routes share a color or colors are misread.
 * The results screen can open it with a start already picked (`start` + suggested `holds`).
 */
export default function PickRouteScreen() {
  const params = useLocalSearchParams<{
    scanId: string;
    placeName: string;
    start?: string;
    holds?: string; // comma-separated suggested hold ids
  }>();
  const { scanId, placeName } = params;
  const c = useThemeColors();
  const { data: scan, error, reload } = useAsyncData(
    useCallback(() => api.getScan(scanId), [scanId]),
    [scanId],
  );
  const [startId, setStartId] = useState<string | null>(params.start ?? null);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(params.start ? (params.holds ?? params.start).split(',') : []),
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  if (error) {
    return (
      <Screen>
        <AppHeader title="Pick a route" />
        <MessageState icon="wifi.slash" title="Couldn’t load scan" message="Please try again." actionLabel="Retry" onAction={reload} />
      </Screen>
    );
  }
  if (!scan) {
    return (
      <Screen>
        <AppHeader title="Pick a route" />
        <Loading label="Loading scan…" />
      </Screen>
    );
  }

  const onHoldPress = async (holdId: string) => {
    if (busy) return;
    setFailed(null);
    if (!startId) {
      setBusy(true);
      try {
        const ids = await api.suggestRoute(scanId, holdId);
        setStartId(holdId);
        setSelected(new Set(ids));
      } catch (e) {
        setFailed(e instanceof Error ? e.message : 'Couldn’t suggest a route.');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (holdId === startId) return; // the start hold stays; use Start over to change it
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(holdId)) next.delete(holdId);
      else next.add(holdId);
      return next;
    });
  };

  const reset = () => {
    setStartId(null);
    setSelected(new Set());
    setFailed(null);
  };

  const save = async () => {
    if (!startId) return;
    setBusy(true);
    try {
      const ordered = [startId, ...[...selected].filter((id) => id !== startId)];
      const route = await api.createRoute(scanId, ordered, startId);
      router.replace({ pathname: '/scan/path', params: { scanId, routeId: route.id, placeName } });
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'Couldn’t save the route.');
      setBusy(false);
    }
  };

  return (
    <Screen padded={false}>
      <View style={styles.headerWrap}>
        <AppHeader
          title="Pick a route"
          right={
            <Pressable onPress={reset} disabled={!startId} hitSlop={8} accessibilityLabel="Start over">
              <Text variant="label" tone={startId ? 'accent' : 'secondary'}>
                Reset
              </Text>
            </Pressable>
          }
        />
      </View>

      <WallView uri={scan.imageUri} holds={scan.holds} selectedHoldIds={startId ? selected : undefined} onHoldPress={onHoldPress} style={styles.wall} />

      <View style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text variant="caption" tone="secondary">
          {!startId
            ? 'Tap the route’s start hold. We’ll suggest the rest of the route.'
            : `${selected.size} holds selected. Tap holds to add or remove them, then save.`}
        </Text>
        {failed ? (
          <Text variant="caption" tone="destructive">
            {failed}
          </Text>
        ) : null}
        <Button
          title={startId ? `Use this route (${selected.size} holds)` : 'Tap a start hold'}
          onPress={save}
          disabled={!startId || selected.size === 0}
          loading={busy}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerWrap: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  wall: { flex: 1 },
  sheet: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
});
