// app/bot/[id]/conversations.jsx — PHASE 17 — Bot conversation inbox.
//
// A Telegram-style inbox over GET /bots/:id/conversations: one row per
// bot user, newest activity first, with unread counts, last-message
// previews (outbound messages get the "You: " prefix), and muted/blocked
// markers. Tapping a row opens the real message thread
// (user/[userId]/history), which reads through
// GET /bots/:id/conversations/:userId/messages — the route that also
// clears the unread counter server-side — so returning here after
// reading shows the badge gone. User management stays one long-press
// away (profile, mute, block), and the full Users screen is unchanged.

import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, avatarPalette, useTheme } from '../../../theme';
import {
  fetchBotConversations,
  setBotUserBlocked,
  setBotUserMuted,
} from '../../../botsApi';
import ActionSheet from '../../../components/ActionSheet';
import { SkeletonList } from '../../../components/Skeleton';
import { EmptyState, ErrorState } from '../../../components/StateViews';
import { useToast } from '../../../components/Toast';
import { hapticTap } from '../../../utils/haptics';
import { conversationPreview, unreadBadgeLabel, timeAgo } from '../../../utils/botInboxFormat.mjs';

function hashColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return avatarPalette[h % avatarPalette.length];
}

function initials(name) {
  const parts = (name ?? '?').trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function BotConversationsScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const toast = useToast();

  const [conversations, setConversations] = useState([]);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [refreshing, setRefreshing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sheetConvo, setSheetConvo] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const list = await fetchBotConversations(id);
      setConversations(list);
      setPhase('ready');
    } catch (e) {
      setPhase('error');
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) => (c.name ?? '').toLowerCase().includes(q) || (c.username ?? '').toLowerCase().includes(q)
    );
  }, [conversations, query]);

  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + (Number(c.unreadCount) || 0), 0),
    [conversations]
  );

  // Merge one updated bot-user flag (blocked/muted) back into the row —
  // no full reload for a single toggle.
  function patchConvo(botUserId, patch) {
    setConversations((list) =>
      list.map((c) => (c.botUserId === botUserId ? { ...c, ...patch } : c))
    );
  }

  async function handleToggleMute(convo) {
    setBusyId(convo.botUserId);
    try {
      await setBotUserMuted(id, convo.botUserId, !convo.muted);
      patchConvo(convo.botUserId, { muted: !convo.muted });
    } catch (e) {
      toast.error("Couldn't update this user");
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleBlock(convo) {
    setBusyId(convo.botUserId);
    try {
      await setBotUserBlocked(id, convo.botUserId, !convo.blocked);
      patchConvo(convo.botUserId, { blocked: !convo.blocked });
      toast.show(convo.blocked ? 'User unblocked' : 'User blocked');
    } catch (e) {
      toast.error("Couldn't update this user");
    } finally {
      setBusyId(null);
    }
  }

  function openSheet(convo) {
    hapticTap();
    setSheetConvo(convo);
  }

  const sheetActions = sheetConvo
    ? [
        {
          key: 'open',
          icon: 'chatbubble-ellipses-outline',
          label: 'Open conversation',
          onPress: () => router.push(`/bot/${id}/user/${sheetConvo.botUserId}/history`),
        },
        {
          key: 'profile',
          icon: 'person-outline',
          label: 'View profile',
          onPress: () => router.push(`/bot/${id}/user/${sheetConvo.botUserId}`),
        },
        {
          key: 'mute',
          icon: sheetConvo.muted ? 'notifications-outline' : 'notifications-off-outline',
          label: sheetConvo.muted ? 'Unmute' : 'Mute',
          onPress: () => handleToggleMute(sheetConvo),
        },
        {
          key: 'block',
          icon: sheetConvo.blocked ? 'lock-open-outline' : 'lock-closed-outline',
          label: sheetConvo.blocked ? 'Unblock' : 'Block',
          destructive: !sheetConvo.blocked,
          onPress: () => handleToggleBlock(sheetConvo),
        },
      ]
    : [];

  if (phase === 'loading') {
    return (
      <View style={styles.screen}>
        <View style={{ paddingTop: space.sm }}>
          <SkeletonList count={6} />
        </View>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.screen}>
        <ErrorState message="Couldn't load this bot's conversations." onRetry={retry} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        {searchOpen ? (
          <View style={styles.searchBar}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search conversations"
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              autoFocus
              autoCorrect={false}
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => {
                setSearchOpen(false);
                setQuery('');
              }}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.title}>
              {totalUnread > 0 ? `${totalUnread} unread` : `${conversations.length} conversation${conversations.length === 1 ? '' : 's'}`}
            </Text>
            <Pressable
              onPress={() => { hapticTap(); setSearchOpen(true); }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Search conversations"
            >
              <Ionicons name="search" size={20} color={colors.accent} />
            </Pressable>
          </>
        )}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(c) => c.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xl * 2, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textMuted} />}
        ListHeaderComponent={
          !searchOpen && !query && conversations.length ? (
            <Text style={styles.helperTop}>
              Everyone talking to this bot, newest first. Tap to open the thread; hold for quick actions.
            </Text>
          ) : null
        }
        renderItem={({ item }) => {
          const unread = unreadBadgeLabel(item.unreadCount);
          return (
            <Pressable
              onPress={() => router.push(`/bot/${id}/user/${item.botUserId}/history`)}
              onLongPress={() => openSheet(item)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceRaised }]}
              accessibilityRole="button"
              accessibilityLabel={`Conversation with ${item.name}${unread ? `, ${unread} unread` : ''}`}
            >
              <View style={[styles.avatar, { backgroundColor: hashColor(item.botUserId) }]}>
                <Text style={styles.avatarText}>{initials(item.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                  {item.muted ? <Ionicons name="notifications-off" size={13} color={colors.textMuted} /> : null}
                  {item.blocked ? <Ionicons name="lock-closed" size={13} color={colors.danger} /> : null}
                </View>
                <Text
                  style={[styles.preview, unread && { color: colors.textPrimary }]}
                  numberOfLines={1}
                >
                  {conversationPreview(item)}
                </Text>
              </View>
              <View style={styles.metaCol}>
                <Text style={styles.time}>{timeAgo(item.lastMessageAt)}</Text>
                {unread ? (
                  <View style={[styles.badge, item.muted && { backgroundColor: colors.textMuted }]}>
                    <Text style={styles.badgeText}>{unread}</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          query ? (
            <EmptyState icon="search-outline" title="No matches" message={`No conversations match "${query}".`} />
          ) : (
            <EmptyState icon="chatbubbles-outline" title="No conversations yet" message="When someone messages this bot, the thread shows up here." />
          )
        }
      />

      <ActionSheet
        visible={!!sheetConvo}
        onClose={() => setSheetConvo(null)}
        title={sheetConvo?.name}
        actions={sheetActions}
      />
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm,
      minHeight: 40,
    },
    title: { ...type.h1, fontSize: 17, color: colors.textPrimary },
    searchBar: {
      flex: 1,
      flexDirection: 'row', alignItems: 'center', gap: space.sm,
      backgroundColor: colors.surface, borderRadius: radius.lg,
      paddingHorizontal: space.md, height: 36,
      borderWidth: 1, borderColor: colors.border,
    },
    searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15, padding: 0 },
    cancelText: { ...type.body, color: colors.accent, fontWeight: '600' },
    helperTop: { ...type.small, color: colors.textMuted, marginBottom: space.lg, lineHeight: 17 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: space.md,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, padding: space.md, marginBottom: space.sm,
    },
    avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: '#F2F4F6', fontSize: 16, fontWeight: '600' },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    name: { ...type.h2, fontSize: 15, color: colors.textPrimary, flexShrink: 1 },
    preview: { ...type.small, color: colors.textMuted, marginTop: 2 },
    metaCol: { alignItems: 'flex-end', gap: 4 },
    time: { ...type.small, color: colors.textMuted },
    badge: {
      minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.accent,
      alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
    },
    badgeText: { color: colors.onAccent, fontSize: 12, fontWeight: '700' },
  });
}
