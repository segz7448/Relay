import { View, Text, StyleSheet } from 'react-native';
import { colors, type, space, radius } from '../theme';

// A horizontal bank of bars, like a console VU meter, standing in for
// live messages/sec. Deliberately not a card+number — this tool's whole
// point is throughput, so the meter is the hero, not a decoration.
export default function ThroughputMeter({ label, value, unit, bars = 24, level = 0.6 }) {
  const lit = Math.round(bars * level);
  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>
          {value}
          <Text style={styles.unit}> {unit}</Text>
        </Text>
      </View>
      <View style={styles.bars}>
        {Array.from({ length: bars }).map((_, i) => {
          const on = i < lit;
          const hot = i > bars * 0.85;
          return (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  backgroundColor: on
                    ? (hot ? colors.warning : colors.accent)
                    : colors.surfaceRaised,
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: space.md,
  },
  label: { ...type.body, color: colors.textSecondary },
  value: { ...type.dataLg, color: colors.textPrimary },
  unit: { ...type.dataSm, color: colors.textMuted, fontWeight: '400' },
  bars: { flexDirection: 'row', gap: 3, height: 28, alignItems: 'flex-end' },
  bar: { flex: 1, height: '100%', borderRadius: 2 },
});
