import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { api } from '@/api';
import { Contours } from '@/components/contours';
import { enter, Press } from '@/components/motion';
import { Icon, Screen, Text } from '@/components/ui';
import { useScans, type SavedScan } from '@/store/use-scans';
import { Fonts, Radius, Spacing, useThemeColors } from '@/theme';

const THUMBS = 3; // wall previews per gym card

type Gym = { id: string; name: string; scans: SavedScan[] };

export default function Saved() {
  const c = useThemeColors();
  const scans = useScans((s) => s.scans);
  const places = useScans((s) => s.places);
  const addScan = useScans((s) => s.addScan);

  // Starter walls from the backend join the saved list (addScan skips duplicates).
  useEffect(() => {
    api
      .getFeaturedScans()
      .then((walls) => walls.forEach(addScan))
      .catch(() => {}); // offline / no backend: just the climber's own scans
  }, [addScan]);

  // Gyms with their walls, newest first; the most recently climbed gym on top.
  const byId = new Map<string, Gym>();
  for (const s of [...scans].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const gym = byId.get(s.placeId) ?? {
      id: s.placeId,
      name: places[s.placeId]?.name ?? s.placeName,
      scans: [],
    };
    gym.scans.push(s);
    byId.set(s.placeId, gym);
  }
  const gyms = [...byId.values()];

  return (
    <Screen padded={false} edges={['top', 'left', 'right']}>
      <Contours color={c.accent} />

      <View style={styles.header}>
        <Text style={[styles.title, { fontFamily: Fonts.serif, color: c.text }]}>Saved walls</Text>
        <Text variant="body" tone="secondary">
          {gyms.length === 0
            ? 'Walls you scan are kept here, grouped by gym.'
            : `${scans.length} ${scans.length === 1 ? 'wall' : 'walls'} across ${gyms.length} ${
                gyms.length === 1 ? 'gym' : 'gyms'
              }.`}
        </Text>
      </View>

      {gyms.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="bookmark" size={40} color={c.textSecondary} />
          <Text tone="secondary" style={styles.emptyText}>
            No saved walls yet. Scan a wall and it shows up here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={gyms}
          keyExtractor={(g) => g.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <Animated.View entering={enter(index)}>
              <GymCard gym={item} />
            </Animated.View>
          )}
        />
      )}
    </Screen>
  );
}

function GymCard({ gym }: { gym: Gym }) {
  const c = useThemeColors();
  const count = gym.scans.length;
  const latest = new Date(gym.scans[0].createdAt).toLocaleDateString();
  const shown = gym.scans.slice(0, THUMBS);
  const more = count - shown.length;

  return (
    <Press
      scaleTo={0.98}
      onPress={() => router.push(`/place/${gym.id}`)}
      accessibilityLabel={`${gym.name}, ${count} ${count === 1 ? 'wall' : 'walls'}`}
      style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
    >
      <View style={styles.thumbs}>
        {shown.map((s, i) => (
          <View key={s.scanId} style={styles.thumbWrap}>
            <Image source={{ uri: s.imageUri }} style={styles.thumb} contentFit="cover" />
            {more > 0 && i === shown.length - 1 ? (
              <View style={styles.moreOverlay}>
                <Text variant="label" color="#fff">
                  +{more}
                </Text>
              </View>
            ) : null}
          </View>
        ))}
      </View>

      <View style={styles.cardRow}>
        <View style={styles.cardText}>
          <Text style={[styles.gymName, { fontFamily: Fonts.serif, color: c.text }]} numberOfLines={1}>
            {gym.name}
          </Text>
          <Text variant="caption" tone="secondary">
            {count} {count === 1 ? 'wall' : 'walls'} · latest {latest}
          </Text>
        </View>
        <Icon name="chevron.right" size={16} color={c.textSecondary} />
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing.md, gap: 4 },
  title: { fontSize: 30, fontWeight: '600' },
  list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl, gap: Spacing.md },
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.sm,
    gap: Spacing.sm,
  },
  thumbs: { flexDirection: 'row', gap: Spacing.xs },
  thumbWrap: { flex: 1, height: 96, borderRadius: Radius.md, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%' },
  moreOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(26,24,21,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xs,
    paddingBottom: Spacing.xs,
  },
  cardText: { flex: 1, gap: 2 },
  gymName: { fontSize: 19, fontWeight: '600' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
  },
  emptyText: { textAlign: 'center' },
});
