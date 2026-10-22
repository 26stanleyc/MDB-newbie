import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { LayoutAnimationConfig, LinearTransition, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { GYM, GYMS, ROUTES, WALLS, type LabSend } from './data';
import { LabIcon } from './icons';
import { enter, Press, RollingText } from './motion';
import { kindStyle, SectionHead, Swatch, T } from './ui';
import type { LabTheme } from './variants';

export const TABS = ['Home', 'Walls', 'Routes', 'Gyms'] as const;
export type Tab = (typeof TABS)[number];

export function LabHome({
  t,
  tab,
  onTab,
  sends,
  topInset,
  bottomPad,
  onAvatar,
}: {
  t: LabTheme;
  tab: Tab;
  onTab: (tab: Tab) => void;
  sends: LabSend[];
  topInset: number;
  bottomPad: number;
  onAvatar: () => void;
}) {
  return (
    <View style={styles.fill}>
      {t.contours && <Contours color={t.c.primary} />}
      <View style={[styles.topBar, { paddingTop: topInset + 8 }]}>
        <Press
          spring={t.spring}
          onPress={onAvatar}
          accessibilityLabel="Back to variants"
          style={[styles.avatar, { backgroundColor: t.c.surfaceHi }]}
        >
          <T t={t} kind="label">
            S
          </T>
        </Press>
        <TabPills t={t} tab={tab} onTab={onTab} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Home is simply there on launch; entrances play on tab switches. */}
        <LayoutAnimationConfig skipEntering>
          <Animated.View key={tab} style={styles.tabBody}>
            {tab === 'Home' && <HomeTab t={t} sends={sends} />}
            {tab === 'Walls' && <WallsList t={t} />}
            {tab === 'Routes' && <RoutesList t={t} />}
            {tab === 'Gyms' && <GymsList t={t} />}
          </Animated.View>
        </LayoutAnimationConfig>
      </ScrollView>
    </View>
  );
}

/** Pill tabs with one indicator that springs between them. */
function TabPills({ t, tab, onTab }: { t: LabTheme; tab: Tab; onTab: (tab: Tab) => void }) {
  const [layouts, setLayouts] = useState<Record<string, { x: number; w: number }>>({});
  const x = useSharedValue(0);
  const w = useSharedValue(0);

  useEffect(() => {
    const l = layouts[tab];
    if (!l) return;
    // First measurement snaps; later tab changes spring.
    const first = w.value === 0;
    x.value = first ? l.x : withSpring(l.x, t.spring);
    w.value = first ? l.w : withSpring(l.w, t.spring);
  }, [tab, layouts, x, w, t.spring]);

  const ind = useAnimatedStyle(() => ({ width: w.value, transform: [{ translateX: x.value }] }));

  return (
    <View style={styles.pills}>
      <Animated.View
        style={[styles.pillInd, { backgroundColor: t.c.primary, borderRadius: t.radius.button }, ind]}
      />
      {TABS.map((name) => {
        const on = name === tab;
        return (
          <Press
            key={name}
            spring={t.spring}
            onPress={() => onTab(name)}
            accessibilityLabel={name}
            accessibilityState={{ selected: on }}
            onLayout={(e) => {
              const { x: lx, width } = e.nativeEvent.layout;
              setLayouts((prev) => ({ ...prev, [name]: { x: lx, w: width } }));
            }}
            style={[styles.pill, { borderRadius: t.radius.button, backgroundColor: on ? 'transparent' : t.c.chip }]}
          >
            <T t={t} kind="caption" style={{ color: on ? t.c.onPrimary : t.c.text, fontWeight: '600' }}>
              {name}
            </T>
          </Press>
        );
      })}
    </View>
  );
}

function HomeTab({ t, sends }: { t: LabTheme; sends: LabSend[] }) {
  const lastWall = WALLS[0];
  return (
    <>
      <Animated.View entering={enter(t, 0)} style={styles.gymRow}>
        <T t={t} kind="caption" dim>
          {GYM.name}
        </T>
        <LabIcon name="down" size={12} color={t.c.dim} weight={2.6} />
      </Animated.View>
      <Animated.View entering={enter(t, 1)} style={styles.statRow}>
        <RollingText value={String(sends.length + 5)} t={t} style={[kindStyle(t, 'display'), { color: t.c.text }]} />
        <T t={t} kind="title" style={styles.statUnit}>
          sends this week
        </T>
      </Animated.View>
      <Animated.View entering={enter(t, 2)}>
        <T t={t} kind="caption" dim>
          Hardest so far: {hardest(sends)}
        </T>
      </Animated.View>

      <Animated.View entering={enter(t, 3)}>
        <Press
          spring={t.spring}
          scaleTo={0.97}
          accessibilityLabel={`Last scan, ${lastWall.name}`}
          style={[styles.card, styles.lastScan, { backgroundColor: t.c.surface, borderRadius: t.radius.card }]}
        >
          <Image source={{ uri: lastWall.imageUri }} style={[styles.thumbSm, { borderRadius: t.radius.card / 2 }]} />
          <T t={t} kind="label" style={styles.flex}>
            Last scan
          </T>
          <T t={t} kind="label">
            {lastWall.name}
          </T>
        </Press>
      </Animated.View>

      <Animated.View entering={enter(t, 4)}>
        <SectionHead t={t} title="Sends" />
      </Animated.View>
      {sends.map((s, i) => (
        <Animated.View key={s.id} entering={enter(t, 5 + i)} layout={LinearTransition.springify()}>
          <View style={[styles.card, styles.row, { backgroundColor: t.c.surface, borderRadius: t.radius.card }]}>
            <Swatch color={s.color} size={28} t={t} />
            <View style={styles.flex}>
              <T t={t} kind="label">
                {s.routeName}
              </T>
              <T t={t} kind="caption" dim>
                {s.when}
              </T>
            </View>
            <T t={t} kind="label">
              {s.grade}
            </T>
          </View>
        </Animated.View>
      ))}

      <Animated.View entering={enter(t, 6 + sends.length)} layout={LinearTransition.springify()}>
        <SectionHead t={t} title="Routes" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
          {ROUTES.map((r) => (
            <Press
              key={r.id}
              spring={t.spring}
              accessibilityLabel={`${r.name} route, ${r.grade ?? 'ungraded'}`}
              style={[styles.routeCard, { backgroundColor: t.c.surface, borderRadius: t.radius.card }]}
            >
              <Swatch color={r.color} size={30} t={t} />
              <T t={t} kind="label">
                {r.name}
              </T>
              <T t={t} kind="caption" dim>
                {r.grade ?? 'Ungraded'}
              </T>
            </Press>
          ))}
        </ScrollView>
      </Animated.View>
    </>
  );
}

