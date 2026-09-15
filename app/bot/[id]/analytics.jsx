import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { type, space, radius, useTheme } from '../../../theme';
import { SkeletonBox } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/StateViews';
import { fetchBotAnalytics, fetchBotAnalyticsDaily } from '../../../botsApi';

// PHASE 13 — real day-of-week label derived from the actual date string the
// server returns for each bucket (`YYYY-MM-DD`, UTC), not a hardcoded
// Mon..Sun sequence — the prior version assumed the 7 entries always ended
// on a Sunday, which silently mislabeled every bar on any other day of the
// week.
function weekdayLabel(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
}

function StatCard({ label, value, styles }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function BarChart({ daily, styles, colors }) {
  const max = Math.max(1, ...daily.map((d) => d.messages));
  return (
    <View style={styles.chartCard}>
      <Text style={styles.chartTitle}>Messages, last {daily.length} days</Text>
      <View style={styles.chartBars}>
        {daily.map((d) => (
          <View key={d.date} style={styles.chartCol}>
            <View style={styles.chartTrack}>
              <View style={[styles.chartFill, { height: `${Math.max(4, (d.messages / max) * 100)}%`, backgroundColor: colors.accent }]} />
            </View>
            <Text style={styles.chartDayLabel}>{weekdayLabel(d.date)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function BotAnalyticsScreen() {
  const { id } = useLocalSearchParams();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [summary, setSummary] = useState(null);
  const [daily, setDaily] = useState(null);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [summaryData, dailyData] = await Promise.all([
        fetchBotAnalytics(id),
        fetchBotAnalyticsDaily(id, 7),
      ]);
      setSummary(summaryData);
      setDaily(dailyData);
      setPhase('ready');
    } catch (e) {
      setPhase('error');
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function retry() {
    setPhase('loading');
    await load();
  }

  if (phase === 'loading') {
    return (
      <View style={styles.screen}>
        <View style={{ padding: space.lg }}>
          <View style={styles.statsRow}>
            <SkeletonBox width="100%" height={72} radius={radius.md} style={{ flex: 1 }} />
            <SkeletonBox width="100%" height={72} radius={radius.md} style={{ flex: 1 }} />
            <SkeletonBox width="100%" height={72} radius={radius.md} style={{ flex: 1 }} />
          </View>
          <SkeletonBox width="100%" height={40} radius={radius.md} style={{ marginTop: space.md }} />
          <SkeletonBox width="100%" height={180} radius={radius.lg} style={{ marginTop: space.lg }} />
        </View>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.screen}>
        <ErrorState message="Couldn't load analytics for this bot." onRetry={retry} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 2 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textMuted} />}
    >
      <View style={styles.statsRow}>
        <StatCard label="Messages today" value={summary.messagesToday} styles={styles} />
        <StatCard label="Active users" value={summary.activeUsers} styles={styles} />
        <StatCard label="Total users" value={summary.totalUsers} styles={styles} />
      </View>

      <View style={styles.statsRow2}>
        <StatCard label="Total messages" value={summary.totalMessages} styles={styles} />
        <StatCard label="Inbound" value={summary.inboundMessages} styles={styles} />
        <StatCard label="Outbound" value={summary.outboundMessages} styles={styles} />
      </View>

      <View style={{ marginTop: space.lg }}>
        <BarChart daily={daily} styles={styles} colors={colors} />
      </View>

      <Text style={styles.footNote}>
        {daily.reduce((a, d) => a + d.messages, 0)} messages exchanged in the last {daily.length} days.
      </Text>
    </ScrollView>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    statsRow: { flexDirection: 'row', gap: space.sm },
    statsRow2: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
    statCard: {
      flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, padding: space.md, alignItems: 'center',
    },
    statValue: { ...type.dataLg, color: colors.textPrimary },
    statLabel: { ...type.small, color: colors.textMuted, marginTop: 4, textAlign: 'center' },
    chartCard: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.lg, padding: space.lg,
    },
    chartTitle: { ...type.body, color: colors.textSecondary, marginBottom: space.md },
    chartBars: { flexDirection: 'row', height: 120, alignItems: 'flex-end', gap: space.sm },
    chartCol: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
    chartTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
    chartFill: { width: '100%', borderRadius: 4 },
    chartDayLabel: { ...type.small, color: colors.textMuted, marginTop: space.xs },
    footNote: { ...type.small, color: colors.textMuted, textAlign: 'center', marginTop: space.lg },
  });
}
