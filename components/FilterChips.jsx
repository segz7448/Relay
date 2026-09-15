import { useMemo } from 'react';
import { ScrollView, Pressable, Text, StyleSheet } from 'react-native';
import { type, space, radius, useTheme } from '../theme';

// Horizontal row of pill filters — Recent / Missed / Incoming / etc.
// Single-select; the active pill gets the accent fill.
export default function FilterChips({ options, value, onChange }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <Pressable key={opt.key} onPress={() => onChange(opt.key)} style={[styles.chip, active && styles.chipActive]}>
            <Text style={[styles.label, active && styles.labelActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    row: { paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.sm },
    chip: {
      paddingHorizontal: space.md, paddingVertical: 7, borderRadius: radius.xl,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    label: { ...type.small, color: colors.textSecondary, fontWeight: '600' },
    labelActive: { color: colors.onAccent },
  });
}
