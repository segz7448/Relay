// app/server/[id]/channel/[channelId].jsx — Server Relay channel history.
// READ ONLY: history pagination, live polling with id-dedupe, pull to
// refresh. No composer, no send, no edit — the relay never accepts
// writes from this app (bmd.md Phase 3/23).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fetchRelayChannel, fetchRelayChannelMessages, pollRelayChannel } from '../../../../relayApi';
import { useTheme, type, space, avatarPalette } from '../../../../theme';
import { SkeletonList } from '../../../../components/Skeleton';
import { ErrorState } from '../../../../components/StateViews';

const POLL_MS = 5000;
const GROUP_WINDOW_MS = 5 * 60 * 1000;

const dedupe = (rows) =>
  [...new Map(rows.map((row) => [row.id, row])).values()]
    .sort((a, b) => (a.createdAt - b.createdAt) || a.id.localeCompare(b.id));

function hashColor(seed) {
  let h = 0;
  for (let i = 0; i < String(seed).length; i++) h = (h * 31 + String(seed).charCodeAt(i)) >>> 0;
  return avatarPalette[h % avatarPalette.length];
}

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function timeLabel(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Attach display metadata: date separators + sender grouping so the list
// reads like a real chat view instead of a raw row dump.
function decorate(messages) {
  const out = [];
  let lastDay = null;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const day = new Date(m.createdAt).toDateString();
    if (day !== lastDay) {
      out.push({ id: `day-${day}`, type: 'day', label: dayLabel(m.createdAt) });
      lastDay = day;
    }
    const prev = messages[i - 1];
    const grouped =
      prev &&
      prev.senderId === m.senderId &&
      new Date(prev.createdAt).toDateString() === day &&
      m.createdAt - prev.createdAt < GROUP_WINDOW_MS;
    out.push({ ...m, type: 'message', grouped });
  }
  return out;
}

