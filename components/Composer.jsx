import { useMemo, useRef, useState } from 'react';
import { Pressable, Animated, TextInput, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { space, radius, type, useTheme } from '../theme';
import VoiceRecorder from './VoiceRecorder';
import EmojiPickerSheet from './EmojiPickerSheet';

function RoundButton({ icon, onPress, size = 30, color, filled }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = () => Animated.spring(scale, { toValue: 0.86, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  const onPressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 8 }).start();
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        hitSlop={8}
        style={[
          styles.roundBtn,
          { width: size, height: size, borderRadius: size / 2 },
          filled && { backgroundColor: colors.accent },
        ]}
      >
        <Ionicons name={icon} size={size * 0.56} color={filled ? colors.onAccent : color ?? colors.textSecondary} />
      </Pressable>
    </Animated.View>
  );
}

// Bottom message bar. Telegram's composer: + attachment, growing text
// field with an emoji toggle inside it, and a trailing action button that
// is a mic when the field is empty and morphs into a send arrow the
// moment there's text — never both, never neither.
//
// The mic slot is VoiceRecorder itself, not a plain button: holding it
// down takes over recording (with its own slide-to-cancel/lock/pause
// UI), and `onVoice` fires once with the finished attachment when the
// hold ends in a send, exactly like `onSend` fires once with the typed
// text.
export default function Composer({ onSend, onAttach, onVoice, replyingTo, onCancelReply, editingText, onCancelEdit, initialText }) {
  const { colors, fontScale } = useTheme();
  const styles = useMemo(() => getStyles(colors, fontScale), [colors, fontScale]);
  // `initialText` seeds the field once (e.g. a "Message instead" quick
  // reply handed off from a declined call) — same one-time-seed pattern
  // as `editingText`, not a controlled/synced prop.
  const [text, setText] = useState(editingText ?? initialText ?? '');
  const [recordingActive, setRecordingActive] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const hasText = text.trim().length > 0;

  function submit() {
    if (!hasText) return;
    onSend?.(text.trim());
    setText('');
  }

  function insertEmoji(emoji) {
    setText((t) => t + emoji);
    setEmojiPickerOpen(false);
  }

  return (
    <View style={styles.wrap}>
      {replyingTo ? (
        <View style={styles.contextBar}>
          <Ionicons name="arrow-undo" size={14} color={colors.accent} />
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <Text numberOfLines={1} style={styles.contextTitle}>Reply to {replyingTo.author}</Text>
            <Text numberOfLines={1} style={styles.contextBody}>{replyingTo.text}</Text>
          </View>
          <Pressable onPress={onCancelReply} hitSlop={8}>
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : null}

      {editingText != null ? (
        <View style={styles.contextBar}>
          <Ionicons name="create-outline" size={14} color={colors.accent} />
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <Text numberOfLines={1} style={styles.contextTitle}>Editing message</Text>
          </View>
          <Pressable onPress={onCancelEdit} hitSlop={8}>
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.row}>
        {!recordingActive ? <RoundButton icon="add" onPress={onAttach} size={32} /> : null}

        {!recordingActive ? (
          <View style={styles.inputWrap}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Message"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              multiline
            />
            <RoundButton icon="happy-outline" onPress={() => setEmojiPickerOpen(true)} size={26} color={colors.textMuted} />
          </View>
        ) : null}

        {hasText ? (
          <RoundButton icon="arrow-up" onPress={submit} size={32} filled />
        ) : (
          <VoiceRecorder onFinish={onVoice} onActiveChange={setRecordingActive} />
        )}
      </View>

      <EmojiPickerSheet visible={emojiPickerOpen} onClose={() => setEmojiPickerOpen(false)} onSelect={insertEmoji} />
    </View>
  );
}

function getStyles(colors, fontScale = 1) {
  return StyleSheet.create({
    wrap: { backgroundColor: colors.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    contextBar: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: space.md, paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    contextTitle: { ...type.small, color: colors.accent, fontWeight: '700' },
    contextBody: { ...type.small, color: colors.textSecondary },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: space.sm,
      paddingHorizontal: space.sm,
      paddingVertical: space.sm,
    },
    roundBtn: { alignItems: 'center', justifyContent: 'center' },
    inputWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-end',
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      paddingLeft: space.md,
      paddingRight: 4,
      paddingVertical: 4,
      minHeight: 40,
      maxHeight: 120,
    },
    input: {
      flex: 1,
      ...type.body,
      fontSize: type.body.fontSize * fontScale,
      color: colors.textPrimary,
      paddingVertical: 6,
      maxHeight: 100,
    },
  });
}
