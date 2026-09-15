import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, avatarPalette, useTheme } from '../theme';
import { fetchConversations, searchMessages, searchFiles, startDirectConversation } from '../messagesApi';
import { searchDirectory } from '../privacyApi';
import { fetchServers } from '../serversApi';
import { fileVisualFor } from '../utils/fileTypes';
import ActionSheet from '../components/ActionSheet';

const TABS = [
  { key: 'users', label: 'Users' },
  { key: 'usernames', label: 'Usernames' },
  { key: 'bots', label: 'Bots' },
  { key: 'servers', label: 'Servers' },
  { key: 'messages', label: 'Messages' },
  { key: 'files', label: 'Files' },
  { key: 'conversations', label: 'Conversations' },
];

const MEDIA_CHIPS = [
  { key: 'image', label: 'Photos', icon: 'image-outline' },
  { key: 'video', label: 'Videos', icon: 'videocam-outline' },
  { key: 'document', label: 'Documents', icon: 'document-outline' },
  { key: 'link', label: 'Links', icon: 'link-outline' },
  { key: 'audio', label: 'Audio', icon: 'musical-notes-outline' },
];

const DATE_OPTIONS = [
  { key: 'any', label: 'Any time', sinceMs: null },
  { key: 'today', label: 'Today', sinceMs: 24 * 60 * 60 * 1000 },
  { key: 'week', label: 'This week', sinceMs: 7 * 24 * 60 * 60 * 1000 },
  { key: 'month', label: 'This month', sinceMs: 30 * 24 * 60 * 60 * 1000 },
];

function hashColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return avatarPalette[h % avatarPalette.length];
}
function initials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
function timeLabel(ts) {
  const diff = Date.now() - ts;
  const min = 60 * 1000, hr = 60 * min, day = 24 * hr;
  if (diff < min) return 'now';
  if (diff < hr) return `${Math.floor(diff / min)}m`;
  if (diff < day) return `${Math.floor(diff / hr)}h`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function SearchScreen() {
  const router = useRouter();
  // Deep-linkable starting tab (e.g. /search?tab=bots from the compose
  // menu's "New Bot Conversation"). Unknown values fall back to messages.
  const { tab: tabParam } = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState(() => (TABS.some((t) => t.key === tabParam) ? tabParam : 'messages'));
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [messageResults, setMessageResults] = useState([]);
  const [fileResults, setFileResults] = useState([]);
  const [directoryResults, setDirectoryResults] = useState([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [servers, setServers] = useState([]);
  const [mediaKinds, setMediaKinds] = useState(() => new Set());
  const [dateKey, setDateKey] = useState('any');
  const [senderId, setSenderId] = useState(null);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [senderSheetOpen, setSenderSheetOpen] = useState(false);

  useEffect(() => {
    fetchConversations().then(setConversations);
    fetchServers().then(setServers);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const kinds = mediaKinds.size ? Array.from(mediaKinds) : [];
    Promise.all([searchMessages(query), searchFiles(query, kinds)]).then(([msgs, files]) => {
      if (cancelled) return;
      setMessageResults(msgs);
      setFileResults(files);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [query, mediaKinds]);

  useEffect(() => {
    let cancelled = false;
    setDirectoryLoading(true);
    searchDirectory(query).then((users) => {
      if (cancelled) return;
      setDirectoryResults(users);
      setDirectoryLoading(false);
    });
    return () => { cancelled = true; };
  }, [query]);

  const dateOption = DATE_OPTIONS.find((d) => d.key === dateKey) ?? DATE_OPTIONS[0];
  const sender = conversations.find((c) => c.id === senderId) ?? null;

  function withFilters(list) {
    return list.filter((item) => {
      if (senderId && item.conversationId !== senderId) return false;
      if (dateOption.sinceMs != null && Date.now() - item.createdAt > dateOption.sinceMs) return false;
      return true;
    });
  }

  const q = query.trim().toLowerCase();
  const conversationResults = useMemo(
    () => (q ? conversations.filter((c) => c.name.toLowerCase().includes(q)) : conversations),
    [conversations, q],
  );
  const userResults = useMemo(() => conversationResults.filter((c) => c.kind === 'direct'), [conversationResults]);
  const botResults = useMemo(() => conversationResults.filter((c) => c.kind === 'bot'), [conversationResults]);
  const filteredMessages = useMemo(() => withFilters(messageResults), [messageResults, senderId, dateKey]);
  const filteredFiles = useMemo(() => withFilters(fileResults), [fileResults, senderId, dateKey]);
  const serverResults = useMemo(
    () => (q ? servers.filter((s) => s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)) : servers),
    [servers, q],
  );

  function toggleMediaChip(key) {
    setMediaKinds((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function openConversation(id, messageId) {
    router.push(messageId ? `/conversation/${id}?highlight=${messageId}` : `/conversation/${id}`);
  }

  function openDirectoryUser(user) {
    const id = startDirectConversation(user);
    router.push(`/conversation/${id}`);
  }

  function openServer(id) {
    router.push(`/server/${id}`);
  }

  const dateSheetActions = DATE_OPTIONS.map((d) => ({
    key: d.key,
    label: d.label,
    icon: d.key === dateKey ? 'checkmark-circle' : 'ellipse-outline',
    onPress: () => setDateKey(d.key),
  }));
  const senderSheetActions = [
    { key: 'any', label: 'Any sender', icon: !senderId ? 'checkmark-circle' : 'ellipse-outline', onPress: () => setSenderId(null) },
    ...conversations.map((c) => ({
      key: c.id,
      label: c.name,
      icon: senderId === c.id ? 'checkmark-circle' : 'ellipse-outline',
      onPress: () => setSenderId(c.id),
    })),
  ];

  const showMediaChips = tab === 'files';
  const showSenderDate = tab === 'messages' || tab === 'files';

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.xs }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search users, bots, servers, messages…"
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
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabRow} contentContainerStyle={{ paddingHorizontal: space.md, gap: space.sm }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tabChip, active && styles.tabChipActive]}>
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={{ paddingHorizontal: space.md, gap: space.sm }}>
        {showMediaChips
          ? MEDIA_CHIPS.map((c) => {
              const active = mediaKinds.has(c.key);
              return (
                <Pressable key={c.key} onPress={() => toggleMediaChip(c.key)} style={[styles.filterChip, active && styles.filterChipActive]}>
                  <Ionicons name={c.icon} size={13} color={active ? colors.onAccent : colors.textSecondary} />
                  <Text style={[styles.filterLabel, active && styles.filterLabelActive]}>{c.label}</Text>
                </Pressable>
              );
            })
          : null}
        {showSenderDate ? (
          <>
            <Pressable onPress={() => setDateSheetOpen(true)} style={[styles.filterChip, dateKey !== 'any' && styles.filterChipActive]}>
              <Ionicons name="calendar-outline" size={13} color={dateKey !== 'any' ? colors.onAccent : colors.textSecondary} />
              <Text style={[styles.filterLabel, dateKey !== 'any' && styles.filterLabelActive]}>
                {dateKey === 'any' ? 'Date' : dateOption.label}
              </Text>
            </Pressable>
            <Pressable onPress={() => setSenderSheetOpen(true)} style={[styles.filterChip, senderId && styles.filterChipActive]}>
              <Ionicons name="person-outline" size={13} color={senderId ? colors.onAccent : colors.textSecondary} />
              <Text style={[styles.filterLabel, senderId && styles.filterLabelActive]} numberOfLines={1}>
                {sender ? sender.name : 'Sender'}
              </Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>

      {loading && (tab === 'messages' || tab === 'files') ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : directoryLoading && tab === 'usernames' ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : tab === 'messages' ? (
        <FlatList
          data={filteredMessages}
          keyExtractor={(m) => m.messageId}
          contentContainerStyle={{ paddingBottom: space.xl * 2 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openConversation(item.conversationId, item.messageId)}
              style={({ pressed }) => [styles.resultRow, pressed && { backgroundColor: colors.surfaceRaised }]}
            >
              <View style={[styles.avatar, { backgroundColor: hashColor(item.conversationId) }]}>
                <Text style={styles.avatarText}>{initials(item.conversationName)}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: space.md }}>
                <View style={styles.resultTopLine}>
                  <Text style={styles.resultName} numberOfLines={1}>{item.conversationName}</Text>
                  <Text style={styles.resultTime}>{timeLabel(item.createdAt)}</Text>
                </View>
                <Text style={styles.resultSnippet} numberOfLines={1}>{item.text}</Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={<EmptyState query={query} styles={styles} />}
        />
      ) : tab === 'files' ? (
        <FlatList
          data={filteredFiles}
          keyExtractor={(f) => f.messageId}
          contentContainerStyle={{ paddingBottom: space.xl * 2 }}
          renderItem={({ item }) => {
            const visual = item.attachment.kind === 'link'
              ? { icon: 'link-outline', color: colors.accent, label: 'Link' }
              : fileVisualFor(item.attachment.ext || '');
            return (
              <Pressable
                onPress={() => openConversation(item.conversationId, item.messageId)}
                style={({ pressed }) => [styles.resultRow, pressed && { backgroundColor: colors.surfaceRaised }]}
              >
                <View style={[styles.fileIcon, { backgroundColor: visual.color + '22' }]}>
                  <Ionicons name={item.attachment.kind === 'link' ? 'link-outline' : 'document-outline'} size={19} color={visual.color} />
                </View>
                <View style={{ flex: 1, marginLeft: space.md }}>
                  <Text style={styles.resultName} numberOfLines={1}>{item.attachment.name}</Text>
                  <Text style={styles.resultSnippet} numberOfLines={1}>
                    {item.conversationName} · {timeLabel(item.createdAt)}
                  </Text>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={<EmptyState query={query} styles={styles} />}
        />
      ) : tab === 'users' ? (
        <ConversationList data={userResults} styles={styles} colors={colors} onPress={(c) => openConversation(c.id)} query={query} />
      ) : tab === 'usernames' ? (
        <FlatList
          data={directoryResults}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ paddingBottom: space.xl * 2 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openDirectoryUser(item)}
              style={({ pressed }) => [styles.resultRow, pressed && { backgroundColor: colors.surfaceRaised }]}
            >
              <View style={[styles.avatar, { backgroundColor: hashColor(item.id) }]}>
                <Text style={styles.avatarText}>{initials(item.name)}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: space.md }}>
                <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.resultSnippet} numberOfLines={1}>@{item.username}</Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={<EmptyState query={query} styles={styles} />}
        />
      ) : tab === 'bots' ? (
        <ConversationList data={botResults} styles={styles} colors={colors} onPress={(c) => openConversation(c.id)} query={query} />
      ) : tab === 'servers' ? (
        <FlatList
          data={serverResults}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingBottom: space.xl * 2 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openServer(item.id)}
              style={({ pressed }) => [styles.resultRow, pressed && { backgroundColor: colors.surfaceRaised }]}
            >
              <View style={[styles.avatar, { backgroundColor: item.iconColor || hashColor(item.id) }]}>
                <Text style={styles.avatarText}>{initials(item.name)}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: space.md }}>
                <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.resultSnippet} numberOfLines={1}>
                  {item.memberCount} member{item.memberCount === 1 ? '' : 's'}{item.description ? ` · ${item.description}` : ''}
                </Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={<EmptyState query={query} styles={styles} />}
        />
      ) : (
        <ConversationList data={conversationResults} styles={styles} colors={colors} onPress={(c) => openConversation(c.id)} query={query} />
      )}

      <ActionSheet visible={dateSheetOpen} onClose={() => setDateSheetOpen(false)} title="Filter by date" actions={dateSheetActions} />
      <ActionSheet visible={senderSheetOpen} onClose={() => setSenderSheetOpen(false)} title="Filter by sender" actions={senderSheetActions} />
    </View>
  );
}

