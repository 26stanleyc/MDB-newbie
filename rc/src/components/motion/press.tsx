import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Springs } from './springs';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** How far the element squishes while held (1 = not at all). */
  scaleTo?: number;
  /** Light tap on press-in. Use for primary actions and toggles. */
  haptic?: boolean;
};

/**
 * Pressable that squishes while held and springs back on release, so every
 * tappable surface feels physical. Replaces opacity-only press states.
 */
export function Press({ style, children, scaleTo = 0.96, haptic, disabled, ...rest }: Props) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={disabled}
      {...rest}
      onPressIn={(e) => {
        s.set(withSpring(scaleTo, Springs.pressIn));
        if (haptic && Platform.OS !== 'web') Haptics.selectionAsync();
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        s.set(withSpring(1, Springs.release));
        rest.onPressOut?.(e);
      }}
      style={[style, a]}
    >
      {children}
    </AnimatedPressable>
  );
}
