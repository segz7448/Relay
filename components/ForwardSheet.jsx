import { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, avatarPalette, useTheme } from '../theme';
import { fetchConversations } from '../messagesApi';

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

// Full-screen "Forward to" picker — Telegram's flow for a long-pressed
// message: search or scroll recent chats, tap to check off any number of
// them, then Send. Deliberately its own screen (not a bottom sheet) since
// picking from a long, searchable list needs the space.
export default function ForwardSheet({ visible, messages, onClose, onSend }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setSelected(new Set());
    setSending(false);
    setLoading(true);
    fetchConversations().then((data) => {
      setConversations(data);
      setLoading(false);
    });
  }, [visible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? conversations.filter((c) => c.name.toLowerCase().includes(q)) : conversations;
    return [...base].sort((a, b) => (b.pinned - a.pinned) || (b.lastMessageAt - a.lastMessageAt));
  }, [conversations, query]);

  function toggle(convo) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(convo.id) ? next.delete(convo.id) : next.add(convo.id);
      return next;
    });
  }

  async function handleSend() {
    if (!selected.size || sending) return;
    setSending(true);
    await onSend?.(Array.from(selected));
    setSending(false);
  }

  const count = selected.size;
  const messageCount = messages?.length ?? 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {count ? `${count} selected` : 'Forward to…'}
          </Text>
          <View style={{ width: 52 }} />
        </View>

        {messageCount ? (
          <View style={styles.previewBar}>
            <Ionicons name="arrow-redo-outline" size={14} color={colors.textMuted} />
            <Text style={styles.previewText} numberOfLines={1}>
              {messageCount > 1
                ? `Forwarding ${messageCount} messages`
                : messages[0]?.text || (messages[0]?.attachment ? `📎 ${messages[0].attachment.name || messages[0].attachment.kind}` : 'Forwarding message')}
            </Text>
          </View>
        ) : null}

        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            autoCorrect={false}
          />
        </View>

        {loading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(c) => c.id}
            contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
            renderItem={({ item }) => {
              const on = selected.has(item.id);
              return (
                <Pressable
                  onPress={() => toggle(item)}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceRaised }]}
                >
                  <View style={[styles.avatar, { backgroundColor: hashColor(item.id) }]}>
                    <Text style={styles.avatarText}>{initials(item.name)}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: space.md }}>
                    <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.sub} numberOfLines={1}>
                      {item.kind === 'relay' ? 'Server relay' : item.kind === 'bot' ? 'Bot' : item.kind === 'group' ? 'Group' : 'Direct message'}
                    </Text>
                  </View>
                  <View style={[styles.checkbox, on && styles.checkboxOn]}>
                    {on ? <Ionicons name="checkmark" size={14} color={colors.onAccent} /> : null}
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View style={styles.centerFill}>
                <Text style={styles.emptyText}>No chats match "{query}".</Text>
              </View>
            }
          />
        )}

        {count > 0 ? (
          <View style={[styles.sendBar, { paddingBottom: insets.bottom + space.sm }]}>
            <Pressable
              onPress={handleSend}
              disabled={sending}
              style={({ pressed }) => [styles.sendBtn, pressed && { opacity: 0.85 }]}
            >
              {sending ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <>
                  <Text style={styles.sendLabel}>Send to {count}</Text>
                  <Ionicons name="send" size={16} color={colors.onAccent} />
                </>
              )}
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: space.md, paddingBottom: space.sm,
    },
    cancelText: { ...type.body, color: colors.accent, width: 52 },
    title: { ...type.h2, fontSize: 16, color: colors.textPrimary, flex: 1, textAlign: 'center' },
    previewBar: {
      flexDirection: 'row', alignItems: 'center', gap: space.sm,
      marginHorizontal: space.md, marginBottom: space.sm,
      paddingHorizontal: space.md, paddingVertical: space.sm,
      backgroundColor: colors.surface, borderRadius: radius.md,
      borderWidth: 1, borderColor: colors.border,
    },
    previewText: { ...type.small, color: colors.textSecondary, flex: 1 },
    searchBar: {
      flexDirection: 'row', alignItems: 'center', gap: space.sm,
      marginHorizontal: space.md, marginBottom: space.sm,
      backgroundColor: colors.surface, borderRadius: radius.lg,
      paddingHorizontal: space.md, height: 36,
      borderWidth: 1, borderColor: colors.border,
    },
    searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15, padding: 0 },
    row: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: space.sm + 2, paddingHorizontal: space.md,
    },
    avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: '#F2F4F6', fontSize: 15, fontWeight: '600' },
    name: { ...type.body, color: colors.textPrimary, fontWeight: '600' },
    sub: { ...type.small, color: colors.textMuted, marginTop: 1 },
    checkbox: {
      width: 24, height: 24, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1.5, borderColor: colors.border,
    },
    checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: space.xl * 2 },
    emptyText: { ...type.body, color: colors.textMuted },
    sendBar: {
      position: 'absolute', left: 0, right: 0, bottom: 0,
      paddingHorizontal: space.md, paddingTop: space.sm,
      backgroundColor: colors.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    },
    sendBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
      backgroundColor: colors.accent, borderRadius: radius.lg, paddingVertical: space.md,
    },
    sendLabel: { ...type.body, color: colors.onAccent, fontWeight: '700' },
  });
}
