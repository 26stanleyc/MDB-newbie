/**
 * Color tokens — exported from design-system/capitan/MASTER.md.
 *
 * Earthy / muted chrome so route overlays (arbitrary saturated hold colors) pop.
 * The accent (moss) is intentionally desaturated so it never reads as a route.
 */
export const Colors = {
  light: {
    background: '#F5F1E8', // chalk
    surface: '#EAE3D5', // sandstone
    surfaceSelected: '#DED5C4',
    text: '#2A2723', // granite
    textSecondary: '#5A544A', // granite grey (≥4.5:1 on background)
    border: '#D8CFBE',
    accent: '#55694A', // moss
    accentPressed: '#3E4F36', // forest
    onAccent: '#F5F1E8',
    destructive: '#A8492F',
    warning: '#B07C2A',
  },
  dark: {
    background: '#1A1815', // soil
    surface: '#26231E',
    surfaceSelected: '#322E27',
    text: '#F0EBE0',
    textSecondary: '#A69E90',
    border: '#3A362E',
    accent: '#8AA173',
    accentPressed: '#6E855A',
    onAccent: '#14140F',
    destructive: '#C75B40',
    warning: '#C79A45',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
