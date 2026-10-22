import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Press } from '@/components/motion';

import { Radius, Spacing, useThemeColors } from '@/theme';

type Props = {
  children: ReactNode;
  onPress?: () => void;
  selected?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
};

/** Sandstone surface card; pressable (with a squish) when onPress is provided. */
export function Card({ children, onPress, selected, style, accessibilityLabel }: Props) {
  const c = useThemeColors();
  const base: ViewStyle = {
    backgroundColor: selected ? c.surfaceSelected : c.surface,
    borderColor: selected ? c.accent : c.border,
    borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
  };

  if (onPress) {
    return (
      <Press
        onPress={onPress}
        scaleTo={0.98}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ selected: !!selected }}
        style={[styles.card, base, style]}
      >
        {children}
      </Press>
    );
  }
  return <View style={[styles.card, base, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
});
