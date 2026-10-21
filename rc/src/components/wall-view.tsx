import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Circle, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import type { Hold, PathStep, Point } from '@/api';
import { routeHex } from '@/lib/route-colors';

type Props = {
  uri: string;
  holds: Hold[];
  /** When set, these holds are highlighted and others are dimmed. */
  selectedHoldIds?: Set<string>;
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

function toPoints(poly: Point[], w: number, h: number): string {
  return poly.map((p) => `${p.x * w},${p.y * h}`).join(' ');
}

/**
 * Wall photo with hold/route overlays that stay pixel-aligned at every zoom
 * level: the image and the SVG live in a single transformed container, so one
 * pinch/pan transform moves both together (design doc M3).
 */
export function WallView({ uri, holds, selectedHoldIds, steps, onHoldPress, style }: Props) {
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

  const composed = Gesture.Simultaneous(pinch, Gesture.Exclusive(doubleTap, pan));

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  // Fit the image inside the measured box ("contain").
  let dispW = 0;
  let dispH = 0;
  if (box.w && box.h) {
    dispW = Math.min(box.w, box.h * aspect);
    dispH = dispW / aspect;
  }

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
                  return (
                    <Polygon
                      key={h.id}
                      points={pts}
                      fill={color}
                      fillOpacity={selected ? 0.18 : 0.04}
                      stroke={selected ? '#FFFFFF' : color}
                      strokeOpacity={selected ? 0.95 : 0.25}
                      strokeWidth={selected ? 3 : 1.5}
                      onPress={onHoldPress ? () => onHoldPress(h.id) : undefined}
                    />
                  );
                })}
                {/* Color stroke on top of the white halo for selected holds. */}
                {holds.map((h) => {
                  const selected = !dimming || selectedHoldIds!.has(h.id);
                  if (!selected) return null;
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
