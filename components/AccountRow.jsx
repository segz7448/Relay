import { useEffect, useMemo, useRef } from 'react';
import { View, Text, Pressable, Animated, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type, space, useTheme } from '../theme';
import Avatar from './Avatar';
import { accountPresence } from '../accountsStore';

// A row for another signed-in account in the Settings switcher — avatar,
// name, subtitle, tap to switch. In edit mode a red "minus" control
// slides in on the left (the same iOS delete-control shape Telegram uses
// for its own account list), tap to log that account out of this device.
export default function AccountRow({ account, editing, onPress, onLongPress, onRemove }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const removeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(removeAnim, {
      toValue: editing ? 1 : 0,
      useNativeDriver: true,
      speed: 22,
      bounciness: 6,
    }).start();
  }, [editing]);

  const name = account.name || account.username || account.email || 'Account';
  const subtitle = account.username ? `@${account.username}` : account.email || 'Tap to switch';
  const presence = accountPresence(account);

  return (
    <Pressable
      onPress={editing ? undefined : onPress}
      onLongPress={editing ? undefined : onLongPress}
      disabled={editing}
      style={({ pressed }) => [styles.row, pressed && !editing && { opacity: 0.7 }]}
    >
      <Animated.View
        style={[
          styles.removeWrap,
          {
            opacity: removeAnim,
            transform: [{ scale: removeAnim }],
            width: removeAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 26] }),
          },
        ]}
      >
        {editing ? (
          <Pressable onPress={onRemove} hitSlop={8}>
            <Ionicons name="remove-circle" size={22} color={colors.danger} />
          </Pressable>
        ) : null}
      </Animated.View>

      <View style={styles.avatarWrap}>
        <Avatar uri={account.photo} name={name} size={44} />
        {presence.online ? <View style={styles.onlineDot} /> : null}
      </View>
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.subtitleRow}>
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
          {subtitle && presence.label ? <Text style={styles.subtitleDivider}>·</Text> : null}
          <Text
            style={[styles.subtitle, presence.online && { color: colors.online }]}
            numberOfLines={1}
          >
            {presence.label}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.xs },
    removeWrap: { alignItems: 'flex-start', justifyContent: 'center', overflow: 'hidden' },
    avatarWrap: { position: 'relative' },
    onlineDot: {
      position: 'absolute', right: 0, bottom: 0,
      width: 12, height: 12, borderRadius: 6,
      backgroundColor: colors.online, borderWidth: 2, borderColor: colors.bg,
    },
    text: { flex: 1, marginLeft: space.md },
    name: { ...type.body, fontWeight: '600', color: colors.textPrimary },
    subtitleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
    subtitleDivider: { ...type.small, color: colors.textMuted, marginHorizontal: 4 },
    subtitle: { ...type.small, color: colors.textMuted },
  });
}
