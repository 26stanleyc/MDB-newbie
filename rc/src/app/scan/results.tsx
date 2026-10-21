import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { WallView } from '@/components/wall-view';
import {
  Badge,
  Button,
  Card,
  Icon,
  Loading,
  MessageState,
  Screen,
  Segmented,
  Swatch,
  Text,
} from '@/components/ui';
import { api, type Route } from '@/api';
import { useAsyncData } from '@/lib/use-async-data';
import { Radius, Spacing, useThemeColors } from '@/theme';

export default function ResultsScreen() {
  const { scanId, placeName } = useLocalSearchParams<{ scanId: string; placeName: string }>();
  const c = useThemeColors();
  const { data: scan, error, reload } = useAsyncData(
    useCallback(() => api.getScan(scanId), [scanId]),
    [scanId],
  );
  // Tapping a hold on the photo either picks it as a route's start or turns it off.
  const [tapMode, setTapMode] = useState<'start' | 'off'>('start');
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  // Holds the climber tapped off on the photo; saved as delete corrections.
  const [off, setOff] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const toggleHold = (id: string) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Start hold → the backend suggests the rest of the route → review it on the pick screen.
  const pickStart = async (holdId: string) => {
    if (picking) return;
    setPicking(true);
    setPickError(null);
    try {
      const ids = await api.suggestRoute(scanId, holdId);
      router.push({
        pathname: '/scan/pick-route',
        params: { scanId, placeName, start: holdId, holds: ids.join(',') },
      });
    } catch (e) {
      setPickError(e instanceof Error ? e.message : 'Couldn’t suggest a route from that hold.');
    } finally {
      setPicking(false);
    }
  };

  const saveOff = async () => {
    setSaving(true);
    try {
      await api.submitCorrections(
        scanId,
        [...off].map((holdId) => ({ kind: 'delete' as const, holdId })),
      );
      setOff(new Set());
      reload(); // routes are regrouped without the removed holds
    } finally {
      setSaving(false);
    }
  };

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

  return (
    <Screen padded={false}>
      <View style={styles.headerWrap}>
        <AppHeader
          title={placeName}
          right={
            <Pressable
              onPress={() =>
                router.push({ pathname: '/scan/correct', params: { scanId, placeName } })
              }
              accessibilityRole="button"
              accessibilityLabel="Fix detection"
              hitSlop={8}
            >
              <Text variant="label" tone="accent">
                Fix
              </Text>
            </Pressable>
          }
        />
      </View>

      <WallView
        uri={scan.imageUri}
        holds={scan.holds}
        offHoldIds={off}
        onHoldPress={tapMode === 'start' ? pickStart : toggleHold}
        style={styles.wall}
      />

      <View style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Segmented
          options={[
            { label: 'Pick start', value: 'start' },
            { label: 'Turn off holds', value: 'off' },
          ]}
          value={tapMode}
          onChange={setTapMode}
        />
        <Text variant="caption" tone={pickError ? 'destructive' : 'secondary'} style={styles.hint}>
          {pickError ??
            (picking
              ? 'Finding the route…'
              : tapMode === 'start'
                ? 'Tap a start hold on the photo to plan that route.'
                : 'Tap holds on the photo that aren’t holds (people, volumes) to turn them off.')}
        </Text>

        {off.size > 0 ? (
          <View style={styles.offBar}>
            <Text variant="caption" tone="secondary" style={styles.flex}>
              {off.size} {off.size === 1 ? 'hold' : 'holds'} turned off
            </Text>
            <Button
              title="Undo"
              variant="ghost"
              fullWidth={false}
              onPress={() => setOff(new Set())}
              disabled={saving}
            />
            <Button title="Save" fullWidth={false} onPress={saveOff} loading={saving} />
          </View>
        ) : lowConfidence ? (
          <View style={styles.warning}>
            <Icon name="exclamationmark.triangle.fill" size={14} color={c.warning} />
            <Text variant="caption" tone="secondary" style={styles.flex}>
              Some holds are low-confidence. Turn off wrong ones or tap “Fix”.
            </Text>
          </View>
        ) : null}

        <Text variant="heading" style={styles.sheetTitle}>
          Routes
        </Text>

        {scan.routes.length === 0 ? (
          <MessageState
            icon="questionmark.circle"
            title="No routes found"
            message="We couldn’t group these holds into routes. Try fixing detection or retaking the photo."
            actionLabel="Fix detection"
            onAction={() =>
              router.push({ pathname: '/scan/correct', params: { scanId, placeName } })
            }
          />
        ) : (
          <FlatList
            data={scan.routes}
            keyExtractor={(r) => r.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <RouteRow
                route={item}
                onPress={() =>
                  router.push({
                    pathname: '/scan/path',
                    params: { scanId, routeId: item.id, placeName },
                  })
                }
              />
            )}
          />
        )}
      </View>
    </Screen>
  );
}

function RouteRow({ route, onPress }: { route: Route; onPress: () => void }) {
  const c = useThemeColors();
  const g = route.communityGrade;
  return (
    <Card onPress={onPress} accessibilityLabel={`${route.displayName} route`} style={styles.row}>
      <Swatch color={route.color} />
      <View style={styles.flex}>
        <Text variant="label">{route.displayName}</Text>
        <Text variant="caption" tone="secondary">
          {route.holdIds.length} holds
        </Text>
      </View>
      {g ? (
        <View style={styles.grade}>
          <Badge label={g.grade} />
          <Text variant="caption" tone="secondary">
            {g.votes} {g.votes === 1 ? 'vote' : 'votes'}
          </Text>
        </View>
      ) : (
        <Text variant="caption" tone="secondary">
          Ungraded
        </Text>
      )}
      <Icon name="chevron.right" size={16} color={c.textSecondary} />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerWrap: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  wall: { flex: 1 },
  sheet: {
    maxHeight: '46%',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  hint: { marginTop: Spacing.sm, marginBottom: Spacing.sm },
  offBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  warning: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  sheetTitle: { marginBottom: Spacing.sm },
  list: { gap: Spacing.sm, paddingBottom: Spacing.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  grade: { alignItems: 'flex-end', gap: 2 },
});
