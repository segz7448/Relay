import { Pressable, View, Text, StyleSheet } from 'react-native';
import { colors, type, space, radius } from '../theme';
import StatusPill from './StatusPill';

export default function BotRow({ bot, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${bot.name}, @${bot.username}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceRaised }]}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{bot.name.slice(0, 1).toUpperCase()}</Text>
      </View>

      <View style={styles.main}>
        <Text style={styles.name}>{bot.name}</Text>
        <Text style={styles.handle}>@{bot.username}</Text>
      </View>

      <View style={styles.right}>
        <Text style={styles.rate}>{bot.msgsPerSec}/s</Text>
        <StatusPill status={bot.status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: space.md,
  },
  avatar: {
    width: 38, height: 38, borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  avatarText: { ...type.h2, color: colors.textSecondary },
  main: { flex: 1 },
  name: { ...type.h2, color: colors.textPrimary },
  handle: { ...type.dataSm, color: colors.textMuted, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: space.xs },
  rate: { ...type.dataSm, color: colors.textSecondary },
});
