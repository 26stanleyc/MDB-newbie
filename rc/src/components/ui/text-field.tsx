import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { Radius, Spacing, TextStyles, useThemeColors } from '@/theme';

import { Text } from './text';

type Props = TextInputProps & {
  label?: string;
  error?: string;
};

export function TextField({ label, error, style, ...rest }: Props) {
  const c = useThemeColors();
  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="label" tone="secondary" style={styles.label}>
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={c.textSecondary}
        style={[
          styles.input,
          TextStyles.body,
          {
            color: c.text,
            backgroundColor: c.surface,
            borderColor: error ? c.destructive : c.border,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text variant="caption" tone="destructive" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.xs },
  label: { marginLeft: Spacing.xs },
  input: {
    minHeight: 50,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: Spacing.md,
  },
  error: { marginLeft: Spacing.xs },
});
