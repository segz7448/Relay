import { useEffect, useMemo, useRef } from 'react';
import { Modal, Pressable, View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { type, space, useTheme } from '../theme';
import GlassSurface from './GlassSurface';

// The eight-way grid Telegram shows above the composer when you tap the
// "+" — each option gets its own colored tile (not a flat icon list) so
// the sheet reads as a set of distinct destinations, not a menu of
// settings. Two rows of four, same card-then-Cancel-card shape as the
// rest of the app's sheets.
const OPTIONS = [
  { key: 'photo', label: 'Photo', icon: 'image', color: '#3D9BFF' },
  { key: 'camera', label: 'Camera', icon: 'camera', color: '#E5584D' },
  { key: 'video', label: 'Video', icon: 'videocam', color: '#9C5AE5' },
  { key: 'document', label: 'Document', icon: 'document-text', color: '#3D6EE0' },
  { key: 'file', label: 'File', icon: 'folder', color: '#E5883D' },
  { key: 'audio', label: 'Audio', icon: 'musical-notes', color: '#D1453B' },
  { key: 'contact', label: 'Contact', icon: 'person', color: '#2E9E5B' },
  { key: 'location', label: 'Location', icon: 'location', color: '#1E9C74' },
];

export default function AttachmentSheet({ visible, onClose, onSelect, keys }) {
  // `keys` narrows the grid to the attachment kinds the host screen
  // actually handles (e.g. the bot-user thread only offers what the bot
  // file endpoint accepts) — never tiles that lead nowhere.
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      rise.setValue(0);
      Animated.timing(rise, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [24, 0] });

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Animated.View
          style={[styles.wrap, { paddingBottom: insets.bottom + space.sm, opacity: rise, transform: [{ translateY }] }]}
        >
          <GlassSurface variant="sheet" contentStyle={styles.grid}>
            {(keys ? OPTIONS.filter((o) => keys.includes(o.key)) : OPTIONS).map((opt) => (
              <Pressable
                key={opt.key}
                onPress={() => {
                  onClose?.();
                  onSelect?.(opt.key);
                }}
                style={({ pressed }) => [styles.tile, pressed && { opacity: 0.6 }]}
              >
                <View style={[styles.iconBox, { backgroundColor: opt.color }]}>
                  <Ionicons name={opt.icon} size={24} color="#FFFFFF" />
                </View>
                <Text style={styles.tileLabel} numberOfLines={1}>{opt.label}</Text>
              </Pressable>
            ))}
          </GlassSurface>

          <Pressable onPress={onClose}>
            {({ pressed }) => (
              <GlassSurface variant="sheet" style={[styles.cancelCard, pressed && styles.cancelCardPressed]}>
                <Text style={styles.cancelLabel}>Cancel</Text>
              </GlassSurface>
            )}
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    wrap: { paddingHorizontal: space.sm, gap: space.sm },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingVertical: space.md,
      paddingHorizontal: 4,
    },
    tile: {
      width: '25%',
      alignItems: 'center',
      paddingVertical: space.sm,
      gap: 6,
    },
    iconBox: {
      width: 52,
      height: 52,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tileLabel: { ...type.small, color: colors.textSecondary },
    cancelCard: { alignItems: 'center', paddingVertical: space.md },
    cancelCardPressed: { opacity: 0.7 },
    cancelLabel: { ...type.body, color: colors.accent, fontWeight: '700' },
  });
}
