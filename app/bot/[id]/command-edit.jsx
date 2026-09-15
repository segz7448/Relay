import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../../../theme';
import Field from '../../../components/Field';
import Checkbox from '../../../components/Checkbox';
import { PrimaryButton } from '../../../components/Button';
import ActionSheet from '../../../components/ActionSheet';
import { SkeletonBox } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/StateViews';
import { useToast } from '../../../components/Toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { fetchCommand, addCommand, updateCommand, removeCommand, ACTION_TYPES } from '../../../botsApi';

const ACTION_HELP = {
  'Reply with text': 'Sent back exactly as written, as soon as the command is received.',
  'Send welcome message': "Reuses this bot's welcome message from its profile.",
  'Open menu': 'Shows this bot\u2019s command list as a tappable menu.',
  'Trigger webhook': 'POSTs the update to this URL and relays whatever it returns.',
  'No action': 'Listed in the command menu, but does nothing yet.',
};

const ACTION_VALUE_LABEL = {
  'Reply with text': 'Response text',
  'Trigger webhook': 'Webhook URL',
};

export default function CommandEditScreen() {
  const { id, commandId } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const toast = useToast();
  const confirm = useConfirm();
  const isEditing = !!commandId;

  const [command, setCommand] = useState('');
  const [description, setDescription] = useState('');
  const [actionType, setActionType] = useState('Reply with text');
  const [actionValue, setActionValue] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [phase, setPhase] = useState(isEditing ? 'loading' : 'ready'); // 'loading' | 'ready' | 'error'
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const load = useCallback(async () => {
    if (!isEditing) return;
    try {
      // PHASE 11 — dedicated "Get command" endpoint, instead of loading
      // the whole bot and scanning its commands array for this one id.
      const cmd = await fetchCommand(id, commandId);
      if (!cmd) throw new Error('command_not_found');
      setCommand(cmd.command);
      setDescription(cmd.description);
      setActionType(cmd.actionType);
      setActionValue(cmd.actionValue);
      setEnabled(cmd.enabled);
      setPhase('ready');
    } catch (e) {
      setPhase('error');
    }
  }, [id, commandId, isEditing]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function retry() {
    setPhase('loading');
    await load();
  }

  const cmdClean = command.trim().replace(/^\//, '').toLowerCase();
  const cmdValid = /^[a-z][a-z0-9_]{0,31}$/.test(cmdClean);
  const canSave = cmdValid && description.trim().length > 0 && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    const fields = { command: cmdClean, description: description.trim(), actionType, actionValue: actionValue.trim(), enabled };
    try {
      if (isEditing) await updateCommand(id, commandId, fields);
      else await addCommand(id, fields);
      toast.success(isEditing ? 'Command saved' : 'Command added');
      router.back();
    } catch (e) {
      // PHASE 11 — the Worker rejects a duplicate command name for this
      // bot with a clear message ("/x already exists on this bot.");
      // surface it inline next to the field rather than only as a toast,
      // since it's exactly the kind of error someone will want to fix
      // and immediately retry without losing their place.
      setSaveError(e.message || 'Could not save this command.');
      toast.error(e.message || 'Could not save this command.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    const ok = await confirm({
      title: 'Delete command?',
      message: `Delete /${command}? This can't be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        await removeCommand(id, commandId);
      },
    });
    if (!ok) return;
    toast.success('Command deleted');
    router.back();
  }

  const actionActions = ACTION_TYPES.map((a) => ({
    key: a,
    label: a,
    icon: a === actionType ? 'checkmark' : 'ellipse-outline',
    onPress: () => setActionType(a),
  }));

  if (phase === 'loading') {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Edit command' }} />
        <View style={{ padding: space.lg }}>
          <SkeletonBox width="100%" height={56} radius={radius.md} style={{ marginBottom: space.md }} />
          <SkeletonBox width="100%" height={56} radius={radius.md} style={{ marginBottom: space.md }} />
          <SkeletonBox width="100%" height={56} radius={radius.md} />
        </View>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Edit command' }} />
        <ErrorState message="Couldn't load this command." onRetry={retry} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: isEditing ? 'Edit command' : 'New command' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg }}>
        <Field
          label="Command"
          value={command}
          onChangeText={(v) => { setCommand(v); setSaveError(null); }}
          placeholder="help"
          icon="return-down-forward"
          helper={
            saveError
              ? saveError
              : command && !cmdValid
              ? 'Lowercase letters, numbers, underscores — must start with a letter.'
              : 'Shown to people as /' + (cmdClean || 'command') + ' in the chat menu.'
          }
          error={saveError || (command && !cmdValid ? ' ' : null)}
        />
        <Field label="Description" value={description} onChangeText={setDescription} placeholder="e.g. Show what this bot can do" helper="Short summary next to the command in the “/” menu." />

        <Text style={styles.label}>Action</Text>
        <Pressable style={styles.selectRow} onPress={() => setActionSheetOpen(true)}>
          <Text style={styles.selectValue}>{actionType}</Text>
          <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
        </Pressable>
        <Text style={styles.helper}>{ACTION_HELP[actionType]}</Text>

        {ACTION_VALUE_LABEL[actionType] ? (
          <Field
            label={ACTION_VALUE_LABEL[actionType]}
            value={actionValue}
            onChangeText={setActionValue}
            placeholder={actionType === 'Trigger webhook' ? 'https://your-server.com/hook' : "What should the bot say back?"}
            mono={actionType === 'Trigger webhook'}
          />
        ) : null}

        <View style={styles.optionsCard}>
          <Checkbox checked={enabled} onToggle={() => setEnabled((v) => !v)}>Enabled</Checkbox>
        </View>

        <PrimaryButton label={saving ? 'Saving…' : isEditing ? 'Save command' : 'Add command'} disabled={!canSave} loading={saving} onPress={handleSave} />

        {isEditing ? (
          <Pressable style={({ pressed }) => [styles.deleteRow, pressed && { opacity: 0.6 }]} onPress={confirmDelete}>
            <Ionicons name="trash-outline" size={17} color={colors.danger} />
            <Text style={styles.deleteLabel}>Delete command</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <ActionSheet visible={actionSheetOpen} onClose={() => setActionSheetOpen(false)} title="Action" actions={actionActions} />
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
    optionsCard: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, padding: space.md, paddingBottom: space.xs,
      marginBottom: space.lg,
    },
    deleteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.lg },
    deleteLabel: { ...type.body, color: colors.danger, fontWeight: '600' },
  });
}
