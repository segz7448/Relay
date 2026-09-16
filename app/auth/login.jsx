import { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, type, space } from '../../theme';
import AuthBackground from '../../components/AuthBackground';
import AnimatedLogo from '../../components/AnimatedLogo';
import Field from '../../components/Field';
import Checkbox from '../../components/Checkbox';
import { PrimaryButton, IconGhostButton } from '../../components/Button';
import StatusTicker from '../../components/StatusTicker';
import { login } from '../../authApi';
import { useAccounts } from '../../accountsStore';

export default function LoginScreen() {
  const router = useRouter();
  const { addAccount } = useAccounts();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = identifier.trim() && password.length > 0 && !submitting;

  async function handleSignIn() {
    setError(null);
    setSubmitting(true);
    try {
      const signedIn = await login({ identifier, password });
      const { apiKey } = signedIn;
      const trimmed = identifier.trim();
      const isEmail = trimmed.includes('@');
      // This screen doubles as both the first sign-in and "Add Account"
      // from Settings — addAccount() handles either case (and switches
      // straight to an already-added match instead of duplicating it).
      await addAccount({
        apiKey,
        email: isEmail ? trimmed : '',
        name: signedIn.name || '',
        username: signedIn.username || (isEmail ? '' : trimmed.replace(/^@/, '')),
        email: signedIn.email || (isEmail ? trimmed : ''),
        bio: signedIn.bio || '',
        photo: signedIn.photo || null,
      });
      router.replace('/');
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.screen}>
      <AuthBackground />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.headerRow}>
            <IconGhostButton icon="chevron-back" onPress={() => router.back()} />
          </View>

          <AnimatedLogo size={48} />
          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.subtitle}>Welcome back — enter your details to continue</Text>

          <Field
            label="Email or username"
            value={identifier}
            onChangeText={setIdentifier}
            placeholder="you@domain.com"
            icon="person-outline"
            autoComplete="username"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            icon="lock-closed-outline"
            secure
            textContentType="password"
          />

          <View style={styles.row}>
            <Checkbox checked={remember} onToggle={() => setRemember((v) => !v)}>
              Remember me
            </Checkbox>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <PrimaryButton label="Sign in" onPress={handleSignIn} disabled={!canSubmit} loading={submitting} />

          <View style={{ marginTop: space.lg, alignItems: 'center' }}>
            <StatusTicker state={submitting ? 'working' : 'idle'} label={submitting ? 'Checking credentials…' : 'Ready'} />
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.xl, paddingBottom: space.xl * 1.5 },
  headerRow: { marginBottom: space.sm },
  title: { ...type.display, fontSize: 24, color: colors.textPrimary, marginTop: space.lg },
  subtitle: { ...type.body, color: colors.textSecondary, marginTop: space.xs, marginBottom: space.xl },
  row: { flexDirection: 'row', alignItems: 'flex-start', marginTop: -space.xs },
  error: { ...type.small, color: colors.danger, marginBottom: space.md, textAlign: 'center' },
});
