import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { enter } from './springs';

/**
 * Text whose characters roll in when they change. Only changed characters
 * re-mount, so "Move 3" → "Move 4" rolls a single digit.
 */
export function RollingText({ value, style }: { value: string; style?: StyleProp<TextStyle> }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={value}>
      {value.split('').map((ch, i) => (
        <Animated.Text key={`${i}-${ch}`} entering={enter()} style={style}>
          {ch}
        </Animated.Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', overflow: 'hidden' } });
