import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../theme';
import { SkeletonBox, SkeletonList } from '../components/Skeleton';
import { ErrorState } from '../components/StateViews';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { fetchSessions, terminateSession, terminateAllOtherSessions } from '../privacyApi';

const DEVICE_ICONS = {
  iPhone: 'phone-portrait',
  Pixel: 'phone-portrait',
  Chrome: 'desktop',
  Unrecognized: 'help-circle',
};

function iconFor(device) {
  const hit = Object.keys(DEVICE_ICONS).find((k) => device.includes(k));
  return DEVICE_ICONS[hit] || 'hardware-chip';
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const min = 60 * 1000, hr = 60 * min, day = 24 * hr;
  if (diff < min) return 'just now';
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}

export default function ActiveSessionsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const toast = useToast();
  const confirm = useConfirm();
  const [sessions, setSessions] = useState([]);
  const [busy, setBusy] = useState(null);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'

  const load = useCallback(async () => {
    try {
      const list = await fetchSessions();
      setSessions(list);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function confirmTerminate(session) {
    const ok = await confirm({
      title: 'End This Session?',
      message: `${session.device} will be signed out of botmanager immediately.`,
      confirmLabel: 'End Session',
      destructive: true,
      onConfirm: async () => {
        setBusy(session.id);
        const next = await terminateSession(session.id);
        setSessions(next);
        setBusy(null);
      },
    });
    if (ok) toast.show('Session ended');
  }

  async function confirmTerminateAll() {
    const ok = await confirm({
      title: 'End All Other Sessions?',
      message: 'This will log out botmanager on all your other devices except this one.',
      confirmLabel: 'End All',
      destructive: true,
      onConfirm: async () => {
        setBusy('all');
        const next = await terminateAllOtherSessions();
        setSessions(next);
        setBusy(null);
      },
    });
    if (ok) toast.show('All other sessions ended');
  }

  const otherSessions = sessions.filter((s) => !s.current);
  const currentSession = sessions.find((s) => s.current);

  if (phase === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg }}>
        <SkeletonBox width="100%" height={90} radius={radius.md} style={{ marginBottom: space.lg }} />
        <SkeletonList count={4} />
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ErrorState message="Couldn't load your sessions." onRetry={load} />
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 3 }}
      data={otherSessions}
      keyExtractor={(s) => s.id}
      ListHeaderComponent={
        <View>
          {currentSession ? (
            <View style={{ marginBottom: space.lg }}>
              <Text style={styles.sectionLabel}>This Device</Text>
              <SessionCard session={currentSession} styles={styles} colors={colors} />
            </View>
          ) : null}
          {otherSessions.length > 0 ? (
            <View style={styles.otherHeader}>
              <Text style={styles.sectionLabel}>Active Sessions</Text>
              <Pressable onPress={confirmTerminateAll} disabled={busy === 'all'}>
                <Text style={styles.terminateAll}>{busy === 'all' ? 'Ending…' : 'End All'}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      }
      ListFooterComponent={
        <Text style={styles.footer}>
          Terminating a session will log that device out of botmanager. It'll need to sign in again to reconnect.
        </Text>
      }
      renderItem={({ item }) => (
        <View style={{ marginBottom: space.sm }}>
          <SessionCard session={item} styles={styles} colors={colors} onEnd={() => confirmTerminate(item)} busy={busy === item.id} />
        </View>
      )}
    />
  );
}

function SessionCard({ session, styles, colors, onEnd, busy }) {
  return (
    <View style={[styles.card, session.flagged && styles.cardFlagged]}>
      <View style={[styles.iconBox, { backgroundColor: session.flagged ? colors.danger : colors.accent }]}>
        <Ionicons name={iconFor(session.device)} size={18} color="#FFFFFF" />
      </View>
      <View style={{ flex: 1, marginLeft: space.md }}>
        <View style={styles.titleRow}>
          <Text style={styles.device}>{session.device}</Text>
          {session.current ? <Text style={styles.currentTag}>This Device</Text> : null}
          {session.flagged ? <Text style={styles.flagTag}>Unrecognized</Text> : null}
        </View>
        <Text style={styles.app}>{session.app}</Text>
        <Text style={styles.meta}>{session.location} · {session.ip}</Text>
        <Text style={styles.meta}>{session.current ? 'Active now' : timeAgo(session.lastActive)}</Text>
      </View>
      {onEnd ? (
        <Pressable onPress={onEnd} disabled={busy} hitSlop={10}>
          <Text style={styles.endLabel}>{busy ? 'Ending…' : 'End'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    sectionLabel: {
      ...type.small, color: colors.textMuted, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: space.sm,
    },
    otherHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md },
    terminateAll: { ...type.small, color: colors.danger, fontWeight: '700' },
    card: {
      flexDirection: 'row', alignItems: 'flex-start',
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, padding: space.md,
    },
    cardFlagged: { borderColor: colors.danger },
    iconBox: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
    device: { ...type.h2, fontSize: 15, color: colors.textPrimary },
    currentTag: {
      ...type.small, color: colors.online, backgroundColor: colors.onlineDim,
      paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, fontWeight: '700', fontSize: 10,
    },
    flagTag: {
      ...type.small, color: colors.danger, backgroundColor: colors.dangerDim,
      paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, fontWeight: '700', fontSize: 10,
    },
    app: { ...type.small, color: colors.textSecondary, marginTop: 3 },
    meta: { ...type.small, color: colors.textMuted, marginTop: 1 },
    endLabel: { ...type.small, color: colors.danger, fontWeight: '700', marginLeft: space.sm },
    footer: { ...type.small, color: colors.textMuted, marginTop: space.md, lineHeight: 16 },
  });
}
