import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { MeasurementForm, type Measurements } from '@/components/measurement-form';
import { Button, Card, Icon, Screen, Text } from '@/components/ui';
import { formatHeight, formatSpan } from '@/lib/units';
import { useProfile } from '@/store/use-profile';
import { useSession } from '@/store/use-session';
import { Spacing, useThemeColors } from '@/theme';

export default function ProfileScreen() {
  const c = useThemeColors();
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const { profile, unit, setUnit, saveProfile } = useProfile();

  const [value, setValue] = useState<Measurements | null>(profile);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);

  const save = async () => {
    if (!value) return;
    setSaving(true);
    setSavedAt(false);
    try {
      await saveProfile(value);
      setSavedAt(true);
    } finally {
      setSaving(false);
    }
  };

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'You can sign back in anytime.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/sign-in');
        },
      },
    ]);
  };

  return (
    <Screen padded={false}>
      <View style={styles.headerWrap}>
        <AppHeader title="Profile" />
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Card style={styles.accountRow}>
            <Icon name="person.crop.circle" size={36} color={c.textSecondary} />
            <View style={styles.flex}>
              <Text variant="label">Signed in</Text>
              <Text variant="caption" tone="secondary">
                {user?.email ?? 'Guest'}
              </Text>
            </View>
          </Card>

          <View>
            <Text variant="heading" style={styles.sectionTitle}>
              Measurements
            </Text>
            {profile ? (
              <Text variant="caption" tone="secondary" style={styles.current}>
                Current: {formatHeight(profile.heightCm, unit)} tall ·{' '}
                {formatSpan(profile.wingspanCm, unit)} wingspan
              </Text>
            ) : (
              <Text variant="caption" tone="secondary" style={styles.current}>
                Not set — paths won’t be personalized until you add these.
              </Text>
            )}
            <MeasurementForm
              unit={unit}
              onUnitChange={setUnit}
              initial={profile}
              onChange={(v) => {
                setValue(v);
                setSavedAt(false);
              }}
            />
          </View>

          <View style={styles.saveRow}>
            <Button title="Save measurements" onPress={save} disabled={!value} loading={saving} />
            {savedAt ? (
              <Text variant="caption" tone="secondary" style={styles.savedNote}>
                Saved. New paths will use these measurements.
              </Text>
            ) : null}
          </View>

          {__DEV__ ? (
            <Button title="Dev menu" variant="secondary" onPress={() => router.push('/dev')} />
          ) : null}

          <Button title="Sign out" variant="ghost" onPress={confirmSignOut} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerWrap: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  content: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing['2xl'] },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  sectionTitle: { marginBottom: Spacing.xs },
  current: { marginBottom: Spacing.md },
  saveRow: { gap: Spacing.sm },
  savedNote: { textAlign: 'center' },
});
