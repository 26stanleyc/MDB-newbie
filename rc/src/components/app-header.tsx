import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Press } from '@/components/motion';
import { Icon, Text } from '@/components/ui';
import { Spacing } from '@/theme';

type Props = {
  title?: string;
  /** Hide the back chevron (e.g. roots). */
  hideBack?: boolean;
  /** Optional right-aligned element (e.g. a text action). */
  right?: React.ReactNode;
};

/** Lightweight themed header with an iOS-style back control. */
export function AppHeader({ title, hideBack, right }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.side}>
        {!hideBack && router.canGoBack() ? (
          <Press
            onPress={() => router.back()}
            accessibilityLabel="Go back"
            hitSlop={12}
            scaleTo={0.85}
            style={styles.back}
          >
            <Icon name="chevron.left" size={20} />
          </Press>
        ) : null}
      </View>
      <Text variant="label" numberOfLines={1} style={styles.title}>
        {title ?? ''}
      </Text>
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    marginBottom: Spacing.sm,
  },
  side: { width: 64, justifyContent: 'center' },
  right: { alignItems: 'flex-end' },
  back: { width: 44, height: 44, justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center' },
});
