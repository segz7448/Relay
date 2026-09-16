// app/(tabs)/relay.jsx — Server Relay. READ ONLY.
//
// This screen must never gain a create/delete/edit/mute/leave action.
// It only lists what fetchRelayServers() (relayApi.js, backed by the
// read-only /relay/* Worker routes) returns, and lets the user open,
// search, and pull-to-refresh. See notes/02-relay-vs-servers-discrepancy.md
// from the Phase 1 discovery pass for why this screen used to import
// mutation functions from serversApi.js and why that was wrong.

import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../../theme';
import ServerRow from '../../components/ServerRow';
import { SkeletonList } from '../../components/Skeleton';
import { ErrorState } from '../../components/StateViews';
import { fetchRelayServers } from '../../relayApi';

export default function RelayScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const [servers, setServers] = useState([]);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [refreshing, setRefreshing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async () => {
    try {
      // PHASE 4: /relay/servers now returns the shared paginated shape
      // ({ items, nextCursor, hasMore }) instead of a bare array, so every
      // relay list endpoint has one consistent envelope. This screen only
      // Keep the first response and its cursor together so onEndReached can
      // append every later page without duplicates.
      const data = await fetchRelayServers();
      setServers(data?.items ?? []);
      setCursor(data?.nextCursor ?? null);
      setHasMore(!!data?.hasMore);
      setPhase('ready');
    } catch (e) {
      setPhase('error');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function retry() {
    setPhase('loading');
    await load();
  }


  async function loadMore() {
    if (!hasMore || !cursor || query) return;
    try {
      const page = await fetchRelayServers(cursor);
      setServers((old) => [...new Map([...old, ...(page.items ?? [])].map((row) => [row.id, row])).values()]);
      setCursor(page.nextCursor ?? null); setHasMore(!!page.hasMore);
    } catch { setPhase('error'); }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return servers;
    return servers.filter((s) => s.name.toLowerCase().includes(q));
  }, [servers, query]);

  const totalUnread = servers.reduce((n, s) => n + (s.muted ? 0 : s.unreadCount), 0);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        {searchOpen ? (
          <View style={styles.searchBar}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search servers"
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              autoFocus
              autoCorrect={false}
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </Pressable>
            ) : null}
            <Pressable onPress={() => { setSearchOpen(false); setQuery(''); }} hitSlop={8}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View>
              <Text style={styles.title}>Server Relay</Text>
              <Text style={styles.subtitle}>
                {servers.length} server{servers.length === 1 ? '' : 's'}
                {totalUnread > 0 ? ` · ${totalUnread} unread` : ''}
              </Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable onPress={() => setSearchOpen(true)} hitSlop={10}>
                <Ionicons name="search" size={20} color={colors.accent} />
              </Pressable>
              {/* No "add" / create action here on purpose — the relay is read only. */}
            </View>
          </>
        )}
      </View>

      {phase === 'loading' ? (
        <View style={{ paddingTop: space.md }}>
          <SkeletonList count={6} />
        </View>
      ) : phase === 'error' ? (
        <ErrorState message="Couldn't load your servers." onRetry={retry} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(s) => s.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          renderItem={({ item }) => (
            <ServerRow
              server={item}
              onPress={() => router.push(`/server/${item.id}`)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="git-network-outline" size={30} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>{query ? `No servers match "${query}"` : 'No servers yet'}</Text>
              {!query ? (
                <Text style={styles.emptyBody}>
                  Servers you're a member of will show up here — channels, members, and message
                  history, read-only.
                </Text>
              ) : null}
            </View>
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={hasMore && !query ? <Text style={styles.loadingMore}>Loading more…</Text> : null}
          contentContainerStyle={{ paddingBottom: space.xl * 4, flexGrow: 1 }}
        />
      )}
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md, minHeight: 46,
    },
    title: { ...type.h1, color: colors.textPrimary },
    subtitle: { ...type.small, color: colors.textSecondary, marginTop: 2 },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
    searchBar: {
      flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm,
      backgroundColor: colors.surface, borderRadius: radius.lg,
      paddingHorizontal: space.md, height: 36, borderWidth: 1, borderColor: colors.border,
    },
    searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15, padding: 0 },
    cancelText: { ...type.body, color: colors.accent, fontWeight: '600' },
    empty: { alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm, flexGrow: 1 },
    emptyTitle: { ...type.h1, color: colors.textPrimary, marginTop: space.xs },
    emptyBody: { ...type.body, color: colors.textMuted, textAlign: 'center', lineHeight: 19 },
    loadingMore: { ...type.small, color: colors.textMuted, textAlign: 'center', padding: space.md },
  });
}
