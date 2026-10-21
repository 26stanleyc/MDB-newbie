import { Image } from 'expo-image';
import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { Icon, Screen, Text } from '@/components/ui';
import { APP_NAME } from '@/config/app';
import { useScans, type SavedScan } from '@/store/use-scans';
import { Fonts, Radius, Spacing, useThemeColors } from '@/theme';

export default function Home() {
  const c = useThemeColors();
  const scans = useScans((s) => s.scans);
  const recent = scans.slice(0, 6);

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
        <Pressable
          onPress={() => router.push('/profile')}
          accessibilityRole="button"
          accessibilityLabel="Profile"
          hitSlop={12}
          style={[styles.avatar, { backgroundColor: c.surface, borderColor: c.border }]}
        >
          <Icon name="person.crop.circle" size={24} color={c.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.greeting}>
        <Text style={[styles.greetingTitle, { fontFamily: Fonts.serif, color: c.text }]}>
          Ready to climb?
        </Text>
        <Text variant="body" tone="secondary">
          Scan a wall to map its holds and plan your next send.
        </Text>
        <Pressable
          onPress={() => router.push('/how-it-works')}
          accessibilityRole="button"
          accessibilityLabel="How it works"
          hitSlop={8}
          style={styles.howLink}
        >
          <Text variant="label" tone="accent">
            How it works
          </Text>
          <Icon name="chevron.right" size={14} color={c.accent} />
        </Pressable>
      </View>

      <Text variant="label" tone="secondary" style={styles.sectionLabel}>
        RECENT SCANS
      </Text>

      {recent.length === 0 ? (
        <EmptyRecent />
      ) : (
        <FlatList
          data={recent}
          keyExtractor={(s) => s.scanId}
          contentContainerStyle={styles.trail}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <TrailStop scan={item} first={index === 0} last={index === recent.length - 1} />
          )}
        />
      )}

      <ScanDock />
    </Screen>
  );
}

/** Faint topographic contour lines behind the content (decorative). */
function Contours({ color }: { color: string }) {
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 390 800"
    >
      <Path
        d="M-20 120 C 90 90 150 160 250 130 S 430 150 430 150"
        stroke={color}
        strokeOpacity={0.14}
        strokeWidth={1.3}
        fill="none"
      />
      <Path
        d="M-20 210 C 100 180 170 250 270 215 S 430 230 430 230"
        stroke={color}
        strokeOpacity={0.14}
        strokeWidth={1.3}
        fill="none"
      />
      <Path
        d="M-20 330 C 80 300 160 360 260 325 S 430 340 430 340"
        stroke={color}
        strokeOpacity={0.12}
        strokeWidth={1.3}
        fill="none"
      />
      <Path
        d="M-20 470 C 110 440 180 510 280 475 S 430 490 430 490"
        stroke={color}
        strokeOpacity={0.1}
        strokeWidth={1.3}
        fill="none"
      />
      <Path
        d="M-20 620 C 90 590 160 660 265 625 S 430 640 430 640"
        stroke={color}
        strokeOpacity={0.08}
        strokeWidth={1.3}
        fill="none"
      />
    </Svg>
  );
}

/** One recent scan as a waypoint on a dashed trail. */
function TrailStop({ scan, first, last }: { scan: SavedScan; first: boolean; last: boolean }) {
  const c = useThemeColors();
  const date = new Date(scan.createdAt).toLocaleDateString();
  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: '/scan/results',
          params: { scanId: scan.scanId, imageUri: scan.imageUri, placeName: scan.placeName },
        })
      }
      accessibilityRole="button"
      accessibilityLabel={`Scan at ${scan.placeName}, ${date}`}
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
    </Pressable>
  );
}

function EmptyRecent() {
  const c = useThemeColors();
  return (
    <View style={styles.empty}>
      <Icon name="camera.viewfinder" size={40} color={c.textSecondary} />
      <Text tone="secondary" style={styles.emptyText}>
        No scans yet. Tap “Scan wall” to analyze your first route.
      </Text>
    </View>
  );
}

/** Moss pill docked bottom-center, floating above the content with a soft fade. */
function ScanDock() {
  const c = useThemeColors();
  return (
    <View style={styles.dock} pointerEvents="box-none">
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={c.background} stopOpacity="0" />
            <Stop offset="0.55" stopColor={c.background} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#fade)" />
      </Svg>
      <Pressable
        onPress={() => router.push('/scan/mode')}
        accessibilityRole="button"
        accessibilityLabel="Scan wall"
        style={({ pressed }) => [
          styles.scanBtn,
          { backgroundColor: pressed ? c.accentPressed : c.accent },
        ]}
      >
        <Icon name="camera.viewfinder" size={22} color={c.onAccent} />
        <Text variant="label" color={c.onAccent} style={styles.scanLabel}>
          Scan wall
        </Text>
      </Pressable>
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
  sectionLabel: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.sm,
    letterSpacing: 1.2,
  },
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
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 128,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: Spacing.md,
  },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: 54,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    shadowColor: '#2A2723',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  scanLabel: { fontSize: 16, fontWeight: '700' },
});
