import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { MeasurementForm, type Measurements } from '@/components/measurement-form';
import { Button, Screen, Text } from '@/components/ui';
import { useProfile } from '@/store/use-profile';
import { Spacing } from '@/theme';

export default function ProfileSetup() {
  const { unit, setUnit, saveProfile } = useProfile();
  const [value, setValue] = useState<Measurements | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!value) return;
    setSaving(true);
    try {
      await saveProfile(value);
      router.replace('/home');
    } finally {
      setSaving(false);
    }
  };

  const skip = () => {
    Alert.alert(
      'Skip measurements?',
      'Without your height and wingspan, routes can’t be personalized to your reach. You can add them later in Profile.',
      [
        { text: 'Go back', style: 'cancel' },
        { text: 'Skip', style: 'destructive', onPress: () => router.replace('/home') },
      ],
    );
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.body}>
          <Text variant="title">Your measurements</Text>
          <Text tone="secondary">
            We use your height and wingspan to compute reachable hand-and-foot sequences.
          </Text>
          <View style={styles.form}>
            <MeasurementForm unit={unit} onUnitChange={setUnit} onChange={setValue} />
          </View>
        </View>

        <View style={styles.footer}>
          <Button title="Save and continue" onPress={save} disabled={!value} loading={saving} />
          <Button title="Skip for now" variant="ghost" onPress={skip} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { flex: 1, gap: Spacing.sm },
  form: { marginTop: Spacing.lg },
  footer: { gap: Spacing.sm, paddingBottom: Spacing.md },
});
