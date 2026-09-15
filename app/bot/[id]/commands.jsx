import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, Switch, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type, space, radius, useTheme } from '../../../theme';
import HeaderIconButton from '../../../components/HeaderIconButton';
import { SkeletonList } from '../../../components/Skeleton';
import { EmptyState, ErrorState } from '../../../components/StateViews';
import { useToast } from '../../../components/Toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { hapticSwitch } from '../../../utils/haptics';
import { fetchBot, setCommandEnabled, removeCommand } from '../../../botsApi';

function CommandRow({ item, onPress, onToggle, onDelete, styles, colors }) {
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceRaised }, !item.enabled && styles.rowDisabled]}
    >
      <View style={{ flex: 1 }}>
        <View style={styles.commandLine}>
          <Text style={[styles.command, !item.enabled && styles.mutedText]}>/{item.command}</Text>
          {!item.enabled ? <Text style={styles.disabledTag}>Disabled</Text> : null}
        </View>
        {item.description ? <Text style={[styles.description, !item.enabled && styles.mutedText]} numberOfLines={1}>{item.description}</Text> : null}
        <View style={styles.actionLine}>
          <Ionicons name="flash-outline" size={12} color={colors.textMuted} />
          <Text style={styles.actionText} numberOfLines={1}>{item.actionType}{item.actionValue ? ` · ${item.actionValue}` : ''}</Text>
        </View>
      </View>

      <Switch
        value={item.enabled}
        onValueChange={() => onToggle(item)}
        trackColor={{ false: colors.surfaceRaised, true: colors.accentDim }}
        thumbColor={item.enabled ? colors.accent : colors.textMuted}
      />
      <Pressable onPress={() => onDelete(item)} hitSlop={10} style={styles.deleteBtn}>
        <Ionicons name="trash-outline" size={17} color={colors.danger} />
      </Pressable>
    </Pressable>
  );
}

export default function BotCommandsScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const toast = useToast();
  const confirm = useConfirm();

  const [bot, setBot] = useState(null);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'

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

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function retry() {
    setPhase('loading');
    await load();
  }

  async function handleToggle(cmd) {
    hapticSwitch();
    const nextEnabled = !cmd.enabled;
    setBot((b) => ({ ...b, commands: b.commands.map((c) => (c.id === cmd.id ? { ...c, enabled: nextEnabled } : c)) }));
    try {
      await setCommandEnabled(id, cmd.id, nextEnabled);
    } catch (e) {
      toast.error("Couldn't update that command");
      setBot((b) => ({ ...b, commands: b.commands.map((c) => (c.id === cmd.id ? { ...c, enabled: !nextEnabled } : c)) }));
    }
  }

  async function confirmDelete(cmd) {
    const ok = await confirm({
      title: 'Delete command?',
      message: `Delete /${cmd.command}? This can't be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        const updated = await removeCommand(id, cmd.id);
        setBot(updated);
      },
    });
    if (ok) toast.success(`/${cmd.command} deleted`);
  }

  if (phase === 'loading') {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Commands' }} />
        <View style={{ paddingTop: space.md }}>
          <SkeletonList count={5} />
        </View>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Commands' }} />
        <ErrorState message="Couldn't load this bot's commands." onRetry={retry} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: 'Commands',
          headerRight: () => <HeaderIconButton icon="add" size={30} onPress={() => router.push(`/bot/${id}/command-edit`)} />,
        }}
      />
      <FlatList
        data={bot.commands}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xl, flexGrow: 1 }}
        ListHeaderComponent={
          bot.commands.length ? (
            <Text style={styles.helperTop}>
              This list appears to people typing “/” in a chat with @{bot.username} — just like /setcommands in BotFather. Tap a command to edit it, or add a new one above.
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <CommandRow item={item} onPress={(c) => router.push(`/bot/${id}/command-edit?commandId=${c.id}`)} onToggle={handleToggle} onDelete={confirmDelete} styles={styles} colors={colors} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        ListEmptyComponent={
          <EmptyState
            icon="terminal-outline"
            title="No commands yet"
            message="Add /start to give people a way in."
            actionLabel="Add command"
            onAction={() => router.push(`/bot/${id}/command-edit`)}
          />
        }
      />
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    helperTop: { ...type.small, color: colors.textMuted, marginBottom: space.lg, lineHeight: 17 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: space.sm,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, padding: space.md,
    },
    rowDisabled: { opacity: 0.65 },
    commandLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    command: { ...type.dataSm, fontSize: 15, color: colors.accent, fontWeight: '600' },
    disabledTag: {
      ...type.small, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase',
      fontSize: 10, letterSpacing: 0.4,
      borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
      paddingHorizontal: 5, paddingVertical: 1,
    },
    description: { ...type.small, color: colors.textSecondary, marginTop: 3 },
    actionLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
    actionText: { ...type.small, color: colors.textMuted, flexShrink: 1 },
    mutedText: { color: colors.textMuted },
    deleteBtn: { paddingLeft: space.xs },
  });
}
