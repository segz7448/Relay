import { View, Text, StyleSheet } from 'react-native';
import { colors, type, space, radius } from '../theme';

const CONFIG = {
  online:  { dot: colors.online,  bg: colors.onlineDim,  label: 'Online' },
  offline: { dot: colors.textMuted, bg: colors.surfaceRaised, label: 'Offline' },
  error:   { dot: colors.danger,  bg: colors.dangerDim,  label: 'Error' },
};

export default function StatusPill({ status = 'offline' }) {
  const c = CONFIG[status] ?? CONFIG.offline;
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <View style={[styles.dot, { backgroundColor: c.dot }]} />
      <Text style={[styles.label, { color: c.dot }]}>{c.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    gap: space.xs,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { ...type.small, fontWeight: '600' },
});
