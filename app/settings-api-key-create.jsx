import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { type, space, radius, useTheme } from '../theme';
import Field from '../components/Field';
import { PrimaryButton, SecondaryButton } from '../components/Button';
import ActionSheet from '../components/ActionSheet';
import { useToast } from '../components/Toast';
import { createApiKey, SCOPES, SCOPE_HELP } from '../devPlatformStore';

export default function ApiKeyCreateScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const toast = useToast();

  const [name, setName] = useState('');
  const [scope, setScope] = useState('Full access');
  const [scopeSheetOpen, setScopeSheetOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // { secret, key }
  const [copied, setCopied] = useState(false);

  const canCreate = name.trim().length > 0 && !creating;

  async function handleCreate() {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    try {
      const { secret, key } = await createApiKey({ name: name.trim(), scope });
      setResult({ secret, key });
    } catch (e) {
      setError(e.message || 'Could not create this key.');
      toast.error(e.message || 'Could not create this key.');
    } finally {
      setCreating(false);
    }
  }

  async function copySecret() {
    if (!result) return;
    await Clipboard.setStringAsync(result.secret);
    setCopied(true);
    toast.success('Key copied');
  }

  const scopeActions = SCOPES.map((s) => ({
    key: s,
    label: s,
    icon: s === scope ? 'checkmark' : 'ellipse-outline',
    onPress: () => setScope(s),
  }));

  if (result) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Key created', headerLeft: () => null, gestureEnabled: false }} />
        <ScrollView contentContainerStyle={{ padding: space.lg }}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={40} color={colors.online} />
          </View>
          <Text style={styles.successTitle}>"{result.key.name}" is ready</Text>
          <Text style={styles.warning}>
            Copy this key now — for your security, botmanager won't show it again.
          </Text>

          <View style={styles.secretBox}>
            <Text style={styles.secretText} selectable>{result.secret}</Text>
          </View>

          <SecondaryButton
            label={copied ? 'Copied' : 'Copy Key'}
            icon={copied ? 'checkmark' : 'copy-outline'}
            onPress={copySecret}
          />

          <View style={{ height: space.md }} />
          <PrimaryButton label="Done" onPress={() => router.replace('/settings-api-keys')} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'New API Key' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg }}>
        <Field
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Production, CI Pipeline"
          icon="pricetag-outline"
          autoCapitalize="words"
          helper="A label to help you tell keys apart later — not shown to the API."
        />

        <Text style={styles.label}>Scope</Text>
        <Pressable style={styles.selectRow} onPress={() => setScopeSheetOpen(true)}>
          <Text style={styles.selectValue}>{scope}</Text>
          <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
        </Pressable>
        <Text style={styles.helper}>{SCOPE_HELP[scope]}</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton label={creating ? 'Creating…' : 'Create Key'} disabled={!canCreate} loading={creating} onPress={handleCreate} />
      </ScrollView>

      <ActionSheet visible={scopeSheetOpen} onClose={() => setScopeSheetOpen(false)} title="Scope" actions={scopeActions} />
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    label: { ...type.small, color: colors.textSecondary, marginBottom: space.xs, fontWeight: '600' },
    selectRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
      borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md,
    },
    selectValue: { ...type.body, color: colors.textPrimary, fontWeight: '500' },
    helper: { ...type.small, color: colors.textMuted, marginTop: space.xs, marginBottom: space.lg, lineHeight: 16 },
    error: { ...type.small, color: colors.danger, marginBottom: space.md },
    successIcon: { alignItems: 'center', marginBottom: space.md, marginTop: space.md },
    successTitle: { ...type.h1, color: colors.textPrimary, textAlign: 'center', marginBottom: space.sm },
    warning: { ...type.small, color: colors.warning, textAlign: 'center', lineHeight: 17, marginBottom: space.lg },
    secretBox: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, padding: space.md, marginBottom: space.lg,
    },
    secretText: { ...type.dataSm, fontSize: 13, color: colors.accent, lineHeight: 19 },
  });
}
