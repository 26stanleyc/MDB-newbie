import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Press, Springs } from '@/components/motion';
import { Radius, Spacing, useThemeColors } from '@/theme';

import { Text } from './text';

type Option<T extends string> = { label: string; value: T };

type Props<T extends string> = {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
};

/**
 * Segmented control (e.g. unit toggle, step/full path mode). One thumb slides
 * between segments instead of each segment repainting.
 */
export function Segmented<T extends string>({ options, value, onChange }: Props<T>) {
  const c = useThemeColors();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const segW = width > 0 ? (width - PAD * 2 - GAP * (options.length - 1)) / options.length : 0;

  const x = useSharedValue(0);
  const placed = useRef(false);
  useEffect(() => {
    if (segW <= 0) return;
    const target = index * (segW + GAP);
    // Snap on first layout, spring afterwards.
    x.value = placed.current ? withSpring(target, Springs.settle) : target;
    placed.current = true;
  }, [index, segW, x]);

  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View
      style={[styles.track, { backgroundColor: c.surfaceSelected }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {segW > 0 ? (
        <Animated.View
          style={[styles.thumb, { width: segW, backgroundColor: c.background }, thumb]}
        />
      ) : null}
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Press
            key={opt.value}
            onPress={() => onChange(opt.value)}
            haptic
            scaleTo={0.97}
            accessibilityState={{ selected: active }}
            style={styles.segment}
          >
            <Text variant="label" tone={active ? 'default' : 'secondary'}>
              {opt.label}
            </Text>
          </Press>
        );
      })}
    </View>
  );
}

const PAD = Spacing.xs;
const GAP = Spacing.xs;

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    padding: PAD,
    gap: GAP,
  },
  thumb: {
    position: 'absolute',
    top: PAD,
    bottom: PAD,
    left: PAD,
    borderRadius: Radius.sm,
    shadowColor: '#2A2723',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
