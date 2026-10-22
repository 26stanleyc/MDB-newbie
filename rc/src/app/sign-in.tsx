import { Link, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { Button, Screen, Text, TextField } from '@/components/ui';
import { APP_NAME } from '@/config/app';
import { isValidEmail } from '@/lib/validate';
import { useSession } from '@/store/use-session';
import { Spacing } from '@/theme';

export default function SignIn() {
  const signIn = useSession((s) => s.signIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = isValidEmail(email) && password.length >= 6;

  const onSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      router.replace('/home');
    } catch {
      setError('Could not sign in. Please try again.');
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
          <Text variant="title">Welcome back</Text>
          <Text tone="secondary">Sign in to {APP_NAME}.</Text>

          <View style={styles.form}>
            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              placeholder="you@example.com"
            />
            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="At least 6 characters"
            />
            {error ? <Text tone="destructive">{error}</Text> : null}
          </View>
        </View>

        <View style={styles.footer}>
          <Button title="Sign in" onPress={onSubmit} disabled={!canSubmit} loading={loading} />
          <View style={styles.switch}>
            <Text tone="secondary">New here? </Text>
            <Link href="/sign-up" replace>
              <Text tone="accent">Create an account</Text>
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
