// app/bot/[id]/webhook-deliveries.jsx — PHASE 16 — Webhook delivery history.
//
// Real view over GET /bots/:id/webhook/deliveries (the Worker returns the
// newest 50 attempts, each a recorded *real* delivery — see
// worker/src/lib/botWebhookDelivery.ts). Loading, error-with-retry,
// unconfigured, and empty states are all distinct; pull-to-refresh
// reloads, and because the route has no cursor yet the 50-row window is
// paged client-side ("Load more" reveals the next 20).

import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../../../theme';
import { SkeletonList } from '../../../components/Skeleton';
import { EmptyState, ErrorState } from '../../../components/StateViews';
import { fetchBotWebhookDeliveries } from '../../../botsApi';
import {
  deliveryStatusKind,
  deliveryStatusLabel,
  deliveryMeta,
} from '../../../utils/botInboxFormat.mjs';

const PAGE = 20;

const STATUS_ICON = {
  success: { name: 'checkmark-circle', colorKey: 'online' },
  error: { name: 'close-circle', colorKey: 'danger' },
  pending: { name: 'time-outline', colorKey: 'textMuted' },
};

export default function BotWebhookDeliveriesScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const [deliveries, setDeliveries] = useState([]);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error' | 'unconfigured'
  const [refreshing, setRefreshing] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE);

  const load = useCallback(async () => {
    try {
      const list = await fetchBotWebhookDeliveries(id);
      setDeliveries(list);
      setVisibleCount(PAGE);
      setPhase('ready');
    } catch (e) {
      if (e.message === 'not_configured') setPhase('unconfigured');
      else setPhase('error');
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function retry() {
    setPhase('loading');
    await load();
  }

  if (phase === 'loading') {
    return (
      <View style={styles.screen}>
        <View style={{ paddingTop: space.sm }}>
          <SkeletonList count={7} />
        </View>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.screen}>
        <ErrorState message="Couldn't load the delivery history." onRetry={retry} />
      </View>
    );
  }

  if (phase === 'unconfigured') {
    return (
      <View style={styles.screen}>
        <EmptyState
          icon="git-branch-outline"
          title="No webhook configured"
          message="Set up a webhook for this bot first — every delivery attempt will be recorded here."
          actionLabel="Set up webhook"
          onAction={() => router.push(`/bot/${id}/webhook`)}
        />
      </View>
    );
  }

  const visible = deliveries.slice(0, visibleCount);
  const hasMore = visibleCount < deliveries.length;

  return (
    <View style={styles.screen}>
      <FlatList
        data={visible}
        keyExtractor={(d) => d.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textMuted} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (hasMore) setVisibleCount((n) => n + PAGE); }}
        ListHeaderComponent={
          deliveries.length ? (
            <Text style={styles.helperTop}>
              The {deliveries.length} most recent delivery attempt{deliveries.length === 1 ? '' : 's'}, newest first. Pull down to refresh.
            </Text>
          ) : null
        }
        renderItem={({ item }) => {
          const kind = deliveryStatusKind(item.status);
          const icon = STATUS_ICON[kind];
          return (
            <View style={styles.row} accessibilityLabel={`${item.eventType}, ${deliveryStatusLabel(item.status)}`}>
              <Ionicons name={icon.name} size={20} color={colors[icon.colorKey]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.event} numberOfLines={1}>{item.eventType}</Text>
                <Text style={styles.meta} numberOfLines={1}>{deliveryMeta(item)}</Text>
              </View>
              <Text style={[styles.statusLabel, { color: colors[icon.colorKey] }]}>
                {deliveryStatusLabel(item.status)}
              </Text>
            </View>
          );
        }}
        ListFooterComponent={
          hasMore ? (
            <Pressable
              style={({ pressed }) => [styles.moreBtn, pressed && { backgroundColor: colors.surfaceRaised }]}
              onPress={() => setVisibleCount((n) => n + PAGE)}
              accessibilityRole="button"
              accessibilityLabel="Load more deliveries"
            >
              <Text style={styles.moreLabel}>Load more</Text>
            </Pressable>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="paper-plane-outline"
            title="No deliveries yet"
            message="Send a test event from the webhook screen and the result will show up here."
            actionLabel="Open webhook"
            onAction={() => router.push(`/bot/${id}/webhook`)}
          />
        }
      />
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    list: { padding: space.lg, paddingBottom: space.xl * 2, flexGrow: 1 },
    helperTop: { ...type.small, color: colors.textMuted, marginBottom: space.lg, lineHeight: 17 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: space.md,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, padding: space.md, marginBottom: space.sm,
    },
    event: { ...type.dataSm, fontSize: 13, color: colors.textPrimary },
    meta: { ...type.small, color: colors.textMuted, marginTop: 2 },
    statusLabel: { ...type.small, fontWeight: '700' },
    moreBtn: {
      alignItems: 'center', paddingVertical: space.md, borderRadius: radius.md,
      borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    },
    moreLabel: { ...type.body, color: colors.accent, fontWeight: '600' },
  });
}
