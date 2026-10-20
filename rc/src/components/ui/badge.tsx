import { StyleSheet, View } from 'react-native';

import { Radius, Spacing, useThemeColors } from '@/theme';

import { Text } from './text';

/** Small pill, e.g. a community grade or vote count. */
export function Badge({ label, subtle = false }: { label: string; subtle?: boolean }) {
  const c = useThemeColors();
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: subtle ? c.surfaceSelected : c.accent },
      ]}
    >
      <Text variant="caption" color={subtle ? c.text : c.onAccent}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
});
