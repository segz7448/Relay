import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, Switch, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../theme';
import { SkeletonList } from '../components/Skeleton';
import { ErrorState, EmptyState } from '../components/StateViews';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { hapticSwitch } from '../utils/haptics';
import { fetchDevices, removeDevice, setDevicePush } from '../privacyApi';

function daysAgo(ts) {
  const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export default function DevicesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const toast = useToast();
  const confirm = useConfirm();
  const [devices, setDevices] = useState([]);
  const [phase, setPhase] = useState('loading');

  const load = useCallback(async () => {
    try {
      const list = await fetchDevices();
      setDevices(list);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function confirmRemove(device) {
    const ok = await confirm({
      title: 'Remove Device?',
      message: `${device.name} will stop syncing and lose access to push notifications for this account.`,
      confirmLabel: 'Remove',
      destructive: true,
      onConfirm: async () => setDevices(await removeDevice(device.id)),
    });
    if (ok) toast.show('Device removed');
  }

  async function togglePush(device, value) {
    hapticSwitch();
    setDevices((list) => list.map((d) => (d.id === device.id ? { ...d, pushEnabled: value } : d)));
    try {
      await setDevicePush(device.id, value);
    } catch {
      setDevices((list) => list.map((d) => (d.id === device.id ? { ...d, pushEnabled: !value } : d)));
      toast.error("Couldn't update push settings");
    }
  }

  if (phase === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: space.lg }}>
        <SkeletonList count={4} />
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ErrorState message="Couldn't load your devices." onRetry={load} />
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 3, flexGrow: 1 }}
      data={devices}
      keyExtractor={(d) => d.id}
      ListEmptyComponent={<EmptyState icon="hardware-chip-outline" title="No Devices" message="Devices are added automatically the first time you sign in." />}
      ListFooterComponent={
        devices.length > 0 ? (
          <Text style={styles.footer}>
            Devices are added automatically the first time you sign in. Removing a device here doesn't sign it
            out — use Active Sessions for that.
          </Text>
        ) : null
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={[styles.iconBox, { backgroundColor: item.current ? colors.accent : colors.textMuted }]}>
              <Ionicons name={item.platform.includes('iOS') || item.platform.includes('iPad') ? 'phone-portrait' : 'laptop'} size={17} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1, marginLeft: space.md }}>
              <View style={styles.titleRow}>
                <Text style={styles.name}>{item.name}</Text>
                {item.current ? <Text style={styles.currentTag}>This Device</Text> : null}
              </View>
              <Text style={styles.meta}>{item.platform}</Text>
              <Text style={styles.meta}>Last synced {daysAgo(item.lastSynced)} · Added {daysAgo(item.addedAt)}</Text>
            </View>
          </View>
          <View style={styles.separator} />
          <View style={styles.actionRow}>
            <Text style={styles.pushLabel}>Push Notifications</Text>
            <Switch
              value={item.pushEnabled}
              onValueChange={(v) => togglePush(item, v)}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor="#FFFFFF"
              ios_backgroundColor={colors.border}
            />
          </View>
          {!item.current ? (
            <Pressable onPress={() => confirmRemove(item)} style={({ pressed }) => [styles.removeRow, pressed && { opacity: 0.6 }]}>
              <Ionicons name="trash-outline" size={15} color={colors.danger} />
              <Text style={styles.removeLabel}>Remove Device</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    />
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, padding: space.md, marginBottom: space.sm,
    },
    row: { flexDirection: 'row', alignItems: 'flex-start' },
    iconBox: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    name: { ...type.h2, fontSize: 15, color: colors.textPrimary },
    currentTag: {
      ...type.small, color: colors.online, backgroundColor: colors.onlineDim,
      paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, fontWeight: '700', fontSize: 10,
    },
    meta: { ...type.small, color: colors.textMuted, marginTop: 2 },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space.sm },
    actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    pushLabel: { ...type.body, color: colors.textPrimary },
    removeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm },
    removeLabel: { ...type.small, color: colors.danger, fontWeight: '600' },
    footer: { ...type.small, color: colors.textMuted, marginTop: space.sm, lineHeight: 16 },
  });
}
