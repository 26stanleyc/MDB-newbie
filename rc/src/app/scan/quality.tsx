import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Loading, MessageState, Screen } from '@/components/ui';
import { api } from '@/api';
import { useScanDraft } from '@/store/use-scan-draft';

type Phase =
  | { kind: 'checking' }
  | { kind: 'failed'; message: string }
  | { kind: 'error' };

export default function QualityScreen() {
  const { placeId, placeName } = useLocalSearchParams<{
    placeId: string;
    placeName: string;
  }>();
  const mode = useScanDraft((s) => s.mode);
  const captures = useScanDraft((s) => s.captures);
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });

  // Runs the quality check, then creates the scan and advances to processing.
  // Written so the mount effect never calls setState synchronously.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (captures.length === 0) {
        setPhase({ kind: 'error' });
        return;
      }
      const images = captures.map((c) => c.image);
      const metas = captures.map((c) => c.meta);
      try {
        // Quality-check the first view (mock passes; precise uses all views later).
        const result = await api.checkImageQuality(images[0]);
        if (cancelled) return;
        if (!result.ok) {
          setPhase({ kind: 'failed', message: result.message });
          return;
        }
        const { scanId } = await api.createScan(images, placeId, metas, mode);
        if (cancelled) return;
        router.replace({
          pathname: '/scan/processing',
          params: { scanId, uri: images[0].uri, placeId, placeName },
        });
      } catch {
        if (!cancelled) setPhase({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [placeId, placeName, captures, mode]);

  if (phase.kind === 'checking') {
    return (
      <Screen>
        <Loading label="Checking photo quality…" />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.body}>
        {phase.kind === 'failed' ? (
          <MessageState
            icon="exclamationmark.triangle"
            title="Photo needs a retake"
            message={phase.message}
            actionLabel="Retake photo"
            onAction={() => router.dismissTo('/scan/camera')}
          />
        ) : (
          <MessageState
            icon="wifi.slash"
            title="Something went wrong"
            message="We couldn’t check the photo. Please try again."
            actionLabel="Retake photo"
            onAction={() => router.dismissTo('/scan/camera')}
          />
        )}
      </View>
      <Button title="Cancel" variant="ghost" onPress={() => router.dismissTo('/home')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
});
