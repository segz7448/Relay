// app/server/[id]/index.jsx — one Server Relay server. READ ONLY.
//
// Channels and members are paginated through the read-only /relay/*
// endpoints. There are intentionally no create/edit/kick/invite controls
// anywhere on this screen (see bmd.md Phase 3: the relay is read-only,
// and no UI may suggest otherwise).

import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, avatarPalette, useTheme } from '../../../theme';
import { fetchRelayServer, fetchRelayChannels, fetchRelayMembers } from '../../../relayApi';
import { SkeletonList } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/StateViews';

function hashColor(seed) {
  let h = 0;
  for (let i = 0; i < String(seed).length; i++) h = (h * 31 + String(seed).charCodeAt(i)) >>> 0;
  return avatarPalette[h % avatarPalette.length];
}

const TABS = [
  { key: 'channels', label: 'Channels', icon: 'chatbubbles-outline' },
  { key: 'members', label: 'Members', icon: 'people-outline' },
];

function mergePage(old, items) {
  return [...new Map([...old, ...items].map((row) => [row.id, row])).values()];
}

export default function RelayServerScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const [server, setServer] = useState(null);
  const [tab, setTab] = useState('channels');
  const [channels, setChannels] = useState([]);
  const [members, setMembers] = useState([]);
  const [channelCursor, setChannelCursor] = useState(null);
  const [memberCursor, setMemberCursor] = useState(null);
  const [channelMore, setChannelMore] = useState(false);
  const [memberMore, setMemberMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [detail, channelPage, memberPage] = await Promise.all([
        fetchRelayServer(id),
        fetchRelayChannels(id),
        fetchRelayMembers(id),
      ]);
      setServer(detail);
      setChannels(channelPage.items ?? []);
      setChannelCursor(channelPage.nextCursor ?? null);
      setChannelMore(!!channelPage.hasMore);
      setMembers(memberPage.items ?? []);
      setMemberCursor(memberPage.nextCursor ?? null);
      setMemberMore(!!memberPage.hasMore);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function loadMore() {
    const cursor = tab === 'channels' ? channelCursor : memberCursor;
    const more = tab === 'channels' ? channelMore : memberMore;
    if (!more || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      if (tab === 'channels') {
        const page = await fetchRelayChannels(id, cursor);
        setChannels((old) => mergePage(old, page.items ?? []));
        setChannelCursor(page.nextCursor ?? null);
        setChannelMore(!!page.hasMore);
      } else {
        const page = await fetchRelayMembers(id, cursor);
        setMembers((old) => mergePage(old, page.items ?? []));
        setMemberCursor(page.nextCursor ?? null);
        setMemberMore(!!page.hasMore);
      }
    } catch {
      // Stay on current data; the next scroll/refresh retries.
    } finally {
      setLoadingMore(false);
    }
  }

  const data = tab === 'channels' ? channels : members;
  const more = tab === 'channels' ? channelMore : memberMore;
  const iconColor = server?.iconColor ?? hashColor(id);

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
        <View style={[styles.serverIcon, { backgroundColor: iconColor }]}>
          {server?.icon ? (
            <Ionicons name="server-outline" size={18} color="#FFFFFF" />
          ) : (
            <Text style={styles.serverIconText}>{(server?.name ?? '?').trim().slice(0, 1).toUpperCase()}</Text>
          )}
        </View>
        <View style={styles.heading}>
          <Text style={styles.title} numberOfLines={1}>{server?.name ?? 'Server Relay'}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {server
              ? `${server.memberCount ?? members.length} member${(server.memberCount ?? members.length) === 1 ? '' : 's'}`
                + (server.onlineCount ? ` · ${server.onlineCount} online` : '')
              : 'Read only'}
          </Text>
        </View>
        <View style={styles.readOnlyPill}>
          <Ionicons name="eye-outline" size={12} color={colors.textSecondary} />
          <Text style={styles.readOnlyText}>Read only</Text>
        </View>
      </View>

      {server?.description ? (
        <Text style={styles.description} numberOfLines={2}>{server.description}</Text>
      ) : null}

      <View style={styles.tabs}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              accessibilityRole="button"
              accessibilityLabel={`${t.label} tab`}
              accessibilityState={{ selected: active }}
              style={[styles.tab, active && styles.activeTab]}
            >
              <Ionicons name={t.icon} size={14} color={active ? colors.onAccent : colors.textSecondary} />
              <Text style={[styles.tabText, active && styles.activeText]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {phase === 'loading' ? (
        <View style={{ paddingTop: space.md }}>
          <SkeletonList count={7} />
        </View>
      ) : phase === 'error' ? (
        <ErrorState message="Couldn't load this server." onRetry={() => { setPhase('loading'); load(); }} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          contentContainerStyle={styles.list}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.accent} style={{ padding: space.md }} />
            ) : more ? (
              <Text style={styles.more}>Scroll for more</Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name={tab === 'channels' ? 'chatbubbles-outline' : 'people-outline'} size={30} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>{tab === 'channels' ? 'No channels' : 'No members'}</Text>
              <Text style={styles.emptyBody}>
                {tab === 'channels'
                  ? 'This server has no channels you can read.'
                  : 'This server has no members visible to you.'}
              </Text>
            </View>
          }
          renderItem={({ item }) =>
            tab === 'channels' ? (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceRaised }]}
                onPress={() => router.push(`/server/${id}/channel/${item.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Open channel ${item.name}${item.private ? ', private' : ''}`}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name={item.private ? 'lock-closed-outline' : 'chatbubble-outline'} size={17} color={colors.textSecondary} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.name} numberOfLines={1}>#{item.name}</Text>
                  <Text style={styles.meta} numberOfLines={1}>{item.topic || 'Channel history'}</Text>
                </View>
                {item.unreadCount ? (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadText}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text>
                  </View>
                ) : null}
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </Pressable>
            ) : (
              <View style={styles.row}>
                <View style={[styles.avatar, { backgroundColor: item.avatarColor ?? hashColor(item.id) }]}>
                  <Text style={styles.avatarText}>{(item.name || '?').slice(0, 1).toUpperCase()}</Text>
                  {item.online ? <View style={[styles.online, { borderColor: colors.bg }]} /> : null}
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.meta} numberOfLines={1}>@{item.username}</Text>
                </View>
                {item.role && item.role !== 'member' ? (
                  <View style={styles.roleBadge}>
                    <Text style={styles.roleText}>{item.role}</Text>
                  </View>
                ) : null}
              </View>
            )
          }
        />
      )}
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: space.sm,
      paddingHorizontal: space.sm, paddingBottom: space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    backBtn: { padding: 4 },
    serverIcon: { width: 38, height: 38, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    serverIconText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
    heading: { flex: 1 },
    title: { ...type.h1, color: colors.textPrimary },
    subtitle: { ...type.small, color: colors.textSecondary, marginTop: 1 },
    readOnlyPill: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
    },
    readOnlyText: { ...type.small, color: colors.textSecondary, fontWeight: '600' },
    description: { ...type.small, color: colors.textSecondary, paddingHorizontal: space.lg, paddingTop: space.sm },
    tabs: {
      flexDirection: 'row', gap: space.sm,
      paddingHorizontal: space.lg, paddingVertical: space.sm,
    },
    tab: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    },
    activeTab: { backgroundColor: colors.accent, borderColor: colors.accent },
    tabText: { ...type.small, color: colors.textSecondary, fontWeight: '600' },
    activeText: { color: colors.onAccent },
    list: { paddingBottom: space.xl * 3, flexGrow: 1 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: space.md,
      paddingVertical: space.sm, paddingHorizontal: space.lg,
    },
    rowIcon: {
      width: 38, height: 38, borderRadius: radius.md,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      alignItems: 'center', justifyContent: 'center',
    },
    rowText: { flex: 1 },
    name: { ...type.body, color: colors.textPrimary, fontWeight: '600' },
    meta: { ...type.small, color: colors.textSecondary, marginTop: 1 },
    avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
    online: {
      position: 'absolute', right: -1, bottom: -1,
      width: 12, height: 12, borderRadius: 6,
      backgroundColor: '#34C759', borderWidth: 2,
    },
    unreadBadge: {
      minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6,
      backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    },
    unreadText: { color: colors.onAccent, fontSize: 11, fontWeight: '700' },
    roleBadge: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2,
    },
    roleText: { ...type.small, color: colors.accent, fontWeight: '700', textTransform: 'capitalize' },
    more: { ...type.small, color: colors.textMuted, textAlign: 'center', padding: space.md },
    empty: { alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm, flexGrow: 1, marginTop: space.xl * 2 },
    emptyTitle: { ...type.h1, color: colors.textPrimary },
    emptyBody: { ...type.body, color: colors.textMuted, textAlign: 'center' },
  });
}
