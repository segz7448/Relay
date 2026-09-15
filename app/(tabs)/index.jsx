import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, TextInput, FlatList, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../../theme';
import ConversationRow from '../../components/ConversationRow';
import ActionSheet from '../../components/ActionSheet';
import HeaderIconButton from '../../components/HeaderIconButton';
import { SkeletonList, SkeletonListRow } from '../../components/Skeleton';
import { EmptyState, ErrorState } from '../../components/StateViews';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { fetchConversations } from '../../messagesApi';

export default function MessagesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const toast = useToast();
  const confirm = useConfirm();
  const [conversations, setConversations] = useState([]);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [sheetFor, setSheetFor] = useState(null); // convo shown in the long-press sheet
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  const load = useCallback(async () => {
    try {
      const data = await fetchConversations();
      setConversations(data);
      setPhase('ready');
    } catch (e) {
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function retryLoad() {
    setPhase('loading');
    await load();
  }

  function patch(id, changes) {
    setConversations((list) => list.map((c) => (c.id === id ? { ...c, ...changes } : c)));
  }

  function togglePin(convo) {
    patch(convo.id, { pinned: !convo.pinned });
    toast.show(convo.pinned ? 'Unpinned' : 'Pinned');
  }
  function toggleRead(convo) {
    patch(convo.id, { unread: convo.unread > 0 ? 0 : 1 });
  }
  function markUnread(convo) {
    patch(convo.id, { unread: convo.unread > 0 ? convo.unread : 1 });
  }
  function toggleMute(convo) {
    patch(convo.id, { muted: !convo.muted });
    toast.show(convo.muted ? 'Unmuted' : 'Muted');
  }
  async function remove(convo) {
    const ok = await confirm({
      title: `Delete "${convo.name}"?`,
      message: 'This removes the conversation from your list. This can\'t be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setConversations((list) => list.filter((c) => c.id !== convo.id));
    toast.success('Conversation deleted');
  }

  function openSheet(convo) {
    setSheetFor(convo);
  }

  function enterSelectMode(convo) {
    setSelectMode(true);
    setSelected(convo ? new Set([convo.id]) : new Set());
  }
  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }
  function toggleSelect(convo) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(convo.id)) next.delete(convo.id);
      else next.add(convo.id);
      return next;
    });
  }
  async function bulkDelete() {
    const count = selected.size;
    const ok = await confirm({
      title: `Delete ${count} conversation${count === 1 ? '' : 's'}?`,
      message: "This can't be undone.",
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setConversations((list) => list.filter((c) => !selected.has(c.id)));
    exitSelectMode();
    toast.success(`${count} deleted`);
  }
  function bulkMute() {
    const count = selected.size;
    setConversations((list) => list.map((c) => (selected.has(c.id) ? { ...c, muted: true } : c)));
    exitSelectMode();
    toast.show(`${count} muted`);
  }
  function bulkRead() {
    const count = selected.size;
    setConversations((list) => list.map((c) => (selected.has(c.id) ? { ...c, unread: 0 } : c)));
    exitSelectMode();
    toast.show(`${count} marked read`);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? conversations.filter((c) => c.name.toLowerCase().includes(q)) : conversations;
    return [...base].sort((a, b) => (b.pinned - a.pinned) || (b.lastMessageAt - a.lastMessageAt));
  }, [conversations, query]);

  const sheetActions = sheetFor
    ? [
        { key: 'pin', icon: sheetFor.pinned ? 'pin' : 'pin-outline', label: sheetFor.pinned ? 'Unpin' : 'Pin', onPress: () => togglePin(sheetFor) },
        { key: 'mute', icon: 'volume-mute-outline', label: sheetFor.muted ? 'Unmute' : 'Mute', onPress: () => toggleMute(sheetFor) },
        { key: 'unread', icon: 'mail-unread-outline', label: 'Mark unread', onPress: () => markUnread(sheetFor) },
        { key: 'archive', icon: 'archive-outline', label: 'Archive', onPress: () => remove(sheetFor) },
        { key: 'select', icon: 'checkmark-circle-outline', label: 'Select', onPress: () => enterSelectMode(sheetFor) },
        { key: 'delete', icon: 'trash-outline', label: 'Delete', destructive: true, onPress: () => remove(sheetFor) },
      ]
    : [];

  return (
    <View style={styles.screen}>
      <View style={styles.navBar}>
        {selectMode ? (
          <Pressable onPress={exitSelectMode} hitSlop={10}>
            <Text style={styles.navAction}>Cancel</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => enterSelectMode(null)} hitSlop={10}>
            <Text style={styles.navAction}>Edit</Text>
          </Pressable>
        )}
        <View style={{ flex: 1 }} />
        {!selectMode ? (
          <>
            <HeaderIconButton icon="search-outline" size={30} onPress={() => router.push('/search')} />
            <HeaderIconButton icon="create-outline" size={30} onPress={() => router.push('/compose')} />
          </>
        ) : null}
      </View>

      <View style={styles.titleRow}>
        <Text style={styles.title}>{selectMode ? `${selected.size} Selected` : 'Messages'}</Text>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
        />
      </View>

      {phase === 'loading' ? (
        <SkeletonList count={7} row={SkeletonListRow} />
      ) : phase === 'error' ? (
        <ErrorState message="Couldn't load your messages. Check your connection and try again." onRetry={retryLoad} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          renderItem={({ item }) => (
            <ConversationRow
              convo={item}
              selectable={selectMode}
              selected={selected.has(item.id)}
              onToggleSelect={toggleSelect}
              onPress={(c) => router.push(`/conversation/${c.id}`)}
              onLongPress={openSheet}
              onPin={togglePin}
              onMarkRead={toggleRead}
              onMute={toggleMute}
              onDelete={remove}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon={conversations.length === 0 ? 'chatbubbles-outline' : 'search-outline'}
              title={conversations.length === 0 ? 'No messages yet' : 'No matches'}
              message={conversations.length === 0 ? 'Start a new message to see it here.' : `Nothing matches "${query}".`}
              actionLabel={conversations.length === 0 ? 'New message' : undefined}
              onAction={conversations.length === 0 ? () => router.push('/compose') : undefined}
            />
          }
          contentContainerStyle={{ paddingBottom: (selectMode ? 90 : 0) + space.xl * 3, flexGrow: 1 }}
        />
      )}

      {selectMode ? (
        <View style={[styles.toolbar, { paddingBottom: insets.bottom + space.sm }]}>
          <Pressable style={styles.toolbarBtn} onPress={bulkRead} disabled={!selected.size}>
            <Ionicons name="checkmark-done-outline" size={21} color={selected.size ? colors.textPrimary : colors.textMuted} />
            <Text style={[styles.toolbarLabel, !selected.size && { color: colors.textMuted }]}>Read</Text>
          </Pressable>
          <Pressable style={styles.toolbarBtn} onPress={bulkMute} disabled={!selected.size}>
            <Ionicons name="volume-mute-outline" size={21} color={selected.size ? colors.textPrimary : colors.textMuted} />
            <Text style={[styles.toolbarLabel, !selected.size && { color: colors.textMuted }]}>Mute</Text>
          </Pressable>
          <Pressable style={styles.toolbarBtn} onPress={bulkDelete} disabled={!selected.size}>
            <Ionicons name="trash-outline" size={21} color={selected.size ? colors.danger : colors.textMuted} />
            <Text style={[styles.toolbarLabel, { color: selected.size ? colors.danger : colors.textMuted }]}>Delete</Text>
          </Pressable>
        </View>
      ) : null}

      <ActionSheet visible={!!sheetFor} onClose={() => setSheetFor(null)} title={sheetFor?.name} actions={sheetActions} />
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  navBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.lg, paddingTop: space.sm, height: 30,
  },
  navAction: { ...type.body, color: colors.accent, fontWeight: '600' },
  titleRow: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.sm },
  title: { ...type.display, fontSize: 32, color: colors.textPrimary },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    marginHorizontal: space.lg, marginBottom: space.sm,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    paddingHorizontal: space.md, height: 36,
    borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15, padding: 0 },
  toolbar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', justifyContent: 'space-around',
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
    paddingTop: space.sm,
  },
  toolbarBtn: { alignItems: 'center', gap: 3, minWidth: 64 },
  toolbarLabel: { ...type.small, color: colors.textPrimary, fontWeight: '600' },
  });
}
