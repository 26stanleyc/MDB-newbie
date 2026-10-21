import { Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing, useThemeColors } from '@/theme';

import { Text } from './text';

type Option<T extends string> = { label: string; value: T };

type Props<T extends string> = {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
};

/** Simple segmented control (e.g. unit toggle, step/full path mode). */
export function Segmented<T extends string>({ options, value, onChange }: Props<T>) {
  const c = useThemeColors();
  return (
    <View style={[styles.track, { backgroundColor: c.surfaceSelected }]}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.segment,
              active && { backgroundColor: c.background },
            ]}
          >
            <Text variant="label" tone={active ? 'default' : 'secondary'}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    padding: Spacing.xs,
    gap: Spacing.xs,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
