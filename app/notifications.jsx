// app/notifications.jsx — in-app notification inbox.
//
// Lists every notification received while the app was running (or tapped
// through), real data from the Notifications context (notifications.js).
// Tapping a row marks it read and routes to the conversation/bot the
// notification is about, using the ids the Worker includes in the push
// payload (worker/src/lib/fcm.ts).

import { useMemo } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, avatarPalette, useTheme } from '../theme';
import { useNotifications } from '../notifications';
import { EmptyState } from '../components/StateViews';

const TYPE_VISUALS = {
  message: { icon: 'chatbubble-ellipses', color: '#3D9BFF' },
  bot_alert: { icon: 'hardware-chip-outline', color: '#9C5AE5' },
  server: { icon: 'server-outline', color: '#2E9E5B' },
  relay: { icon: 'server-outline', color: '#2E9E5B' },
  incoming_call: { icon: 'call-outline', color: '#E5584D' },
};

function timeLabel(ts) {
  const diff = Date.now() - ts;
  const min = 60 * 1000, hr = 60 * min, day = 24 * hr;
  if (diff < min) return 'now';
  if (diff < hr) return `${Math.floor(diff / min)}m`;
  if (diff < day) return `${Math.floor(diff / hr)}h`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function NotificationsInboxScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { items, markRead, markAllRead } = useNotifications();
  const unread = items.filter((n) => !n.read).length;

  function open(item) {
    markRead(item.id);
    const data = item.data ?? {};
    if (data.conversationId) router.push(`/conversation/${data.conversationId}`);
    else if (data.botId) router.push(`/bot/${data.botId}`);
  }

  return (
    <View style={styles.screen}>
      {items.length ? (
        <View style={styles.toolbar}>
          <Text style={styles.countText}>
            {unread ? `${unread} unread` : 'All caught up'}
          </Text>
          {unread ? (
            <Pressable
              onPress={markAllRead}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Mark all notifications as read"
            >
              <Text style={styles.markAll}>Mark all read</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: space.xl * 2 }}
        ListEmptyComponent={
          <EmptyState
            icon="notifications-outline"
            title="No notifications"
            message="Message and bot alerts you receive will show up here."
          />
        }
        renderItem={({ item }) => {
          const visual = TYPE_VISUALS[item.data?.type] ?? { icon: 'notifications-outline', color: '#8E8E93' };
          return (
            <Pressable
              onPress={() => open(item)}
              accessibilityRole="button"
              accessibilityLabel={`${item.read ? '' : 'Unread, '}${item.title ?? 'notification'}`}
              accessibilityState={{ selected: !item.read }}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceRaised }]}
            >
              <View style={[styles.iconBox, { backgroundColor: visual.color }]}>
                <Ionicons name={visual.icon} size={17} color="#FFFFFF" />
              </View>
              <View style={styles.rowText}>
                <View style={styles.topLine}>
                  <Text style={[styles.title, !item.read && styles.titleUnread]} numberOfLines={1}>
                    {item.title ?? 'Notification'}
                  </Text>
                  <Text style={styles.time}>{timeLabel(item.receivedAt)}</Text>
                </View>
                {item.body ? (
                  <Text style={styles.body} numberOfLines={2}>{item.body}</Text>
                ) : null}
              </View>
              {!item.read ? <View style={[styles.dot, { backgroundColor: colors.accent }]} /> : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    toolbar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: space.lg, paddingVertical: space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    countText: { ...type.small, color: colors.textSecondary },
    markAll: { ...type.small, color: colors.accent, fontWeight: '700' },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: space.md,
      paddingHorizontal: space.lg, paddingVertical: space.md,
    },
    iconBox: { width: 38, height: 38, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    rowText: { flex: 1 },
    topLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
    title: { ...type.body, color: colors.textSecondary, fontWeight: '500', flex: 1 },
    titleUnread: { color: colors.textPrimary, fontWeight: '700' },
    time: { ...type.small, color: colors.textMuted },
    body: { ...type.small, color: colors.textSecondary, marginTop: 2, lineHeight: 17 },
    dot: { width: 9, height: 9, borderRadius: 5 },
  });
}
