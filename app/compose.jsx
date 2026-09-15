import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { type, space, radius, useTheme } from '../theme';

// Every entry here routes to a real destination. Anything without a real
// backend behind it (e.g. a "New Group" flow — there is no group
// membership model in the Worker) is deliberately not listed, rather
// than shown as a button that silently does nothing.
const OPTIONS = [
  // Opens Search on the People tab: pick someone you already know and a
  // direct conversation with them opens (see app/search.jsx).
  { key: 'direct', icon: 'person-outline', label: 'New Message', route: '/search?tab=usernames' },
  // Opens Search on the Bots tab: pick one of your bots to open its
  // conversation.
  { key: 'bot-convo', icon: 'hardware-chip-outline', label: 'New Bot Conversation', route: '/search?tab=bots' },
  { key: 'search', icon: 'search-outline', label: 'Search Everything', route: '/search' },
  { key: 'create-bot', icon: 'add-circle-outline', label: 'Create Bot', route: '/create-bot' },
  // Server Relay is read-only — this opens the relay list, never a
  // create/edit flow (see app/(tabs)/relay.jsx).
  { key: 'relay', icon: 'git-network-outline', label: 'Server Relay', route: '/relay' },
];

export default function ComposeScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const router = useRouter();
  return (
    <View style={styles.screen}>
      {OPTIONS.map((o) => (
        <Pressable
          key={o.key}
          onPress={() => router.replace(o.route)}
          accessibilityRole="button"
          accessibilityLabel={o.label}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceRaised }]}
        >
          <View style={styles.icon}>
            <Ionicons name={o.icon} size={18} color={colors.textSecondary} />
          </View>
          <Text style={styles.label}>{o.label}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>
      ))}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: space.md },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: space.md, paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  icon: {
    width: 34, height: 34, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  label: { ...type.body, color: colors.textPrimary, fontWeight: '500', flex: 1 },
});
