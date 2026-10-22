import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import type { VGrade } from '@/api/types';

import { GRADES, GYM, ROUTES, WALLS, type LabRoute } from './data';
import { LabIcon, type LabIconName } from './icons';
import { enter, Morph, Press, RollingText } from './motion';
import { kindStyle, Swatch, T } from './ui';
import type { LabTheme } from './variants';

export type FlowStep = 'route' | 'grade' | 'review';

/**
 * "Log a send" — the Capitan analog of the reference's Send flow:
 * pick a route (recipients) → pick a grade (amount keypad) → review → confirm.
 */
export function LabFlow({
  t,
  step,
  topInset,
  bottomInset,
  onStep,
  onClose,
  onConfirm,
}: {
  t: LabTheme;
  step: FlowStep;
  topInset: number;
  bottomInset: number;
  onStep: (s: FlowStep) => void;
  onClose: () => void;
  onConfirm: (route: LabRoute, grade: VGrade, attempts: number) => void;
}) {
  const [route, setRoute] = useState<LabRoute>(ROUTES[0]);
  const [grade, setGrade] = useState<VGrade | null>(null);
  const [attempts, setAttempts] = useState(3);

  return (
    <View style={[styles.fill, { paddingTop: topInset + 6, paddingBottom: bottomInset + 12 }]}>
      {step === 'route' ? (
        <RouteStep
          t={t}
          onClose={onClose}
          onPick={(r) => {
            setRoute(r);
            setGrade(null);
            onStep('grade');
          }}
        />
      ) : (
        <GradeStep
          t={t}
          route={route}
          grade={grade}
          attempts={attempts}
          reviewing={step === 'review'}
          onGrade={setGrade}
          onAttempts={setAttempts}
          onBack={() => onStep(step === 'review' ? 'grade' : 'route')}
          onReview={() => onStep('review')}
          onConfirm={() => grade && onConfirm(route, grade, attempts)}
        />
      )}
    </View>
  );
}

function Header({
  t,
  icon,
  onIcon,
  title,
  subtitle,
}: {
  t: LabTheme;
  icon: LabIconName;
  onIcon: () => void;
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.header}>
      <Press
        spring={t.spring}
        onPress={onIcon}
        accessibilityLabel={icon === 'close' ? 'Close' : 'Back'}
        style={[styles.roundBtn, { backgroundColor: t.c.surfaceHi }]}
      >
        <LabIcon name={icon} size={16} color={t.c.text} weight={2.4} />
      </Press>
      <View>
        <Animated.View key={title} entering={enter(t)}>
          <T t={t} kind="label">
            {title}
          </T>
        </Animated.View>
        {subtitle ? (
          <T t={t} kind="caption" dim>
            {subtitle}
          </T>
        ) : null}
      </View>
    </View>
  );
}

function RouteStep({ t, onClose, onPick }: { t: LabTheme; onClose: () => void; onPick: (r: LabRoute) => void }) {
  const [q, setQ] = useState('');
  const shown = ROUTES.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
  let i = 0;

  return (
    <Animated.View style={styles.fill} exiting={FadeOut.duration(140)}>
      <Header t={t} icon="close" onIcon={onClose} title="Log a send" subtitle={GYM.name} />
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {WALLS.map((w) => {
          const rs = shown.filter((r) => r.wallId === w.id);
          if (rs.length === 0) return null;
          return (
            <View key={w.id}>
              <Animated.View entering={enter(t, i++)}>
                <T t={t} kind="caption" dim style={styles.groupLabel}>
                  {w.name}
                </T>
              </Animated.View>
              {rs.map((r) => (
                <Animated.View key={r.id} entering={enter(t, i++)}>
                  <Press
                    spring={t.spring}
                    scaleTo={0.97}
                    onPress={() => onPick(r)}
                    accessibilityLabel={`${r.name}, ${r.grade ?? 'ungraded'}`}
                    style={styles.routeRow}
                  >
                    <Swatch color={r.color} size={26} t={t} />
                    <T t={t} kind="label" style={styles.flex}>
                      {r.name}
                    </T>
                    <T t={t} kind="caption" dim>
                      {r.grade ? `Gym says ${r.grade}` : 'Ungraded'}
                    </T>
                  </Press>
                </Animated.View>
              ))}
            </View>
          );
        })}
        {shown.length === 0 && (
          <T t={t} dim style={styles.empty}>
            No route matches “{q}”. Try a color, like Blue.
          </T>
        )}
      </ScrollView>
      <View style={[styles.search, { backgroundColor: t.c.surface, borderRadius: t.radius.button }]}>
        <LabIcon name="search" size={16} color={t.c.dim} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search routes by color"
          placeholderTextColor={t.c.dim}
          style={[kindStyle(t, 'body'), styles.flex, { color: t.c.text }]}
          accessibilityLabel="Search routes"
        />
      </View>
    </Animated.View>
  );
}