export default function RelayChannelScreen() {
  const { channelId } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const list = useRef(null);

  const [channel, setChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [older, setOlder] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pollCursor, setPollCursor] = useState(null);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [refreshing, setRefreshing] = useState(false);
  const didInitialScroll = useRef(false);

  const load = useCallback(async () => {
    try {
      const [ch, page] = await Promise.all([
        fetchRelayChannel(channelId),
        fetchRelayChannelMessages(channelId),
      ]);
      const rows = page.items ?? [];
      setChannel(ch);
      setMessages(rows);
      setOlder(page.nextCursor);
      setHasMore(page.hasMore);
      setPollCursor(rows.length ? rows[rows.length - 1].cursor : null);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, [channelId]);

  useEffect(() => { load(); }, [load]);

  // Live polling: merge by id so a message straddling a page boundary can
  // never appear twice (bmd.md: "Receive new relay messages without
  // duplicating messages").
  useEffect(() => {
    if (phase !== 'ready') return;
    const timer = setInterval(async () => {
      try {
        const page = await pollRelayChannel(channelId, pollCursor);
        if (page.items?.length) setMessages((old) => dedupe([...old, ...page.items]));
        if (page.nextCursor) setPollCursor(page.nextCursor);
      } catch {
        // A failed poll cycle is silent — the next cycle retries with the
        // same cursor, and pull-to-refresh remains as the manual path.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [channelId, phase, pollCursor]);

  async function loadOlder() {
    if (!hasMore || !older || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await fetchRelayChannelMessages(channelId, older);
      setMessages((old) => dedupe([...(page.items ?? []), ...old]));
      setOlder(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      // Keep current history; the button stays available for a retry.
    } finally {
      setLoadingOlder(false);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const items = useMemo(() => decorate(messages), [messages]);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </Pressable>
        <View style={styles.heading}>
          <Text style={styles.title} numberOfLines={1}>#{channel?.name ?? 'channel'}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{channel?.topic || 'Read-only relay'}</Text>
        </View>
        <View style={styles.readOnlyPill}>
          <Ionicons name="eye-outline" size={12} color={colors.textSecondary} />
          <Text style={styles.readOnlyText}>Read only</Text>
        </View>
      </View>

      {phase === 'loading' ? (
        <View style={{ paddingTop: space.md }}>
          <SkeletonList count={8} />
        </View>
      ) : phase === 'error' ? (
        <ErrorState message="Couldn't load channel history." onRetry={() => { setPhase('loading'); load(); }} />
      ) : (
        <FlatList
          ref={list}
          data={items}
          keyExtractor={(m) => m.id}
          contentContainerStyle={[styles.list, !items.length && { flex: 1 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          onContentSizeChange={() => {
            if (!didInitialScroll.current && items.length) {
              didInitialScroll.current = true;
              list.current?.scrollToEnd({ animated: false });
            }
          }}
          ListHeaderComponent={
            hasMore ? (
              <Pressable
                style={styles.history}
                onPress={loadOlder}
                disabled={loadingOlder}
                accessibilityRole="button"
                accessibilityLabel="Load older messages"
                accessibilityState={{ busy: loadingOlder }}
              >
                {loadingOlder ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <>
                    <Ionicons name="arrow-up" size={13} color={colors.accent} />
                    <Text style={styles.historyText}>Load older messages</Text>
                  </>
                )}
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="chatbubble-ellipses-outline" size={30} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptyBody}>New relay messages will appear here automatically.</Text>
            </View>
          }
          renderItem={({ item }) => {
            if (item.type === 'day') {
              return (
                <View style={styles.dayRow}>
                  <View style={styles.dayPill}>
                    <Text style={styles.dayText}>{item.label}</Text>
                  </View>
                </View>
              );
            }
            const color = hashColor(item.senderId ?? item.senderName ?? '?');
            return (
              <View style={[styles.message, item.grouped && styles.messageGrouped]}>
                <View style={styles.avatarCol}>
                  {!item.grouped ? (
                    <View style={[styles.avatar, { backgroundColor: color }]}>
                      <Text style={styles.avatarText}>{(item.senderName || '?').slice(0, 1).toUpperCase()}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.body}>
                  {!item.grouped ? (
                    <View style={styles.metaRow}>
                      <Text style={[styles.sender, { color }]} numberOfLines={1}>{item.senderName || 'Unknown'}</Text>
                      <Text style={styles.time}>{timeLabel(item.createdAt)}</Text>
                    </View>
                  ) : null}
                  {item.text ? (
                    <Text style={styles.text}>{item.text}{item.truncated ? ' …' : ''}</Text>
                  ) : (
                    <View style={styles.attachmentRow}>
                      <Ionicons name="document-outline" size={15} color={colors.textSecondary} />
                      <Text style={styles.attachmentText}>{item.kind ? `${item.kind} attachment` : 'Attachment'}</Text>
                    </View>
                  )}
                  {item.grouped ? <Text style={styles.groupedTime}>{timeLabel(item.createdAt)}</Text> : null}
                </View>
              </View>
            );
          }}
        />
      )}

      {phase === 'ready' ? (
        <View style={[styles.readOnlyBar, { paddingBottom: insets.bottom + space.sm }]}>
          <Ionicons name="eye-outline" size={16} color={colors.textMuted} />
          <Text style={styles.readOnlyBarText}>Server Relay is read only — you can't send messages here</Text>
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: space.sm,
      paddingHorizontal: space.sm, paddingBottom: space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    backBtn: { padding: 4 },
    heading: { flex: 1 },
    title: { ...type.h1, color: colors.textPrimary },
    subtitle: { ...type.small, color: colors.textSecondary, marginTop: 1 },
    readOnlyPill: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
      marginRight: space.sm,
    },
    readOnlyText: { ...type.small, color: colors.textSecondary, fontWeight: '600' },
    list: { paddingVertical: space.sm, paddingBottom: space.xl },
    history: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
      alignSelf: 'center', marginVertical: space.sm,
      paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    },
    historyText: { ...type.small, color: colors.accent, fontWeight: '700' },
    dayRow: { alignItems: 'center', marginVertical: space.sm },
    dayPill: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4,
    },
    dayText: { ...type.small, color: colors.textSecondary, fontWeight: '600' },
    message: {
      flexDirection: 'row', gap: space.sm,
      paddingHorizontal: space.lg, marginTop: space.md,
    },
    messageGrouped: { marginTop: 2 },
    avatarCol: { width: 34 },
    avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
    body: { flex: 1 },
    metaRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
    sender: { ...type.body, fontWeight: '700' },
    time: { ...type.small, color: colors.textMuted, fontSize: 11 },
    text: { ...type.body, color: colors.textPrimary, lineHeight: 20, marginTop: 1 },
    groupedTime: { ...type.small, color: colors.textMuted, fontSize: 10, marginTop: 1 },
    attachmentRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
    attachmentText: { ...type.body, color: colors.textSecondary, fontStyle: 'italic' },
    empty: { alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm, flex: 1 },
    emptyTitle: { ...type.h1, color: colors.textPrimary },
    emptyBody: { ...type.body, color: colors.textMuted, textAlign: 'center' },
    readOnlyBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      paddingTop: space.sm,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    readOnlyBarText: { ...type.small, color: colors.textMuted },
  });
}
