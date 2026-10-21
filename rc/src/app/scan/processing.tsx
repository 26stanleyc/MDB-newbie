import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Loading, MessageState, Screen } from '@/components/ui';
import { api, type Scan } from '@/api';
import { weakDetection } from '@/lib/detection-check';
import { useScanDraft } from '@/store/use-scan-draft';
import { useScans } from '@/store/use-scans';

const POLL_MS = 1200;

export default function ProcessingScreen() {
  const { scanId, uri, placeName } = useLocalSearchParams<{
    scanId: string;
    uri: string;
    placeName: string;
  }>();
  const addScan = useScans((s) => s.addScan);
  const [failed, setFailed] = useState(false);
  // Detections too weak to trust: suggest a retake before showing results.
  const [weak, setWeak] = useState<{ scan: Scan; reason: string } | null>(null);
  const precise = useScanDraft((s) => s.mode) === 'precise';

  // Save the scan and show its routes.
  const finish = useCallback(
    (scan: Scan) => {
      addScan({
        scanId: scan.id,
        placeId: scan.placeId, // the server's id: a gym picked from Google gets a permanent one
        placeName,
        imageUri: scan.imageUri,
        createdAt: scan.createdAt,
      });
      router.replace({ pathname: '/scan/results', params: { scanId, uri, placeName } });
    },
    [scanId, uri, placeName, addScan],
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
        <Loading label="Analyzing wall…" />
      </View>
      <Button title="Cancel" variant="ghost" onPress={() => router.dismissTo('/home')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
});
