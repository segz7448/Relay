import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, View, Text, FlatList, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, avatarPalette, useTheme } from '../theme';
import { groupReactions } from '../utils/reactions';

function hashColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return avatarPalette[h % avatarPalette.length];
}

function initials(name) {
  const parts = (name || '?').trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Telegram's "who reacted" sheet: an "All" tab plus one tab per distinct
// emoji, a scrollable list of reactors underneath, and a tap on your own
// row removes your reaction — the same gesture Telegram uses there.
export default function ReactionsViewSheet({ visible, message, onClose, onRemoveMine }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [tab, setTab] = useState('all');

  const groups = useMemo(() => groupReactions(message?.reactions), [message]);
  const total = message?.reactions?.length ?? 0;

  useEffect(() => {
    if (visible) setTab('all');
  }, [visible, message?.id]);

  if (!message) return null;

  const rows =
    tab === 'all'
      ? groups.flatMap((g) => g.reactors.map((r) => ({ ...r, emoji: g.emoji })))
      : (groups.find((g) => g.emoji === tab)?.reactors ?? []).map((r) => ({ ...r, emoji: tab }));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + space.sm }]} onPress={() => {}}>
          <View style={styles.grabber} />

          <View style={styles.tabRow}>
            <Pressable onPress={() => setTab('all')} style={[styles.tab, tab === 'all' && styles.tabActive]}>
              <Text style={[styles.tabText, tab === 'all' && styles.tabTextActive]}>All {total}</Text>
            </Pressable>
            {groups.map((g) => (
              <Pressable
                key={g.emoji}
                onPress={() => setTab(g.emoji)}
                style={[styles.tab, tab === g.emoji && styles.tabActive]}
              >
                <Text style={[styles.tabText, tab === g.emoji && styles.tabTextActive]}>
                  {g.emoji} {g.count}
                </Text>
              </Pressable>
            ))}
          </View>

          <FlatList
            data={rows}
            keyExtractor={(r, i) => `${r.name}-${r.emoji}-${i}`}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  if (item.mine) {
                    onRemoveMine?.();
                    onClose?.();
                  }
                }}
                style={({ pressed }) => [styles.row, pressed && item.mine && { backgroundColor: colors.surfaceRaised }]}
              >
                <View style={[styles.avatar, { backgroundColor: hashColor(item.name || '?') }]}>
                  <Text style={styles.avatarText}>{initials(item.name)}</Text>
                </View>
                <Text style={styles.name} numberOfLines={1}>
                  {item.mine ? 'You' : item.name}
                </Text>
                <Text style={styles.rowEmoji}>{item.emoji}</Text>
                {item.mine ? <Ionicons name="close-circle" size={18} color={colors.textMuted} style={{ marginLeft: 6 }} /> : null}
              </Pressable>
            )}
            style={{ maxHeight: 320 }}
            contentContainerStyle={{ paddingBottom: space.sm }}
          />

          {rows.some((r) => r.mine) ? (
            <Text style={styles.hint}>Tap your reaction to remove it</Text>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: space.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderBottomWidth: 0,
    },
    grabber: {
      width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border,
      alignSelf: 'center', marginTop: space.sm, marginBottom: space.sm,
    },
    tabRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, paddingBottom: space.sm },
    tab: {
      paddingHorizontal: space.sm, paddingVertical: 6, borderRadius: radius.xl,
      backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border,
    },
    tabActive: { backgroundColor: colors.accentDim, borderColor: colors.accent },
    tabText: { ...type.small, color: colors.textSecondary, fontWeight: '600' },
    tabTextActive: { color: colors.textPrimary },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: space.sm,
      paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    },
    avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: '#F2F4F6', fontSize: 12, fontWeight: '600' },
    name: { ...type.body, color: colors.textPrimary, flex: 1 },
    rowEmoji: { fontSize: 18 },
    hint: { ...type.small, color: colors.textMuted, textAlign: 'center', paddingVertical: space.sm },
  });
}