function GradeStep({
  t,
  route,
  grade,
  attempts,
  reviewing,
  onGrade,
  onAttempts,
  onBack,
  onReview,
  onConfirm,
}: {
  t: LabTheme;
  route: LabRoute;
  grade: VGrade | null;
  attempts: number;
  reviewing: boolean;
  onGrade: (g: VGrade) => void;
  onAttempts: (n: number) => void;
  onBack: () => void;
  onReview: () => void;
  onConfirm: () => void;
}) {
  // 0 = picking a grade, 1 = reviewing. The big grade stays mounted and
  // glides down between the two — the reference's "$1" hand-off.
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withSpring(reviewing ? 1 : 0, t.spring);
  }, [reviewing, p, t.spring]);

  const bigStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(p.value, [0, 1], [0, 70]) }],
  }));
  const padStyle = useAnimatedStyle(() => ({
    opacity: 1 - p.value,
    transform: [{ translateY: interpolate(p.value, [0, 1], [0, 60]) }],
  }));
  const reviewStyle = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: interpolate(p.value, [0, 1], [40, 0]) }],
  }));

  const quick: { label: string; g: VGrade }[] = [
    ...(route.grade ? [{ label: `Gym ${route.grade}`, g: route.grade }] : []),
    { label: 'Your last V4', g: 'V4' },
    { label: 'Your best V6', g: 'V6' },
  ];
  const btn = { backgroundColor: t.c.primary, borderRadius: t.radius.button };

  return (
    <Animated.View style={styles.fill} entering={enter(t)}>
      <Header
        t={t}
        icon="back"
        onIcon={onBack}
        title={reviewing ? 'Review send' : 'Log a send'}
        subtitle={reviewing ? undefined : `${route.name}, ${route.wallName}`}
      />

      <Animated.View style={[styles.big, bigStyle]}>
        <RollingText
          value={grade ?? 'V?'}
          t={t}
          style={[kindStyle(t, 'display'), styles.bigText, { color: grade ? t.c.text : t.c.dim }]}
        />
      </Animated.View>

      <View style={styles.flex} />

      {/* Review rows sit in the same space the keypad leaves. */}
      <View style={styles.bottomStack}>
        <Animated.View
          style={[styles.reviewBox, reviewStyle]}
          pointerEvents={reviewing ? 'auto' : 'none'}
        >
          <ReviewRow t={t} label="Route">
            <Swatch color={route.color} size={14} t={t} />
            <T t={t} kind="label">
              {route.name}, {route.wallName}
            </T>
          </ReviewRow>
          <ReviewRow t={t} label="Attempts">
            <Stepper t={t} value={attempts} onChange={onAttempts} />
          </ReviewRow>
          <Press spring={t.spring} onPress={onConfirm} style={[styles.cta, btn]} accessibilityLabel="Log send">
            <T t={t} kind="label" style={{ color: t.c.onPrimary }}>
              Log send
            </T>
          </Press>
        </Animated.View>

        <Animated.View style={padStyle} pointerEvents={reviewing ? 'none' : 'auto'}>
          <Morph
            t={t}
            on={grade !== null}
            height={44}
            from={
              <View style={styles.chips}>
                {quick.map((q) => (
                  <Press
                    key={q.label}
                    spring={t.spring}
                    onPress={() => onGrade(q.g)}
                    accessibilityLabel={q.label}
                    style={[styles.chip, { backgroundColor: t.c.chip, borderRadius: t.radius.button }]}
                  >
                    <T t={t} kind="caption" style={styles.chipText}>
                      {q.label}
                    </T>
                  </Press>
                ))}
              </View>
            }
            to={
              <Press spring={t.spring} onPress={onReview} style={[styles.ctaBase, btn]} accessibilityLabel="Review">
                <T t={t} kind="label" style={{ color: t.c.onPrimary }}>
                  Review
                </T>
              </Press>
            }
          />
          <View style={styles.pad}>
            {GRADES.map((g) => {
              const on = g === grade;
              return (
                <Press
                  key={g}
                  spring={t.spring}
                  scaleTo={0.88}
                  onPress={() => onGrade(g)}
                  accessibilityLabel={g}
                  accessibilityState={{ selected: on }}
                  style={[
                    styles.key,
                    { borderRadius: t.radius.button, backgroundColor: on ? t.c.surfaceHi : 'transparent' },
                  ]}
                >
                  <T t={t} kind="title" style={{ fontFamily: t.font.number }}>
                    {g}
                  </T>
                </Press>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

function ReviewRow({ t, label, children }: { t: LabTheme; label: string; children: React.ReactNode }) {
  return (
    <View style={[styles.reviewRow, { borderBottomColor: t.c.line }]}>
      <T t={t} kind="caption" dim>
        {label}
      </T>
      <View style={styles.reviewValue}>{children}</View>
    </View>
  );
}

function Stepper({ t, value, onChange }: { t: LabTheme; value: number; onChange: (n: number) => void }) {
  const b = [styles.stepBtn, { backgroundColor: t.c.surfaceHi }];
  return (
    <View style={styles.stepper}>
      <Press spring={t.spring} scaleTo={0.85} style={b} onPress={() => onChange(Math.max(1, value - 1))} accessibilityLabel="Fewer attempts">
        <T t={t} kind="label">
          −
        </T>
      </Press>
      <View style={styles.stepVal}>
        <RollingText value={String(value)} t={t} style={[kindStyle(t, 'label'), { color: t.c.text }]} />
      </View>
      <Press spring={t.spring} scaleTo={0.85} style={b} onPress={() => onChange(value + 1)} accessibilityLabel="More attempts">
        <T t={t} kind="label">
          +
        </T>
      </Press>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, height: 48 },
  roundBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
  groupLabel: { marginTop: 14, marginBottom: 4 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 52 },
  empty: { marginTop: 24 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    height: 46,
    paddingHorizontal: 14,
  },
  big: { paddingHorizontal: 20, paddingTop: 48 },
  bigText: { fontSize: 76, lineHeight: 88 },
  bottomStack: { paddingHorizontal: 16 },
  reviewBox: { position: 'absolute', left: 16, right: 16, bottom: 0, gap: 4 },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  reviewValue: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ctaBase: { height: 44, alignItems: 'center', justifyContent: 'center' },
  cta: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  chips: { flexDirection: 'row', gap: 8, height: 44 },
  chip: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontWeight: '600' },
  pad: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  key: { width: '33.33%', height: 60, alignItems: 'center', justifyContent: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stepVal: { minWidth: 18, alignItems: 'center' },
});
