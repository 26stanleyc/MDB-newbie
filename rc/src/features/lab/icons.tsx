import Svg, { Circle, Path } from 'react-native-svg';

/**
 * Stroke icons drawn in SVG so the lab renders the same in Expo Go and on web
 * (SF Symbols don't render in the browser).
 */
export type LabIconName =
  | 'plus'
  | 'close'
  | 'back'
  | 'chevron'
  | 'down'
  | 'search'
  | 'scan'
  | 'flag'
  | 'pin'
  | 'path'
  | 'check'
  | 'qr';

const PATHS: Record<LabIconName, string> = {
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M15 5l-7 7 7 7',
  chevron: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM16.5 16.5L20 20',
  scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 12h8',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  pin: 'M12 21s-6-5.5-6-11a6 6 0 1 1 12 0c0 5.5-6 11-6 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  path: 'M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8.5 15.5l7-7',
  check: 'M5 12.5l4.5 4.5L19 7',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2z',
};

export function LabIcon({
  name,
  size = 20,
  color,
  weight = 2,
}: {
  name: LabIconName;
  size?: number;
  color: string;
  weight?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={PATHS[name]}
        stroke={color}
        strokeWidth={weight}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Indeterminate arc for the "Logging…" toast. Rotated by the caller. */
export function Arc({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeOpacity={0.25} strokeWidth={3} />
      <Path d="M12 3a9 9 0 0 1 9 9" stroke={color} strokeWidth={3} strokeLinecap="round" />
    </Svg>
  );
}
