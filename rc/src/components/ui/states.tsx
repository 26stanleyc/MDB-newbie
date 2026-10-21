import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { SymbolViewProps } from 'expo-symbols';

import { Spacing, useThemeColors } from '@/theme';

import { Button } from './button';
import { Icon } from './icon';
import { Text } from './text';

/** Centered spinner with an optional caption. */
export function Loading({ label }: { label?: string }) {
  const c = useThemeColors();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={c.accent} />
      {label ? (
        <Text tone="secondary" style={styles.caption}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

type MessageProps = {
  icon?: SymbolViewProps['name'];
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
};

/** Shared empty / error layout. */
export function MessageState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
}: MessageProps) {
  const c = useThemeColors();
  return (
    <View style={styles.center}>
      {icon ? <Icon name={icon} size={40} color={c.textSecondary} /> : null}
      <Text variant="heading" style={styles.title}>
        {title}
      </Text>
      {message ? (
        <Text tone="secondary" style={styles.caption}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} fullWidth={false} style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: Spacing.xl,
  },
  title: { textAlign: 'center' },
  caption: { textAlign: 'center' },
  action: { marginTop: Spacing.md },
});
