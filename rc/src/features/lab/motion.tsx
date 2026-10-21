import { useEffect, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Arc, LabIcon } from './icons';
import type { LabSpring, LabTheme } from './variants';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const PRESS_IN: LabSpring = { damping: 20, stiffness: 520, mass: 0.6 };

/** Staggered entrance shared by every list/screen in the lab. */
export function enter(t: LabTheme, index = 0) {
  return FadeInDown.delay(index * t.stagger)
    .springify()
    .damping(t.spring.damping)
    .stiffness(t.spring.stiffness)
    .mass(t.spring.mass);
}

/**
 * Pressable that squishes while held and springs back on release — the
 * "every button feels physical" quality of the reference.
 */
export function Press({
  spring,
  scaleTo = 0.95,
  style,
  children,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  spring: LabSpring;
  scaleTo?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <AnimatedPressable
      accessibilityRole="button"
      {...rest}
      onPressIn={(e) => {
        s.set(withSpring(scaleTo, PRESS_IN));
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        s.set(withSpring(1, spring));
        rest.onPressOut?.(e);
      }}
      style={[style, a]}
    >
      {children}
    </AnimatedPressable>
  );
}

/**
 * Text whose characters roll in individually when they change (only the
 * changed characters re-mount, so "6" → "7" rolls one digit).
 */
export function RollingText({
  value,
  style,
  t,
}: {
  value: string;
  style: StyleProp<TextStyle>;
  t: LabTheme;
}) {
  return (
    <View style={styles.roll} accessible accessibilityLabel={value}>
      {value.split('').map((ch, i) => (
        <Animated.Text key={`${i}-${ch}`} entering={enter(t)} style={style}>
          {ch}
        </Animated.Text>
      ))}
    </View>
  );
}

/**
 * Two layers in the same slot that cross-morph: `from` shrinks and fades as
 * `to` grows in. Used for quick-pick chips → "Review".
 */
export function Morph({
  on,
  from,
  to,
  height,
  t,
}: {
  on: boolean;
  from: ReactNode;
  to: ReactNode;
  height: number;
  t: LabTheme;
}) {
  const p = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    p.value = withSpring(on ? 1 : 0, t.spring);
  }, [on, p, t.spring]);

  const fromStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.5], [1, 0], 'clamp'),
    transform: [{ scale: interpolate(p.value, [0, 1], [1, 0.9]) }],
  }));
  const toStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0.3, 1], [0, 1], 'clamp'),
    transform: [
      { scaleX: interpolate(p.value, [0, 1], [0.6, 1]) },
      { scaleY: interpolate(p.value, [0, 1], [0.8, 1]) },
    ],
  }));

  return (
    <View style={{ height }}>
      <Animated.View
        style={[StyleSheet.absoluteFill, fromStyle]}
        pointerEvents={on ? 'none' : 'auto'}
      >
        {from}
      </Animated.View>
      <Animated.View
        style={[StyleSheet.absoluteFill, toStyle]}
        pointerEvents={on ? 'auto' : 'none'}
      >
        {to}
      </Animated.View>
    </View>
  );
}

export type ToastState = { kind: 'hidden' } | { kind: 'busy'; text: string } | { kind: 'done'; text: string };

/**
 * Dynamic-Island-style toast: drops from the top as a small "busy" pill, then
 * widens into the confirmation.
 */
export function IslandToast({ state, top, t }: { state: ToastState; top: number; t: LabTheme }) {
  const shown = useSharedValue(0);
  const wide = useSharedValue(0);
  const spin = useSharedValue(0);

  useEffect(() => {
    shown.value = withSpring(state.kind === 'hidden' ? 0 : 1, t.spring);
    wide.value = withSpring(state.kind === 'done' ? 1 : 0, t.spring);
  }, [state.kind, shown, wide, t.spring]);

  useEffect(() => {
    spin.value = withRepeat(withTiming(360, { duration: 800, easing: Easing.linear }), -1);
  }, [spin]);

  const box = useAnimatedStyle(() => ({
    opacity: shown.value,
    minWidth: interpolate(wide.value, [0, 1], [150, 210]),
    transform: [
      { translateY: interpolate(shown.value, [0, 1], [-48, 0]) },
      { scale: interpolate(shown.value, [0, 1], [0.6, 1]) },
    ],
  }));
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));

  const ink = t.dark ? '#FFFFFF' : '#F5F5F2';
  return (
    <View style={[styles.toastWrap, { top }]} pointerEvents="none">
      <Animated.View
        style={[styles.toast, { backgroundColor: t.dark ? '#000' : '#1E1E1C' }, box]}
        accessibilityLiveRegion="polite"
      >
        {state.kind === 'done' ? (
          <Animated.View key="done" entering={enter(t)} style={styles.toastRow}>
            <View style={[styles.toastCheck, { backgroundColor: ink }]}>
              <LabIcon name="check" size={12} color="#000" weight={3} />
            </View>
            <Text style={[styles.toastText, { color: ink, fontFamily: t.font.body }]}>
              {state.text}
            </Text>
          </Animated.View>
        ) : (
          <View style={styles.toastRow}>
            <Animated.View style={spinStyle}>
              <Arc size={14} color={ink} />
            </Animated.View>
            <Text style={[styles.toastText, { color: ink, fontFamily: t.font.body }]}>
              {state.kind === 'busy' ? state.text : ''}
            </Text>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  roll: { flexDirection: 'row', overflow: 'hidden' },
  toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 50 },
  toast: {
    height: 38,
    borderRadius: 19,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toastCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastText: { fontSize: 14, fontWeight: '600' },
});
