import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { Card, MessageState, Screen, Text } from '@/components/ui';
import { useScans, type SavedScan } from '@/store/use-scans';
import { Radius, Spacing } from '@/theme';

export default function PlaceDetailScreen() {
  const { placeId } = useLocalSearchParams<{ placeId: string }>();
  const place = useScans((s) => s.places[placeId]);
  const scansForPlace = useScans((s) => s.scansForPlace);
  const scans = scansForPlace(placeId);

  return (
    <Screen>
      <AppHeader title={place?.name ?? 'Place'} />
      {scans.length === 0 ? (
        <MessageState icon="photo" title="No scans here yet" />
      ) : (
        <FlatList
          data={scans}
          keyExtractor={(s) => s.scanId}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <ScanRow scan={item} />}
        />
      )}
    </Screen>
  );
}

function ScanRow({ scan }: { scan: SavedScan }) {
  const date = new Date(scan.createdAt).toLocaleString();
  return (
    <Card
      onPress={() =>
        router.push({
          pathname: '/scan/results',
          params: { scanId: scan.scanId, imageUri: scan.imageUri, placeName: scan.placeName },
        })
      }
      accessibilityLabel={`Scan from ${date}`}
      style={styles.row}
    >
      <Image source={{ uri: scan.imageUri }} style={styles.thumb} contentFit="cover" />
      <View style={styles.flex}>
        <Text variant="label">{scan.placeName}</Text>
        <Text variant="caption" tone="secondary">
          {date}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: Spacing.sm, paddingBottom: Spacing.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  thumb: { width: 56, height: 56, borderRadius: Radius.sm },
});
