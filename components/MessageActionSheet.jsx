import { useMemo } from 'react';
import { Modal, Pressable, View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../theme';
import { QUICK_REACTIONS } from '../utils/reactions';
import { hapticTap, hapticSwitch } from '../utils/haptics';

// Telegram's long-press-on-a-message sheet: a row of quick-tap reactions
// (plus a "+" to the full picker) above a card of contextual actions
// (reply/forward/copy/pin/edit/delete/select), closing the same two-group
// way as ActionSheet.
export default function MessageActionSheet({ visible, onClose, message, onReact, onOpenMore, actions = [] }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  if (!message) return null;

  const mine = message.reactions?.find((r) => r.mine);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={[styles.wrap, { paddingBottom: insets.bottom + space.sm }]}>
          <View style={styles.reactionRow}>
            {QUICK_REACTIONS.map((emoji) => {
              const isMine = mine?.emoji === emoji;
              return (
                <Pressable
                  key={emoji}
                  onPress={() => {
                    isMine ? hapticSwitch() : hapticTap();
                    onClose?.();
                    onReact?.(message, emoji);
                  }}
                  style={({ pressed }) => [
                    styles.reactionBtn,
                    isMine && styles.reactionBtnMine,
                    pressed && { transform: [{ scale: 0.88 }] },
                  ]}
                  hitSlop={4}
                >
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => onOpenMore?.(message)}
              style={({ pressed }) => [styles.reactionBtn, styles.moreBtn, pressed && { transform: [{ scale: 0.88 }] }]}
              hitSlop={4}
            >
              <Ionicons name="add" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.card}>
            {actions.map((a, i) => (
              <Pressable
                key={a.key ?? i}
                onPress={() => {
                  onClose?.();
                  a.onPress?.(message);
                }}
                style={({ pressed }) => [
                  styles.row,
                  i > 0 && styles.rowBorder,
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
  reactionRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    paddingHorizontal: space.sm,
    paddingVertical: 8,
    gap: 4,
  },
  reactionBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  reactionBtnMine: { backgroundColor: colors.accentDim },
  reactionEmoji: { fontSize: 21 },
  moreBtn: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
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
