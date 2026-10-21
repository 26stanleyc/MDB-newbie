import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { Press, RollingText } from '@/components/motion';
import { GradePickerModal } from '@/components/grade-picker-modal';
import { WallView } from '@/components/wall-view';
import {
  Badge,
  Button,
  Icon,
  Loading,
  MessageState,
  Screen,
  Segmented,
  Swatch,
  Text,
} from '@/components/ui';
import { api, type VGrade } from '@/api';
import { useAsyncData } from '@/lib/use-async-data';
import { useProfile } from '@/store/use-profile';
import { useToast } from '@/store/use-toast';
import { Radius, Spacing, TextStyles, useThemeColors } from '@/theme';

const DEFAULT_PROFILE = { heightCm: 170, wingspanCm: 170 };

export default function PathScreen() {
  const { scanId, routeId, placeName } = useLocalSearchParams<{
    scanId: string;
    routeId: string;
    placeName: string;
  }>();
  const c = useThemeColors();
  const toast = useToast();
  const profile = useProfile((s) => s.profile);
  const notPersonalized = !profile;

  const { data, error, reload } = useAsyncData(
    useCallback(async () => {
      const scan = await api.getScan(scanId);
      const route = scan.routes.find((r) => r.id === routeId);
      if (!route) throw new Error('route not found');
      // Several betas to choose from; the climber's pick is preference data.
      const options = await api.getPathOptions(scanId, routeId, profile ?? DEFAULT_PROFILE);
      return { scan, route, options };
    }, [scanId, routeId, profile]),
    [scanId, routeId, profile?.heightCm, profile?.wingspanCm],
  );

  // Re-fetch when returning from Edit path so a saved correction shows here.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      reload();
    }, [reload]),
  );

  const [mode, setMode] = useState<'all' | 'step'>('all');
  const [current, setCurrent] = useState(0);
  const [gradeOpen, setGradeOpen] = useState(false);
  const [gradeOverride, setGradeOverride] = useState<{ grade: VGrade; votes: number } | null>(null);
  const [optionId, setOptionId] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const selectedHoldIds = useMemo(
    () => new Set(data?.route.holdIds ?? []),
    [data?.route.holdIds],
  );

  if (error) {
    return (
      <Screen>
        <AppHeader title={placeName} />
        <MessageState
          icon="wifi.slash"
          title="Couldn’t compute path"
          message="Please try again."
          actionLabel="Retry"
          onAction={reload}
        />
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen>
        <AppHeader title={placeName} />
        <Loading label="Computing your path…" />
      </Screen>
    );
  }

  const { route, scan, options } = data;
  const option = options.find((o) => o.id === optionId) ?? options[0];
  const steps = option?.steps ?? [];
  const visibleSteps = mode === 'all' ? steps : steps.slice(0, current + 1);
  const grade = gradeOverride ?? route.communityGrade;

  const pickOption = async () => {
    if (!option) return;
    setPicking(true);
    toast.busy('Saving your pick…');
    try {
      await api.choosePath(scanId, routeId, option.id, options.map((o) => o.id), profile ?? DEFAULT_PROFILE);
      setPickedId(option.id);
      toast.done('Saved as your path');
    } catch {
      toast.done('Couldn’t save your pick');
    } finally {
      setPicking(false);
    }
  };

  const submitGrade = async (g: VGrade) => {
    toast.busy('Saving grade…');
    const updated = await api.submitGrade(route.id, g);
    if (updated.communityGrade) setGradeOverride(updated.communityGrade);
    toast.done(`Graded ${g}`);
  };

  return (
    <Screen padded={false}>
      <View style={styles.headerWrap}>
        <AppHeader
          title={route.displayName}
          right={
            <Press
              onPress={() =>
                router.push({
                  pathname: '/scan/edit-path',
                  params: { scanId, routeId, placeName },
                })
              }
              accessibilityLabel="Edit path"
              hitSlop={8}
            >
              <Text variant="label" tone="accent">
                Edit
              </Text>
            </Press>
          }
        />
      </View>

      <WallView
        uri={scan.imageUri}
        holds={scan.holds}
        selectedHoldIds={selectedHoldIds}
        steps={visibleSteps}
        activeOrder={mode === 'all' ? undefined : steps[current]?.order}
        style={styles.wall}
      />

      <View style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={styles.routeRow}>
          <Swatch color={route.color} />
          <Text variant="label" style={styles.flex}>
            {route.displayName}
          </Text>
          {grade ? <Badge label={`${grade.grade} · ${grade.votes}`} /> : null}
          <Press
            onPress={() => setGradeOpen(true)}
            accessibilityLabel="Grade this route"
            hitSlop={8}
          >
            <Text variant="label" tone="accent">
              {grade ? 'Regrade' : 'Add grade'}
            </Text>
          </Press>
        </View>

        {notPersonalized ? (
          <View style={styles.notice}>
            <Icon name="info.circle" size={14} color={c.warning} />
            <Text variant="caption" tone="secondary" style={styles.flex}>
              Not personalized — add your measurements in Profile for a path matched to your reach.
            </Text>
          </View>
        ) : null}

        {options.length > 1 ? (
          <View style={styles.options}>
            <Segmented
              options={options.map((o) => ({ label: o.label, value: o.id }))}
              value={option.id}
              onChange={(id) => {
                setOptionId(id);
                setCurrent(0);
              }}
            />
            <View style={styles.pickRow}>
              <Text variant="caption" tone="secondary" style={styles.flex}>
                Which would you climb? Your pick helps improve paths.
              </Text>
              <Button
                title={pickedId === option.id ? 'Your pick' : 'I’d climb this'}
                variant="secondary"
                fullWidth={false}
                onPress={pickOption}
                disabled={pickedId === option.id}
                loading={picking}
              />
            </View>
          </View>
        ) : null}

        <Segmented
          options={[
            { label: 'All steps', value: 'all' },
            { label: 'Step through', value: 'step' },
          ]}
          value={mode}
          onChange={(m) => {
            setMode(m);
            setCurrent(0);
          }}
        />

        {mode === 'step' ? (
          <StepControls
            index={current}
            total={steps.length}
            onPrev={() => setCurrent((i) => Math.max(0, i - 1))}
            onNext={() => setCurrent((i) => Math.min(steps.length - 1, i + 1))}
            step={steps[current]}
          />
        ) : (
          <Text variant="caption" tone="secondary">
            {steps.length} moves · circles are hands, squares are feet.
          </Text>
        )}
      </View>

      <GradePickerModal
        visible={gradeOpen}
        current={grade?.grade}
        onClose={() => setGradeOpen(false)}
        onSubmit={submitGrade}
      />
    </Screen>
  );
}

function StepControls({
  index,
  total,
  onPrev,
  onNext,
  step,
}: {
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  step?: { limb: string; order: number };
}) {
  const c = useThemeColors();
  const limbName: Record<string, string> = {
    LH: 'Left hand',
    RH: 'Right hand',
    LF: 'Left foot',
    RF: 'Right foot',
  };
  return (
    <View style={styles.stepControls}>
      <Button title="Prev" variant="secondary" fullWidth={false} onPress={onPrev} style={styles.stepBtn} />
      <View style={styles.stepLabel}>
        <RollingText value={`Move ${index + 1} of ${total}`} style={[TextStyles.label, { color: c.text }]} />
        {step ? (
          <Text variant="caption" tone="secondary">
            {limbName[step.limb] ?? step.limb}
          </Text>
        ) : null}
      </View>
      <Button title="Next" fullWidth={false} onPress={onNext} style={styles.stepBtn} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerWrap: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  wall: { flex: 1 },
  sheet: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  notice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  stepControls: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepBtn: { minWidth: 84 },
  stepLabel: { flex: 1, alignItems: 'center' },
  options: { gap: Spacing.sm },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});
