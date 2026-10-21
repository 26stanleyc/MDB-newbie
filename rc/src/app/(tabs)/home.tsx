import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Alert, FlatList, Platform, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Contours } from '@/components/contours';
import { enter, Press, RollingText } from '@/components/motion';
import { ScanDock } from '@/components/scan-dock';
import { Icon, Screen, Text } from '@/components/ui';
import { APP_NAME } from '@/config/app';
import { useScans, type SavedScan } from '@/store/use-scans';
import { Fonts, Radius, Spacing, useThemeColors } from '@/theme';

export default function Home() {
  const c = useThemeColors();
  const scans = useScans((s) => s.scans);
  const recent = scans.slice(0, 6);
  const gymCount = new Set(scans.map((s) => s.placeId)).size;

  return (
    <Screen padded={false} edges={['top', 'left', 'right']}>
      <Contours color={c.accent} />

      <View style={styles.header}>
        <Image
          source={require('../../../assets/logo.png')}
          style={styles.logo}
          contentFit="contain"
        />
        <Text style={[styles.wordmark, { fontFamily: Fonts.serif }]}>{APP_NAME}</Text>
        <View style={styles.flex} />
        <Press
          onPress={() => router.push('/profile')}
          accessibilityLabel="Profile"
          hitSlop={12}
          scaleTo={0.9}
          style={[styles.avatar, { backgroundColor: c.surface, borderColor: c.border }]}
        >
          <Icon name="person.crop.circle" size={24} color={c.textSecondary} />
        </Press>
      </View>

      {scans.length === 0 ? (
        <View style={styles.greeting}>
          <Text style={[styles.greetingTitle, { fontFamily: Fonts.serif, color: c.text }]}>
            Ready to climb?
          </Text>
          <Text variant="body" tone="secondary">
            Scan a wall to map its holds and plan your next send.
          </Text>
          <Press
            onPress={() => router.push('/how-it-works')}
            accessibilityLabel="How it works"
            hitSlop={8}
            style={styles.howLink}
          >
            <Text variant="label" tone="accent">
              How it works
            </Text>
            <Icon name="chevron.right" size={14} color={c.accent} />
          </Press>
        </View>
      ) : (
        // Stats hero: the number rolls when a new scan lands.
        <View style={styles.greeting}>
          <View style={styles.statRow}>
            <RollingText
              value={String(scans.length)}
              style={[styles.statNumber, { fontFamily: Fonts.serif, color: c.text }]}
            />
            <Text style={[styles.statUnit, { fontFamily: Fonts.serif, color: c.text }]}>
              {scans.length === 1 ? 'wall scanned' : 'walls scanned'}
            </Text>
          </View>
          <Text variant="body" tone="secondary">
            Across {gymCount} {gymCount === 1 ? 'gym' : 'gyms'}. Latest at {scans[0].placeName}.
          </Text>
        </View>
      )}

      <View style={styles.sectionRow}>
        <Text style={[styles.sectionLabel, { fontFamily: Fonts.serif, color: c.text }]}>
          Recent scans
        </Text>
        {recent.length > 0 ? (
          <Text variant="caption" tone="secondary">
            Hold a wall to delete it
          </Text>
        ) : null}
      </View>

      {recent.length === 0 ? (
        <EmptyRecent />
      ) : (
        <FlatList
          data={recent}
          keyExtractor={(s) => s.scanId}
          contentContainerStyle={styles.trail}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <Animated.View entering={enter(index)}>
              <TrailStop scan={item} first={index === 0} last={index === recent.length - 1} />
            </Animated.View>
          )}
        />
      )}

      <ScanDock />
    </Screen>
  );
}

/** One recent scan as a waypoint on a dashed trail. */
function TrailStop({ scan, first, last }: { scan: SavedScan; first: boolean; last: boolean }) {
  const c = useThemeColors();
  const removeScan = useScans((s) => s.removeScan);
  const date = new Date(scan.createdAt).toLocaleDateString();

  // Long-press → confirm → drop it from the climber's saved walls.
  const confirmDelete = () => {
    const title = 'Delete this wall?';
    const message = `Your ${scan.placeName} scan from ${date} will be removed from your walls.`;
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n\n${message}`)) removeScan(scan.scanId);
      return;
    }
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeScan(scan.scanId) },
    ]);
  };

  return (
    <Press
      scaleTo={0.98}
      onPress={() =>
        router.push({
          pathname: '/scan/results',
          params: { scanId: scan.scanId, imageUri: scan.imageUri, placeName: scan.placeName },
        })
      }
      onLongPress={confirmDelete}
      accessibilityLabel={`Scan at ${scan.placeName}, ${date}`}
      accessibilityHint="Long-press to delete"
      accessibilityActions={[{ name: 'delete', label: 'Delete wall' }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'delete' && confirmDelete()}
      style={styles.trailRow}
    >
      <View style={styles.rail}>
        <View style={[styles.railLine, { borderColor: c.border }, first && styles.railHidden]} />
        <View style={[styles.node, { borderColor: c.accent, backgroundColor: c.background }]}>
          <View style={[styles.nodeDot, { backgroundColor: c.accent }]} />
        </View>
        <View style={[styles.railLine, { borderColor: c.border }, last && styles.railHidden]} />
      </View>

      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Image source={{ uri: scan.imageUri }} style={styles.thumb} contentFit="cover" />
        <View style={styles.cardText}>
          <Text variant="label" numberOfLines={1}>
            {scan.placeName}
          </Text>
          <Text variant="caption" tone="secondary">
            {date}
          </Text>
        </View>
        <Icon name="chevron.right" size={16} color={c.textSecondary} />
      </View>
    </Press>
  );
}

function EmptyRecent() {
  const c = useThemeColors();
  return (
    <View style={styles.empty}>
      <Icon name="camera.viewfinder" size={40} color={c.textSecondary} />
      <Text tone="secondary" style={styles.emptyText}>
        No scans yet. Tap “Scan wall” to map your first wall.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  logo: { width: 30, height: 30 },
  wordmark: { fontSize: 24, fontWeight: '600', letterSpacing: 0.2 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  greeting: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, gap: 4 },
  greetingTitle: { fontSize: 30, fontWeight: '600' },
  howLink: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingTop: Spacing.xs },
  statRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },
  statNumber: { fontSize: 52, fontWeight: '600', lineHeight: 60 },
  statUnit: { fontSize: 24, fontWeight: '500' },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.sm,
  },
  sectionLabel: { fontSize: 20, fontWeight: '600' },
  trail: { paddingHorizontal: Spacing.lg, paddingBottom: 112 },
  trailRow: { flexDirection: 'row' },
  rail: { width: 28, alignItems: 'center' },
  railLine: {
    flex: 1,
    width: 0,
    borderLeftWidth: 2,
    borderStyle: 'dashed',
    minHeight: 10,
  },
  railHidden: { borderLeftWidth: 0 },
  node: {
    width: 16,
    height: 16,
    borderRadius: Radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeDot: { width: 5, height: 5, borderRadius: Radius.pill },
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginLeft: Spacing.sm,
    marginVertical: Spacing.xs,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 54, height: 54, borderRadius: Radius.sm },
  cardText: { flex: 1, gap: 2 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingBottom: 112,
  },
  emptyText: { textAlign: 'center' },
});
