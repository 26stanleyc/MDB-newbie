import { Link, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { Button, Screen, Text, TextField } from '@/components/ui';
import { APP_NAME } from '@/config/app';
import { isValidEmail } from '@/lib/validate';
import { useSession } from '@/store/use-session';
import { Spacing } from '@/theme';

export default function SignUp() {
  const signUp = useSession((s) => s.signUp);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailOk = isValidEmail(email);
  const passwordOk = password.length >= 6;
  const canSubmit = emailOk && passwordOk;

  const onSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      await signUp(email.trim(), password);
      // First-launch flow continues into measurements.
      router.replace('/profile-setup');
    } catch {
      setError('Could not create your account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <AppHeader />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.body}>
          <Text variant="title">Create your account</Text>
          <Text tone="secondary">Join {APP_NAME} to save your scans.</Text>

          <View style={styles.form}>
            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              placeholder="you@example.com"
              error={email.length > 0 && !emailOk ? 'Enter a valid email' : undefined}
            />
            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="At least 6 characters"
              error={password.length > 0 && !passwordOk ? 'At least 6 characters' : undefined}
            />
            {error ? <Text tone="destructive">{error}</Text> : null}
          </View>
        </View>

        <View style={styles.footer}>
          <Button title="Sign up" onPress={onSubmit} disabled={!canSubmit} loading={loading} />
          <View style={styles.switch}>
            <Text tone="secondary">Already have an account? </Text>
            <Link href="/sign-in" replace>
              <Text tone="accent">Sign in</Text>
            </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { flex: 1, gap: Spacing.sm },
  form: { gap: Spacing.md, marginTop: Spacing.lg },
  footer: { gap: Spacing.md, paddingBottom: Spacing.md },
  switch: { flexDirection: 'row', justifyContent: 'center' },
});
