import { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type, space, useTheme } from '../theme';
import SettingsSection from '../components/SettingsSection';
import SettingsRow from '../components/SettingsRow';
import Field from '../components/Field';
import PasswordStrength from '../components/PasswordStrength';
import { PrimaryButton, TextLink } from '../components/Button';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import {
  usePrivacySecurity,
  saveTwoStepSecret,
  readTwoStepSecret,
  clearTwoStepSecret,
} from '../privacySecurity';

// mode: null | 'set' | 'change-verify' | 'change-new' | 'disable'
export default function TwoStepScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { state, setTwoStepMeta } = usePrivacySecurity();
  const { twoStep } = state;
  const toast = useToast();
  const confirmAction = useConfirm();

  const [mode, setMode] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [hint, setHint] = useState('');
  const [current, setCurrent] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setMode(null);
    setPassword('');
    setConfirmPassword('');
    setHint('');
    setCurrent('');
    setError(null);
    setBusy(false);
  }

  async function handleSetPassword() {
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    if (password !== confirmPassword) return setError('Passwords don\u2019t match.');
    setBusy(true);
    await saveTwoStepSecret(password);
    setTwoStepMeta({ enabled: true, hint: hint.trim() });
    reset();
    toast.success('Two-Step Verification turned on');
  }

  async function handleVerifyCurrent() {
    const stored = await readTwoStepSecret();
    if (current !== stored) return setError('Incorrect password.');
    setError(null);
    setMode('change-new');
    setPassword('');
    setConfirmPassword('');
  }

  async function handleChangeNew() {
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    if (password !== confirmPassword) return setError('Passwords don\u2019t match.');
    setBusy(true);
    await saveTwoStepSecret(password);
    setTwoStepMeta({ hint: hint.trim() });
    reset();
    toast.success('Password updated');
  }

  async function handleDisable() {
    const stored = await readTwoStepSecret();
    if (current !== stored) return setError('Incorrect password.');
    const ok = await confirmAction({
      title: 'Turn Off Two-Step Verification?',
      message: 'Sensitive account actions will no longer require this extra password.',
      confirmLabel: 'Turn Off',
      destructive: true,
      onConfirm: async () => {
        await clearTwoStepSecret();
        setTwoStepMeta({ enabled: false, hint: '' });
      },
    });
    reset();
    if (ok) toast.success('Two-Step Verification turned off');
  }

  if (mode === 'set' || mode === 'change-new') {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.formWrap}>
        <Text style={styles.title}>{mode === 'set' ? 'Set a Password' : 'Enter a New Password'}</Text>
        <Text style={styles.helper}>
          This password will be required in addition to your account credentials for extra-sensitive actions.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Field label="New Password" value={password} onChangeText={setPassword} secure placeholder="Enter password" textContentType="newPassword" />
        <PasswordStrength password={password} />
        <Field label="Confirm Password" value={confirmPassword} onChangeText={setConfirmPassword} secure placeholder="Re-enter password" />
        <Field label="Hint (optional)" value={hint} onChangeText={setHint} placeholder="A hint to help you remember" autoCapitalize="sentences" />
        <PrimaryButton
          label={mode === 'set' ? 'Set Password' : 'Save New Password'}
          onPress={mode === 'set' ? handleSetPassword : handleChangeNew}
          loading={busy}
        />
        <View style={{ height: space.sm }} />
        <TextLink label="Cancel" onPress={reset} muted />
      </ScrollView>
    );
  }

  if (mode === 'change-verify' || mode === 'disable') {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.formWrap}>
        <Text style={styles.title}>Enter Your Password</Text>
        <Text style={styles.helper}>Confirm your current Two-Step Verification password to continue.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Field label="Password" value={current} onChangeText={setCurrent} secure placeholder="Current password" />
        <PrimaryButton
          label={mode === 'disable' ? 'Turn Off Two-Step Verification' : 'Continue'}
          onPress={mode === 'disable' ? handleDisable : handleVerifyCurrent}
          loading={busy}
        />
        <View style={{ height: space.sm }} />
        <TextLink label="Cancel" onPress={reset} muted />
      </ScrollView>
    );
  }

  if (!twoStep.enabled) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.introWrap}>
        <View style={[styles.iconCircle, { backgroundColor: colors.accentDim }]}>
          <Ionicons name="key" size={32} color={colors.accent} />
        </View>
        <Text style={styles.title}>Two-Step Verification</Text>
        <Text style={styles.helper}>
          Set an additional password that will be required for sensitive account actions, on top of your
          normal sign-in.
        </Text>
        <PrimaryButton label="Set a Password" onPress={() => setMode('set')} icon="lock-closed" />
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg }}>
      <SettingsSection footer={twoStep.hint ? `Hint: ${twoStep.hint}` : 'Two-Step Verification is currently on.'}>
        <SettingsRow icon="checkmark-circle" iconColor="#34C759" label="Status" value="Enabled" />
      </SettingsSection>
      <SettingsSection>
        <SettingsRow icon="key" iconColor="#007AFF" label="Change Password" onPress={() => setMode('change-verify')} />
        <SettingsRow icon="close-circle" iconColor="#FF3B30" label="Turn Off" destructive onPress={() => setMode('disable')} />
      </SettingsSection>
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    formWrap: { padding: space.lg, paddingBottom: space.xl * 3 },
    introWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm },
    iconCircle: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
    title: { ...type.h1, color: colors.textPrimary, textAlign: 'center' },
    helper: { ...type.body, color: colors.textMuted, textAlign: 'center', marginBottom: space.md, lineHeight: 19 },
    error: { ...type.small, color: colors.danger, marginBottom: space.sm },
  });
}