function ConversationList({ data, styles, colors, onPress, query }) {
  return (
    <FlatList
      data={data}
      keyExtractor={(c) => c.id}
      contentContainerStyle={{ paddingBottom: space.xl * 2 }}
      renderItem={({ item }) => (
        <Pressable onPress={() => onPress(item)} style={({ pressed }) => [styles.resultRow, pressed && { backgroundColor: colors.surfaceRaised }]}>
          <View style={[styles.avatar, { backgroundColor: hashColor(item.id) }]}>
            <Text style={styles.avatarText}>{initials(item.name)}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: space.md }}>
            <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.resultSnippet} numberOfLines={1}>
              {item.kind === 'relay' ? 'Server relay' : item.kind === 'bot' ? 'Bot' : item.kind === 'group' ? 'Group' : 'Direct message'}
            </Text>
          </View>
        </Pressable>
      )}
      ListEmptyComponent={<EmptyState query={query} styles={styles} />}
    />
  );
}

function EmptyState({ query, styles }) {
  return (
    <View style={styles.centerFill}>
      <Text style={styles.emptyText}>{query ? `No results for "${query}".` : 'Nothing here yet.'}</Text>
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    searchBar: {
      flexDirection: 'row', alignItems: 'center', gap: space.sm,
      marginHorizontal: space.md, marginBottom: space.sm,
      backgroundColor: colors.surface, borderRadius: radius.lg,
      paddingHorizontal: space.md, height: 36,
      borderWidth: 1, borderColor: colors.border,
    },
    searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15, padding: 0 },
    cancelText: { ...type.body, color: colors.accent, fontWeight: '600' },
    tabRow: { flexGrow: 0, marginBottom: space.sm },
    tabChip: {
      paddingHorizontal: space.md, paddingVertical: 7,
      borderRadius: radius.xl, backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.border,
    },
    tabChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    tabLabel: { ...type.small, color: colors.textSecondary, fontWeight: '600' },
    tabLabelActive: { color: colors.onAccent },
    filterRow: { flexGrow: 0, marginBottom: space.sm },
    filterChip: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: space.sm + 2, paddingVertical: 6,
      borderRadius: radius.lg, backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.border, maxWidth: 140,
    },
    filterChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    filterLabel: { ...type.small, fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
    filterLabelActive: { color: colors.onAccent },
    resultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm + 2, paddingHorizontal: space.md },
    avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: '#F2F4F6', fontSize: 14, fontWeight: '600' },
    fileIcon: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    resultTopLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    resultName: { ...type.body, color: colors.textPrimary, fontWeight: '600', flexShrink: 1 },
    resultTime: { ...type.small, color: colors.textMuted, marginLeft: space.sm },
    resultSnippet: { ...type.small, color: colors.textMuted, marginTop: 1 },
    centerFill: { alignItems: 'center', justifyContent: 'center', paddingTop: space.xl * 2, paddingHorizontal: space.xl },
    emptyText: { ...type.body, color: colors.textMuted, textAlign: 'center' },
  });
}
