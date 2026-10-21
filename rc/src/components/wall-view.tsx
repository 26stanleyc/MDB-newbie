import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { G, Polygon, Polyline, Rect, Text as SvgText } from 'react-native-svg';

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
  /** Step order to highlight (the current step when stepping through). */
  activeOrder?: number;
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
const MAX_ZOOM = 6;
const DOUBLE_TAP_ZOOM = 2.5;
const TAP_MAX_MOVE_PX = 10; // a finger that travels farther is dragging, not tapping

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
  activeOrder,
  onHoldPress,
  style,
}: Props) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [aspect, setAspect] = useState(0.75); // w/h, updated on image load
  const [loaded, setLoaded] = useState(false); // outlines wait for the real aspect

  // Fit the image inside the measured box ("contain").
  let dispW = 0;
  let dispH = 0;
  if (box.w && box.h) {
    dispW = Math.min(box.w, box.h * aspect);
    dispH = dispW / aspect;
  }

  // Zoom/pan: one transform (translate, then scale about the box center) moves the
  // photo and the overlays together. Pinch zooms about the fingers, panning stops
  // at the photo's edges, and the photo never shrinks below fit.
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  // Each gesture keeps its own starting point: sharing one let a pan that began
  // mid-pinch overwrite the pinch's focal point (the photo jumped sideways).
  const pinchBase = useSharedValue({ s: 1, k: 1, x: 0, y: 0, fx: 0, fy: 0, n: 0 });
  const panBase = useSharedValue({ x: 0, y: 0 });
  const pinching = useSharedValue(false);
  const panRebase = useSharedValue(false);
  const tapDown = useSharedValue({ x: 0, y: 0 });
  // Settled zoom, so outlines and markers keep their on-screen size (they'd grow
  // with the transform otherwise). Updated when a gesture ends.
  const [zoom, setZoom] = useState(1);
  const bw = box.w;
  const bh = box.h;

  const clampT = (t: number, s: number, content: number, view: number) => {
    'worklet';
    const max = Math.max(0, (content * s - view) / 2);
    return Math.min(max, Math.max(-max, t));
  };

  // Pinch zooms about the fingers. Whenever the finger count changes (a finger
  // lifts or lands) the focal point jumps, so the pinch re-bases on the photo as it
  // is now instead of jumping with it.
  const rebasePinch = (e: { scale: number; focalX: number; focalY: number; numberOfPointers: number }) => {
    'worklet';
    pinchBase.value = {
      s: scale.value,
      k: e.scale,
      x: tx.value,
      y: ty.value,
      fx: e.focalX - bw / 2,
      fy: e.focalY - bh / 2,
      n: e.numberOfPointers,
    };
  };

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      'worklet';
      pinching.value = true;
      rebasePinch(e);
    })
    .onUpdate((e) => {
      'worklet';
      if (e.numberOfPointers < 2) return; // one finger left: hold still until it lifts
      if (e.numberOfPointers !== pinchBase.value.n) rebasePinch(e);
      const b = pinchBase.value;
      const s = Math.min(MAX_ZOOM, Math.max(1, (b.s * e.scale) / b.k));
      // keep the photo point that was under the fingers under them as they pinch and move
      const fx = e.focalX - bw / 2;
      const fy = e.focalY - bh / 2;
      scale.value = s;
      tx.value = clampT(fx - (b.fx - b.x) * (s / b.s), s, dispW, bw);
      ty.value = clampT(fy - (b.fy - b.y) * (s / b.s), s, dispH, bh);
    })
    .onFinalize(() => {
      'worklet';
      pinching.value = false;
      panRebase.value = true; // a finger still down keeps panning from here, no jump
      runOnJS(setZoom)(scale.value);
    });

  // One-finger drag. iOS keeps a pan running when a second finger lands, so it
  // stands still while a pinch is on (otherwise both move the photo and fight).
  const pan = Gesture.Pan()
    .maxPointers(1) // two fingers belong to the pinch
    .minDistance(8) // shorter moves are taps
    .onStart((e) => {
      'worklet';
      // from the photo where it is, minus the slop already moved: no start jump
      panBase.value = { x: tx.value - e.translationX, y: ty.value - e.translationY };
      panRebase.value = false;
    })
    .onUpdate((e) => {
      'worklet';
      if (pinching.value) return;
      if (panRebase.value) {
        panBase.value = { x: tx.value - e.translationX, y: ty.value - e.translationY };
        panRebase.value = false;
      }
      tx.value = clampT(panBase.value.x + e.translationX, scale.value, dispW, bw);
      ty.value = clampT(panBase.value.y + e.translationY, scale.value, dispH, bh);
    });

  // Double-tap: zoom into the tapped spot, or back out to the whole photo.
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      'worklet';
      const s = scale.value > 1.05 ? 1 : DOUBLE_TAP_ZOOM;
      const fx = e.x - bw / 2;
      const fy = e.y - bh / 2;
      // the tapped point (in zoomed space) stays put while zooming
      const nx = clampT(fx - (fx - tx.value) * (s / scale.value), s, dispW, bw);
      const ny = clampT(fy - (fy - ty.value) * (s / scale.value), s, dispH, bh);
      scale.value = withTiming(s, { duration: 220 });
      tx.value = withTiming(nx, { duration: 220 });
      ty.value = withTiming(ny, { duration: 220 });
      runOnJS(setZoom)(s);
    });

  // Hold taps go through the gesture handler: on iOS it claims touches before
  // react-native-svg's own onPress ever sees them. x/y are in the (untransformed)
  // frame; undo the zoom/pan to get photo coordinates.
  const hitTest = (x: number, y: number, s: number, offX: number, offY: number) => {
    if (!onHoldPress || dispW === 0) return;
    const cx = bw / 2 + (x - bw / 2 - offX) / s;
    const cy = bh / 2 + (y - bh / 2 - offY) / s;
    const p = { x: (cx - (bw - dispW) / 2) / dispW, y: (cy - (bh - dispH) / 2) / dispH };
    const hits = holds.filter((h) => contains(h.polygon, p));
    if (hits.length) {
      // Overlapping outlines: the smallest one is the hold the climber meant.
      onHoldPress(hits.reduce((a, b) => (area(b.polygon) < area(a.polygon) ? b : a)).id);
      return;
    }
    let best: { id: string; d: number } | null = null;
    for (const h of holds) {
      const c = centroid(h.polygon);
      const d = Math.hypot((c.x - p.x) * dispW, (c.y - p.y) * dispH) * s; // on-screen px
      if (d < TAP_SLOP_PX && (!best || d < best.d)) best = { id: h.id, d };
    }
    if (best) onHoldPress(best.id);
  };

  // A drag is never a tap. Tap's own default has no distance limit (a quick drag
  // still "taps"), and its maxDistance / requireExternalGestureToFail options
  // stop taps from firing at all on web — so measure the finger's travel here.
  const singleTap = Gesture.Tap()
    .enabled(!!onHoldPress)
    .onBegin((e) => {
      'worklet';
      tapDown.value = { x: e.x, y: e.y };
    })
    .onEnd((e, success) => {
      'worklet';
      const moved = Math.hypot(e.x - tapDown.value.x, e.y - tapDown.value.y);
      if (success && moved < TAP_MAX_MOVE_PX) {
        runOnJS(hitTest)(e.x, e.y, scale.value, tx.value, ty.value);
      }
    });

  // Pan runs alongside the taps (a moved finger fails the tap anyway), so dragging
  // starts at once instead of waiting for the double-tap to time out.
  const composed = Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap));

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const dimming = !!selectedHoldIds;
  const k = 1 / zoom; // overlay sizes in photo space that stay constant on screen

  return (
    // Gestures attach to the untransformed frame, so touch coordinates are screen
    // coordinates; only the inner view is zoomed.
    <GestureDetector gesture={composed}>
      <View
        style={[styles.root, style]}
        onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        <Animated.View style={[styles.center, { width: box.w, height: box.h }, animStyle]}>
          {dispW > 0 ? (
            <View style={{ width: dispW, height: dispH }}>
              <Image
                source={{ uri }}
                style={{ width: dispW, height: dispH }}
                contentFit="contain"
                allowDownscaling={false} // full resolution, so zooming in stays sharp
                accessibilityLabel={`Wall photo with ${holds.length} detected holds. Pinch to zoom, double-tap to reset.`}
                onLoad={(e) => {
                  const s = e.source;
                  if (s?.width && s?.height) setAspect(s.width / s.height);
                  setLoaded(true);
                }}
              />
              {loaded ? (
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
                          strokeWidth={1.5 * k}
                          strokeDasharray={`${4 * k} ${4 * k}`}
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
                        strokeWidth={(selected ? 3 : 1.5) * k}
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
                        strokeWidth={1.5 * k}
                      />
                    );
                  })}
                  {steps?.length ? (
                    <StepMarkers
                      steps={steps}
                      holds={holds}
                      w={dispW}
                      h={dispH}
                      activeOrder={activeOrder}
                      k={k}
                    />
                  ) : null}
                </Svg>
              ) : null}
            </View>
          ) : null}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const MARK = 7; // marker radius (px): small enough to leave the hold visible
