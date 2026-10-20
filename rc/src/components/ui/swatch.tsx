import { StyleSheet, View } from 'react-native';

import { routeHex } from '@/lib/route-colors';
import { useThemeColors } from '@/theme';

/** A route color swatch. Always shown next to a text label (never color-only). */
export function Swatch({ color, size = 18 }: { color: string; size?: number }) {
  const c = useThemeColors();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        styles.swatch,
        {
          width: size,
          height: size,
          borderRadius: size / 4,
          backgroundColor: routeHex(color),
          borderColor: c.border,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  swatch: { borderWidth: StyleSheet.hairlineWidth },
});
