import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import Svg, { Polygon, Rect } from 'react-native-svg';

import { AppHeader } from '@/components/app-header';
import { Button, Icon, Loading, MessageState, Screen, Swatch, Text } from '@/components/ui';
import { api, type Hold, type HoldCorrection, type Point } from '@/api';
import { ROUTE_COLOR_OPTIONS, routeHex } from '@/lib/route-colors';
import { useAsyncData } from '@/lib/use-async-data';
import { Radius, Spacing, useThemeColors } from '@/theme';

type Action =
  | { kind: 'recolor'; holdId: string; newColor: string }
  | { kind: 'delete'; holdId: string }
  | { kind: 'add'; id: string; box: { topLeft: Point; bottomRight: Point }; color: string };

function polygonFromBox(b: { topLeft: Point; bottomRight: Point }): Point[] {
  return [
    b.topLeft,
    { x: b.bottomRight.x, y: b.topLeft.y },
    b.bottomRight,
    { x: b.topLeft.x, y: b.bottomRight.y },
  ];
}

/** Apply the local edit history to the fetched holds for immediate display. */
function applyHistory(base: Hold[], history: Action[]): Hold[] {
  let holds = base.map((h) => ({ ...h }));
  for (const a of history) {
    if (a.kind === 'recolor') {
      holds = holds.map((h) => (h.id === a.holdId ? { ...h, color: a.newColor } : h));
    } else if (a.kind === 'delete') {
      holds = holds.filter((h) => h.id !== a.holdId);
    } else {
      holds.push({ id: a.id, polygon: polygonFromBox(a.box), color: a.color, confidence: 1 });
    }
  }
  return holds;
}

function points(poly: Point[], w: number, h: number): string {
  return poly.map((p) => `${p.x * w},${p.y * h}`).join(' ');
}

