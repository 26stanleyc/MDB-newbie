import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Radius, Spacing, useThemeColors } from '@/theme';

type Props = {
  children: ReactNode;
  onPress?: () => void;
  selected?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
};

/** Sandstone surface card; pressable when onPress is provided. */
export function Card({ children, onPress, selected, style, accessibilityLabel }: Props) {
  const c = useThemeColors();
  const base: ViewStyle = {
    backgroundColor: selected ? c.surfaceSelected : c.surface,
    borderColor: selected ? c.accent : c.border,
    borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
  };

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ selected: !!selected }}
        style={({ pressed }) => [styles.card, base, pressed && styles.pressed, style]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, base, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  pressed: { opacity: 0.9 },
});
