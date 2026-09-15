import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { type, space, radius, useTheme } from '../theme';
import Avatar from '../components/Avatar';
import ActionSheet from '../components/ActionSheet';
import { SkeletonList } from '../components/Skeleton';
import { ErrorState, EmptyState } from '../components/StateViews';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { fetchBots, rotateBotToken } from '../botsApi';

function dateStr(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function BotTokensScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const toast = useToast();
  const confirm = useConfirm();
  const [bots, setBots] = useState([]);
  const [phase, setPhase] = useState('loading');
  const [sheetBot, setSheetBot] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [revealed, setRevealed] = useState(null); // { bot, token }
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchBots();
      setBots(list);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const loaded = phase !== 'loading';

  async function copyPrefix(bot) {
    await Clipboard.setStringAsync(bot.tokenPrefix);
    toast.success('Prefix copied');
  }

  async function confirmRotate(bot) {
    await confirm({
      title: 'Regenerate Token?',
      message: `The current token for @${bot.username} will stop working immediately. Update it anywhere this bot is deployed.`,
      confirmLabel: 'Regenerate',
      destructive: true,
      onConfirm: async () => {
        setBusyId(bot.id);
        const token = await rotateBotToken(bot.id);
        const list = await fetchBots();
        setBots(list);
        setBusyId(null);
        setRevealed({ bot, token });
      },
    });
  }

  async function copyRevealed() {
    if (!revealed) return;
    await Clipboard.setStringAsync(revealed.token);
    setCopied(true);
    toast.success('Token copied');
  }

  const sheetActions = sheetBot
    ? [
        { key: 'copy', label: 'Copy Token Prefix', icon: 'copy-outline', onPress: () => copyPrefix(sheetBot) },
        { key: 'open', label: 'Open Bot', icon: 'open-outline', onPress: () => router.push(`/bot/${sheetBot.id}`) },
        { key: 'rotate', label: 'Regenerate Token', icon: 'refresh', destructive: true, onPress: () => confirmRotate(sheetBot) },
      ]
    : [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {phase === 'loading' ? (
        <View style={{ padding: space.lg }}>
          <SkeletonList count={4} />
        </View>
      ) : phase === 'error' ? (
        <ErrorState message="Couldn't load your bots." onRetry={load} />
      ) : (
      <FlatList
        data={bots}
        keyExtractor={(b) => b.id}
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 3, flexGrow: 1 }}
        ListHeaderComponent={
          loaded && bots.length > 0 ? (
            <Text style={styles.helperTop}>
              Every bot gets a unique token, just like BotFather — this is what your bot's server uses to authenticate with botmanager and receive updates.
            </Text>
          ) : null
        }
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setSheetBot(item)}
            disabled={busyId === item.id}
            style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.surfaceRaised }, busyId === item.id && { opacity: 0.5 }]}
          >
            <Avatar name={item.name} size={38} />
            <View style={{ flex: 1, marginLeft: space.md }}>
              <View style={styles.titleRow}>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                {!item.enabled ? <Text style={styles.disabledTag}>Disabled</Text> : null}
              </View>
              <Text style={styles.prefix} numberOfLines={1}>{item.tokenPrefix}:{'•'.repeat(20)}</Text>
              <Text style={styles.meta}>@{item.username} · created {dateStr(item.createdAt)}</Text>
            </View>
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
          </Pressable>
        )}
        ListEmptyComponent={
          <EmptyState icon="hardware-chip-outline" title="No Bots Yet" message="Create one from the Messages tab to get its token." />
        }
      />
      )}

      <ActionSheet visible={!!sheetBot} onClose={() => setSheetBot(null)} title={sheetBot ? `@${sheetBot.username}` : null} actions={sheetActions} />

      {revealed ? (
        <View style={styles.revealBackdrop}>
          <View style={styles.revealCard}>
            <Ionicons name="checkmark-circle" size={32} color={colors.online} style={{ alignSelf: 'center', marginBottom: space.sm }} />
            <Text style={styles.revealTitle}>New token for @{revealed.bot.username}</Text>
            <Text style={styles.revealWarning}>Copy it now — it won't be shown again.</Text>
            <View style={styles.secretBox}>
              <Text style={styles.secretText} selectable>{revealed.token}</Text>
            </View>
            <Pressable style={styles.copyBtn} onPress={copyRevealed}>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={colors.textPrimary} />
              <Text style={styles.copyBtnLabel}>{copied ? 'Copied' : 'Copy Token'}</Text>
            </Pressable>
            <Pressable style={styles.doneBtn} onPress={() => { setRevealed(null); setCopied(false); }}>
              <Text style={styles.doneBtnLabel}>Done</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    helperTop: { ...type.small, color: colors.textMuted, marginBottom: space.lg, lineHeight: 17 },
    card: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, padding: space.md,
    },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    name: { ...type.h2, fontSize: 15, color: colors.textPrimary, flexShrink: 1 },
    disabledTag: {
      ...type.small, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase',
      fontSize: 10, letterSpacing: 0.4, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.sm, paddingHorizontal: 5, paddingVertical: 1,
    },
    prefix: { ...type.dataSm, color: colors.accent, marginTop: 3 },
    meta: { ...type.small, color: colors.textMuted, marginTop: 2 },
    empty: { alignItems: 'center', gap: space.sm, paddingTop: space.xl },
    emptyText: { ...type.small, color: colors.textMuted, textAlign: 'center', lineHeight: 17, paddingHorizontal: space.xl },
    revealBackdrop: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: space.lg,
    },
    revealCard: {
      width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.lg, padding: space.lg,
    },
    revealTitle: { ...type.h1, fontSize: 17, color: colors.textPrimary, textAlign: 'center', marginBottom: space.xs },
    revealWarning: { ...type.small, color: colors.warning, textAlign: 'center', marginBottom: space.md, lineHeight: 16 },
    secretBox: {
      backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, padding: space.md, marginBottom: space.md,
    },
    secretText: { ...type.dataSm, fontSize: 13, color: colors.accent, lineHeight: 19 },
    copyBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs,
      borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: space.md, marginBottom: space.sm,
    },
    copyBtnLabel: { ...type.body, color: colors.textPrimary, fontWeight: '600' },
    doneBtn: { alignItems: 'center', paddingVertical: space.sm },
    doneBtnLabel: { ...type.body, color: colors.accent, fontWeight: '700' },
  });
}