export default function CorrectScreen() {
  const { scanId, placeName } = useLocalSearchParams<{ scanId: string; placeName: string }>();
  const c = useThemeColors();
  const { data: scan, error, reload } = useAsyncData(
    useCallback(() => api.getScan(scanId), [scanId]),
    [scanId],
  );

  const [history, setHistory] = useState<Action[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'select' | 'add'>('select');
  const [addColor, setAddColor] = useState<string>('blue');
  const [submitting, setSubmitting] = useState(false);

  // Canvas sizing + live draw box (pixels within the image rect).
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [aspect, setAspect] = useState(0.75);
  const [draw, setDraw] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  let dispW = 0;
  let dispH = 0;
  if (box.w && box.h) {
    dispW = Math.min(box.w, box.h * aspect);
    dispH = dispW / aspect;
  }

  const endDraw = () => {
    setDraw((d) => {
      if (d && d.w > 12 && d.h > 12 && dispW > 0) {
        const topLeft = { x: d.x / dispW, y: d.y / dispH };
        const bottomRight = { x: (d.x + d.w) / dispW, y: (d.y + d.h) / dispH };
        const id = `add-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        setHistory((h) => [...h, { kind: 'add', id, box: { topLeft, bottomRight }, color: addColor }]);
      }
      return null;
    });
  };

  const drawPan = Gesture.Pan()
    .enabled(mode === 'add')
    .onBegin((e) => {
      'worklet';
      startX.value = e.x;
      startY.value = e.y;
      runOnJS(setDraw)({ x: e.x, y: e.y, w: 0, h: 0 });
    })
    .onUpdate((e) => {
      'worklet';
      const x = Math.min(startX.value, e.x);
      const y = Math.min(startY.value, e.y);
      runOnJS(setDraw)({
        x,
        y,
        w: Math.abs(e.x - startX.value),
        h: Math.abs(e.y - startY.value),
      });
    })
    .onEnd(() => {
      'worklet';
      runOnJS(endDraw)();
    });

  if (error) {
    return (
      <Screen>
        <AppHeader title="Fix detection" />
        <MessageState icon="wifi.slash" title="Couldn’t load scan" actionLabel="Retry" onAction={reload} />
      </Screen>
    );
  }
  if (!scan) {
    return (
      <Screen>
        <AppHeader title="Fix detection" />
        <Loading label="Loading…" />
      </Screen>
    );
  }

  const holds = applyHistory(scan.holds, history);
  const selected = holds.find((h) => h.id === selectedId) ?? null;

  const recolor = (color: string) => {
    if (!selected) return;
    setHistory((h) => [...h, { kind: 'recolor', holdId: selected.id, newColor: color }]);
  };
  const del = () => {
    if (!selected) return;
    setHistory((h) => [...h, { kind: 'delete', holdId: selected.id }]);
    setSelectedId(null);
  };
  const undo = () => setHistory((h) => h.slice(0, -1));

  const done = async () => {
    if (history.length === 0) {
      router.back();
      return;
    }
    setSubmitting(true);
    try {
      const corrections: HoldCorrection[] = history.map((a) =>
        a.kind === 'add'
          ? { kind: 'add', box: a.box, color: a.color }
          : a.kind === 'recolor'
            ? { kind: 'recolor', holdId: a.holdId, newColor: a.newColor }
            : { kind: 'delete', holdId: a.holdId },
      );
      await api.submitCorrections(scanId, corrections);
      router.replace({ pathname: '/scan/results', params: { scanId, placeName } });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen padded={false}>
      <View style={styles.headerWrap}>
        <AppHeader
          title="Fix detection"
          right={
            <Pressable onPress={undo} disabled={history.length === 0} hitSlop={8} accessibilityLabel="Undo">
              <Text variant="label" tone={history.length === 0 ? 'secondary' : 'accent'}>
                Undo
              </Text>
            </Pressable>
          }
        />
      </View>

      <View
        style={styles.canvas}
        onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        {dispW > 0 ? (
          <GestureDetector gesture={drawPan}>
            <View style={{ width: dispW, height: dispH }}>
              <Image
                source={{ uri: scan.imageUri }}
                style={{ width: dispW, height: dispH }}
                contentFit="contain"
                onLoad={(e) => {
                  const s = e.source;
                  if (s?.width && s?.height) setAspect(s.width / s.height);
                }}
              />
              <Svg style={StyleSheet.absoluteFill} width={dispW} height={dispH}>
                {holds.map((h) => {
                  const isSel = h.id === selectedId;
                  return (
                    <Polygon
                      key={h.id}
                      points={points(h.polygon, dispW, dispH)}
                      fill={routeHex(h.color)}
                      fillOpacity={isSel ? 0.3 : 0.15}
                      stroke={isSel ? '#FFFFFF' : routeHex(h.color)}
                      strokeWidth={isSel ? 3 : 1.5}
                      onPress={mode === 'select' ? () => setSelectedId(h.id) : undefined}
                    />
                  );
                })}
                {draw ? (
                  <Rect
                    x={draw.x}
                    y={draw.y}
                    width={draw.w}
                    height={draw.h}
                    fill={routeHex(addColor)}
                    fillOpacity={0.25}
                    stroke="#FFFFFF"
                    strokeWidth={2}
                  />
                ) : null}
              </Svg>
            </View>
          </GestureDetector>
        ) : null}
      </View>

      <View style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}>
        <ModeToggle mode={mode} onChange={(m) => { setMode(m); setSelectedId(null); }} />

        {mode === 'select' ? (
          selected ? (
            <>
              <Text variant="caption" tone="secondary">
                Selected hold — recolor or delete.
              </Text>
              <ColorRow value={selected.color} onPick={recolor} />
              <View style={styles.actionRow}>
                <Button title="Delete hold" variant="destructive" fullWidth={false} onPress={del} style={styles.flex} />
                <Button title="Deselect" variant="secondary" fullWidth={false} onPress={() => setSelectedId(null)} style={styles.flex} />
              </View>
            </>
          ) : (
            <Text variant="caption" tone="secondary">
              Tap a hold to recolor or delete it.
            </Text>
          )
        ) : (
          <>
            <Text variant="caption" tone="secondary">
              Pick a color, then drag on the photo to box a missed hold.
            </Text>
            <ColorRow value={addColor} onPick={setAddColor} />
          </>
        )}

        <Button title="Done" onPress={done} loading={submitting} />
      </View>
    </Screen>
  );
}

function ModeToggle({ mode, onChange }: { mode: 'select' | 'add'; onChange: (m: 'select' | 'add') => void }) {
  const c = useThemeColors();
  const opts: { key: 'select' | 'add'; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
    { key: 'select', label: 'Edit holds', icon: 'hand.tap' },
    { key: 'add', label: 'Add hold', icon: 'plus.viewfinder' },
  ];
  return (
    <View style={[styles.modeTrack, { backgroundColor: c.surfaceSelected }]}>
      {opts.map((o) => {
        const active = o.key === mode;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.modeBtn, active && { backgroundColor: c.background }]}
          >
            <Icon name={o.icon} size={16} color={active ? c.text : c.textSecondary} />
            <Text variant="label" tone={active ? 'default' : 'secondary'}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ColorRow({ value, onPick }: { value: string; onPick: (color: string) => void }) {
  const c = useThemeColors();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colorRow}>
      {ROUTE_COLOR_OPTIONS.map((color) => {
        const active = color === value;
        return (
          <Pressable
            key={color}
            onPress={() => onPick(color)}
            accessibilityRole="button"
            accessibilityLabel={color}
            accessibilityState={{ selected: active }}
            style={[styles.colorChip, { borderColor: active ? c.accent : 'transparent' }]}
          >
            <Swatch color={color} size={28} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerWrap: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  canvas: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  sheet: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  actionRow: { flexDirection: 'row', gap: Spacing.sm },
  modeTrack: { flexDirection: 'row', borderRadius: Radius.md, padding: Spacing.xs, gap: Spacing.xs },
  modeBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: Radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  colorRow: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  colorChip: { padding: 3, borderRadius: Radius.pill, borderWidth: 2 },
});
