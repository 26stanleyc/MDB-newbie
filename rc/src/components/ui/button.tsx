import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type ViewStyle,
} from 'react-native';

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

/** Primary action button. ≥44pt tap target (MASTER.md / iOS). */
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

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        {
          backgroundColor: bg,
          borderColor: c.border,
          borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth * 2 : 0,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[TextStyles.label, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
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
});
