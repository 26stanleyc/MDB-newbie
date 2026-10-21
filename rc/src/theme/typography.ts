import { Platform } from 'react-native';

/** Type tokens — exported from MASTER.md. System SF on iOS, no font loading. */
export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
    serif: 'Iowan Old Style', // bundled on iOS; warm book serif for display headings
  },
  default: {
    sans: 'normal',
    rounded: 'normal',
    mono: 'monospace',
    serif: 'serif',
  },
});

export const TextStyles = {
  title: { fontSize: 32, fontWeight: '700' },
  heading: { fontSize: 22, fontWeight: '600' },
  body: { fontSize: 16, fontWeight: '400' },
  label: { fontSize: 15, fontWeight: '600' },
  caption: { fontSize: 13, fontWeight: '500' },
} as const;
