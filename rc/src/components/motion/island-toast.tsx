import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { useToast } from '@/store/use-toast';
import { TextStyles, useThemeColors } from '@/theme';

import { enter, Springs } from './springs';

/**
 * Dynamic-Island-style status pill. Drops in as a small "busy" pill, then
 * widens into the confirmation. Mounted once in the root layout; screens drive
 * it through `useToast`.
 */
export function IslandToast() {
  const state = useToast((s) => s.state);
  const insets = useSafeAreaInsets();
  const c = useThemeColors();
  const shown = useSharedValue(0);
  const wide = useSharedValue(0);

  useEffect(() => {
    shown.value = withSpring(state.kind === 'hidden' ? 0 : 1, Springs.settle);
    wide.value = withSpring(state.kind === 'done' ? 1 : 0, Springs.settle);
  }, [state.kind, shown, wide]);

  const box = useAnimatedStyle(() => ({
    opacity: shown.value,
    minWidth: interpolate(wide.value, [0, 1], [140, 200]),
    transform: [
      { translateY: interpolate(shown.value, [0, 1], [-50, 0]) },
      { scale: interpolate(shown.value, [0, 1], [0.6, 1]) },
    ],
  }));

  // Granite pill in both schemes; text is chalk.
  const ink = '#F5F1E8';
  return (
    <View style={[styles.wrap, { top: insets.top + 6 }]} pointerEvents="none">
      <Animated.View
        style={[styles.pill, { backgroundColor: '#1F1C18', borderColor: c.border }, box]}
        accessibilityLiveRegion="polite"
      >
        {state.kind === 'done' ? (
          <Animated.View key={state.text} entering={enter()} style={styles.row}>
            <View style={[styles.check, { backgroundColor: c.accent }]}>
              <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
                <Path d="M5 12.5l4.5 4.5L19 7" stroke={ink} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
            <Text style={[TextStyles.label, styles.text, { color: ink }]}>{state.text}</Text>
          </Animated.View>
        ) : (
          <View style={styles.row}>
            <ActivityIndicator size="small" color={ink} />
            <Text style={[TextStyles.label, styles.text, { color: ink }]}>
              {state.kind === 'busy' ? state.text : ''}
            </Text>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 100 },
  pill: {
    height: 38,
    borderRadius: 19,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  check: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 14 },
});
