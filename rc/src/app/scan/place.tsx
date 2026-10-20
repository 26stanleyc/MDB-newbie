import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { Card, Icon, Loading, Screen, Text, TextField } from '@/components/ui';
import { api, type Place } from '@/api';
import { Spacing, useThemeColors } from '@/theme';

function formatDistance(m?: number): string | null {
  if (m == null) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export default function PlacePickerScreen() {
  const c = useThemeColors();

  const [query, setQuery] = useState('');
  const [nearby, setNearby] = useState<Place[] | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [adding, setAdding] = useState(false);

  // Request location + load nearby gyms (falls back to search-only if denied).
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationDenied(true);
        setNearby([]);
        return;
      }
      try {
        const pos = await Location.getCurrentPositionAsync({});
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setNearby(await api.getNearbyPlaces(pos.coords.latitude, pos.coords.longitude));
      } catch {
        setLocationDenied(true);
        setNearby([]);
      }
    })();
  }, []);

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    const t = setTimeout(async () => {
      if (!q) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        setResults(await api.searchPlaces(q));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const choose = (place: Place) => {
    router.push({
      pathname: '/scan/quality',
      params: { placeId: place.id, placeName: place.name },
    });
  };

  const addNew = async () => {
    const name = query.trim();
    if (!name || adding) return;
    setAdding(true);
    try {
      const place = await api.createPlace(name, coords?.lat, coords?.lng);
      choose(place);
    } finally {
      setAdding(false);
    }
  };

  const q = query.trim();
  const list = q ? results : (nearby ?? []);
  const loading = q ? searching : nearby === null;
  const showAddNew = q.length > 0 && !searching;

  return (
    <Screen>
      <AppHeader title="Pick a place" />

      <TextField
        placeholder="Search gyms"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
      />

      {locationDenied && !q ? (
        <View style={styles.notice}>
          <Icon name="location.slash" size={16} color={c.textSecondary} />
          <Text variant="caption" tone="secondary" style={styles.flex}>
            Location is off — search for your gym by name.
          </Text>
        </View>
      ) : null}

      {!q && !locationDenied ? (
        <Text variant="label" tone="secondary" style={styles.sectionLabel}>
          Nearby
        </Text>
      ) : null}

      {loading ? (
        <Loading />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const dist = formatDistance(item.distanceM);
            return (
              <Card onPress={() => choose(item)} accessibilityLabel={item.name} style={styles.row}>
                <View style={styles.flex}>
                  <Text variant="label">{item.name}</Text>
                  {dist ? (
                    <Text variant="caption" tone="secondary">
                      {dist} away
                    </Text>
                  ) : null}
                </View>
                <Icon name="chevron.right" size={16} color={c.textSecondary} />
              </Card>
            );
          }}
          ListFooterComponent={
            showAddNew ? (
              <Card onPress={addNew} accessibilityLabel={`Add ${q} as a new place`} style={styles.row}>
                <Icon name="plus.circle.fill" size={20} color={c.accent} />
                <Text variant="label" tone="accent" style={styles.flex}>
                  Add “{q}” as a new place
                </Text>
              </Card>
            ) : null
          }
          ListEmptyComponent={
            !showAddNew ? (
              <Text tone="secondary" style={styles.emptyText}>
                No places found.
              </Text>
            ) : null
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  sectionLabel: { marginTop: Spacing.md },
  list: { gap: Spacing.sm, paddingVertical: Spacing.sm, paddingBottom: Spacing.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  emptyText: { textAlign: 'center', marginTop: Spacing.xl },
});
