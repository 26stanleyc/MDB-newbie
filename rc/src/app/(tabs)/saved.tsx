import { router } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { api } from '@/api';
import { Card, Icon, MessageState, Screen, Text } from '@/components/ui';
import { useScans } from '@/store/use-scans';
import { Spacing, useThemeColors } from '@/theme';

export default function Saved() {
  const placesWithScans = useScans((s) => s.placesWithScans);
  const addScan = useScans((s) => s.addScan);
  useScans((s) => s.scans); // subscribe, so added scans re-render the list
  const places = placesWithScans();

  // Starter walls from the backend join the saved list (addScan skips duplicates).
  useEffect(() => {
    api
      .getFeaturedScans()
      .then((walls) => walls.forEach(addScan))
      .catch(() => {}); // offline / no backend: just the climber's own scans
  }, [addScan]);

  return (
    <Screen>
      <Text variant="title" style={styles.title}>
        Saved Walls
      </Text>

      {places.length === 0 ? (
        <MessageState
          icon="bookmark"
          title="No saved walls yet"
          message="Scans you take are saved here, grouped by gym."
        />
      ) : (
        <FlatList
          data={places}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <PlaceRow id={item.id} name={item.name} count={item.count} />
          )}
        />
      )}
    </Screen>
  );
}

function PlaceRow({ id, name, count }: { id: string; name: string; count: number }) {
  const c = useThemeColors();
  return (
    <Card
      onPress={() => router.push(`/place/${id}`)}
      accessibilityLabel={`${name}, ${count} ${count === 1 ? 'scan' : 'scans'}`}
      style={styles.row}
    >
      <View style={styles.rowText}>
        <Text variant="label">{name}</Text>
        <Text variant="caption" tone="secondary">
          {count} {count === 1 ? 'scan' : 'scans'}
        </Text>
      </View>
      <Icon name="chevron.right" size={16} color={c.textSecondary} />
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { marginBottom: Spacing.lg },
  list: { gap: Spacing.sm, paddingBottom: Spacing.xl },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowText: { gap: 2 },
});