function WallsList({ t }: { t: LabTheme }) {
  return (
    <>
      {WALLS.map((w, i) => (
        <Animated.View key={w.id} entering={enter(t, i)}>
          <Press
            spring={t.spring}
            scaleTo={0.97}
            accessibilityLabel={w.name}
            style={[styles.card, styles.row, { backgroundColor: t.c.surface, borderRadius: t.radius.card }]}
          >
            <Image source={{ uri: w.imageUri }} style={[styles.thumb, { borderRadius: t.radius.card / 2 }]} />
            <View style={styles.flex}>
              <T t={t} kind="label">
                {w.name}
              </T>
              <T t={t} kind="caption" dim>
                {w.routeCount} routes, scanned {w.date}
              </T>
            </View>
            <LabIcon name="chevron" size={16} color={t.c.dim} />
          </Press>
        </Animated.View>
      ))}
    </>
  );
}

function RoutesList({ t }: { t: LabTheme }) {
  return (
    <>
      {ROUTES.map((r, i) => (
        <Animated.View key={r.id} entering={enter(t, i)}>
          <Press
            spring={t.spring}
            scaleTo={0.97}
            accessibilityLabel={`${r.name}, ${r.wallName}`}
            style={[styles.card, styles.row, { backgroundColor: t.c.surface, borderRadius: t.radius.card }]}
          >
            <Swatch color={r.color} size={28} t={t} />
            <View style={styles.flex}>
              <T t={t} kind="label">
                {r.name}
              </T>
              <T t={t} kind="caption" dim>
                {r.wallName}
              </T>
            </View>
            <T t={t} kind="label">
              {r.grade ?? 'Ungraded'}
            </T>
          </Press>
        </Animated.View>
      ))}
    </>
  );
}

function GymsList({ t }: { t: LabTheme }) {
  return (
    <>
      {GYMS.map((g, i) => (
        <Animated.View key={g.id} entering={enter(t, i)}>
          <Press
            spring={t.spring}
            scaleTo={0.97}
            accessibilityLabel={g.name}
            style={[styles.card, styles.row, { backgroundColor: t.c.surface, borderRadius: t.radius.card }]}
          >
            <View style={[styles.pinDot, { backgroundColor: t.c.surfaceHi }]}>
              <LabIcon name="pin" size={16} color={t.c.text} />
            </View>
            <View style={styles.flex}>
              <T t={t} kind="label">
                {g.name}
              </T>
              <T t={t} kind="caption" dim>
                {g.scanCount === 0 ? 'No walls scanned yet' : `${g.scanCount} walls scanned`}
              </T>
            </View>
            <T t={t} kind="caption" dim>
              {formatDistance(g.distanceM)}
            </T>
          </Press>
        </Animated.View>
      ))}
    </>
  );
}

function hardest(sends: LabSend[]): string {
  const n = (g: string) => (g === 'VB' ? -1 : Number(g.slice(1)));
  return sends.reduce((a, s) => (n(s.grade) > n(a) ? s.grade : a), 'VB');
}

export function formatDistance(m?: number): string {
  if (m == null) return '';
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Faint topo contours from the current home screen (refined variant only). */
function Contours({ color }: { color: string }) {
  const lines = [120, 230, 360, 500, 650];
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 390 800"
    >
      {lines.map((y, i) => (
        <Path
          key={y}
          d={`M-20 ${y} C 90 ${y - 30} 160 ${y + 40} 260 ${y + 5} S 430 ${y + 20} 430 ${y + 20}`}
          stroke={color}
          strokeOpacity={0.14 - i * 0.015}
          strokeWidth={1.3}
          fill="none"
        />
      ))}
    </Svg>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  pills: { flexDirection: 'row', gap: 6 },
  pillInd: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  pill: { height: 32, paddingHorizontal: 13, justifyContent: 'center' },
  scroll: { paddingHorizontal: 16, paddingTop: 18 },
  tabBody: { gap: 8 },
  gymRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  statUnit: { fontWeight: '500' },
  card: { padding: 12 },
  lastScan: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumbSm: { width: 32, height: 32 },
  thumb: { width: 52, height: 52 },
  hList: { gap: 8, paddingRight: 16 },
  routeCard: { width: 108, padding: 12, gap: 6 },
  pinDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
