import { useCallback, useState } from 'react';
import { View, Text, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useTheme, type, space } from '../../../theme';
import { SkeletonList } from '../../../components/Skeleton';
import { EmptyState, ErrorState } from '../../../components/StateViews';
import { fetchBotActivity } from '../../../botsApi';

// PHASE 13 — this screen previously rendered a fixed array of five
// made-up log lines (fabricated update_ids, a fabricated 429 rate-limit
// error, fabricated latencies) behind a fake 450ms delay meant to look
// like a loading network call. None of it came from this bot. It's now
// wired to the real `GET /bots/:id/activity` endpoint (worker/src/routes/
// bots.ts), which returns this bot's actual `bot_messages` rows via
// `botMessageShape` — real direction, real text, real timestamp.
//
// There's no per-message delivery-status/error log in this schema (no
// column tracks a webhook response code per message), so unlike the old
// fake feed this only ever shows two real directions — inbound / outbound
// — rather than inventing a third "error" state nothing here actually
// measures.
const DIRECTION_COLOR = (colors) => ({ in: colors.online, out: colors.accent });
const DIRECTION_LABEL = { in: 'Received', out: 'Sent' };

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function eventText(item) {
  if (item.text) return item.text;
  if (item.attachment) return `[${item.attachment.kind || 'attachment'}]`;
  return '(empty message)';
}

export default function BotActivityScreen() {
  const { id } = useLocalSearchParams();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const dirColor = DIRECTION_COLOR(colors);

  const [events, setEvents] = useState(null);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchBotActivity(id);
      setEvents(data);
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

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Activity</Text>
        <Text style={styles.subtitle}>bot {id} · recent messages</Text>
      </View>

      {phase === 'loading' ? (
        <View style={{ paddingTop: space.md }}>
          <SkeletonList count={6} />
        </View>
      ) : phase === 'error' ? (
        <ErrorState message="Couldn't load the activity feed." onRetry={retry} />
      ) : (
        <FlatList
          data={events}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ padding: space.lg, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textMuted} />}
          renderItem={({ item }) => (
            <View style={styles.line}>
              <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
              <View style={[styles.tick, { backgroundColor: dirColor[item.dir] }]} />
              <Text style={styles.text} numberOfLines={1}>{DIRECTION_LABEL[item.dir]} · {eventText(item)}</Text>
            </View>
          )}
          ListEmptyComponent={<EmptyState icon="pulse-outline" title="No activity yet" message="Events will appear here as soon as this bot starts receiving updates." />}
        />
      )}
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: { paddingHorizontal: space.lg, paddingTop: space.md },
    title: { ...type.h1, color: colors.textPrimary },
    subtitle: { ...type.dataSm, color: colors.textMuted, marginTop: 2 },
    line: { flexDirection: 'row', alignItems: 'center', marginBottom: space.sm, gap: space.sm },
    time: { ...type.dataSm, color: colors.textMuted, width: 92 },
    tick: { width: 6, height: 6, borderRadius: 3 },
    text: { ...type.dataSm, color: colors.textSecondary, flex: 1 },
  });
}
