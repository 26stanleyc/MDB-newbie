import { StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/** Faint topographic contour lines behind the content (decorative). */
export function Contours({ color }: { color: string }) {
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 390 800"
    >
      <Path
        d="M-20 120 C 90 90 150 160 250 130 S 430 150 430 150"
        stroke={color}
        strokeOpacity={0.14}
        strokeWidth={1.3}
        fill="none"
      />
      <Path
        d="M-20 210 C 100 180 170 250 270 215 S 430 230 430 230"
        stroke={color}
        strokeOpacity={0.14}
        strokeWidth={1.3}
        fill="none"
      />
      <Path
        d="M-20 330 C 80 300 160 360 260 325 S 430 340 430 340"
        stroke={color}
        strokeOpacity={0.12}
        strokeWidth={1.3}
        fill="none"
      />
      <Path
        d="M-20 470 C 110 440 180 510 280 475 S 430 490 430 490"
        stroke={color}
        strokeOpacity={0.1}
        strokeWidth={1.3}
        fill="none"
      />
      <Path
        d="M-20 620 C 90 590 160 660 265 625 S 430 640 430 640"
        stroke={color}
        strokeOpacity={0.08}
        strokeWidth={1.3}
        fill="none"
      />
    </Svg>
  );
}
