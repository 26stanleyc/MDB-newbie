import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, type ViewStyle } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Press, Springs } from '@/components/motion';
import { Radius, Spacing, TextStyles, useThemeColors } from '@/theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';

type Props = {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
};

/**
 * Primary action button. ≥44pt tap target (MASTER.md / iOS). Squishes on
 * press; the label morphs into a spinner while loading instead of swapping.
 */
export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = true,
  style,
}: Props) {
  const c = useThemeColors();
  const isDisabled = disabled || loading;

  const bg =
    variant === 'primary'
      ? c.accent
      : variant === 'destructive'
        ? c.destructive
        : 'transparent';
  const fg =
    variant === 'primary' || variant === 'destructive'
      ? c.onAccent
      : variant === 'secondary'
        ? c.text
        : c.accent;

  const busy = useSharedValue(loading ? 1 : 0);
  const off = useSharedValue(disabled ? 1 : 0);
  useEffect(() => {
    busy.value = withSpring(loading ? 1 : 0, Springs.settle);
    off.value = withSpring(disabled ? 1 : 0, Springs.settle);
  }, [loading, disabled, busy, off]);

  const labelStyle = useAnimatedStyle(() => ({
    opacity: 1 - busy.value,
    transform: [{ scale: interpolate(busy.value, [0, 1], [1, 0.8]) }],
  }));
  const spinnerStyle = useAnimatedStyle(() => ({
    opacity: busy.value,
    transform: [{ scale: interpolate(busy.value, [0, 1], [0.6, 1]) }],
  }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: interpolate(off.value, [0, 1], [1, 0.45]) }));

  return (
    <Press
      onPress={onPress}
      disabled={isDisabled}
      haptic={variant === 'primary'}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={title}
      style={[
        styles.base,
        fullWidth && styles.fullWidth,
        {
          backgroundColor: bg,
          borderColor: c.border,
          borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth * 2 : 0,
        },
        style,
      ]}
    >
      <Animated.View style={dimStyle}>
        <Animated.View style={labelStyle}>
          <Text style={[TextStyles.label, { color: fg }]}>{title}</Text>
        </Animated.View>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.center, spinnerStyle]} pointerEvents="none">
        <ActivityIndicator color={fg} />
      </Animated.View>
    </Press>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  fullWidth: { alignSelf: 'stretch' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
