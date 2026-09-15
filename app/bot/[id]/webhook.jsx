// app/bot/[id]/webhook.jsx — PHASE 16 — Bot webhook management.
//
// The Worker has a full dedicated webhook surface (configure / update /
// enable / disable / rotate-secret / test / deliveries / delete — see
// worker/src/routes/bots.ts "PHASE 16"), and botsApi.js wraps every one
// of them. This screen is the UI for that surface. It replaces the old
// generic `updateBot({ webhookUrl })` field on the bot settings screen,
// which only ever wrote the pipeline's mirror column and could not reach
// enable/disable, secret rotation, test deliveries, or history.
//
// Secret handling: the raw signing secret is returned by the Worker
// exactly once (on configure and on rotate) and is never stored anywhere
// client-side beyond the reveal modal's local state — copy it, then
// dismiss. Afterwards only `secretPrefix` is shown.

import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../../../theme';
import Field from '../../../components/Field';
import ToggleRow from '../../../components/ToggleRow';
import StatusPill from '../../../components/StatusPill';
import { PrimaryButton, SecondaryButton } from '../../../components/Button';
import { SkeletonBox } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/StateViews';
import { useToast } from '../../../components/Toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import {
  fetchBotWebhook,
  configureBotWebhook,
  updateBotWebhook,
  setBotWebhookEnabled,
  rotateBotWebhookSecret,
  testBotWebhook,
  removeBotWebhook,
} from '../../../botsApi';
import { timeAgo } from '../../../utils/botInboxFormat.mjs';

function statusOf(wh) {
  if (!wh.enabled) return 'offline';
  if (wh.lastDeliveryStatus === 'failed' || wh.lastDeliveryStatus === 'exhausted') return 'error';
  if (wh.lastDeliveryStatus === 'delivered') return 'online';
  return 'offline';
}

