import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Switch, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../../../theme';
import { SecondaryButton } from '../../../components/Button';
import { SkeletonBox } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/StateViews';
import { useToast } from '../../../components/Toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { useStatusBurst } from '../../../components/StatusBurst';
import { hapticSwitch } from '../../../utils/haptics';
import { fetchBot, fetchBotWebhook, updateBot, setBotEnabled, rotateBotToken, revokeBotToken, deleteBot } from '../../../botsApi';

function ToggleRow({ label, helper, value, onValueChange, styles, colors, disabled }) {
  return (
    <View style={styles.switchRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.switchLabel, disabled && { color: colors.textMuted }]}>{label}</Text>
        {helper ? <Text style={styles.switchHelper}>{helper}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={(v) => { hapticSwitch(); onValueChange(v); }}
        disabled={disabled}
        trackColor={{ false: colors.surfaceRaised, true: colors.accentDim }}
        thumbColor={value ? colors.accent : colors.textMuted}
      />
    </View>
  );
}

export default function BotSettingsScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const toast = useToast();
  const confirm = useConfirm();
  const burst = useStatusBurst();

  const [bot, setBot] = useState(null);
  const [newToken, setNewToken] = useState(null);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [rotating, setRotating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  // PHASE 16 — the configured webhook's state, fetched through the
  // dedicated webhook route so this row can deep-link to the real
  // management screen. null = not configured.
  const [webhook, setWebhook] = useState(null);

  const load = useCallback(async () => {
    try {
      const b = await fetchBot(id);
      if (!b) throw new Error('bot_not_found');
      let wh = null;
      try {
        wh = await fetchBotWebhook(id);
      } catch (e) {
        if (e.message !== 'not_configured') throw e;
      }
      setBot(b);
      setWebhook(wh);
      setPhase('ready');
    } catch (e) {
      setPhase('error');
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function retry() {
    setPhase('loading');
    await load();
  }

  async function patch(changes) {
    const previous = bot;
    setBot((b) => ({ ...b, ...changes }));
    try {
      await updateBot(id, changes);
    } catch (e) {
      setBot(previous);
      toast.error("Couldn't save that change");
    }
  }

  async function handleToggleEnabled(value) {
    const previous = bot;
    setBot((b) => ({ ...b, enabled: value, status: value ? 'online' : 'disabled' }));
    try {
      await setBotEnabled(id, value);
      toast.show(value ? 'Bot enabled' : 'Bot disabled');
    } catch (e) {
      setBot(previous);
      toast.error("Couldn't update this bot");
    }
  }

  async function handleRotate() {
    setRotating(true);
    try {
      const token = await rotateBotToken(id);
      setNewToken(token);
      const updated = await fetchBot(id);
      setBot(updated);
      toast.success('Token rotated');
    } catch (e) {
      toast.error("Couldn't rotate the token");
    } finally {
      setRotating(false);
    }
  }

  async function handleCopyToken() {
    if (!newToken) return;
    await Clipboard.setStringAsync(newToken);
    toast.success('Token copied');
  }

  async function confirmRevoke() {
    const ok = await confirm({
      title: 'Revoke token?',
      message: "The bot's current token stops working immediately. It won't be able to receive messages again until you rotate the token.",
      confirmLabel: 'Revoke',
      destructive: true,
      onConfirm: async () => {
        setRevoking(true);
        try {
          const updated = await revokeBotToken(id);
          setBot(updated);
          setNewToken(null);
          toast.success('Token revoked');
        } catch (e) {
          toast.error("Couldn't revoke the token");
        } finally {
          setRevoking(false);
        }
      },
    });
  }

  async function confirmDelete() {
    const ok = await confirm({
      title: 'Delete bot?',
      message: `Delete "${bot.name}"? This can't be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        await deleteBot(id);
      },
    });
    if (!ok) return;
    burst.success('Bot deleted');
    router.replace('/');
  }

  if (phase === 'loading') {
    return (
      <View style={styles.screen}>
        <View style={{ padding: space.lg }}>
          <SkeletonBox width="100%" height={64} radius={radius.lg} style={{ marginBottom: space.lg }} />
          <SkeletonBox width="100%" height={180} radius={radius.lg} style={{ marginBottom: space.lg }} />
          <SkeletonBox width="100%" height={64} radius={radius.lg} />
        </View>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.screen}>
        <ErrorState message="Couldn't load this bot's settings." onRetry={retry} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: space.lg }}>
      <Text style={styles.sectionLabel}>Bot status</Text>
      <View style={styles.card}>
        <ToggleRow
          label="Enable bot"
          helper="Turn the bot fully off without deleting it."
          value={bot.enabled}
          onValueChange={handleToggleEnabled}
          styles={styles} colors={colors}
        />
      </View>

      <Text style={styles.sectionLabel}>Permissions</Text>
      <View style={styles.card}>
        <ToggleRow label="Allow messages" value={bot.allowMessages} disabled={!bot.enabled} onValueChange={(v) => patch({ allowMessages: v })} styles={styles} colors={colors} />
        <View style={styles.hairline} />
        <ToggleRow label="Allow files" value={bot.allowFiles} disabled={!bot.enabled} onValueChange={(v) => patch({ allowFiles: v })} styles={styles} colors={colors} />
        <View style={styles.hairline} />
        <ToggleRow label="Allow commands" value={bot.allowCommands} disabled={!bot.enabled} onValueChange={(v) => patch({ allowCommands: v })} styles={styles} colors={colors} />
        <View style={styles.hairline} />
        <ToggleRow label="Enable notifications" helper="Push a notification on every new message." value={bot.enableNotifications} onValueChange={(v) => patch({ enableNotifications: v })} styles={styles} colors={colors} />
        <View style={styles.hairline} />
        <ToggleRow
          label="Notify on every message"
          helper="Otherwise notifications are batched/summarized."
          value={bot.notifyOnMessage}
          disabled={!bot.enableNotifications}
          onValueChange={(v) => patch({ notifyOnMessage: v })}
          styles={styles} colors={colors}
        />
      </View>

      <Text style={styles.sectionLabel}>Webhook</Text>
      <View style={styles.card}>
        <Pressable
          style={({ pressed }) => [styles.webhookRow, pressed && { backgroundColor: colors.surfaceRaised }]}
          onPress={() => router.push(`/bot/${id}/webhook`)}
          accessibilityRole="button"
          accessibilityLabel="Manage webhook"
        >
          <Ionicons name="git-branch-outline" size={17} color={colors.textSecondary} />
          <Text style={styles.webhookRowLabel}>Webhook</Text>
          <Text style={styles.webhookRowValue}>
            {webhook ? (webhook.enabled ? 'Enabled' : 'Paused') : 'Not set up'}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>
      </View>
      <Text style={styles.helper}>
        Configure the endpoint, signing secret, test events, and delivery history on the webhook screen.
      </Text>

      <Text style={styles.sectionLabel}>Credentials</Text>
      <View style={styles.card}>
        <View style={styles.tokenRow}>
          <Text style={styles.rowLabel}>Token</Text>
          <Text style={styles.tokenValue} numberOfLines={1}>
            {newToken ?? (bot.tokenRevoked ? 'Revoked' : `${bot.tokenPrefix}••••••••`)}
          </Text>
        </View>
      </View>
      {newToken ? (
        <>
          <Text style={styles.helper}>This is shown once — copy it now.</Text>
          <SecondaryButton label="Copy token" icon="copy-outline" onPress={handleCopyToken} />
          <View style={{ height: space.sm }} />
        </>
      ) : bot.tokenRevoked ? (
        <Text style={styles.helper}>This bot's token is revoked. Rotate it to issue a new working token.</Text>
      ) : null}
      <SecondaryButton label={rotating ? 'Rotating…' : 'Rotate token'} icon="key-outline" disabled={rotating} loading={rotating} onPress={handleRotate} />
      <View style={{ height: space.sm }} />
      <SecondaryButton
        label={revoking ? 'Revoking…' : 'Revoke token'}
        icon="close-circle-outline"
        disabled={revoking || bot.tokenRevoked}
        loading={revoking}
        onPress={confirmRevoke}
      />

      <Text style={[styles.sectionLabel, { color: colors.danger }]}>Danger zone</Text>
      <Pressable style={({ pressed }) => [styles.deleteRow, pressed && { opacity: 0.6 }]} onPress={confirmDelete}>
        <Ionicons name="trash-outline" size={17} color={colors.danger} />
        <Text style={styles.deleteLabel}>Delete bot</Text>
      </Pressable>
    </ScrollView>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    sectionLabel: {
      ...type.small, color: colors.textMuted, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 0.6,
      marginTop: space.lg, marginBottom: space.sm,
    },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.lg,
      borderWidth: 1, borderColor: colors.border, overflow: 'hidden', paddingHorizontal: space.md,
    },
    hairline: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
    switchLabel: { ...type.body, color: colors.textPrimary, fontWeight: '500' },
    switchHelper: { ...type.small, color: colors.textMuted, marginTop: 2 },
    tokenRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space.md, gap: space.md },
    rowLabel: { ...type.body, color: colors.textSecondary },
    tokenValue: { ...type.dataSm, color: colors.textPrimary, flexShrink: 1 },
    helper: { ...type.small, color: colors.textMuted, marginTop: space.xs, marginBottom: space.sm },
    webhookRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md },
    webhookRowLabel: { ...type.body, color: colors.textPrimary, flex: 1 },
    webhookRowValue: { ...type.small, color: colors.textMuted },
    deleteRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
    deleteLabel: { ...type.body, color: colors.danger, fontWeight: '600' },
  });
}
