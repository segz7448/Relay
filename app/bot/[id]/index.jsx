import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Image, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, avatarPalette, useTheme } from '../../../theme';
import StatusPill from '../../../components/StatusPill';
import ActionSheet from '../../../components/ActionSheet';
import { SkeletonCircle, SkeletonBox } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/StateViews';
import { useToast } from '../../../components/Toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { useStatusBurst } from '../../../components/StatusBurst';
import { hapticTap } from '../../../utils/haptics';
import { fetchBot, setBotEnabled, deleteBot } from '../../../botsApi';

function hashColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return avatarPalette[h % avatarPalette.length];
}

function Row({ icon, label, value, onPress, styles, colors, danger }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceRaised }]}
    >
      <View style={[styles.rowIcon, danger && { backgroundColor: colors.dangerDim }]}>
        <Ionicons name={icon} size={16} color={danger ? colors.danger : colors.textSecondary} />
      </View>
      <Text style={[styles.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
      {value ? <Text style={styles.rowValue} numberOfLines={1}>{value}</Text> : null}
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

export default function BotDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const toast = useToast();
  const confirm = useConfirm();
  const burst = useStatusBurst();

  const [bot, setBot] = useState(null);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const b = await fetchBot(id);
      if (!b) throw new Error('bot_not_found');
      setBot(b);
      setPhase('ready');
    } catch (e) {
      setPhase('error');
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function retry() {
    setPhase('loading');
    await load();
  }

  async function handleCopy(value, label) {
    await Clipboard.setStringAsync(value);
    toast.success(`${label} copied`);
  }

  async function handleToggleEnabled() {
    setBusy(true);
    try {
      const updated = await setBotEnabled(id, !bot.enabled);
      setBot(updated);
      toast.show(updated.enabled ? 'Bot enabled' : 'Bot disabled');
    } catch (e) {
      toast.error("Couldn't update this bot");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    const ok = await confirm({
      title: 'Delete bot?',
      message: `Delete "${bot.name}"? This removes its conversation and can't be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        await deleteBot(id);
      },
    });
    if (!ok) return;
    burst.success('Bot deleted');
    router.replace('/');
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
          <SkeletonCircle size={88} style={{ borderRadius: 44, marginBottom: space.md }} />
          <SkeletonBox width={140} height={20} />
          <SkeletonBox width={100} height={12} style={{ marginTop: space.sm }} />
        </View>
        <View style={{ paddingHorizontal: space.lg, gap: space.sm, marginTop: space.lg }}>
          <SkeletonBox width="100%" height={230} radius={radius.lg} />
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
        <ErrorState message="Couldn't load this bot. Check your connection and try again." onRetry={retry} />
      </View>
    );
  }

  const avatarColor = bot.avatarColor || hashColor(bot.name);
  const initials = bot.name.trim().slice(0, 1).toUpperCase();

  const sheetActions = [
    { key: 'edit', icon: 'create-outline', label: 'Edit bot', onPress: () => router.push(`/bot/${id}/edit`) },
    { key: 'rotate', icon: 'key-outline', label: 'Rotate token', onPress: () => router.push(`/bot/${id}/settings`) },
    {
      key: 'disable',
      icon: bot.enabled ? 'pause-circle-outline' : 'play-circle-outline',
      label: bot.enabled ? 'Disable bot' : 'Enable bot',
      onPress: handleToggleEnabled,
    },
    { key: 'copy-id', icon: 'finger-print-outline', label: 'Copy bot ID', onPress: () => handleCopy(id, 'Bot ID') },
    { key: 'copy-username', icon: 'at-outline', label: 'Copy bot username', onPress: () => handleCopy(`@${bot.username}`, 'Username') },
    { key: 'delete', icon: 'trash-outline', label: 'Delete bot', destructive: true, onPress: confirmDelete },
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
          {bot.profileImage ? (
            <Image source={{ uri: bot.profileImage }} style={styles.avatarImg} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          )}
          <Text style={styles.name}>{bot.name}</Text>
          <Text style={styles.handle}>@{bot.username}</Text>
          <View style={{ marginTop: space.sm }}>
            <StatusPill status={bot.enabled ? bot.status : 'offline'} />
          </View>
          {bot.description ? <Text style={styles.description}>{bot.description}</Text> : null}
        </View>

        <Text style={styles.sectionLabel}>Bot</Text>
        <View style={styles.card}>
          <Row icon="terminal-outline" label="Commands" value={`${bot.commands.length}`} onPress={() => router.push(`/bot/${id}/commands`)} styles={styles} colors={colors} />
          <View style={styles.hairline} />
          <Row icon="chatbubbles-outline" label="Messages" onPress={() => router.push(`/conversation/${id}`)} styles={styles} colors={colors} />
          <View style={styles.hairline} />
          <Row icon="people-outline" label="Users" value={`${bot.users.length}`} onPress={() => router.push(`/bot/${id}/users`)} styles={styles} colors={colors} />
          <View style={styles.hairline} />
          <Row icon="document-attach-outline" label="Files" onPress={() => router.push(`/bot/${id}/files`)} styles={styles} colors={colors} />
          <View style={styles.hairline} />
          <Row icon="stats-chart-outline" label="Analytics" onPress={() => router.push(`/bot/${id}/analytics`)} styles={styles} colors={colors} />
          <View style={styles.hairline} />
          <Row icon="settings-outline" label="Settings" onPress={() => router.push(`/bot/${id}/settings`)} styles={styles} colors={colors} />
        </View>

        <Text style={styles.sectionLabel}>Danger zone</Text>
        <View style={styles.card}>
          <Row icon="trash-outline" label="Delete bot" onPress={confirmDelete} styles={styles} colors={colors} danger />
        </View>
      </ScrollView>

      <ActionSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title={bot.name} actions={sheetActions} />
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
    avatarImg: { width: 88, height: 88, borderRadius: 44, marginBottom: space.md },
    avatarText: { color: '#F2F4F6', fontSize: 30, fontWeight: '600' },
    name: { ...type.display, fontSize: 22, color: colors.textPrimary },
    handle: { ...type.dataSm, color: colors.textMuted, marginTop: 2 },
    description: { ...type.body, color: colors.textSecondary, textAlign: 'center', marginTop: space.md, lineHeight: 19 },
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
