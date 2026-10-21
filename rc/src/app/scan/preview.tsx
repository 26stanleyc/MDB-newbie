import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { Button, Screen, Text } from '@/components/ui';
import { useScanDraft } from '@/store/use-scan-draft';
import { Radius, Spacing } from '@/theme';

export default function PreviewScreen() {
  const mode = useScanDraft((s) => s.mode);
  const captures = useScanDraft((s) => s.captures);
  const clear = useScanDraft((s) => s.clear);
  const precise = mode === 'precise';
  const first = captures[0];

  if (!first) {
    return (
      <Screen>
        <AppHeader title="Preview" />
        <Text tone="secondary">No photo captured.</Text>
      </Screen>
    );
  }

  const retake = () => {
    clear();
    router.back();
  };

  return (
    <Screen>
      <AppHeader title={precise ? `Preview · ${captures.length} photos` : 'Preview'} />
      <View style={styles.imageWrap}>
        <Image
          source={{ uri: first.image.uri }}
          style={styles.image}
          contentFit="contain"
          accessibilityLabel="Captured wall photo"
        />
      </View>

      {precise ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.stripContent}>
          {captures.map((cap, i) => (
            <Image
              key={i}
              source={{ uri: cap.image.uri }}
              style={styles.thumb}
              contentFit="cover"
              accessibilityLabel={`View ${i + 1}`}
            />
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.footer}>
        <Button
          title={precise ? `Use ${captures.length} photos` : 'Use photo'}
          onPress={() => router.push('/scan/place')}
        />
        <Button title="Retake" variant="secondary" onPress={retake} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  imageWrap: { flex: 1, borderRadius: Radius.lg, overflow: 'hidden' },
  image: { flex: 1 },
  strip: { flexGrow: 0, marginTop: Spacing.sm },
  stripContent: { gap: Spacing.sm },
  thumb: { width: 64, height: 64, borderRadius: Radius.sm },
  footer: { gap: Spacing.sm, paddingTop: Spacing.md, paddingBottom: Spacing.md },
});