const FONT = 8;
const INK = '#1A1815';

/**
 * Path markers, one per hold and limb type: hands are round, feet square, each
 * labeled with side + step (R1, L2 …) so nothing depends on color (§4). Markers sit
 * just right of their hold, like map labels, so the hold itself stays visible.
 * Several moves on one hold share a pill ("R1 L2"); a foot on a hand's hold sits
 * below the hand's. A thin dashed line links the hand moves in order.
 */
function StepMarkers({
  steps,
  holds,
  w,
  h,
  activeOrder,
  k,
}: {
  steps: PathStep[];
  holds: Hold[];
  w: number;
  h: number;
  activeOrder?: number;
  /** 1 / zoom: keeps marker sizes constant on screen */
  k: number;
}) {
  const m = MARK * k;
  const f = FONT * k;
  const center = new Map(
    holds.map((hold) => {
      const c = centroid(hold.polygon);
      return [hold.id, { x: c.x * w, y: c.y * h }];
    }),
  );
  const rightEdge = new Map(
    holds.map((hold) => [hold.id, Math.max(...hold.polygon.map((p) => p.x)) * w]),
  );
  const isHand = (s: PathStep) => s.limb === 'LH' || s.limb === 'RH';
  const groups = new Map<string, { holdId: string; hand: boolean; steps: PathStep[] }>();
  for (const s of steps) {
    if (!center.has(s.holdId)) continue;
    const key = `${s.holdId}:${isHand(s) ? 'h' : 'f'}`;
    const g = groups.get(key) ?? { holdId: s.holdId, hand: isHand(s), steps: [] };
    g.steps.push(s);
    groups.set(key, g);
  }
  const handLine = steps
    .filter(isHand)
    .map((s) => center.get(s.holdId))
    .filter((p): p is { x: number; y: number } => !!p)
    .map((p) => `${p.x},${p.y}`)
    .join(' ');

  return (
    <G>
      {/* dark halo under the dashes, so the line reads on light and dark walls */}
      <Polyline
        points={handLine}
        fill="none"
        stroke={INK}
        strokeOpacity={0.5}
        strokeWidth={3.5 * k}
      />
      <Polyline
        points={handLine}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={1.5 * k}
        strokeDasharray={`${3 * k} ${3 * k}`}
      />
      {[...groups.values()].map((g) => {
        const c = center.get(g.holdId)!;
        const sharesHold = !g.hand && groups.has(`${g.holdId}:h`);
        const label = g.steps.map((s) => `${s.limb[0]}${s.order}`).join(' ');
        const active = g.steps.some((s) => s.order === activeOrder);
        const width = Math.max(m * 2, label.length * f * 0.62 + 6 * k);
        const x = rightEdge.get(g.holdId)! + 3 * k;
        const cy = sharesHold ? c.y + m * 2 + k : c.y;
        return (
          <G key={`${g.holdId}-${g.hand ? 'h' : 'f'}`}>
            <Rect
              x={x}
              y={cy - m}
              width={width}
              height={m * 2}
              rx={g.hand ? m : 2.5 * k}
              fill={active ? '#FFFFFF' : INK}
              fillOpacity={active ? 1 : 0.88}
              stroke={active ? INK : '#FFFFFF'}
              strokeWidth={1.25 * k}
            />
            <SvgText
              x={x + width / 2}
              y={cy + f * 0.36}
              fill={active ? INK : '#FFFFFF'}
              fontSize={f}
              fontWeight="700"
              textAnchor="middle"
            >
              {label}
            </SvgText>
          </G>
        );
      })}
    </G>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
