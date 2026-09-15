import { useMemo, useRef } from 'react';
import { Animated, View, Text, Pressable, Switch, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type, space, useTheme } from '../theme';
import { hapticSwitch, hapticTap } from '../utils/haptics';
import { SkeletonBox } from './Skeleton';

// A single row for a <SettingsSection> card. Three shapes, matching
// Telegram's own Settings list:
//   - nav row:    icon + label + chevron, onPress pushes a sub-screen
//   - toggle row: icon + label + Switch
//   - action row: centered label only (e.g. "Log Out"), no icon/chevron
export default function SettingsRow({
  icon,
  iconColor = '#8E8E93',
  label,
  value,
  valueLoading,
  onPress,
  toggle, // { value, onValueChange }
  chevron,
  destructive,
  disabled,
  center,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const showChevron = chevron ?? (!!onPress && !toggle && !center);
  const scale = useRef(new Animated.Value(1)).current;

  const onPressIn = () => Animated.spring(scale, { toValue: 0.975, speed: 40, bounciness: 0, useNativeDriver: true }).start();
  const onPressOut = () => Animated.spring(scale, { toValue: 1, speed: 20, bounciness: 8, useNativeDriver: true }).start();

  const content = (
    <View style={[styles.row, center && styles.rowCenter, disabled && styles.disabled]}>
      {icon ? (
        <View style={[styles.iconBox, { backgroundColor: iconColor }]}>
          <Ionicons name={icon} size={16} color="#FFFFFF" />
        </View>
      ) : null}
      <Text
        style={[styles.label, destructive && { color: colors.danger }, center && styles.labelCenter]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {!center ? <View style={{ flex: 1 }} /> : null}
      {valueLoading ? (
        <SkeletonBox width={36} height={11} radius={4} style={{ marginLeft: space.sm }} />
      ) : value ? (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {toggle ? (
        <Switch
          value={toggle.value}
          onValueChange={(v) => { hapticSwitch(); toggle.onValueChange(v); }}
          disabled={disabled}
          trackColor={{ false: colors.border, true: colors.accent }}
          thumbColor="#FFFFFF"
          ios_backgroundColor={colors.border}
        />
      ) : showChevron ? (
        <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
      ) : null}
    </View>
  );

  // Toggle rows: only the Switch itself is interactive (matches ToggleRow),
  // avoiding a Pressable-around-Switch nested-gesture conflict.
  if (toggle || !onPress) return content;

  return (
    <Pressable
      onPress={() => { hapticTap(); onPress(); }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      accessibilityRole={toggle ? 'switch' : onPress ? 'button' : 'text'}
      accessibilityLabel={typeof label === 'string' ? label : undefined}
      accessibilityState={{ disabled: !!disabled, ...(toggle ? { checked: !!toggle.value } : {}) }}
    >
      {({ pressed }) => (
        <Animated.View style={[{ transform: [{ scale }] }, pressed && !disabled ? { backgroundColor: colors.surfaceRaised } : null]}>
          {content}
        </Animated.View>
      )}
    </Pressable>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 46,
      paddingVertical: space.sm,
      gap: space.sm,
    },
    rowCenter: { justifyContent: 'center' },
    disabled: { opacity: 0.5 },
    iconBox: { width: 29, height: 29, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
    label: { ...type.body, color: colors.textPrimary },
    labelCenter: { textAlign: 'center', fontWeight: '600' },
    value: { ...type.body, color: colors.textMuted, marginLeft: space.sm, maxWidth: 140 },
  });
}
