import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, avatarPalette, useTheme } from '../../../../../theme';
import { fetchBot, fetchBotUser, setBotUserBlocked, setBotUserMuted, removeBotUser } from '../../../../../botsApi';
import ActionSheet from '../../../../../components/ActionSheet';
import { SkeletonCircle, SkeletonBox } from '../../../../../components/Skeleton';
import { ErrorState } from '../../../../../components/StateViews';
import { useToast } from '../../../../../components/Toast';
import { useConfirm } from '../../../../../components/ConfirmDialog';
import { hapticTap } from '../../../../../utils/haptics';

function hashColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return avatarPalette[h % avatarPalette.length];
}

function dateLabel(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function lastSeenLabel(ts) {
  if (!ts) return 'No activity yet';
  const diff = Date.now() - ts;
  const min = 60 * 1000, hr = 60 * min, day = 24 * hr;
  if (diff < min) return 'Active just now';
  if (diff < hr) return `Active ${Math.floor(diff / min)}m ago`;
  if (diff < day) return `Active ${Math.floor(diff / hr)}h ago`;
  if (diff < 7 * day) return `Active ${Math.floor(diff / day)}d ago`;
  return `Last seen ${dateLabel(ts)}`;
}

function Row({ icon, label, value, onPress, styles, colors, danger }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && onPress && { backgroundColor: colors.surfaceRaised }]}
    >
      <View style={[styles.rowIcon, danger && { backgroundColor: colors.dangerDim }]}>
        <Ionicons name={icon} size={16} color={danger ? colors.danger : colors.textSecondary} />
      </View>
      <Text style={[styles.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
      {value ? <Text style={styles.rowValue} numberOfLines={1}>{value}</Text> : null}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

function ActionButton({ icon, label, onPress, colors, styles, active, danger }) {
  return (
    <Pressable onPress={onPress} style={styles.actionBtnWrap}>
      <View style={[styles.actionBtn, active && { backgroundColor: colors.accentDim }, danger && { backgroundColor: colors.dangerDim }]}>
        <Ionicons name={icon} size={19} color={danger ? colors.danger : active ? colors.accent : colors.textSecondary} />
      </View>
      <Text style={[styles.actionLabel, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

export default function BotUserProfileScreen() {
  const { id, userId } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const toast = useToast();
  const confirm = useConfirm();

  const [bot, setBot] = useState(null);
  const [user, setUser] = useState(null);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error' | 'notfound'
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const b = await fetchBot(id);
      const u = await fetchBotUser(id, userId);
      setBot(b);
      if (u) {
        setUser(u);
        setPhase('ready');
      } else {
        setPhase('notfound');
      }
    } catch (e) {
      setPhase('error');
    }
  }, [id, userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function retry() {
    setPhase('loading');
    await load();
  }

  async function handleCopy(value, label) {
    await Clipboard.setStringAsync(value);
    toast.success(`${label} copied`);
  }

  // PHASE 12 — dedicated block/mute endpoints via the target state this
  // screen already has (`user.blocked`/`user.muted`), applied directly to
  // local `user` state. Previously this re-ran the racy fetch-then-invert
  // toggle and then a full `load()` (bot + user re-fetch) just to reflect
  // one flag flipping — now it's one request and one state update.
  async function handleToggleBlock() {
    setBusy(true);
    try {
      const updated = await setBotUserBlocked(id, userId, !user.blocked);
      setUser(updated);
    } catch (e) {
      toast.error("Couldn't update this user");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleMute() {
    setBusy(true);
    try {
      const updated = await setBotUserMuted(id, userId, !user.muted);
      setUser(updated);
    } catch (e) {
      toast.error("Couldn't update this user");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    const ok = await confirm({
      title: 'Remove user?',
      message: `Remove ${user?.name} from @${bot?.username}'s users? This can't be undone.`,
      confirmLabel: 'Remove',
      destructive: true,
      onConfirm: async () => {
        await removeBotUser(id, userId);
      },
    });
    if (!ok) return;
    toast.success('User removed');
    router.back();
  }

  if (phase === 'loading') {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={colors.accent} />
          </Pressable>
        </View>
        <View style={styles.identity}>
          <SkeletonCircle size={88} style={{ marginBottom: space.md }} />
          <SkeletonBox width={140} height={20} />
          <SkeletonBox width={100} height={12} style={{ marginTop: space.sm }} />
        </View>
        <View style={{ paddingHorizontal: space.lg, marginTop: space.lg }}>
          <SkeletonBox width="100%" height={200} radius={radius.lg} />
        </View>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={colors.accent} />
          </Pressable>
        </View>
        <ErrorState message="Couldn't load this user's profile." onRetry={retry} />
      </View>
    );
  }

  if (phase === 'notfound') {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={colors.accent} />
          </Pressable>
        </View>
        <ErrorState title="No longer here" message="This user is no longer in the list." />
      </View>
    );
  }

  const avatarColor = hashColor(user.id);
  const initial = user.name.trim().slice(0, 1).toUpperCase();

  const sheetActions = [
    {
      key: 'history',
      icon: 'chatbubble-ellipses-outline',
      label: 'Message history',
      onPress: () => router.push(`/bot/${id}/user/${userId}/history`),
    },
    { key: 'copy-username', icon: 'at-outline', label: 'Copy username', onPress: () => handleCopy(`@${user.username}`, 'Username') },
    { key: 'copy-id', icon: 'finger-print-outline', label: 'Copy user ID', onPress: () => handleCopy(user.id, 'User ID') },
    {
      key: 'mute',
      icon: user.muted ? 'notifications-outline' : 'notifications-off-outline',
      label: user.muted ? 'Unmute' : 'Mute',
      onPress: handleToggleMute,
    },
    {
      key: 'block',
      icon: user.blocked ? 'lock-open-outline' : 'lock-closed-outline',
      label: user.blocked ? 'Unblock' : 'Block',
      destructive: !user.blocked,
      onPress: handleToggleBlock,
    },
    { key: 'remove', icon: 'trash-outline', label: 'Remove user', destructive: true, onPress: confirmRemove },
  ];

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </Pressable>
        <Pressable onPress={() => { hapticTap(); setSheetOpen(true); }} hitSlop={10} disabled={busy}>
          <Ionicons name="ellipsis-horizontal" size={24} color={busy ? colors.textMuted : colors.accent} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: space.xl * 2 }}>
        <View style={styles.identity}>
          <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <Text style={styles.name}>{user.name}</Text>
          <Text style={styles.handle}>@{user.username}</Text>
          <View style={styles.badgeRow}>
            {user.blocked ? (
              <View style={[styles.badge, { backgroundColor: colors.dangerDim }]}>
                <Ionicons name="lock-closed" size={12} color={colors.danger} />
                <Text style={[styles.badgeText, { color: colors.danger }]}>Blocked</Text>
              </View>
            ) : null}
            {user.muted ? (
              <View style={[styles.badge, { backgroundColor: colors.surfaceRaised }]}>
                <Ionicons name="notifications-off" size={12} color={colors.textMuted} />
                <Text style={[styles.badgeText, { color: colors.textMuted }]}>Muted</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.lastSeen}>{lastSeenLabel(user.lastActiveAt)}</Text>
        </View>

        <View style={styles.actionsRow}>
          <ActionButton
            icon="chatbubble-ellipses-outline"
            label="Message"
            colors={colors}
            styles={styles}
            onPress={() => router.push(`/bot/${id}/user/${userId}/history`)}
          />
          <ActionButton
            icon={user.muted ? 'notifications-off' : 'notifications-off-outline'}
            label={user.muted ? 'Unmute' : 'Mute'}
            colors={colors}
            styles={styles}
            active={user.muted}
            onPress={handleToggleMute}
          />
          <ActionButton
            icon={user.blocked ? 'lock-closed' : 'lock-closed-outline'}
            label={user.blocked ? 'Unblock' : 'Block'}
            colors={colors}
            styles={styles}
            danger={!user.blocked}
            active={user.blocked}
            onPress={handleToggleBlock}
          />
        </View>

        <Text style={styles.sectionLabel}>Info</Text>
        <View style={styles.card}>
          <Row icon="at-outline" label="Username" value={`@${user.username}`} onPress={() => handleCopy(`@${user.username}`, 'Username')} styles={styles} colors={colors} />
          <View style={styles.hairline} />
          <Row icon="finger-print-outline" label="User ID" value={user.id} onPress={() => handleCopy(user.id, 'User ID')} styles={styles} colors={colors} />
          <View style={styles.hairline} />
          <Row icon="calendar-outline" label="Joined" value={dateLabel(user.joinedAt)} styles={styles} colors={colors} />
          <View style={styles.hairline} />
          <Row icon="chatbubbles-outline" label="Messages exchanged" value={`${user.messageCount ?? 0}`} styles={styles} colors={colors} />
        </View>

        <Text style={styles.sectionLabel}>Conversation</Text>
        <View style={styles.card}>
          <Row icon="time-outline" label="Message history" onPress={() => router.push(`/bot/${id}/user/${userId}/history`)} styles={styles} colors={colors} />
        </View>

        <Text style={styles.sectionLabel}>Danger zone</Text>
        <View style={styles.card}>
          <Row
            icon={user.blocked ? 'lock-open-outline' : 'lock-closed-outline'}
            label={user.blocked ? 'Unblock user' : 'Block user'}
            onPress={handleToggleBlock}
            styles={styles}
            colors={colors}
            danger={!user.blocked}
          />
          <View style={styles.hairline} />
          <Row icon="trash-outline" label="Remove user" onPress={confirmRemove} styles={styles} colors={colors} danger />
        </View>
      </ScrollView>

      <ActionSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title={user.name} actions={sheetActions} />
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xs, height: 44,
    },
    identity: { alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg },
    avatar: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: space.md },
    avatarText: { color: '#F2F4F6', fontSize: 30, fontWeight: '600' },
    name: { ...type.display, fontSize: 22, color: colors.textPrimary },
    handle: { ...type.dataSm, color: colors.textMuted, marginTop: 2 },
    badgeRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
    badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 4 },
    badgeText: { ...type.small, fontWeight: '600' },
    lastSeen: { ...type.small, color: colors.textMuted, marginTop: space.sm },
    actionsRow: {
      flexDirection: 'row', justifyContent: 'center', gap: space.xl,
      marginTop: space.sm, marginBottom: space.lg,
    },
    actionBtnWrap: { alignItems: 'center', gap: 6 },
    actionBtn: {
      width: 52, height: 52, borderRadius: 26,
      backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: colors.border,
    },
    actionLabel: { ...type.small, color: colors.textSecondary, fontWeight: '600' },
    sectionLabel: {
      ...type.small, color: colors.textMuted, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 0.6,
      marginTop: space.lg, marginBottom: space.sm, marginLeft: space.lg,
    },
    card: {
      marginHorizontal: space.lg, backgroundColor: colors.surface,
      borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
    },
    hairline: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: space.md + 30 + space.md },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, paddingHorizontal: space.md, gap: space.md },
    rowIcon: {
      width: 30, height: 30, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised,
      alignItems: 'center', justifyContent: 'center',
    },
    rowLabel: { ...type.body, color: colors.textPrimary, flex: 1 },
    rowValue: { ...type.body, color: colors.textMuted, marginRight: space.xs },
  });
}
