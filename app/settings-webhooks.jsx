import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, Switch, StyleSheet } from 'react-native';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../theme';
import HeaderIconButton from '../components/HeaderIconButton';
import StatusPill from '../components/StatusPill';
import { SkeletonList } from '../components/Skeleton';
import { ErrorState, EmptyState } from '../components/StateViews';
import { useToast } from '../components/Toast';
import { hapticSwitch } from '../utils/haptics';
import { fetchWebhooks, toggleWebhookEnabled } from '../devPlatformStore';

function timeAgo(ts) {
  if (!ts) return 'Never fired';
  const diff = Date.now() - ts;
  const min = 60 * 1000, hr = 60 * min, day = 24 * hr;
  if (diff < min) return 'just now';
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}

function statusFor(wh) {
  if (!wh.enabled) return 'offline';
  if (wh.lastDeliveryStatus === 'failed') return 'error';
  if (wh.lastDeliveryStatus === 'success') return 'online';
  return 'offline';
}

export default function WebhooksScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const toast = useToast();
  const [webhooks, setWebhooks] = useState([]);
  const [phase, setPhase] = useState('loading');

  const load = useCallback(async () => {
    try {
      const list = await fetchWebhooks();
      setWebhooks(list);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const loaded = phase !== 'loading';

  async function handleToggle(wh) {
    hapticSwitch();
    setWebhooks((list) => list.map((w) => (w.id === wh.id ? { ...w, enabled: !w.enabled } : w)));
    try {
      const next = await toggleWebhookEnabled(wh.id);
      setWebhooks(next);
    } catch {
      setWebhooks((list) => list.map((w) => (w.id === wh.id ? { ...w, enabled: wh.enabled } : w)));
      toast.error("Couldn't update this webhook");
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: 'Webhooks',
          headerRight: () => <HeaderIconButton icon="add" onPress={() => router.push('/settings-webhook-edit')} />,
        }}
      />
      {phase === 'loading' ? (
        <View style={{ padding: space.lg }}>
          <SkeletonList count={3} />
        </View>
      ) : phase === 'error' ? (
        <ErrorState message="Couldn't load your webhooks." onRetry={load} />
      ) : (
      <FlatList
        data={webhooks}
        keyExtractor={(w) => w.id}
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 3, flexGrow: 1 }}
        ListHeaderComponent={
          loaded && webhooks.length > 0 ? (
            <Text style={styles.helperTop}>
              Webhooks push a POST request to your server the moment an event happens, so you don't have to poll the API for updates.
            </Text>
          ) : null
        }
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/settings-webhook-edit?id=${item.id}`)}
            style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.surfaceRaised }, !item.enabled && { opacity: 0.7 }]}
          >
            <View style={styles.topRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.url} numberOfLines={1}>{item.url}</Text>
                {item.description ? <Text style={styles.description} numberOfLines={1}>{item.description}</Text> : null}
              </View>
              <Switch
                value={item.enabled}
                onValueChange={() => handleToggle(item)}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor="#FFFFFF"
                ios_backgroundColor={colors.border}
              />
            </View>

            <View style={styles.eventsRow}>
              {item.events.slice(0, 3).map((e) => (
                <View key={e} style={styles.eventChip}>
                  <Text style={styles.eventChipText}>{e}</Text>
                </View>
              ))}
              {item.events.length > 3 ? (
                <View style={styles.eventChip}>
                  <Text style={styles.eventChipText}>+{item.events.length - 3}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.bottomRow}>
              <StatusPill status={statusFor(item)} />
              <Text style={styles.lastFired}>
                {item.lastDeliveryAt ? `${item.lastDeliveryCode} · ${timeAgo(item.lastDeliveryAt)}` : 'Never fired'}
              </Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="git-network-outline"
            title="No Webhooks Yet"
            message="Add one to get pushed events instead of polling."
            actionLabel="Add Webhook"
            onAction={() => router.push('/settings-webhook-edit')}
          />
        }
      />
      )}
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    helperTop: { ...type.small, color: colors.textMuted, marginBottom: space.lg, lineHeight: 17 },
    card: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, padding: space.md,
    },
    topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
    url: { ...type.dataSm, fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
    description: { ...type.small, color: colors.textMuted, marginTop: 2 },
    eventsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.sm },
    eventChip: {
      backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 3,
    },
    eventChipText: { ...type.dataSm, fontSize: 10, color: colors.textSecondary },
    bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm },
    lastFired: { ...type.small, color: colors.textMuted },
    empty: { alignItems: 'center', gap: space.sm, paddingTop: space.xl },
    emptyText: { ...type.small, color: colors.textMuted, textAlign: 'center', lineHeight: 17, paddingHorizontal: space.xl },
  });
}
