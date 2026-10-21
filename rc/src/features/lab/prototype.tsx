import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GYMS, ROUTES, SEED_SENDS, WALLS, type LabSend } from './data';
import { LabFlow, type FlowStep } from './flow';
import { formatDistance, LabHome, type Tab } from './home';
import { LabIcon, type LabIconName } from './icons';
import { enter, IslandToast, Press, type ToastState } from './motion';
import { T } from './ui';
import type { LabTheme } from './variants';

type Action = { id: 'send' | 'scan' | 'gym' | 'beta'; label: string; icon: LabIconName };

// Top → bottom, like the reference's Send / Receive / Add Cash / Trade.
const ACTIONS: Action[] = [
  { id: 'send', label: 'Log a send', icon: 'flag' },
  { id: 'scan', label: 'Scan wall', icon: 'scan' },
  { id: 'gym', label: 'Find a gym', icon: 'pin' },
  { id: 'beta', label: 'Plan beta', icon: 'path' },
];

const BAR_H = 48;

/**
 * One interactive prototype of Capitan's home + "Log a send" flow, skinned by
 * `t`. All data is mock (see ./data); nothing here calls the API.
 */
export function LabPrototype({ t, onExit }: { t: LabTheme; onExit: () => void }) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('Home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [step, setStep] = useState<FlowStep | null>(null);
  const [sends, setSends] = useState<LabSend[]>(SEED_SENDS);
  const [toast, setToast] = useState<ToastState>({ kind: 'hidden' });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const later = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  };

  /** busy pill → widen into confirmation → hide. */
  const runToast = (busy: string | null, done: string, onDone?: () => void) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const busyMs = busy ? 1100 : 0;
    if (busy) setToast({ kind: 'busy', text: busy });
    later(busyMs, () => {
      onDone?.();
      setToast({ kind: 'done', text: done });
    });
    later(busyMs + 2000, () => setToast({ kind: 'hidden' }));
  };

  // Menu: blur + FAB rotation share one spring.
  const menuP = useSharedValue(0);
  useEffect(() => {
    menuP.value = withSpring(menuOpen ? 1 : 0, t.spring);
  }, [menuOpen, menuP, t.spring]);

  // Home recedes while the flow is up.
  const flowP = useSharedValue(0);
  useEffect(() => {
    flowP.value = withSpring(step ? 1 : 0, t.spring);
  }, [step, flowP, t.spring]);

  const homeStyle = useAnimatedStyle(() => ({
    opacity: 1 - flowP.value,
    transform: [{ scale: interpolate(flowP.value, [0, 1], [1, 0.94]) }],
  }));
  const blurStyle = useAnimatedStyle(() => ({ opacity: menuP.value }));
  const fabStyle = useAnimatedStyle(() => ({
    opacity: 1 - flowP.value,
    transform: [{ rotate: `${menuP.value * 135}deg` }],
  }));

  const onAction = (a: Action) => {
    setMenuOpen(false);
    if (a.id === 'send') setStep('route');
    if (a.id === 'scan') runToast('Reading holds…', `${ROUTES.length} routes found`);
    if (a.id === 'gym') {
      setTab('Gyms');
      runToast(null, `${GYMS[1].name} is ${formatDistance(GYMS[1].distanceM)} away`);
    }
    if (a.id === 'beta') runToast('Planning beta…', `Beta ready for ${ROUTES[0].name}`);
  };

  const bottom = insets.bottom + 12;
  const blurTint = t.dark ? 'dark' : 'light';

  return (
    <View style={[styles.root, { backgroundColor: t.c.bg }]}>
      {t.wallBackdrop && (
        <>
          <Image source={{ uri: WALLS[0].imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, styles.wallScrim]} />
        </>
      )}

      <Animated.View style={[styles.fill, homeStyle]} pointerEvents={step ? 'none' : 'auto'}>
        <LabHome
          t={t}
          tab={tab}
          onTab={setTab}
          sends={sends}
          topInset={insets.top}
          bottomPad={bottom + BAR_H + 24}
          onAvatar={onExit}
        />
        <View style={[styles.searchBar, { bottom, backgroundColor: t.c.surface, borderRadius: t.radius.button }]}>
          <LabIcon name="search" size={16} color={t.c.dim} />
          <T t={t} dim>
            Search routes and gyms
          </T>
        </View>
      </Animated.View>

      {/* Blur sheet over home while the action menu is open. */}
      <Animated.View
        style={[StyleSheet.absoluteFill, blurStyle]}
        pointerEvents={menuOpen ? 'auto' : 'none'}
      >
        <BlurView intensity={90} tint={blurTint} style={StyleSheet.absoluteFill} />
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: t.c.scrim }]}
          onPress={() => setMenuOpen(false)}
          accessibilityLabel="Close menu"
        />
      </Animated.View>

      {menuOpen && (
        <View style={[styles.menu, { bottom: bottom + BAR_H + 18 }]} pointerEvents="box-none">
          {ACTIONS.map((a, i) => (
            <Animated.View
              key={a.id}
              // Bottom item (closest to the button) lands first.
              entering={enter(t, ACTIONS.length - 1 - i)}
              exiting={FadeOut.duration(110)}
            >
              <Press
                spring={t.spring}
                onPress={() => onAction(a)}
                accessibilityLabel={a.label}
                style={styles.menuItem}
              >
                <T t={t} kind="label" style={styles.menuLabel}>
                  {a.label}
                </T>
                <View style={[styles.menuIcon, { backgroundColor: t.c.primary, borderRadius: t.radius.fab }]}>
                  <LabIcon name={a.icon} size={18} color={t.c.onPrimary} />
                </View>
              </Press>
            </Animated.View>
          ))}
        </View>
      )}

      <Animated.View style={[styles.fab, { bottom }, fabStyle]} pointerEvents={step ? 'none' : 'auto'}>
        <Press
          spring={t.spring}
          scaleTo={0.88}
          onPress={() => setMenuOpen((o) => !o)}
          accessibilityLabel={menuOpen ? 'Close actions' : 'Open actions'}
          style={[styles.fabBtn, { backgroundColor: t.c.primary, borderRadius: t.radius.fab }]}
        >
          <LabIcon name="plus" size={22} color={t.c.onPrimary} weight={2.4} />
        </Press>
      </Animated.View>

      {step && (
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: t.wallBackdrop ? 'transparent' : t.c.bg }]}
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(200)}
        >
          <LabFlow
            t={t}
            step={step}
            topInset={insets.top}
            bottomInset={insets.bottom}
            onStep={setStep}
            onClose={() => setStep(null)}
            onConfirm={(route, grade) => {
              setStep(null);
              runToast('Logging send…', `Logged ${grade} on ${route.name}`, () =>
                setSends((s) => [
                  { id: `s${Date.now()}`, routeName: route.name, color: route.color, grade, when: 'Just now' },
                  ...s,
                ]),
              );
            }}
          />
        </Animated.View>
      )}

      <IslandToast state={toast} top={insets.top + 6} t={t} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  fill: { flex: 1 },
  wallScrim: { backgroundColor: 'rgba(0,0,0,0.35)' },
  searchBar: {
    position: 'absolute',
    left: 16,
    right: 16 + BAR_H + 10,
    height: BAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  menu: { position: 'absolute', right: 16, alignItems: 'flex-end', gap: 14 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  menuLabel: { fontSize: 17 },
  menuIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  fab: { position: 'absolute', right: 16 },
  fabBtn: { width: BAR_H, height: BAR_H, alignItems: 'center', justifyContent: 'center' },
});
