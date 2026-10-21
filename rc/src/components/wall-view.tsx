import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Circle, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import type { Hold, PathStep, Point } from '@/api';
import { routeHex } from '@/lib/route-colors';

type Props = {
  uri: string;
  holds: Hold[];
  /** When set, these holds are highlighted and others are dimmed. */
  selectedHoldIds?: Set<string>;
  /** Holds the climber turned off: drawn as a faint dashed outline. */
  offHoldIds?: Set<string>;
  /** Numbered hand/foot markers (path view). */
  steps?: PathStep[];
  onHoldPress?: (holdId: string) => void;
  style?: ViewStyle;
};

function centroid(poly: Point[]): Point {
  const n = poly.length || 1;
  return {
    x: poly.reduce((s, p) => s + p.x, 0) / n,
    y: poly.reduce((s, p) => s + p.y, 0) / n,
  };
}

/** Ray-casting point-in-polygon, in normalized image coordinates. */
function contains(poly: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function area(poly: Point[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return Math.abs(s / 2);
}

const TAP_SLOP_PX = 14; // a tap this close to a small hold still counts

function toPoints(poly: Point[], w: number, h: number): string {
  return poly.map((p) => `${p.x * w},${p.y * h}`).join(' ');
}

/**
 * Wall photo with hold/route overlays that stay pixel-aligned at every zoom
 * level: the image and the SVG live in a single transformed container, so one
 * pinch/pan transform moves both together (design doc M3).
 */
export function WallView({
  uri,
  holds,
  selectedHoldIds,
  offHoldIds,
  steps,
  onHoldPress,
  style,
}: Props) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [aspect, setAspect] = useState(0.75); // w/h, updated on image load

  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      'worklet';
      const next = savedScale.value * e.scale;
      scale.value = next < 1 ? 1 : next > 5 ? 5 : next;
    })
    .onEnd(() => {
      'worklet';
      savedScale.value = scale.value;
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      'worklet';
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
    })
    .onEnd(() => {
      'worklet';
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      'worklet';
      scale.value = 1;
      tx.value = 0;
      ty.value = 0;
      savedScale.value = 1;
      savedTx.value = 0;
      savedTy.value = 0;
    });

  // Fit the image inside the measured box ("contain").
  let dispW = 0;
  let dispH = 0;
  if (box.w && box.h) {
    dispW = Math.min(box.w, box.h * aspect);
    dispH = dispW / aspect;
  }

  // Hold taps go through the gesture handler: on iOS it claims touches before
  // react-native-svg's own onPress ever sees them. x/y are in the container's
  // own (unzoomed) coordinates; the image is centered inside it.
  const hitTest = (x: number, y: number) => {
    if (!onHoldPress || dispW === 0) return;
    const p = { x: (x - (box.w - dispW) / 2) / dispW, y: (y - (box.h - dispH) / 2) / dispH };
    const hits = holds.filter((h) => contains(h.polygon, p));
    if (hits.length) {
      // Overlapping outlines: the smallest one is the hold the climber meant.
      onHoldPress(hits.reduce((a, b) => (area(b.polygon) < area(a.polygon) ? b : a)).id);
      return;
    }
    let best: { id: string; d: number } | null = null;
    for (const h of holds) {
      const c = centroid(h.polygon);
      const d = Math.hypot((c.x - p.x) * dispW, (c.y - p.y) * dispH);
      if (d < TAP_SLOP_PX && (!best || d < best.d)) best = { id: h.id, d };
    }
    if (best) onHoldPress(best.id);
  };

  const singleTap = Gesture.Tap()
    .enabled(!!onHoldPress)
    .onEnd((e, success) => {
      'worklet';
      if (success) runOnJS(hitTest)(e.x, e.y);
    });

  const composed = Gesture.Simultaneous(pinch, Gesture.Exclusive(doubleTap, singleTap, pan));

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const dimming = !!selectedHoldIds;

  return (
    <View
      style={[styles.root, style]}
      onLayout={(e) =>
        setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
      }
    >
      <GestureDetector gesture={composed}>
        <Animated.View style={[styles.center, { width: box.w, height: box.h }, animStyle]}>
          {dispW > 0 ? (
            <View style={{ width: dispW, height: dispH }}>
              <Image
                source={{ uri }}
                style={{ width: dispW, height: dispH }}
                contentFit="contain"
                accessibilityLabel={`Wall photo with ${holds.length} detected holds. Pinch to zoom, double-tap to reset.`}
                onLoad={(e) => {
                  const s = e.source;
                  if (s?.width && s?.height) setAspect(s.width / s.height);
                }}
              />
              <Svg style={StyleSheet.absoluteFill} width={dispW} height={dispH}>
                {holds.map((h) => {
                  const selected = !dimming || selectedHoldIds!.has(h.id);
                  const color = routeHex(h.color);
                  const pts = toPoints(h.polygon, dispW, dispH);
                  if (offHoldIds?.has(h.id)) {
                    return (
                      <Polygon
                        key={h.id}
                        points={pts}
                        fill="#000000"
                        fillOpacity={0.01} // nearly invisible, but still tappable to turn back on
                        stroke="#FFFFFF"
                        strokeOpacity={0.6}
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                      />
                    );
                  }
                  return (
                    <Polygon
                      key={h.id}
                      points={pts}
                      fill={color}
                      fillOpacity={selected ? 0.18 : 0.04}
                      stroke={selected ? '#FFFFFF' : color}
                      strokeOpacity={selected ? 0.95 : 0.25}
                      strokeWidth={selected ? 3 : 1.5}
                    />
                  );
                })}
                {/* Color stroke on top of the white halo for selected holds. */}
                {holds.map((h) => {
                  const selected = !dimming || selectedHoldIds!.has(h.id);
                  if (!selected || offHoldIds?.has(h.id)) return null;
                  return (
                    <Polygon
                      key={`${h.id}-c`}
                      points={toPoints(h.polygon, dispW, dispH)}
                      fill="none"
                      stroke={routeHex(h.color)}
                      strokeWidth={1.5}
                    />
                  );
                })}
                {steps?.map((step) => {
                  const hold = holds.find((h) => h.id === step.holdId);
                  if (!hold) return null;
                  const ctr = centroid(hold.polygon);
                  const cx = ctr.x * dispW;
                  const cy = ctr.y * dispH;
                  const isHand = step.limb === 'LH' || step.limb === 'RH';
                  const r = 15;
                  return (
                    <StepMarker
                      key={`s-${step.order}`}
                      cx={cx}
                      cy={cy}
                      r={r}
                      isHand={isHand}
                      label={`${step.limb} ${step.order}`}
                    />
                  );
                })}
              </Svg>
            </View>
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/** Hand = circle, foot = square — distinguishable without color (§4). */
function StepMarker({
  cx,
  cy,
  r,
  isHand,
  label,
}: {
  cx: number;
  cy: number;
  r: number;
  isHand: boolean;
  label: string;
}) {
  return (
    <>
      {isHand ? (
        <Circle cx={cx} cy={cy} r={r} fill="#1A1815" stroke="#FFFFFF" strokeWidth={2} />
      ) : (
        <Rect
          x={cx - r}
          y={cy - r}
          width={r * 2}
          height={r * 2}
          rx={3}
          fill="#1A1815"
          stroke="#FFFFFF"
          strokeWidth={2}
        />
      )}
      <SvgText
        x={cx}
        y={cy + 4}
        fill="#FFFFFF"
        fontSize={11}
        fontWeight="bold"
        textAnchor="middle"
      >
        {label}
      </SvgText>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
