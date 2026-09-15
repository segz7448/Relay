import { Pressable, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, type, space, radius } from '../theme';
import StatusPill from './StatusPill';

export default function RelayGroupRow({ group, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceRaised }]}
    >
      <View style={styles.icon}>
        <Ionicons name="git-network-outline" size={19} color={colors.textSecondary} />
      </View>
      <View style={styles.main}>
        <Text style={styles.name}>{group.name}</Text>
        <Text style={styles.members}>{group.members} bot{group.members === 1 ? '' : 's'} relayed</Text>
      </View>
      <StatusPill status={group.status} />
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
  icon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  main: { flex: 1 },
  name: { ...type.h2, color: colors.textPrimary },
  members: { ...type.dataSm, color: colors.textMuted, marginTop: 2 },
});
