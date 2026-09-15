import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, Modal, StyleSheet } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type, space, radius, useTheme } from '../theme';
import HeaderIconButton from '../components/HeaderIconButton';
import Avatar from '../components/Avatar';
import Field from '../components/Field';
import { SkeletonList } from '../components/Skeleton';
import { ErrorState, EmptyState } from '../components/StateViews';
import { useToast } from '../components/Toast';
import { fetchBlockedUsers, blockUser, unblockUser, searchDirectory } from '../privacyApi';

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor(diff / day);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function BlockedUsersScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const toast = useToast();
  const [blocked, setBlocked] = useState([]);
  const [phase, setPhase] = useState('loading');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  const load = useCallback(async () => {
    try {
      const list = await fetchBlockedUsers();
      setBlocked(list);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function openPicker() {
    setQuery('');
    setPickerOpen(true);
    searchDirectory('').then(setResults);
  }

  function onQueryChange(text) {
    setQuery(text);
    searchDirectory(text).then(setResults);
  }

  async function handleBlock(user) {
    setPickerOpen(false);
    await blockUser(user);
    load();
    toast.show(`Blocked ${user.name}`);
  }

  async function handleUnblock(id) {
    const user = blocked.find((u) => u.id === id);
    setBlocked((list) => list.filter((u) => u.id !== id));
    try {
      await unblockUser(id);
      toast.show(user ? `Unblocked ${user.name}` : 'User unblocked');
    } catch {
      toast.error("Couldn't unblock this user");
      load();
    }
  }

  const loaded = phase !== 'loading';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: 'Blocked Users',
          headerRight: () => <HeaderIconButton icon="person-add" size={30} onPress={openPicker} />,
        }}
      />

      {phase === 'loading' ? (
        <View style={{ paddingTop: space.lg }}>
          <SkeletonList count={4} />
        </View>
      ) : phase === 'error' ? (
        <ErrorState message="Couldn't load your blocked users." onRetry={load} />
      ) : blocked.length === 0 ? (
        <EmptyState
          icon="shield-checkmark-outline"
          title="No Blocked Users"
          message="People you block can't message you, call you, or see your last seen and profile photo."
        />
      ) : (
        <FlatList
          data={blocked}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 3 }}
          ListHeaderComponent={
            blocked.length > 0 ? (
              <Text style={styles.helper}>
                Blocked users can't see your profile photo, last seen, or send you messages.
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Avatar name={item.name} size={44} />
              <View style={{ flex: 1, marginLeft: space.md }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.sub}>@{item.username} · Blocked {timeAgo(item.blockedAt)}</Text>
              </View>
              <Pressable
                onPress={() => handleUnblock(item.id)}
                style={({ pressed }) => [styles.unblockBtn, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.unblockLabel}>Unblock</Text>
              </Pressable>
            </View>
          )}
        />
      )}

      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={[styles.modalWrap, { paddingTop: insets.top }]}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setPickerOpen(false)} hitSlop={10}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Text style={styles.modalTitle}>Block a User</Text>
            <View style={{ width: 50 }} />
          </View>
          <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
            <Field
              icon="search"
              placeholder="Search by name or username"
              value={query}
              onChangeText={onQueryChange}
              autoCapitalize="none"
            />
          </View>
          <FlatList
            data={results}
            keyExtractor={(u) => u.id}
            contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xl * 2 }}
            ListEmptyComponent={<Text style={styles.emptyBody}>No matching users.</Text>}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => handleBlock(item)}
                style={({ pressed }) => [styles.pickRow, pressed && { backgroundColor: colors.surfaceRaised }]}
              >
                <Avatar name={item.name} size={40} />
                <View style={{ flex: 1, marginLeft: space.md }}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.sub}>@{item.username}</Text>
                </View>
                <Ionicons name="remove-circle-outline" size={20} color={colors.danger} />
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    helper: { ...type.small, color: colors.textMuted, marginBottom: space.md, lineHeight: 16 },
    row: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, padding: space.md, marginBottom: space.sm,
    },
    name: { ...type.body, color: colors.textPrimary, fontWeight: '600' },
    sub: { ...type.small, color: colors.textMuted, marginTop: 2 },
    unblockBtn: { paddingHorizontal: space.sm, paddingVertical: space.xs },
    unblockLabel: { ...type.small, color: colors.danger, fontWeight: '700' },
    emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm },
    emptyTitle: { ...type.h1, color: colors.textPrimary, marginTop: space.xs },
    emptyBody: { ...type.body, color: colors.textMuted, textAlign: 'center', lineHeight: 19 },
    modalWrap: { flex: 1, backgroundColor: colors.bg },
    modalHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: space.lg, paddingVertical: space.md,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    modalTitle: { ...type.h2, color: colors.textPrimary },
    cancelText: { ...type.body, color: colors.accent },
    pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm },
  });
}
