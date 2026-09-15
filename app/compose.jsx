import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, type, space, radius } from '../theme';

const OPTIONS = [
  { key: 'direct', icon: 'person-outline', label: 'New 1-v-1 Message' },
  { key: 'bot-convo', icon: 'hardware-chip-outline', label: 'New Bot Conversation' },
  { key: 'group', icon: 'people-outline', label: 'New Group' },
  { key: 'relay', icon: 'git-network-outline', label: 'New Server Relay' },
  { key: 'search-users', icon: 'search-outline', label: 'Search Users' },
  { key: 'search-bots', icon: 'search-outline', label: 'Search Bots' },
  { key: 'create-bot', icon: 'add-circle-outline', label: 'Create Bot' },
];

export default function ComposeScreen() {
  const router = useRouter();

  function choose(key) {
    switch (key) {
      case 'create-bot':
        router.replace('/create-bot');
        return;
      case 'relay':
        router.replace('/relay');
        return;
      case 'search-bots':
        router.back();
        // The bots search field already lives on the Messages/relay lists —
        // no dedicated search screen exists yet for this shortcut.
        return;
      default:
        // 1-v-1, bot conversation, group, and user search don't have a
        // destination screen yet — this menu just wires up the entry point.
        router.back();
        return;
    }
  }

  return (
    <View style={styles.screen}>
      {OPTIONS.map((o) => (
        <Pressable
          key={o.key}
          onPress={() => choose(o.key)}
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

const styles = StyleSheet.create({
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