export default function BotWebhookScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const toast = useToast();
  const confirm = useConfirm();

  const [webhook, setWebhook] = useState(null); // null = not configured
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      try {
        const wh = await fetchBotWebhook(id);
        setWebhook(wh);
        setUrlInput(wh.url);
      } catch (e) {
        // The Worker 404s with { error: 'not_configured' } when the bot has
        // no webhook yet — that is a real state, not a failure.
        if (e.message !== 'not_configured') throw e;
        setWebhook(null);
        setUrlInput('');
      }
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

  const urlDirty = urlInput.trim() !== (webhook?.url ?? '');

  async function handleConfigure() {
    setSaving(true);
    setUrlError(null);
    try {
      const { secret, ...wh } = await configureBotWebhook(id, urlInput.trim());
      setWebhook(wh);
      setUrlInput(wh.url);
      // Raw secret, shown once — see the module note.
      setRevealedSecret(secret);
      setCopied(false);
    } catch (e) {
      setUrlError(e.message || 'Enter a valid https:// URL.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveUrl() {
    setSaving(true);
    setUrlError(null);
    try {
      const wh = await updateBotWebhook(id, urlInput.trim());
      setWebhook(wh);
      setUrlInput(wh.url);
      toast.success('Webhook URL updated');
    } catch (e) {
      setUrlError(e.message || 'Enter a valid https:// URL.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleEnabled(value) {
    const previous = webhook;
    setWebhook((wh) => ({ ...wh, enabled: value }));
    setToggling(true);
    try {
      const wh = await setBotWebhookEnabled(id, value);
      setWebhook(wh);
      toast.show(value ? 'Webhook enabled' : 'Webhook paused');
    } catch (e) {
      setWebhook(previous);
      toast.error("Couldn't update this webhook");
    } finally {
      setToggling(false);
    }
  }

  async function confirmRotate() {
    await confirm({
      title: 'Rotate signing secret?',
      message: 'The current secret stops working immediately. Update your endpoint with the new secret or signature verification will fail.',
      confirmLabel: 'Rotate',
      destructive: true,
      onConfirm: async () => {
        setRotating(true);
        try {
          const { secret, secretPrefix } = await rotateBotWebhookSecret(id);
          setWebhook((wh) => ({ ...wh, secretPrefix }));
          setRevealedSecret(secret);
          setCopied(false);
        } catch (e) {
          toast.error("Couldn't rotate the secret");
        } finally {
          setRotating(false);
        }
      },
    });
  }

  async function handleTest() {
    setTesting(true);
    try {
      const { delivery } = await testBotWebhook(id);
      const summary = `${delivery.code != null ? `HTTP ${delivery.code}` : 'no response'} · ${delivery.latencyMs}ms`;
      if (delivery.ok) toast.success(`Test delivered — ${summary}`);
      else toast.error(`Test failed — ${summary}`);
      await load(); // picks up lastDelivery* and the new history entry
    } catch (e) {
      toast.error(e.message || 'Could not send a test event');
    } finally {
      setTesting(false);
    }
  }

  async function confirmDelete() {
    const ok = await confirm({
      title: 'Delete webhook?',
      message: 'This bot stops sending events to your endpoint, and its delivery history is removed. You can configure a new webhook afterwards.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        await removeBotWebhook(id);
      },
    });
    if (!ok) return;
    setWebhook(null);
    setUrlInput('');
    toast.success('Webhook deleted');
  }

  async function copyRevealedSecret() {
    if (!revealedSecret) return;
    await Clipboard.setStringAsync(revealedSecret);
    setCopied(true);
    toast.success('Secret copied');
  }

  if (phase === 'loading') {
    return (
      <View style={styles.screen}>
        <View style={{ padding: space.lg }}>
          <SkeletonBox width="100%" height={84} radius={radius.lg} style={{ marginBottom: space.lg }} />
          <SkeletonBox width="100%" height={64} radius={radius.lg} style={{ marginBottom: space.lg }} />
          <SkeletonBox width="100%" height={140} radius={radius.lg} />
        </View>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.screen}>
        <ErrorState message="Couldn't load this bot's webhook." onRetry={retry} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 2 }}>
        {webhook ? (
          <>
            <View style={styles.statusCard}>
              <StatusPill status={statusOf(webhook)} />
              <Text style={styles.statusUrl} numberOfLines={2}>{webhook.url}</Text>
              <Text style={styles.statusMeta}>
                {webhook.lastDeliveryAt
                  ? `Last delivery ${webhook.lastDeliveryStatus === 'delivered' ? 'succeeded' : 'failed'} · ${webhook.lastDeliveryCode != null ? `HTTP ${webhook.lastDeliveryCode} · ` : ''}${timeAgo(webhook.lastDeliveryAt)}`
                  : 'No deliveries yet'}
              </Text>
            </View>

            <Text style={styles.sectionLabel}>Delivery</Text>
            <View style={styles.card}>
              <ToggleRow
                label="Send events to this endpoint"
                helper="When off, events are dropped instead of delivered."
                value={webhook.enabled}
                disabled={toggling}
                onValueChange={handleToggleEnabled}
              />
            </View>

            <Text style={styles.sectionLabel}>Endpoint URL</Text>
            <View style={styles.card}>
              <Field
                value={urlInput}
                onChangeText={(v) => { setUrlInput(v); setUrlError(null); }}
                placeholder="https://your-server.com/hook"
                helper={urlError ?? "This bot's event payloads are POSTed here, signed with the secret below."}
                error={urlError}
                mono
                autoCapitalize="none"
                keyboardType="url"
                textContentType="URL"
              />
            </View>
            <View style={{ height: space.sm }} />
            <SecondaryButton
              label={saving ? 'Saving…' : 'Save URL'}
              icon="link-outline"
              disabled={saving || !urlDirty}
              loading={saving}
              onPress={handleSaveUrl}
            />

            <Text style={styles.sectionLabel}>Signing secret</Text>
            <View style={styles.card}>
              <View style={styles.secretRow}>
                <Text style={styles.rowLabel}>Secret</Text>
                <Text style={styles.secretValue} numberOfLines={1}>{webhook.secretPrefix}{'•'.repeat(12)}</Text>
              </View>
            </View>
            <Text style={styles.helper}>
              Payloads are signed with this secret so your endpoint can verify they came from Relay. Only the prefix is ever shown after setup.
            </Text>
            <SecondaryButton
              label={rotating ? 'Rotating…' : 'Rotate secret'}
              icon="sync-outline"
              disabled={rotating}
              loading={rotating}
              onPress={confirmRotate}
            />

            <Text style={styles.sectionLabel}>Deliveries</Text>
            <View style={styles.card}>
              <Pressable
                style={({ pressed }) => [styles.linkRow, pressed && { backgroundColor: colors.surfaceRaised }]}
                onPress={() => router.push(`/bot/${id}/webhook-deliveries`)}
                accessibilityRole="button"
                accessibilityLabel="View webhook delivery history"
              >
                <Ionicons name="list-outline" size={17} color={colors.textSecondary} />
                <Text style={styles.linkLabel}>Delivery history</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </Pressable>
            </View>
            <View style={{ height: space.sm }} />
            <SecondaryButton
              label={testing ? 'Sending…' : 'Send test event'}
              icon="paper-plane-outline"
              disabled={testing}
              loading={testing}
              onPress={handleTest}
              accessibilityLabel="Send a test event to this webhook"
            />

            <Text style={[styles.sectionLabel, { color: colors.danger }]}>Danger zone</Text>
            <Pressable
              style={({ pressed }) => [styles.deleteRow, pressed && { opacity: 0.6 }]}
              onPress={confirmDelete}
              accessibilityRole="button"
              accessibilityLabel="Delete webhook"
            >
              <Ionicons name="trash-outline" size={17} color={colors.danger} />
              <Text style={styles.deleteLabel}>Delete webhook</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.emptyHero}>
              <View style={styles.heroIcon}>
                <Ionicons name="git-branch-outline" size={26} color={colors.accent} />
              </View>
              <Text style={styles.heroTitle}>No webhook configured</Text>
              <Text style={styles.heroText}>
                Get this bot's events — new messages, command runs, delivery results — POSTed to your own server as signed JSON payloads.
              </Text>
            </View>

            <Text style={styles.sectionLabel}>Endpoint URL</Text>
            <View style={styles.card}>
              <Field
                value={urlInput}
                onChangeText={(v) => { setUrlInput(v); setUrlError(null); }}
                placeholder="https://your-server.com/hook"
                helper={urlError ?? 'Must be a public https:// URL. Local and private addresses are rejected.'}
                error={urlError}
                mono
                autoCapitalize="none"
                keyboardType="url"
                textContentType="URL"
              />
            </View>
            <View style={{ height: space.md }} />
            <PrimaryButton
              label={saving ? 'Setting up…' : 'Set up webhook'}
              icon="add"
              disabled={saving || !urlInput.trim()}
              loading={saving}
              onPress={handleConfigure}
            />
          </>
        )}
      </ScrollView>

      {revealedSecret ? (
        <View style={styles.revealBackdrop}>
          <View style={styles.revealCard}>
            <Ionicons name="checkmark-circle" size={32} color={colors.online} style={{ alignSelf: 'center', marginBottom: space.sm }} />
            <Text style={styles.revealTitle}>{webhook ? 'Signing secret' : 'Webhook created'}</Text>
            <Text style={styles.revealWarning}>Copy this signing secret now — it won't be shown again.</Text>
            <View style={styles.secretBox}>
              <Text style={styles.secretBoxText} selectable>{revealedSecret}</Text>
            </View>
            <Pressable style={styles.copyBtn} onPress={copyRevealedSecret} accessibilityRole="button">
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={colors.textPrimary} />
              <Text style={styles.copyBtnLabel}>{copied ? 'Copied' : 'Copy secret'}</Text>
            </Pressable>
            <Pressable style={styles.doneBtn} onPress={() => { setRevealedSecret(null); setCopied(false); }} accessibilityRole="button">
              <Text style={styles.doneBtnLabel}>Done</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
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
    statusCard: {
      backgroundColor: colors.surface, borderRadius: radius.lg,
      borderWidth: 1, borderColor: colors.border, padding: space.md, gap: space.sm,
    },
    statusUrl: { ...type.dataSm, color: colors.textPrimary },
    statusMeta: { ...type.small, color: colors.textMuted },
    rowLabel: { ...type.body, color: colors.textSecondary },
    secretRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space.md, gap: space.md },
    secretValue: { ...type.dataSm, color: colors.accent, flexShrink: 1 },
    helper: { ...type.small, color: colors.textMuted, marginTop: space.xs, marginBottom: space.sm, lineHeight: 16 },
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md },
    linkLabel: { ...type.body, color: colors.textPrimary, flex: 1 },
    deleteRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
    deleteLabel: { ...type.body, color: colors.danger, fontWeight: '600' },
    emptyHero: { alignItems: 'center', paddingVertical: space.lg, paddingHorizontal: space.md },
    heroIcon: {
      width: 60, height: 60, borderRadius: 30, backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginBottom: space.md,
    },
    heroTitle: { ...type.h2, color: colors.textPrimary, textAlign: 'center' },
    heroText: { ...type.body, color: colors.textMuted, textAlign: 'center', marginTop: space.xs, lineHeight: 19 },
    revealBackdrop: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: space.lg,
    },
    revealCard: {
      width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.lg, padding: space.lg,
    },
    revealTitle: { ...type.h1, fontSize: 17, color: colors.textPrimary, textAlign: 'center', marginBottom: space.xs },
    revealWarning: { ...type.small, color: colors.warning, textAlign: 'center', marginBottom: space.md, lineHeight: 16 },
    secretBox: {
      backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, padding: space.md, marginBottom: space.md,
    },
    secretBoxText: { ...type.dataSm, fontSize: 13, color: colors.accent, lineHeight: 19 },
    copyBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs,
      borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: space.md, marginBottom: space.sm,
    },
    copyBtnLabel: { ...type.body, color: colors.textPrimary, fontWeight: '600' },
    doneBtn: { alignItems: 'center', paddingVertical: space.sm },
    doneBtnLabel: { ...type.body, color: colors.accent, fontWeight: '700' },
  });
}
