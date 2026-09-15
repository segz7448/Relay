import { useMemo } from 'react';
import { Modal, Pressable, View, Text, Image, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../theme';
import { fileVisualFor, formatBytes } from '../utils/fileTypes';

// The confirmation step between "picked a file" and "it's in the
// thread": exactly what's about to go out (name, kind, size, MIME) plus
// a real thumbnail when one is available, so nothing is sent by
// accident. Cancel/Send sit as a single divided row, the way iOS sheets
// pair a destructive-adjacent and a primary action side by side.
export default function FilePreviewSheet({ visible, attachment, onCancel, onSend }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  if (!attachment) return null;

  const visual = fileVisualFor(attachment.ext);
  const isImage = attachment.kind === 'image' && attachment.uri;
  const isVideo = attachment.kind === 'video';

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={[styles.wrap, { paddingBottom: insets.bottom + space.sm }]} onPress={() => {}}>
          <View style={styles.card}>
            <View style={styles.previewArea}>
              {isImage ? (
                <Image source={{ uri: attachment.uri }} style={styles.previewImage} resizeMode="cover" />
              ) : (
                <View style={[styles.iconTile, { backgroundColor: visual.color }]}>
                  <MaterialCommunityIcons name={visual.icon} size={40} color="#FFFFFF" />
                </View>
              )}
              {isVideo ? (
                <View style={styles.playBadge}>
                  <Ionicons name="play" size={16} color="#FFFFFF" />
                </View>
              ) : null}
            </View>

            <View style={styles.metaBlock}>
              <Text style={styles.filename} numberOfLines={1}>{attachment.name}</Text>
              <View style={styles.metaRow}>
                <Text style={styles.metaChip}>{attachment.ext ? attachment.ext.toUpperCase() : visual.label}</Text>
                {attachment.size != null ? <Text style={styles.metaText}>{formatBytes(attachment.size)}</Text> : null}
              </View>
              <Text style={styles.mimeText} numberOfLines={1}>{attachment.mime}</Text>
            </View>
          </View>

          <View style={[styles.card, styles.actionsCard]}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [styles.actionBtn, styles.actionBorder, pressed && { backgroundColor: colors.surfaceRaised }]}
            >
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={onSend}
              style={({ pressed }) => [styles.actionBtn, pressed && { backgroundColor: colors.surfaceRaised }]}
            >
              <Text style={styles.sendLabel}>Send</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    wrap: { paddingHorizontal: space.sm, gap: space.sm },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    previewArea: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: space.lg,
      paddingBottom: space.md,
    },
    previewImage: { width: 160, height: 160, borderRadius: radius.md },
    iconTile: {
      width: 88, height: 88, borderRadius: 22,
      alignItems: 'center', justifyContent: 'center',
    },
    playBadge: {
      position: 'absolute', width: 36, height: 36, borderRadius: 18,
      backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
    },
    metaBlock: {
      paddingHorizontal: space.lg,
      paddingBottom: space.lg,
      alignItems: 'center',
      gap: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: space.md,
    },
    filename: { ...type.h2, color: colors.textPrimary, maxWidth: '100%' },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    metaChip: {
      ...type.small, fontWeight: '700', color: colors.textSecondary,
      backgroundColor: colors.surfaceRaised, borderRadius: radius.sm,
      paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden',
    },
    metaText: { ...type.small, color: colors.textMuted },
    mimeText: { ...type.small, color: colors.textMuted },
    actionsCard: { flexDirection: 'row' },
    actionBtn: { flex: 1, alignItems: 'center', paddingVertical: space.md },
    actionBorder: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
    cancelLabel: { ...type.body, color: colors.textPrimary },
    sendLabel: { ...type.body, color: colors.accent, fontWeight: '700' },
  });
}
