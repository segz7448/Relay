import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../theme';
import { SkeletonList } from '../components/Skeleton';
import { ErrorState, EmptyState } from '../components/StateViews';
import { fetchLoginActivity } from '../privacyApi';

function formatWhen(ts) {
  const d = new Date(ts);
  const diff = Date.now() - ts;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function LoginActivityScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [entries, setEntries] = useState([]);
  const [phase, setPhase] = useState('loading');

  const load = useCallback(async () => {
    try {
      const list = await fetchLoginActivity();
      setEntries(list);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const failedCount = entries.filter((e) => e.status === 'failed').length;

  if (phase === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: space.lg }}>
        <SkeletonList count={6} />
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ErrorState message="Couldn't load login activity." onRetry={load} />
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 3, flexGrow: 1 }}
      data={entries}
      keyExtractor={(e) => e.id}
      ListEmptyComponent={<EmptyState icon="list-outline" title="No Activity Yet" message="Sign-in attempts on your account will show up here." />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListHeaderComponent={
        <View style={[styles.summary, failedCount > 0 && styles.summaryWarn]}>
          <Ionicons
            name={failedCount > 0 ? 'warning' : 'shield-checkmark'}
            size={18}
            color={failedCount > 0 ? colors.danger : colors.online}
          />
          <Text style={[styles.summaryText, { color: failedCount > 0 ? colors.danger : colors.online }]}>
            {failedCount > 0
              ? `${failedCount} failed sign-in attempt${failedCount > 1 ? 's' : ''} detected`
              : 'No suspicious activity detected'}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={[styles.dot, { backgroundColor: item.status === 'success' ? colors.online : colors.danger }]} />
          <View style={{ flex: 1, marginLeft: space.md }}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{item.status === 'success' ? 'Signed in' : 'Sign-in failed'}</Text>
              <Text style={styles.time}>{formatWhen(item.at)}</Text>
            </View>
            <Text style={styles.meta}>{item.device} · {item.location}</Text>
            <Text style={styles.meta}>{item.ip}{item.reason ? ` · ${item.reason}` : ''}</Text>
          </View>
        </View>
      )}
    />
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    summary: {
      flexDirection: 'row', alignItems: 'center', gap: space.sm,
      backgroundColor: colors.onlineDim, borderRadius: radius.md, padding: space.md, marginBottom: space.lg,
    },
    summaryWarn: { backgroundColor: colors.dangerDim },
    summaryText: { ...type.small, fontWeight: '700', flex: 1 },
    row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: space.sm },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
    dot: { width: 9, height: 9, borderRadius: 5, marginTop: 5 },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { ...type.body, color: colors.textPrimary, fontWeight: '600' },
    time: { ...type.small, color: colors.textMuted },
    meta: { ...type.small, color: colors.textMuted, marginTop: 2 },
  });
}
