import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Share, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../../theme';
import Avatar from '../../components/Avatar';
import { PrimaryButton } from '../../components/Button';
import ActionSheet from '../../components/ActionSheet';
import { SkeletonCircle, SkeletonBox } from '../../components/Skeleton';
import { ErrorState } from '../../components/StateViews';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { fetchConversation, startDirectConversation } from '../../messagesApi';
import { fetchBlockedUsers, blockUser, unblockUser, fetchDirectoryUser } from '../../privacyApi';
import { useProfile } from '../../profileStore';

const REPORT_REASONS = [
  { key: 'spam', label: 'Spam' },
  { key: 'scam', label: 'Scam or fraud' },
  { key: 'harassment', label: 'Harassment or abuse' },
  { key: 'impersonation', label: 'Impersonation' },
  { key: 'other', label: 'Something else' },
];

function presence(convo) {
  if (!convo) return { label: '', online: false };
  if (convo.typing) return { label: 'typing…', online: true };
  if (convo.online) return { label: 'online', online: true };
  const ts = convo.lastSeen;
  if (!ts) return { label: 'last seen recently', online: false };
  const diff = Date.now() - ts;
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < 2 * min) return { label: 'last seen just now', online: false };
  if (diff < hr) return { label: `last seen ${Math.floor(diff / min)}m ago`, online: false };
  if (diff < day) return { label: `last seen ${Math.floor(diff / hr)}h ago`, online: false };
  return { label: `last seen ${Math.floor(diff / day)}d ago`, online: false };
}

