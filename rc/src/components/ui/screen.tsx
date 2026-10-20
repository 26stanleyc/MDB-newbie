import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';

import { Spacing, useThemeColors } from '@/theme';

type Props = {
  children?: ReactNode;
  /** Add default horizontal/vertical padding. */
  padded?: boolean;
  edges?: readonly Edge[];
  style?: ViewStyle;
};

/** Themed, safe-area-aware screen container. */
export function Screen({
  children,
  padded = true,
  edges = ['top', 'left', 'right', 'bottom'],
  style,
}: Props) {
  const c = useThemeColors();
  return (
    <SafeAreaView
      edges={edges}
      style={[styles.root, { backgroundColor: c.background }]}
    >
      <View style={[styles.inner, padded && styles.padded, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  inner: { flex: 1 },
  padded: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
});
