import { useEffect, useRef } from 'react';
import { Pressable, View, Text, Animated, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, type, space } from '../theme';

// Used for "Remember me" and the terms agreement. `children` can be plain
// text or a mix of <Text> nodes (so a screen can make part of the label,
// e.g. "Terms of Service", independently tappable).
export default function Checkbox({ checked, onToggle, children }) {
  const scale = useRef(new Animated.Value(checked ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(scale, { toValue: checked ? 1 : 0, useNativeDriver: true, speed: 26, bounciness: 10 }).start();
  }, [checked]);

  return (
    <View style={styles.row}>
      <Pressable onPress={onToggle} style={[styles.box, checked && styles.boxChecked]} hitSlop={8}>
        <Animated.View style={{ transform: [{ scale }] }}>
          <Ionicons name="checkmark" size={13} color="#1A1006" />
        </Animated.View>
      </Pressable>
      <Pressable onPress={onToggle} style={{ flex: 1 }} hitSlop={4}>
        <Text style={styles.label}>{children}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, marginBottom: space.lg },
  box: {
    width: 20,
    height: 20,
    borderRadius: 5,
    marginTop: 1,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  boxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  label: { ...type.small, color: colors.textSecondary, lineHeight: 18 },
});
