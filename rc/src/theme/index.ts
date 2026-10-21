/**
 * Canonical theme, exported from design-system/capitan/MASTER.md.
 * Import from '@/theme' everywhere; use useThemeColors() for scheme-aware colors.
 */
import { useColorScheme } from 'react-native';

import { Colors } from './colors';

export { Colors, type ThemeColor } from './colors';
export { Spacing, Radius } from './spacing';
export { Fonts, TextStyles } from './typography';

/** Returns the active color set for the current light/dark scheme. */
export function useThemeColors() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return Colors[scheme];
}
