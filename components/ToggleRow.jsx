import { useMemo } from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { type, space, useTheme } from '../theme';
import { hapticSwitch } from '../utils/haptics';

// A single iOS Settings-style row: label (+ optional helper line) on the
// left, a native Switch on the right. Meant to be dropped straight into
// a <SettingsSection> as one of its children.
export default function ToggleRow({ label, helper, value, onValueChange, disabled, icon }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  return (
    <View style={[styles.row, disabled && { opacity: 0.5 }]}>
      <View style={{ flex: 1, marginRight: space.md }}>
        <Text style={styles.label}>{label}</Text>
        {helper ? <Text style={styles.helper}>{helper}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={(v) => { hapticSwitch(); onValueChange(v); }}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor="#FFFFFF"
        ios_backgroundColor={colors.border}
      />
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md },
    label: { ...type.body, color: colors.textPrimary, fontWeight: '500' },
    helper: { ...type.small, color: colors.textMuted, marginTop: 2, lineHeight: 15 },
  });
}