function ActionButton({ icon, label, onPress, danger, colors, styles }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.6 }]}>
      <View style={[styles.actionIcon, danger && { backgroundColor: colors.dangerDim }]}>
        <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.accent} />
      </View>
      <Text style={[styles.actionLabel, danger && { color: colors.danger }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function Row({ icon, label, onPress, danger, value, colors, styles }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceRaised }]}>
      <View style={[styles.rowIcon, danger && { backgroundColor: colors.dangerDim }]}>
        <Ionicons name={icon} size={16} color={danger ? colors.danger : colors.textSecondary} />
      </View>
      <Text style={[styles.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {!danger ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

export default function ProfileScreen() {
  const { id, source } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { profile: ownProfile } = useProfile();
  const isSelf = id === 'me';
  const confirm = useConfirm();
  const toast = useToast();

  const [convo, setConvo] = useState(null);
  const [phase, setPhase] = useState(isSelf ? 'ready' : 'loading'); // 'loading' | 'ready' | 'error'
  const [blocked, setBlocked] = useState(false);
  const [reportSheetOpen, setReportSheetOpen] = useState(false);

  const load = useCallback(async () => {
    if (isSelf) {
      setPhase('ready');
      return;
    }
    try {
      const c = source === 'directory' ? await fetchDirectoryUser(id) : await fetchConversation(id);
      if (!c) throw new Error('not_found');
      setConvo(c);
      const blockedList = await fetchBlockedUsers();
      setBlocked(blockedList.some((b) => b.id === id || (c.username && b.username === c.username)));
      setPhase('ready');
    } catch (e) {
      setPhase('error');
    }
  }, [id, isSelf, source]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function retry() {
    setPhase('loading');
    await load();
  }

  const person = isSelf
    ? { name: ownProfile.name || 'You', username: ownProfile.username, bio: ownProfile.bio, photo: ownProfile.photo }
    : convo;

  async function handleShareProfile() {
    const username = person?.username;
    const message = username
      ? `${person.name} on Botmanager — https://botmanager.app/u/${username}`
      : `${person?.name} on Botmanager`;
    try {
      await Share.share({ message });
    } catch {
      // sheet dismissed / share failed — nothing to recover
    }
  }

  async function handleToggleBlock() {
    if (blocked) {
      const ok = await confirm({
        title: 'Unblock',
        message: `Unblock ${convo.name}? They'll be able to message and call you again.`,
        confirmLabel: 'Unblock',
        onConfirm: async () => {
          await unblockUser(id);
        },
      });
      if (ok) {
        setBlocked(false);
        toast.success(`Unblocked ${convo.name}`);
      }
    } else {
      const ok = await confirm({
        title: 'Block',
        message: `Block ${convo.name}? They won't be able to message or call you.`,
        confirmLabel: 'Block',
        destructive: true,
        onConfirm: async () => {
          await blockUser({ id, name: convo.name, username: convo.username });
        },
      });
      if (ok) {
        setBlocked(true);
        toast.success(`Blocked ${convo.name}`);
      }
    }
  }

  function handleReport(reason) {
    toast.success(`Thanks — we've received your report (${reason.label.toLowerCase()}).`);
  }

  if (!isSelf && phase === 'loading') {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={colors.accent} />
          </Pressable>
        </View>
        <View style={styles.identity}>
          <SkeletonCircle size={96} style={{ marginBottom: space.md }} />
          <SkeletonBox width={150} height={20} />
          <SkeletonBox width={100} height={12} style={{ marginTop: space.sm }} />
        </View>
        <View style={styles.actionsRow}>
          <SkeletonBox width={68} height={68} radius={25} />
          <SkeletonBox width={68} height={68} radius={25} />
          <SkeletonBox width={68} height={68} radius={25} />
        </View>
        <View style={{ paddingHorizontal: space.lg, marginTop: space.md }}>
          <SkeletonBox width="100%" height={100} radius={radius.lg} />
        </View>
      </View>
    );
  }
  if (!isSelf && phase === 'error') {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={colors.accent} />
          </Pressable>
        </View>
        <ErrorState message="Couldn't load this profile. Check your connection and try again." onRetry={retry} />
      </View>
    );
  }

  const pres = presence(convo);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </Pressable>
        {!isSelf ? (
          <Pressable onPress={() => setReportSheetOpen(true)} hitSlop={10}>
            <Ionicons name="ellipsis-horizontal" size={24} color={colors.accent} />
          </Pressable>
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: space.xl * 2 }}>
        <View style={styles.identity}>
          <Avatar uri={person?.photo || person?.photoUrl} name={person?.name} size={96} />
          <Text style={styles.name}>{person?.name}</Text>
          {person?.username ? <Text style={styles.handle}>@{person.username}</Text> : null}
          {!isSelf ? (
            <Text style={[styles.presence, pres.online && { color: colors.accent }]}>{pres.label}</Text>
          ) : null}
          {person?.bio ? <Text style={styles.bio}>{person.bio}</Text> : null}
        </View>

        {isSelf ? (
          <View style={{ paddingHorizontal: space.lg, marginTop: space.sm }}>
            <PrimaryButton label="Edit Profile" icon="create-outline" onPress={() => router.push('/edit-profile')} />
          </View>
        ) : (
          <>
            <View style={styles.actionsRow}>
              <ActionButton icon="chatbubble-ellipses" label="Message" colors={colors} styles={styles} onPress={async () => { const c = source === 'directory' ? await startDirectConversation(convo) : convo; router.push(`/conversation/${c.id}`); }} />
              <ActionButton icon="share-outline" label="Share" colors={colors} styles={styles} onPress={handleShareProfile} />
            </View>

            <Text style={styles.sectionLabel}>Actions</Text>
            <View style={styles.card}>
              <Row
                icon={blocked ? 'checkmark-circle-outline' : 'ban-outline'}
                label={blocked ? 'Unblock User' : 'Block User'}
                danger={!blocked}
                colors={colors}
                styles={styles}
                onPress={handleToggleBlock}
              />
              <View style={styles.hairline} />
              <Row icon="flag-outline" label="Report" danger colors={colors} styles={styles} onPress={() => setReportSheetOpen(true)} />
            </View>
          </>
        )}
      </ScrollView>

      <ActionSheet
        visible={reportSheetOpen}
        onClose={() => setReportSheetOpen(false)}
        title="Report this contact"
        actions={REPORT_REASONS.map((r) => ({ key: r.key, label: r.label, icon: 'flag-outline', destructive: true, onPress: () => handleReport(r) }))}
      />
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
    avatar: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: space.md },
    avatarImg: { width: 96, height: 96, borderRadius: 48, marginBottom: space.md },
    avatarText: { color: '#F2F4F6', fontSize: 34, fontWeight: '600' },
    name: { ...type.display, fontSize: 22, color: colors.textPrimary },
    handle: { ...type.dataSm, color: colors.textMuted, marginTop: 2 },
    presence: { ...type.small, color: colors.textMuted, marginTop: 4 },
    bio: { ...type.body, color: colors.textSecondary, textAlign: 'center', marginTop: space.md, lineHeight: 19 },
    actionsRow: {
      flexDirection: 'row', justifyContent: 'center', gap: space.xl,
      paddingVertical: space.md, marginHorizontal: space.lg,
    },
    actionBtn: { alignItems: 'center', width: 68 },
    actionIcon: {
      width: 50, height: 50, borderRadius: 25, backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.border,
      alignItems: 'center', justifyContent: 'center', marginBottom: space.xs,
    },
    actionLabel: { ...type.small, color: colors.textPrimary },
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
