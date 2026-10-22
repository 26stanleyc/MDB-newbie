import { BlurView } from 'expo-blur';
import { router, type Href } from 'expo-router';
import type { SymbolViewProps } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, useColorScheme, View } from 'react-native';
import Animated, {
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { enter, Press, Springs } from '@/components/motion';
import { Icon, Text } from '@/components/ui';
import type { ScanMode } from '@/api';
import { useScanDraft } from '@/store/use-scan-draft';
import { Radius, Spacing, useThemeColors } from '@/theme';

type Action = {
  key: string;
  icon: SymbolViewProps['name'];
  title: string;
  caption: string;
  run: (startScan: (m: ScanMode) => void) => void;
};

const ACTIONS: Action[] = [
  {
    key: 'quick',
    icon: 'camera',
    title: 'Quick scan',
    caption: 'One photo, routes in seconds',
    run: (start) => {
      start('quick');
      router.push('/scan/camera');
    },
  },
  {
    key: 'precise',
    icon: 'cube.transparent',
    title: 'Precise scan',
    caption: '3–5 photos, true wall angles',
    run: (start) => {
      start('precise');
      router.push('/scan/camera');
    },
  },
  {
    key: 'saved',
    icon: 'bookmark',
    title: 'Saved walls',
    caption: 'Scans grouped by gym',
    run: () => router.push('/saved' as Href),
  },
  {
    key: 'how',
    icon: 'questionmark.circle',
    title: 'How it works',
    caption: 'Tips for a clean scan',
    run: () => router.push('/how-it-works'),
  },
];

const PILL_W = 168;
const PILL_H = 54;
const LABEL_W = 84;

/**
 * Bottom dock. The moss "Scan wall" pill opens a blurred action sheet: the
 * screen frosts over, the scan options rise from the pill one by one, and the
 * pill itself shrinks into a round close button.
 */
export function ScanDock() {
  const c = useThemeColors();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const startScan = useScanDraft((s) => s.startScan);
  const [open, setOpen] = useState(false);

  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withSpring(open ? 1 : 0, Springs.settle);
  }, [open, p]);

  const veil = useAnimatedStyle(() => ({ opacity: p.value }));
  const pill = useAnimatedStyle(() => ({
    width: interpolate(p.value, [0, 1], [PILL_W, PILL_H]),
  }));
  // The label collapses to zero width so the icon ends up centered in the circle.
  // Clamped: the spring overshoots past 1, and a negative width lays out as
  // auto (full text width), which jolts the icon sideways.
  const label = useAnimatedStyle(() => ({
    width: interpolate(p.value, [0, 1], [LABEL_W, 0], 'clamp'),
    marginLeft: interpolate(p.value, [0, 1], [Spacing.sm, 0], 'clamp'),
    opacity: interpolate(p.value, [0, 0.4], [1, 0], 'clamp'),
  }));
  const scanIcon = useAnimatedStyle(() => ({
    opacity: 1 - p.value,
    transform: [{ rotate: `${p.value * 90}deg` }, { scale: 1 - p.value * 0.4 }],
  }));
  const closeIcon = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ rotate: `${(1 - p.value) * -90}deg` }, { scale: 0.6 + p.value * 0.4 }],
  }));

  const choose = (a: Action) => {
    setOpen(false);
    a.run(startScan);
  };

  return (
    <>
      {/* Frosted veil over the whole screen, including under the status bar. */}
      <Animated.View
        style={[styles.veil, { top: -insets.top }, veil]}
        pointerEvents={open ? 'auto' : 'none'}
      >
        <BlurView
          intensity={60}
          tint={scheme === 'dark' ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: c.background, opacity: 0.35 }]}
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close scan options"
        />
      </Animated.View>

      <View style={styles.dock} pointerEvents="box-none">
        {!open && (
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
              <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={c.background} stopOpacity="0" />
                <Stop offset="0.55" stopColor={c.background} stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#fade)" />
          </Svg>
        )}

        {open && (
          <View style={styles.menu} pointerEvents="box-none">
            {ACTIONS.map((a, i) => (
              <Animated.View
                key={a.key}
                // The option nearest the pill lands first.
                entering={enter(ACTIONS.length - 1 - i)}
                exiting={FadeOut.duration(110)}
              >
                <Press
                  onPress={() => choose(a)}
                  haptic
                  accessibilityLabel={`${a.title}. ${a.caption}`}
                  style={[styles.item, { backgroundColor: c.surface, borderColor: c.border }]}
                >
                  <View style={[styles.itemIcon, { backgroundColor: c.background }]}>
                    <Icon name={a.icon} size={20} color={c.accent} />
                  </View>
                  <View style={styles.itemText}>
                    <Text variant="label">{a.title}</Text>
                    <Text variant="caption" tone="secondary">
                      {a.caption}
                    </Text>
                  </View>
                </Press>
              </Animated.View>
            ))}
          </View>
        )}

        <Press
          onPress={() => setOpen((o) => !o)}
          haptic
          scaleTo={0.92}
          accessibilityLabel={open ? 'Close scan options' : 'Scan wall'}
          accessibilityState={{ expanded: open }}
          style={styles.pillWrap}
        >
          <Animated.View style={[styles.pill, { backgroundColor: c.accent }, pill]}>
            <View style={styles.iconSlot}>
              <Animated.View style={[styles.iconLayer, scanIcon]}>
                <Icon name="camera.viewfinder" size={22} color={c.onAccent} />
              </Animated.View>
              <Animated.View style={[styles.iconLayer, closeIcon]}>
                <Icon name="xmark" size={20} color={c.onAccent} />
              </Animated.View>
            </View>
            <Animated.View style={[styles.labelSlot, label]}>
              <Text variant="label" color={c.onAccent} style={styles.pillLabel} numberOfLines={1}>
                Scan wall
              </Text>
            </Animated.View>
          </Animated.View>
        </Press>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  veil: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 128,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: Spacing.md,
  },
  menu: { alignSelf: 'stretch', paddingHorizontal: Spacing.lg, gap: Spacing.sm, marginBottom: Spacing.md },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.sm,
    paddingRight: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  itemIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  itemText: { flex: 1, gap: 2 },
  pillWrap: {
    borderRadius: Radius.pill,
    shadowColor: '#2A2723',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  pill: {
    height: PILL_H,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  labelSlot: { overflow: 'hidden' },
  iconSlot: { width: 22, height: 22 },
  iconLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  pillLabel: { fontSize: 16, fontWeight: '700' },
});
