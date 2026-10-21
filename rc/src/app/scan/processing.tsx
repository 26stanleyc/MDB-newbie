import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { enter } from '@/components/motion';
import { Button, MessageState, Screen, Text } from '@/components/ui';
import { api, type Scan } from '@/api';
import { weakDetection } from '@/lib/detection-check';
import { useScanDraft } from '@/store/use-scan-draft';
import { useToast } from '@/store/use-toast';
import { Fonts, Spacing, useThemeColors } from '@/theme';

// What the pipeline is doing, in climber terms. Cycles while we poll.
const STAGES = ['Finding holds', 'Grouping routes by color', 'Measuring the wall'];
const STAGE_MS = 1500;

const POLL_MS = 1200;

export default function ProcessingScreen() {
  const { scanId, uri, placeName } = useLocalSearchParams<{
    scanId: string;
    uri: string;
    placeName: string;
  }>();
  const toastDone = useToast((s) => s.done);
  const [failed, setFailed] = useState(false);
  // Detections too weak to trust: suggest a retake before showing results.
  const [weak, setWeak] = useState<{ scan: Scan; reason: string } | null>(null);
  const precise = useScanDraft((s) => s.mode) === 'precise';
  const [stage, setStage] = useState(0);
  const c = useThemeColors();

  useEffect(() => {
    const t = setInterval(() => setStage((i) => Math.min(i + 1, STAGES.length - 1)), STAGE_MS);
    return () => clearInterval(t);
  }, []);

  // Save the scan and show its routes.
  const finish = useCallback(
    (scan: Scan) => {
      toastDone(`${scan.routes.length} ${scan.routes.length === 1 ? 'route' : 'routes'} found`);
      // Close the scan flow (and the camera modal under it), then open results as a
      // normal page over Home: pushed above the modal, iOS shows it as a card shifted
      // down and its bottom sheet ends up off-screen.
      if (router.canDismiss()) router.dismissAll();
      router.push({
        pathname: '/scan/results',
        params: { scanId, uri, placeName, step: 'verify' }, // check the holds first
      });
    },
    [scanId, uri, placeName, toastDone],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Poll until the scan is done or failed.
      while (!cancelled) {
        const scan = await api.getScan(scanId);
        if (cancelled) return;
        if (scan.status === 'failed') {
          setFailed(true);
          return;
        }
        if (scan.status === 'done') {
          const reason = weakDetection(scan.holds);
          if (reason) setWeak({ scan, reason });
          else finish(scan);
          return;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scanId, finish]);

  if (weak) {
    return (
      <Screen>
        <View style={styles.body}>
          <MessageState
            icon="camera.viewfinder"
            title={precise ? 'Retake your photos?' : 'Retake the photo?'}
            message={`${weak.reason} Stand square to the wall with the whole route in frame and even light.`}
            actionLabel={precise ? 'Retake photos' : 'Retake photo'}
            onAction={() => router.dismissTo('/scan/camera')}
          />
        </View>
        <Button title="See results anyway" variant="ghost" onPress={() => finish(weak.scan)} />
      </Screen>
    );
  }

  if (failed) {
    return (
      <Screen>
        <View style={styles.body}>
          <MessageState
            icon="exclamationmark.triangle"
            title="Analysis failed"
            message="We couldn’t analyze this wall. Please take another photo."
            actionLabel="Retake photo"
            onAction={() => router.dismissTo('/scan/camera')}
          />
        </View>
        <Button title="Back home" variant="ghost" onPress={() => router.dismissTo('/home')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.body}>
        <ActivityIndicator color={c.accent} />
        {/* Each stage rolls in as the last one fades. */}
        <Animated.View key={stage} entering={enter()} exiting={FadeOut.duration(150)}>
          <Text style={[styles.stage, { fontFamily: Fonts.serif, color: c.text }]}>
            {STAGES[stage]}
          </Text>
        </Animated.View>
        <View style={styles.dots}>
          {STAGES.map((s, i) => (
            <View
              key={s}
              style={[styles.dot, { backgroundColor: i <= stage ? c.accent : c.border }]}
            />
          ))}
        </View>
      </View>
      <Button title="Cancel" variant="ghost" onPress={() => router.dismissTo('/home')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  stage: { fontSize: 26, fontWeight: '600', textAlign: 'center' },
  dots: { flexDirection: 'row', gap: Spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
