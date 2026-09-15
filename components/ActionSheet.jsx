import { useMemo } from 'react';
import { Modal, Pressable, View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../theme';

// iOS action-sheet shape: a rounded card of actions (label left, icon
// trailing, hairline separators between rows) sitting just above a
// second card containing only Cancel — the same two-group layout as
// UIAlertController's actionSheet style / Telegram's long-press menu.
export default function ActionSheet({ visible, onClose, title, actions = [] }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={[styles.wrap, { paddingBottom: insets.bottom + space.sm }]}>
          <View style={styles.card}>
            {title ? (
              <View style={styles.titleRow}>
                <Text style={styles.title} numberOfLines={1}>{title}</Text>
              </View>
            ) : null}
            {actions.map((a, i) => (
              <Pressable
                key={a.key ?? i}
                onPress={() => {
                  onClose?.();
                  a.onPress?.();
                }}
                style={({ pressed }) => [
                  styles.row,
                  i > 0 || title ? styles.rowBorder : null,
                  pressed && { backgroundColor: colors.surfaceRaised },
                ]}
              >
                <Text style={[styles.label, a.destructive && { color: colors.danger }]}>{a.label}</Text>
                <Ionicons name={a.icon} size={18} color={a.destructive ? colors.danger : colors.textSecondary} />
              </Pressable>
            ))}
          </View>

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.card, styles.cancelCard, pressed && { backgroundColor: colors.surfaceRaised }]}
          >
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    wrap: { paddingHorizontal: space.sm, gap: space.sm },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    titleRow: { paddingVertical: space.sm, paddingHorizontal: space.md, alignItems: 'center' },
    title: { ...type.small, color: colors.textMuted, fontWeight: '600' },
    row: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: space.md, paddingHorizontal: space.md,
    },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    label: { ...type.body, color: colors.textPrimary },
    cancelCard: { alignItems: 'center', paddingVertical: space.md },
    cancelLabel: { ...type.body, color: colors.accent, fontWeight: '700' },
  });
}
