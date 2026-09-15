import { useMemo, useState } from 'react';
import { Modal, Pressable, View, Text, TextInput, StyleSheet, SectionList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../theme';
import { EMOJI_CATEGORIES } from '../utils/reactions';
import { hapticTap } from '../utils/haptics';

const COLUMNS = 8;

// The full reaction picker behind the "+" in MessageActionSheet — a
// searchable, categorized emoji grid, the same escalation Telegram uses
// once the six quick-tap reactions aren't the one you want.
export default function EmojiPickerSheet({ visible, onClose, onSelect }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rowsFor = (emojis) => {
      const rows = [];
      for (let i = 0; i < emojis.length; i += COLUMNS) rows.push(emojis.slice(i, i + COLUMNS));
      return rows;
    };
    if (!q) {
      return EMOJI_CATEGORIES.map((c) => ({ title: c.title, data: rowsFor(c.emojis) }));
    }
    const matches = EMOJI_CATEGORIES.flatMap((c) => c.emojis).filter(
      (e) => e.char === q || e.keywords.some((k) => k.includes(q))
    );
    return matches.length ? [{ title: 'Results', data: rowsFor(matches) }] : [];
  }, [query]);

  function handleClose() {
    setQuery('');
    onClose?.();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + space.sm }]} onPress={() => {}}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Reactions</Text>
            <Pressable hitSlop={10} onPress={handleClose}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search emoji"
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              autoCorrect={false}
            />
            {query.length > 0 ? (
              <Pressable hitSlop={10} onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          {sections.length ? (
            <SectionList
              sections={sections}
              keyExtractor={(row, i) => row.map((e) => e.char).join('') + i}
              stickySectionHeadersEnabled={false}
              renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
              renderItem={({ item: row }) => (
                <View style={styles.row}>
                  {row.map((e) => (
                    <Pressable
                      key={e.char}
                      onPress={() => {
                        hapticTap();
                        onSelect?.(e.char);
                        handleClose();
                      }}
                      style={({ pressed }) => [styles.cell, pressed && { transform: [{ scale: 0.85 }] }]}
                      hitSlop={2}
                    >
                      <Text style={styles.cellEmoji}>{e.char}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              style={styles.list}
              contentContainerStyle={{ paddingBottom: space.lg }}
              keyboardShouldPersistTaps="handled"
            />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No matching emoji</Text>
            </View>
          )}
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
      maxHeight: '72%',
      borderWidth: 1,
      borderColor: colors.border,
      borderBottomWidth: 0,
    },
    grabber: {
      width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border,
      alignSelf: 'center', marginTop: space.sm, marginBottom: space.xs,
    },
    headerRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: space.sm,
    },
    title: { ...type.h2, color: colors.textPrimary },
    searchRow: {
      flexDirection: 'row', alignItems: 'center', gap: space.xs,
      backgroundColor: colors.surfaceRaised, borderRadius: radius.md,
      paddingHorizontal: space.sm, paddingVertical: 7,
      marginBottom: space.sm,
    },
    searchInput: { ...type.body, color: colors.textPrimary, flex: 1, padding: 0 },
    list: { flexGrow: 0 },
    sectionTitle: { ...type.small, color: colors.textMuted, fontWeight: '600', marginTop: space.sm, marginBottom: 6 },
    row: { flexDirection: 'row', justifyContent: 'flex-start' },
    cell: { width: `${100 / COLUMNS}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
    cellEmoji: { fontSize: 26 },
    empty: { paddingVertical: space.xl, alignItems: 'center' },
    emptyText: { ...type.body, color: colors.textMuted },
  });
}
