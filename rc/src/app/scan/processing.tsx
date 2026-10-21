import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Loading, MessageState, Screen } from '@/components/ui';
import { api } from '@/api';
import { useScans } from '@/store/use-scans';

const POLL_MS = 1200;

export default function ProcessingScreen() {
  const { scanId, uri, placeId, placeName } = useLocalSearchParams<{
    scanId: string;
    uri: string;
    placeId: string;
    placeName: string;
  }>();
  const addScan = useScans((s) => s.addScan);
  const [failed, setFailed] = useState(false);

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
          addScan({
            scanId: scan.id,
            placeId: scan.placeId, // the server's id: a gym picked from Google gets a permanent one
            placeName,
            imageUri: scan.imageUri,
            createdAt: scan.createdAt,
          });
          router.replace({
            pathname: '/scan/results',
            params: { scanId, uri, placeName },
          });
          return;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scanId, uri, placeId, placeName, addScan]);

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
