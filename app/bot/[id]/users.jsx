import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type, space, radius, avatarPalette, useTheme } from '../../../theme';
import { fetchBot, setBotUserBlocked, setBotUserMuted, removeBotUser } from '../../../botsApi';
import ActionSheet from '../../../components/ActionSheet';
import { SkeletonList } from '../../../components/Skeleton';
import { EmptyState, ErrorState } from '../../../components/StateViews';
import { useToast } from '../../../components/Toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { hapticTap } from '../../../utils/haptics';

function hashColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return avatarPalette[h % avatarPalette.length];
}

function initials(name) {
  return name.trim().slice(0, 1).toUpperCase();
}

// Telegram-style relative "last seen" — recent activity in minutes/hours,
// falling back to a date once it's more than a week old.
function lastSeenLabel(ts) {
  if (!ts) return null;
  const diff = Date.now() - ts;
  const min = 60 * 1000, hr = 60 * min, day = 24 * hr;
  if (diff < min) return 'active just now';
  if (diff < hr) return `active ${Math.floor(diff / min)}m ago`;
  if (diff < day) return `active ${Math.floor(diff / hr)}h ago`;
  if (diff < 7 * day) return `active ${Math.floor(diff / day)}d ago`;
  return `last seen ${new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export default function BotUsersScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const toast = useToast();
  const confirm = useConfirm();

  const [bot, setBot] = useState(null);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [refreshing, setRefreshing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sheetUser, setSheetUser] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const b = await fetchBot(id);
      if (!b) throw new Error('bot_not_found');
      setBot(b);
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

  const users = bot?.users ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)
    );
  }, [users, query]);

  // PHASE 12 — takes the row the caller already has on screen (`item`/
  // `sheetUser`) instead of re-fetching it, calls the dedicated
  // block/mute endpoint with the target state, and merges just that one
  // updated user back into `bot.users` — no more re-fetching the whole
  // bot (commands + every user) just to flip one flag on one person.
  async function handleToggleBlock(user) {
    setBusyId(user.id);
    try {
      const updated = await setBotUserBlocked(id, user.id, !user.blocked);
      setBot((b) => (b ? { ...b, users: b.users.map((u) => (u.id === updated.id ? updated : u)) } : b));
    } catch (e) {
      toast.error("Couldn't update this user");
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleMute(user) {
    setBusyId(user.id);
    try {
      const updated = await setBotUserMuted(id, user.id, !user.muted);
      setBot((b) => (b ? { ...b, users: b.users.map((u) => (u.id === updated.id ? updated : u)) } : b));
    } catch (e) {
      toast.error("Couldn't update this user");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmRemove(user) {
    const ok = await confirm({
      title: 'Remove user?',
      message: `Remove ${user.name} from @${bot.username}'s users? Their message history is kept, but they'll no longer appear in this list.`,
      confirmLabel: 'Remove',
      destructive: true,
      onConfirm: async () => {
        const updated = await removeBotUser(id, user.id);
        setBot(updated);
      },
    });
    if (ok) toast.success(`${user.name} removed`);
  }

  function openSheet(user) {
    hapticTap();
    setSheetUser(user);
  }

  const sheetActions = sheetUser
    ? [
        {
          key: 'profile',
          icon: 'person-outline',
          label: 'View profile',
          onPress: () => router.push(`/bot/${id}/user/${sheetUser.id}`),
        },
        {
          key: 'history',
          icon: 'chatbubble-ellipses-outline',
          label: 'Message history',
          onPress: () => router.push(`/bot/${id}/user/${sheetUser.id}/history`),
        },
        {
          key: 'mute',
          icon: sheetUser.muted ? 'notifications-outline' : 'notifications-off-outline',
          label: sheetUser.muted ? 'Unmute' : 'Mute',
          onPress: () => handleToggleMute(sheetUser),
        },
        {
          key: 'block',
          icon: sheetUser.blocked ? 'lock-open-outline' : 'lock-closed-outline',
          label: sheetUser.blocked ? 'Unblock' : 'Block',
          destructive: !sheetUser.blocked,
          onPress: () => handleToggleBlock(sheetUser),
        },
        {
          key: 'remove',
          icon: 'trash-outline',
          label: 'Remove user',
          destructive: true,
          onPress: () => confirmRemove(sheetUser),
        },
      ]
    : [];

  if (phase === 'loading') {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>Users</Text>
        </View>
        <View style={{ paddingTop: space.sm }}>
          <SkeletonList count={6} />
        </View>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.screen}>
        <ErrorState message="Couldn't load this bot's users." onRetry={retry} />
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
              placeholder="Search users"
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
            <Pressable
              onPress={() => {
                setSearchOpen(false);
                setQuery('');
              }}
              hitSlop={8}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.title}>{users.length} user{users.length === 1 ? '' : 's'}</Text>
            <Pressable onPress={() => { hapticTap(); setSearchOpen(true); }} hitSlop={10}>
              <Ionicons name="search" size={20} color={colors.accent} />
            </Pressable>
          </>
        )}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(u) => u.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xl * 2, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textMuted} />}
        ListHeaderComponent={
          !searchOpen && !query && users.length ? (
            <Text style={styles.helperTop}>
              Everyone who has talked to @{bot.username}. Tap a person to view their profile, or hold for quick actions.
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/bot/${id}/user/${item.id}`)}
            onLongPress={() => openSheet(item)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceRaised }]}
          >
            <View style={[styles.avatar, { backgroundColor: hashColor(item.id) }]}>
              <Text style={styles.avatarText}>{initials(item.name)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                {item.muted ? <Ionicons name="notifications-off" size={13} color={colors.textMuted} /> : null}
                {item.blocked ? <Ionicons name="lock-closed" size={13} color={colors.danger} /> : null}
              </View>
              <Text style={styles.meta} numberOfLines={1}>
                @{item.username} · {lastSeenLabel(item.lastActiveAt) ?? 'no activity yet'}
              </Text>
            </View>
            <Pressable
              hitSlop={8}
              disabled={busyId === item.id}
              style={[styles.blockPill, item.blocked && styles.blockPillActive]}
              onPress={() => handleToggleBlock(item)}
            >
              <Ionicons name={item.blocked ? 'lock-closed' : 'lock-open-outline'} size={13} color={item.blocked ? colors.danger : colors.textMuted} />
              <Text style={[styles.blockLabel, item.blocked && { color: colors.danger }]}>{busyId === item.id ? '…' : item.blocked ? 'Blocked' : 'Block'}</Text>
            </Pressable>
          </Pressable>
        )}
        ListEmptyComponent={
          query ? (
            <EmptyState icon="search-outline" title="No matches" message={`No users match "${query}".`} />
          ) : (
            <EmptyState icon="people-outline" title="No users yet" message="Everyone who messages this bot will show up here." />
          )
        }
      />

      <ActionSheet
        visible={!!sheetUser}
        onClose={() => setSheetUser(null)}
        title={sheetUser?.name}
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
    avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: '#F2F4F6', fontSize: 16, fontWeight: '600' },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    name: { ...type.h2, fontSize: 15, color: colors.textPrimary, flexShrink: 1 },
    meta: { ...type.small, color: colors.textMuted, marginTop: 2 },
    blockPill: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
      paddingHorizontal: space.sm, paddingVertical: 5,
    },
    blockPillActive: { borderColor: colors.danger },
    blockLabel: { ...type.small, color: colors.textMuted, fontWeight: '600' },
  });
}
