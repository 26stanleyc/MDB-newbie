/**
 * Maps gym route color labels to vivid display hexes for swatches + overlays.
 * These are intentionally saturated (they're hold colors) and live OUTSIDE the
 * muted UI theme. Identity never relies on these alone — always paired with a
 * text label (design doc §4 accessibility).
 */
const ROUTE_HEX: Record<string, string> = {
  red: '#E23B2E',
  orange: '#F07D1A',
  yellow: '#F2C318',
  green: '#36B24A',
  teal: '#17A2A2',
  blue: '#2E7CE4',
  purple: '#8B46D4',
  pink: '#E8559E',
  black: '#1E1E1E',
  white: '#F2F2F2',
  brown: '#8A5A2B',
  grey: '#9AA0A6',
  gray: '#9AA0A6',
};

export function routeHex(color: string): string {
  return ROUTE_HEX[color.toLowerCase()] ?? '#9AA0A6';
}

/** Available colors offered in correction/recolor UI. */
export const ROUTE_COLOR_OPTIONS = [
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
  'black',
  'white',
] as const;
