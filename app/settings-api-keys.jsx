import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { type, space, radius, useTheme } from '../theme';
import HeaderIconButton from '../components/HeaderIconButton';
import ActionSheet from '../components/ActionSheet';
import { SkeletonList } from '../components/Skeleton';
import { ErrorState, EmptyState } from '../components/StateViews';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { fetchApiKeys, revokeApiKey } from '../devPlatformStore';

function timeAgo(ts) {
  if (!ts) return 'Never used';
  const diff = Date.now() - ts;
  const min = 60 * 1000, hr = 60 * min, day = 24 * hr;
  if (diff < min) return 'Used just now';
  if (diff < hr) return `Used ${Math.floor(diff / min)}m ago`;
  if (diff < day) return `Used ${Math.floor(diff / hr)}h ago`;
  return `Used ${Math.floor(diff / day)}d ago`;
}

function dateStr(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const SCOPE_COLORS = {
  'Full access': '#FF8A3D',
  'Read only': '#5856D6',
  'Bots only': '#34C759',
};

export default function ApiKeysScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const toast = useToast();
  const confirm = useConfirm();
  const [keys, setKeys] = useState([]);
  const [phase, setPhase] = useState('loading');
  const [sheetKey, setSheetKey] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const list = await fetchApiKeys();
      setKeys(list);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const loaded = phase !== 'loading';

  async function copyPrefix(key) {
    await Clipboard.setStringAsync(key.prefix);
    toast.success('Prefix copied');
  }

  async function confirmRevoke(key) {
    const ok = await confirm({
      title: 'Revoke API Key?',
      message: `"${key.name}" will stop working immediately. Any scripts or agents using it will need a new key.`,
      confirmLabel: 'Revoke',
      destructive: true,
      onConfirm: async () => {
        setBusyId(key.id);
        const next = await revokeApiKey(key.id);
        setKeys(next);
        setBusyId(null);
      },
    });
    if (ok) toast.show(`"${key.name}" revoked`);
  }

  const sheetActions = sheetKey
    ? [
        { key: 'copy', label: 'Copy Key Prefix', icon: 'copy-outline', onPress: () => copyPrefix(sheetKey) },
        { key: 'revoke', label: 'Revoke Key', icon: 'trash-outline', destructive: true, onPress: () => confirmRevoke(sheetKey) },
      ]
    : [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: 'API Keys',
          headerRight: () => <HeaderIconButton icon="add" onPress={() => router.push('/settings-api-key-create')} />,
        }}
      />
      {phase === 'loading' ? (
        <View style={{ padding: space.lg }}>
          <SkeletonList count={4} />
        </View>
      ) : phase === 'error' ? (
        <ErrorState message="Couldn't load your API keys." onRetry={load} />
      ) : (
      <FlatList
        data={keys}
        keyExtractor={(k) => k.id}
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 3, flexGrow: 1 }}
        ListHeaderComponent={
          loaded && keys.length > 0 ? (
            <Text style={styles.helperTop}>
              Keys authenticate scripts and agents calling the botmanager API on your behalf. Anyone holding a key has that key's level of access — treat them like passwords.
            </Text>
          ) : null
        }
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setSheetKey(item)}
            disabled={busyId === item.id}
            style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.surfaceRaised }, busyId === item.id && { opacity: 0.5 }]}
          >
            <View style={[styles.iconBox, { backgroundColor: SCOPE_COLORS[item.scope] || colors.accent }]}>
              <Ionicons name="key" size={16} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1, marginLeft: space.md }}>
              <View style={styles.titleRow}>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.scopeTag}>{item.scope}</Text>
              </View>
              <Text style={styles.prefix} numberOfLines={1}>{item.prefix}{'•'.repeat(24)}</Text>
              <Text style={styles.meta}>Created {dateStr(item.createdAt)} · {timeAgo(item.lastUsedAt)}</Text>
            </View>
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
          </Pressable>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="key-outline"
            title="No API Keys"
            message="Create one to let a script or agent call the API."
            actionLabel="Create Key"
            onAction={() => router.push('/settings-api-key-create')}
          />
        }
      />
      )}

      <ActionSheet visible={!!sheetKey} onClose={() => setSheetKey(null)} title={sheetKey?.name} actions={sheetActions} />
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
    iconBox: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    name: { ...type.h2, fontSize: 15, color: colors.textPrimary, flexShrink: 1 },
    scopeTag: {
      ...type.small, fontSize: 10, fontWeight: '700', color: colors.textMuted,
      borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
      paddingHorizontal: 5, paddingVertical: 1, textTransform: 'uppercase', letterSpacing: 0.3,
    },
    prefix: { ...type.dataSm, color: colors.accent, marginTop: 3 },
    meta: { ...type.small, color: colors.textMuted, marginTop: 2 },
    empty: { alignItems: 'center', gap: space.sm, paddingTop: space.xl },
    emptyText: { ...type.small, color: colors.textMuted, textAlign: 'center', lineHeight: 17, paddingHorizontal: space.xl },
  });
}
