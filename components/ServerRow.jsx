import { useMemo } from 'react';
import { Pressable, View, Text, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../theme';

// Telegram-style relative timestamp for the last-activity column.
function activityLabel(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = 60 * 1000, hr = 60 * min, day = 24 * hr;
  if (diff < min) return 'now';
  if (diff < hr) return `${Math.floor(diff / min)}m`;
  if (diff < day) return `${Math.floor(diff / hr)}h`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ServerRow({ server, onPress, onLongPress }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const initials = server.name.trim().slice(0, 1).toUpperCase();

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceRaised }]}
    >
      {server.icon ? (
        <Image source={{ uri: server.icon }} style={styles.iconImg} />
      ) : (
        <View style={[styles.icon, { backgroundColor: server.iconColor || colors.surfaceRaised }]}>
          <Text style={styles.iconText}>{initials}</Text>
        </View>
      )}

      <View style={styles.main}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{server.name}</Text>
          {server.privacy === 'private' ? (
            <Ionicons name="lock-closed" size={11} color={colors.textMuted} />
          ) : null}
          {server.muted ? (
            <Ionicons name="notifications-off-outline" size={13} color={colors.textMuted} />
          ) : null}
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="ellipse" size={7} color={colors.online} />
          <Text style={styles.meta} numberOfLines={1}>
            {server.onlineCount} online · {server.memberCount} member{server.memberCount === 1 ? '' : 's'}
          </Text>
        </View>
      </View>

      <View style={styles.right}>
        <Text style={styles.time}>{activityLabel(server.lastActivityAt)}</Text>
        {server.unreadCount > 0 ? (
          <View style={[styles.badge, server.muted && { backgroundColor: colors.textMuted }]}>
            <Text style={styles.badgeText}>{server.unreadCount > 99 ? '99+' : server.unreadCount}</Text>
          </View>
        ) : (
          <View style={styles.badgeSpacer} />
        )}
      </View>
    </Pressable>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: space.md,
      paddingHorizontal: space.lg,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: space.md,
    },
    icon: {
      width: 48, height: 48, borderRadius: 24,
      alignItems: 'center', justifyContent: 'center',
    },
    iconImg: { width: 48, height: 48, borderRadius: 24 },
    iconText: { color: '#F2F4F6', fontSize: 18, fontWeight: '600' },
    main: { flex: 1 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    name: { ...type.h2, color: colors.textPrimary, flexShrink: 1 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
    meta: { ...type.small, color: colors.textMuted },
    right: { alignItems: 'flex-end', gap: 6, minWidth: 40 },
    time: { ...type.small, color: colors.textMuted },
    badge: {
      minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6,
      alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent,
    },
    badgeText: { color: colors.onAccent, fontSize: 11, fontWeight: '700' },
    badgeSpacer: { height: 20 },
  });
}
