import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { type, space, radius, useTheme } from '../theme';
import Field from '../components/Field';
import Checkbox from '../components/Checkbox';
import { PrimaryButton, SecondaryButton } from '../components/Button';
import StatusPill from '../components/StatusPill';
import { SkeletonBox } from '../components/Skeleton';
import { ErrorState } from '../components/StateViews';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import {
  EVENT_TYPES,
  fetchWebhook,
  fetchDeliveries,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  regenerateWebhookSecret,
  sendTestEvent,
} from '../devPlatformStore';

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const min = 60 * 1000, hr = 60 * min, day = 24 * hr;
  if (diff < min) return 'just now';
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}

export default function WebhookEditScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const toast = useToast();
  const confirm = useConfirm();
  const isEditing = !!id;

  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState([EVENT_TYPES[0]]);
  const [secretPrefix, setSecretPrefix] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [phase, setPhase] = useState(isEditing ? 'loading' : 'ready');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState(null);
  const [revealedSecret, setRevealedSecret] = useState(null); // new/regenerated secret, shown once
  const [copied, setCopied] = useState(false);

  const load = () => {
    if (!isEditing) return;
    setPhase('loading');
    fetchWebhook(id).then((wh) => {
      if (!wh) throw new Error('webhook_not_found');
      setUrl(wh.url);
      setDescription(wh.description);
      setEvents(wh.events);
      setSecretPrefix(wh.secretPrefix);
      setPhase('ready');
    }).catch(() => setPhase('error'));
    fetchDeliveries(id).then(setDeliveries);
  };

  useEffect(load, [id, isEditing]);

  const urlValid = /^https?:\/\/.+/.test(url.trim());
  const canSave = urlValid && events.length > 0 && !saving;

  function toggleEvent(ev) {
    setEvents((prev) => (prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]));
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      if (isEditing) {
        await updateWebhook(id, { url: url.trim(), description: description.trim(), events });
        toast.success('Webhook saved');
        router.back();
      } else {
        const { secret } = await createWebhook({ url: url.trim(), description: description.trim(), events });
        setRevealedSecret(secret);
      }
    } catch (e) {
      setError(e.message || 'Could not save this webhook.');
      toast.error(e.message || 'Could not save this webhook.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    const ok = await confirm({
      title: 'Delete Webhook?',
      message: 'This endpoint will stop receiving events immediately.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: handleDelete,
    });
    if (ok) router.back();
  }

  async function handleDelete() {
    await deleteWebhook(id);
  }

  async function confirmRegenerate() {
    await confirm({
      title: 'Regenerate Signing Secret?',
      message: 'Existing signatures made with the old secret will fail verification until you update it.',
      confirmLabel: 'Regenerate',
      destructive: true,
      onConfirm: async () => {
        const { secret } = await regenerateWebhookSecret(id);
        setRevealedSecret(secret);
      },
    });
  }

  async function copyRevealedSecret() {
    if (!revealedSecret) return;
    await Clipboard.setStringAsync(revealedSecret);
    setCopied(true);
    toast.success('Secret copied');
  }

  function closeReveal() {
    const wasCreating = !isEditing;
    setRevealedSecret(null);
    setCopied(false);
    if (wasCreating) router.replace('/settings-webhooks');
    else fetchWebhook(id).then((wh) => wh && setSecretPrefix(wh.secretPrefix));
  }

  async function handleTest() {
    setTesting(true);
    try {
      const { delivery } = await sendTestEvent(id, events[0]);
      setDeliveries((prev) => [delivery, ...prev]);
      const summary = `${delivery.event} · HTTP ${delivery.code} · ${delivery.latencyMs}ms`;
      if (delivery.status === 'success') toast.success(`Test delivered — ${summary}`);
      else toast.error(`Test failed — ${summary}`);
    } catch (e) {
      toast.error(e.message || 'Could not send test event');
    } finally {
      setTesting(false);
    }
  }

  if (phase === 'loading') {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Edit Webhook' }} />
        <View style={{ padding: space.lg }}>
          <SkeletonBox width="100%" height={64} radius={radius.md} style={{ marginBottom: space.lg }} />
          <SkeletonBox width="100%" height={64} radius={radius.md} style={{ marginBottom: space.lg }} />
          <SkeletonBox width="100%" height={140} radius={radius.md} />
        </View>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Webhook' }} />
        <ErrorState message="Couldn't load this webhook." onRetry={load} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: isEditing ? 'Edit Webhook' : 'New Webhook' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg }}>
        <Field
          label="Endpoint URL"
          value={url}
          onChangeText={setUrl}
          placeholder="https://your-server.com/hooks/botmanager"
          icon="link-outline"
          mono
          keyboardType="url"
          helper={url && !urlValid ? 'Must be a valid http(s) URL.' : "We'll POST a JSON payload here for every selected event."}
          error={url && !urlValid ? ' ' : null}
        />
        <Field
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="e.g. Forward messages to support desk"
          autoCapitalize="sentences"
        />

        <Text style={styles.label}>Events</Text>
        <View style={styles.eventsCard}>
          {EVENT_TYPES.map((ev, i) => (
            <View key={ev} style={i > 0 ? styles.eventRowBorder : null}>
              <Checkbox checked={events.includes(ev)} onToggle={() => toggleEvent(ev)}>{ev}</Checkbox>
            </View>
          ))}
        </View>

        {isEditing ? (
          <>
            <Text style={styles.label}>Signing Secret</Text>
            <View style={styles.secretRow}>
              <Text style={styles.secretText} numberOfLines={1}>{secretPrefix}{'•'.repeat(18)}</Text>
            </View>
            <SecondaryButton label="Regenerate Secret" icon="sync" onPress={confirmRegenerate} />

            <View style={{ height: space.lg }} />
            <Text style={styles.label}>Test Delivery</Text>
            <SecondaryButton label={testing ? 'Sending…' : 'Send Test Event'} icon="paper-plane-outline" loading={testing} onPress={handleTest} />

            {deliveries.length > 0 ? (
              <>
                <Text style={[styles.label, { marginTop: space.lg }]}>Recent Deliveries</Text>
                <View style={styles.deliveriesCard}>
                  {deliveries.slice(0, 8).map((d, i) => (
                    <View key={d.id} style={[styles.deliveryRow, i > 0 && styles.eventRowBorder]}>
                      <StatusPill status={d.status === 'success' ? 'online' : 'error'} />
                      <View style={{ flex: 1, marginLeft: space.sm }}>
                        <Text style={styles.deliveryEvent} numberOfLines={1}>{d.event}</Text>
                        <Text style={styles.deliveryMeta}>HTTP {d.code} · {d.latencyMs}ms · {timeAgo(d.timestamp)}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={{ height: space.lg }} />
        <PrimaryButton label={saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Create Webhook'} disabled={!canSave} loading={saving} onPress={handleSave} />

        {isEditing ? (
          <Pressable style={styles.deleteRow} onPress={confirmDelete}>
            <Ionicons name="trash-outline" size={17} color={colors.danger} />
            <Text style={styles.deleteLabel}>Delete webhook</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {revealedSecret ? (
        <View style={styles.revealBackdrop}>
          <View style={styles.revealCard}>
            <Ionicons name="checkmark-circle" size={32} color={colors.online} style={{ alignSelf: 'center', marginBottom: space.sm }} />
            <Text style={styles.revealTitle}>{isEditing ? 'Secret regenerated' : 'Webhook created'}</Text>
            <Text style={styles.revealWarning}>Copy this signing secret now — it won't be shown again.</Text>
            <View style={styles.secretBox}>
              <Text style={styles.secretBoxText} selectable>{revealedSecret}</Text>
            </View>
            <Pressable style={styles.copyBtn} onPress={copyRevealedSecret}>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={colors.textPrimary} />
              <Text style={styles.copyBtnLabel}>{copied ? 'Copied' : 'Copy Secret'}</Text>
            </Pressable>
            <Pressable style={styles.doneBtn} onPress={closeReveal}>
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
    label: { ...type.small, color: colors.textSecondary, marginBottom: space.xs, fontWeight: '600' },
    eventsCard: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, padding: space.md, paddingBottom: space.xs, marginBottom: space.lg,
    },
    eventRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: space.sm, marginTop: -space.xs },
    secretRow: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md, marginBottom: space.md,
    },
    secretText: { ...type.dataSm, fontSize: 13, color: colors.accent },
    deliveriesCard: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, paddingHorizontal: space.md, overflow: 'hidden',
    },
    deliveryRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm },
    deliveryEvent: { ...type.dataSm, fontSize: 12, color: colors.textPrimary },
    deliveryMeta: { ...type.small, color: colors.textMuted, marginTop: 1 },
    error: { ...type.small, color: colors.danger, marginTop: space.md },
    deleteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.lg },
    deleteLabel: { ...type.body, color: colors.danger, fontWeight: '600' },
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
