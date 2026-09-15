import { Modal, Pressable, View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

// The canned-response sheet iOS shows under "Message" on an incoming
// call — pick a quick line to send instead of answering, or write your
// own. Selecting either declines the call; the chosen text (if any) is
// handed to the conversation screen to prefill, not auto-sent, so the
// person can still edit before it goes out.
const QUICK_REPLIES = [
  "Can't talk right now.",
  "I'll call you right back.",
  "What's up?",
];

export default function QuickReplySheet({ visible, onClose, onPick }) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={[styles.wrap, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.card}>
            {QUICK_REPLIES.map((text, i) => (
              <Pressable
                key={text}
                onPress={() => onPick?.(text)}
                style={({ pressed }) => [styles.row, i > 0 && styles.rowBorder, pressed && styles.rowPressed]}
              >
                <Text style={styles.label}>{text}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => onPick?.('')}
              style={({ pressed }) => [styles.row, styles.rowBorder, pressed && styles.rowPressed]}
            >
              <Ionicons name="create-outline" size={17} color="#F2F4F6" />
              <Text style={[styles.label, { marginLeft: 8 }]}>Write a message…</Text>
            </Pressable>
          </View>

          <Pressable onPress={onClose} style={({ pressed }) => [styles.card, styles.cancelCard, pressed && styles.rowPressed]}>
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  wrap: { paddingHorizontal: 8, gap: 8 },
  card: { backgroundColor: 'rgba(36,43,49,0.98)', borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 15, paddingHorizontal: 16 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.14)' },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.08)' },
  label: { color: '#F2F4F6', fontSize: 16, fontWeight: '500' },
  cancelCard: { alignItems: 'center', paddingVertical: 15 },
  cancelLabel: { color: '#5EA1FF', fontSize: 16, fontWeight: '700' },
});
